<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Execution Dispatcher (Feature 18)
 * File: api/trigger_run.php
 *
 * Dispatches on-demand and manual AI Visibility audit runs to the n8n
 * Universal Worker webhook (`POST /webhook/chatlytics-run`).
 *
 * Responsibilities:
 * 1. Strict Authentication: Enforces `requireAuth(false)` and `requireWritePermission`
 *    (Magic Audit mode is strictly forbidden from triggering live runs).
 * 2. Multi-Tenant Scoping: Verifies `config_id` exists and belongs to the authenticated user.
 * 3. Atomic Credit Reservation: Calculates required credits (LLM count * Prompt count)
 *    and atomically deducts balance (`credits_remaining >= :cost`). Rejects immediately if insufficient.
 * 4. Dual Execution Modes:
 *    - `async` (default): Sets 2s cURL timeout; awaits n8n fast queue ack (`200 OK {"status": "queued"}` in <200ms)
 *      and returns 200 OK with `queued` status and remaining credits.
 *    - `sync`: Sets 60s cURL timeout; blocks until n8n finishes computation and returns full run results.
 * 5. Rollback on Failure: If n8n is unreachable, times out, or returns a 5xx error,
 *    atomically refunds the reserved credits and returns 502/504 Bad Gateway / Gateway Timeout.
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

// Enforce POST method
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    jsonError("Method Not Allowed. Expected POST.", 405);
}

// 1. Authentication & Mutation Guard
$currentUser = requireAuth(false);
requireWritePermission($currentUser);
$userId = (int)$currentUser['id'];
$isAdmin = ($currentUser['role'] ?? '') === 'admin';

// 2. Parse & Validate Input Payload
$requestData = getRequestData();
$configId = isset($requestData['config_id']) ? (int)$requestData['config_id'] : (isset($_GET['config_id']) ? (int)$_GET['config_id'] : 0);

if ($configId <= 0) {
    jsonError("A valid config_id is required.", 422);
}

// 3. Multi-Tenant Config Resolution
$db = getDb();
$configStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id LIMIT 1");
$configStmt->execute([':id' => $configId]);
$config = $configStmt->fetch();

if (!$config) {
    jsonError("Configuration not found.", 404);
}

// Enforce strict tenant isolation
if ((int)$config['user_id'] !== $userId && !$isAdmin) {
    jsonError("Configuration not found.", 404);
}

// Ensure configuration is not archived
if (($config['status'] ?? '') === 'archived') {
    jsonError("Cannot trigger execution for an archived tracking configuration.", 400);
}

// 4. Resolve Execution Parameters
$brandName = (string)$config['brand_name'];
$brandDomains = json_decode($config['brand_domains'] ?: '[]', true) ?? [];
$competitors = json_decode($config['competitors'] ?: '[]', true) ?? [];

// Resolve target LLMs while preserving per-model granularity (including Mistral vs Z.ai GLM)
$rawTargetLLMs = $requestData['target_llms'] ?? json_decode($config['target_llms'] ?: '[]', true);
$targetLLMs = normalizeTargetLlmsList($rawTargetLLMs);

// Resolve search grounding enabled
if (isset($requestData['search_enabled'])) {
    $searchEnabled = ($requestData['search_enabled'] === true || $requestData['search_enabled'] === 1 || $requestData['search_enabled'] === '1' || $requestData['search_enabled'] === 'true');
} else {
    $searchEnabled = (bool)$config['search_enabled'];
}

// Resolve prompt(s) to evaluate
$prompts = [];
if (isset($requestData['prompt']) && trim((string)$requestData['prompt']) !== '') {
    $prompts = [trim((string)$requestData['prompt'])];
} elseif (isset($requestData['prompts'])) {
    $rawPrompts = $requestData['prompts'];
    if (is_string($rawPrompts)) {
        $rawPrompts = explode("\n", $rawPrompts);
    }
    if (is_array($rawPrompts)) {
        foreach ($rawPrompts as $p) {
            $cleaned = trim((string)$p);
            if ($cleaned !== '') {
                $prompts[] = $cleaned;
            }
        }
    }
}

if (empty($prompts)) {
    $configPrompts = json_decode($config['keywords_prompts'] ?: '[]', true) ?? [];
    if (is_array($configPrompts)) {
        foreach ($configPrompts as $p) {
            $cleaned = trim((string)$p);
            if ($cleaned !== '') {
                $prompts[] = $cleaned;
            }
        }
    }
}

if (empty($prompts)) {
    $prompts = ["Beste Empfehlungen und Produkte von {$brandName}"];
}

// Resolve execution mode: sync vs async
$rawMode = strtolower(trim((string)($requestData['response_mode'] ?? $requestData['mode'] ?? 'async')));
$mode = ($rawMode === 'sync') ? 'sync' : 'async';

