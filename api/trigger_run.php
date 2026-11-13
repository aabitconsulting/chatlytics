<?php
declare(strict_types=1);

/**
 * Chatlytics.de — One-Time Pre-Start Test Run Dispatcher (Feature 18 / Flow B)
 * File: api/trigger_run.php
 *
 * Dispatches the single pre-start test run (`is_test_run = 1`) for a configuration
 * before "Full Start" (`full_started_at`) is activated.
 *
 * Responsibilities:
 * 1. Strict Authentication: Enforces `requireAuth(false)` and `requireWritePermission`
 *    (Magic Audit mode is strictly forbidden from triggering live runs).
 * 2. Multi-Tenant Scoping: Verifies `config_id` exists and belongs to the authenticated user.
 * 3. Pre-Start Lifecycle Enforcement:
 *    - Rejects with 409 Conflict if `full_started_at` is already set (Full Start is active).
 *    - Rejects with 409 Conflict if `initial_test_used` is already 1 (1x test run already used).
 * 4. Atomic Credit & Test Flag Reservation: Calculates required credits (LLM count * Prompt count),
 *    deducts balance, and marks `initial_test_used = 1`.
 * 5. Provider Cost-Optimization & Correlation (`custom_id`):
 *    - Generates a unique `custom_id` and deterministic `prompt_cache_key` for every prompt × LLM item,
 *      persisting each request in `batch_requests` (`is_test_run = 1`).
 * 6. Rollback on Failure: If n8n is unreachable, times out, or returns a 5xx error,
 *    atomically refunds the reserved credits, resets `initial_test_used = 0`, and removes pending batch items.
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
ensureCoreSchemaColumns($db);
ensureUserResultsTable($db, $userId);

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

// Enforce Flow B: One-Time Pre-Start Test Run Lifecycle
if (!empty($config['full_started_at'])) {
    jsonError(
        "Full Data Mining has already started for this configuration. Manual test runs are locked; configuration can only be paused or resumed.",
        409,
        [
            'config_id'         => $configId,
            'full_started_at'   => $config['full_started_at'],
            'initial_test_used' => true,
        ]
    );
}

if (!empty($config['initial_test_used'])) {
    jsonError(
        "The single pre-start test run has already been used for this configuration. Please activate Full Start to begin continuous daily Data Mining.",
        409,
        [
            'config_id'         => $configId,
            'initial_test_used' => true,
        ]
    );
}

// 4. Resolve Execution Parameters
$brandName = (string)$config['brand_name'];
$brandDomains = json_decode($config['brand_domains'] ?: '[]', true) ?? [];
$competitors = json_decode($config['competitors'] ?: '[]', true) ?? [];
$scheduleInterval = normalizeScheduleInterval((string)($config['schedule_interval'] ?? 'every_120m'));

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
    WHERE id = :user_id AND credits_remaining >= :cost_min
");
$deductStmt->execute([
    ':cost_min' => $requiredCredits,
    ':cost'     => $requiredCredits,
    ':user_id'  => $userId,
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

// Mark initial_test_used = 1 atomically before dispatching
$markTestStmt = $db->prepare("UPDATE tracking_configs SET initial_test_used = 1 WHERE id = :id");
$markTestStmt->execute([':id' => $configId]);

// 6. Generate custom_id & Provider Caching Metadata for Each Prompt × LLM Item
$runId = 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7);
$appConfig = getConfig();
$apiBaseUrl = rtrim((string)($appConfig['app']['base_url'] ?? 'https://chatlytics.de'), '/');
$webhookUrl = (string)($appConfig['n8n']['webhook_url'] ?? 'https://n8n.chatlytics.de/webhook/chatlytics-run');
$sharedSecret = (string)($appConfig['n8n']['shared_secret'] ?? '');

$batchItems = [];
$customIds = [];
$insBatchReq = $db->prepare("
    INSERT INTO batch_requests (
        custom_id, prompt_cache_key, execution_strategy,
        user_id, config_id, prompt, provider, model,
        brand_name, brand_domains, competitors,
        search_enabled, is_test_run, status, scheduled_for, submitted_at
    ) VALUES (
        :custom_id, :prompt_cache_key, :execution_strategy,
        :user_id, :config_id, :prompt, :provider, :model,
        :brand_name, :brand_domains, :competitors,
        :search_enabled, 1, 'submitted', NOW(), NOW()
    )
");

$domainsJson = json_encode($brandDomains, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$competitorsJson = json_encode($competitors, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

foreach ($prompts as $promptText) {
    foreach ($targetLLMs as $llmToken) {
        $spec = resolveTargetLlmSpec((string)$llmToken, $scheduleInterval);
        $customId = sprintf('cl_u%d_c%d_%d_%s', $userId, $configId, time(), substr(bin2hex(random_bytes(4)), 0, 8));
        $promptCacheKey = buildPromptCacheKey($configId, $promptText, $spec['id']);
        $providerCachingConfig = buildProviderCachingConfig($spec['provider'], $spec['model'], $promptCacheKey, $scheduleInterval);

        $insBatchReq->execute([
            ':custom_id'          => $customId,
            ':prompt_cache_key'   => $promptCacheKey,
            ':execution_strategy' => $spec['execution_strategy'],
            ':user_id'            => $userId,
            ':config_id'          => $configId,
            ':prompt'             => $promptText,
            ':provider'           => $spec['provider'],
            ':model'              => $spec['model'],
            ':brand_name'         => $brandName,
            ':brand_domains'      => $domainsJson,
            ':competitors'        => $competitorsJson,
            ':search_enabled'     => $searchEnabled ? 1 : 0,
        ]);

        $customIds[] = $customId;
        $batchItems[] = [
            'custom_id'               => $customId,
            'prompt_cache_key'        => $promptCacheKey,
            'execution_strategy'      => $spec['execution_strategy'],
            'provider_caching_config' => $providerCachingConfig,
            'prompt'                  => $promptText,
            'provider'                => $spec['provider'],
            'model'                   => $spec['model'],
            'target_llm'              => $spec['id'],
            'is_test_run'             => true,
        ];
    }
}

$firstItem = $batchItems[0] ?? [];
$webhookPayload = [
    'run_id'                  => $runId,
    'custom_id'               => $firstItem['custom_id'] ?? null,
    'prompt_cache_key'        => $firstItem['prompt_cache_key'] ?? null,
    'execution_strategy'      => $firstItem['execution_strategy'] ?? 'prompt_caching',
    'provider_caching_config' => $firstItem['provider_caching_config'] ?? null,
    'is_test_run'             => true,
    'batch_items'             => $batchItems,
    'api_base_url'            => $apiBaseUrl,
    'config_id'               => (int)$config['id'],
    'user_id'                 => $userId,
    'brand_name'              => $brandName,
    'brand_domains'           => $brandDomains,
    'prompt'                  => $prompts[0],
    'prompts'                 => $prompts,
    'competitors'             => $competitors,
    'target_llms'             => $targetLLMs,
    'schedule_interval'       => $scheduleInterval,
    'search_enabled'          => $searchEnabled,
    'response_mode'           => $mode,
    'created_at'              => date('Y-m-d\TH:i:s\Z'),
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
    // Atomic refund of reserved credits and reset initial_test_used = 0
    $refundStmt = $db->prepare("
        UPDATE users 
        SET credits_remaining = credits_remaining + :cost 
        WHERE id = :user_id
    ");
    $refundStmt->execute([
        ':cost'    => $requiredCredits,
        ':user_id' => $userId,
    ]);

    $resetTestStmt = $db->prepare("UPDATE tracking_configs SET initial_test_used = 0 WHERE id = :id");
    $resetTestStmt->execute([':id' => $configId]);

    if (!empty($customIds)) {
        $namedPlaceholders = [];
        $delParams = [];
        foreach (array_values($customIds) as $idx => $cid) {
            $ph = ':cid_' . $idx;
            $namedPlaceholders[] = $ph;
            $delParams[$ph] = $cid;
        }
        $placeholdersSql = implode(',', $namedPlaceholders);
        $delBrStmt = $db->prepare("DELETE FROM batch_requests WHERE custom_id IN ({$placeholdersSql})");
        $delBrStmt->execute($delParams);
    }

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
$updateStmt = $db->prepare("UPDATE tracking_configs SET last_run_at = NOW(), initial_test_used = 1 WHERE id = :id");
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
        'is_test_run'       => true,
        'initial_test_used' => true,
        'custom_ids'        => $customIds,
        'batch_items'       => $batchItems,
        'credits_deducted'  => $requiredCredits,
        'credits_remaining' => $newCredits,
        'expected_runs'     => $requiredCredits,
        'llm_count'         => $llmCount,
        'prompt_count'      => $promptCount,
        'results'           => $parsedResults,
        'message'           => 'Pre-start test run completed successfully.',
    ], 200);
} else {
    jsonResponse([
        'status'            => 'queued',
        'run_id'            => $runId,
        'config_id'         => (int)$config['id'],
        'response_mode'     => 'async',
        'is_test_run'       => true,
        'initial_test_used' => true,
        'custom_ids'        => $customIds,
        'batch_items'       => $batchItems,
        'credits_deducted'  => $requiredCredits,
        'credits_remaining' => $newCredits,
        'expected_runs'     => $requiredCredits,
        'llm_count'         => $llmCount,
        'prompt_count'      => $promptCount,
        'message'           => 'Pre-start test run dispatched successfully to worker queue.',
    ], 200);
}