// 5. Credit Pre-Check & Atomic Reservation
// Math: required credits = LLM count * Prompt count
$llmCount = count($targetLLMs);
$promptCount = count($prompts);
$requiredCredits = max(1, $llmCount * $promptCount);

// Atomic deduction with balance check in a single statement
$deductStmt = $db->prepare("
    UPDATE users 
    SET credits_remaining = credits_remaining - :cost 
    WHERE id = :user_id AND credits_remaining >= :cost
");
$deductStmt->execute([
    ':cost'    => $requiredCredits,
    ':user_id' => $userId,
]);

if ($deductStmt->rowCount() === 0) {
    // Insufficient credits: retrieve current balance for informative error
    $balStmt = $db->prepare("SELECT credits_remaining FROM users WHERE id = :user_id");
    $balStmt->execute([':user_id' => $userId]);
    $currentCredits = (int)$balStmt->fetchColumn();

    jsonError(
        "Insufficient credit balance. Required: {$requiredCredits}, available: {$currentCredits}.",
        402,
        [
            'required_credits'  => $requiredCredits,
            'credits_remaining' => $currentCredits,
        ]
    );
}

// 6. Build Webhook Payload & Execute cURL to n8n
$runId = 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7);
$appConfig = getConfig();
$webhookUrl = (string)($appConfig['n8n']['webhook_url'] ?? 'https://n8n.chatlytics.de/webhook/chatlytics-run');
$sharedSecret = (string)($appConfig['n8n']['shared_secret'] ?? '');

$webhookPayload = [
    'run_id'         => $runId,
    'config_id'      => (int)$config['id'],
    'user_id'        => $userId,
    'brand_name'     => $brandName,
    'brand_domains'  => $brandDomains,
    'prompt'         => $prompts[0],
    'prompts'        => $prompts,
    'competitors'    => $competitors,
    'target_llms'    => $targetLLMs,
    'search_enabled' => $searchEnabled,
    'response_mode'  => $mode,
    'created_at'     => date('Y-m-d\TH:i:s\Z'),
];

$timeoutSeconds = ($mode === 'sync') ? 60 : 2;

$ch = curl_init($webhookUrl);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($webhookPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => $timeoutSeconds,
    CURLOPT_CONNECTTIMEOUT => 2,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-N8N-Secret: ' . $sharedSecret,
        'X-Chatlytics-Webhook-Secret: ' . $sharedSecret,
    ],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
]);

$responseBody = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErrno = curl_errno($ch);
$curlError = curl_error($ch);
curl_close($ch);

// 7. Evaluate Webhook Response & Rollback on Failure
$isFailed = ($curlErrno !== 0) || ($httpCode >= 400) || ($mode === 'async' && $httpCode !== 200);

if ($isFailed) {
    // Atomic refund of reserved credits
    $refundStmt = $db->prepare("
        UPDATE users 
        SET credits_remaining = credits_remaining + :cost 
        WHERE id = :user_id
    ");
    $refundStmt->execute([
        ':cost'    => $requiredCredits,
        ':user_id' => $userId,
    ]);

    $statusCode = ($curlErrno === CURLE_OPERATION_TIMEDOUT) ? 504 : 502;
    $errorMessage = $curlError !== '' ? $curlError : "HTTP {$httpCode} from n8n webhook";

    jsonError(
        "Workflow execution failed: n8n engine unreachable or timed out ({$errorMessage}). Reserved credits have been refunded.",
        $statusCode,
        [
            'refunded_credits' => $requiredCredits,
            'http_code'        => $httpCode,
            'curl_errno'       => $curlErrno,
        ]
    );
}

// 8. Success: Update Tracking Config and Output Envelope
$updateStmt = $db->prepare("UPDATE tracking_configs SET last_run_at = NOW() WHERE id = :id");
$updateStmt->execute([':id' => (int)$config['id']]);

$credStmt = $db->prepare("SELECT credits_remaining FROM users WHERE id = :user_id");
$credStmt->execute([':user_id' => $userId]);
$newCredits = (int)$credStmt->fetchColumn();

if ($mode === 'sync') {
    $parsedResults = json_decode((string)$responseBody, true) ?: [];
    jsonResponse([
        'status'            => 'completed',
        'run_id'            => $runId,
        'config_id'         => (int)$config['id'],
        'response_mode'     => 'sync',
        'credits_deducted'  => $requiredCredits,
        'credits_remaining' => $newCredits,
        'results'           => $parsedResults,
        'message'           => 'Execution run completed successfully.',
    ], 200);
} else {
    jsonResponse([
        'status'            => 'queued',
        'run_id'            => $runId,
        'config_id'         => (int)$config['id'],
        'response_mode'     => 'async',
        'credits_deducted'  => $requiredCredits,
        'credits_remaining' => $newCredits,
        'message'           => 'Execution run dispatched successfully to worker queue.',
    ], 200);
}
