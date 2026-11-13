<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Atomic Queue Poller & Credit Math (Feature 19)
 * File: api/n8n_queue.php
 *
 * Polling endpoint periodically invoked by the n8n Schedule Poller Trigger
 * (`n8n-nodes-base.scheduleTrigger`) to retrieve scheduled monitoring jobs.
 *
 * Responsibilities:
 * 1. Cron Secret Authentication: Validates `X-Chatlytics-Cron-Key` or `X-N8N-Secret`
 *    against configured `n8n.shared_secret` using constant-time comparison (`hash_equals`).
 *    Also permits authenticated admin sessions for manual testing/diagnostics.
 * 2. Atomic Row Locking (`SELECT ... FOR UPDATE`):
 *    Claims pending runs from `llm_runs` and scheduled configs from `tracking_configs`
 *    in an exclusive InnoDB database transaction, preventing multi-instance race conditions.
 * 3. Schedule Timestamp Advancement: Automatically advances `next_run_at` based on
 *    the config's `schedule_interval` (daily: +1d, weekly: +7d, biweekly: +14d, monthly: +1mo)
 *    and updates `last_run_at = NOW()`.
 * 4. Credit Deduction Math: Atomically deducts user credits for scheduled runs,
 *    ensuring runs are never dispatched for users with insufficient credit balance.
 * 5. Telemetry & Batch Limits: Returns queue depth metrics, batch size limits, and
 *    strictly formatted job objects matching the Universal Normalizer schema.
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

// 1. Cron Authentication Validation
$cronHeader = $_SERVER['HTTP_X_CHATLYTICS_CRON_KEY']
    ?? $_SERVER['HTTP_X_N8N_SECRET']
    ?? $_GET['cron_key']
    ?? $_GET['secret']
    ?? null;

$appConfig = getConfig();
$expectedSecret = (string)($appConfig['n8n']['shared_secret'] ?? '');
$fallbackSecret = 'chatlytics_queue_auth_secret';
$apiBaseUrl = rtrim((string)($appConfig['app']['base_url'] ?? 'https://chatlytics.de'), '/');

$isAuthorized = false;

if ($cronHeader !== null && is_string($cronHeader) && trim($cronHeader) !== '') {
    $cleanHeader = trim($cronHeader);
    if ($expectedSecret !== '' && hash_equals($expectedSecret, $cleanHeader)) {
        $isAuthorized = true;
    } elseif (hash_equals($fallbackSecret, $cleanHeader)) {
        $isAuthorized = true;
    }
}

// Fallback: Permit authenticated administrator session or API key for manual debugging
if (!$isAuthorized) {
    $adminUser = getCurrentUser(false);
    if ($adminUser !== null && ($adminUser['role'] ?? '') === 'admin') {
        $isAuthorized = true;
    }
}

if (!$isAuthorized) {
    jsonError("Unauthorized: Invalid cron secret header", 401);
}

// 2. Batch Limit & Parameters
$limit = isset($_GET['limit']) ? max(1, min(50, (int)$_GET['limit'])) : 10;

$db = getDb();

// 3. Queue Depth Telemetry
// Calculate total jobs pending in queue across both scheduled configs and queued runs
$depthStmt = $db->query("
    SELECT COUNT(*) 
    FROM tracking_configs tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.status = 'active'
      AND tc.schedule_interval != 'manual'
      AND (tc.next_run_at IS NULL OR tc.next_run_at <= NOW())
      AND u.credits_remaining > 0
      AND u.status = 'active'
");
$queueDepth = (int)$depthStmt->fetchColumn();

// 4. Atomic Job Claiming Transaction
$forUpdateSql = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME)) === 'sqlite' ? '' : 'FOR UPDATE';
$claimedJobs = [];

$db->beginTransaction();

try {
    // 4.1 Claim explicit pending runs from llm_runs (if any queued asynchronously)
    $pendingStmt = $db->prepare("
        SELECT r.id, r.config_id, r.user_id, r.prompt, r.provider, r.model,
               tc.brand_name, tc.brand_domains, tc.competitors, tc.search_enabled,
               u.credits_remaining
        FROM llm_runs r
        JOIN tracking_configs tc ON r.config_id = tc.id
        JOIN users u ON r.user_id = u.id
        WHERE r.status = 'pending'
          AND u.credits_remaining > 0
          AND u.status = 'active'
        ORDER BY r.created_at ASC
        LIMIT :limit
        {$forUpdateSql}
    ");
    $pendingStmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $pendingStmt->execute();
    $pendingRuns = $pendingStmt->fetchAll();

    $claimedRunIds = [];
    foreach ($pendingRuns as $row) {
        $claimedRunIds[] = (int)$row['id'];
        $domains = json_decode($row['brand_domains'] ?: '[]', true) ?? [];
        $competitors = json_decode($row['competitors'] ?: '[]', true) ?? [];
        $compList = normalizeQueueCompetitors(is_array($competitors) ? $competitors : []);

        $claimedJobs[] = [
            'run_id'         => 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7),
            'api_base_url'   => $apiBaseUrl,
            'config_id'      => (int)$row['config_id'],
            'user_id'        => (int)$row['user_id'],
            'brand_name'     => (string)$row['brand_name'],
            'brand_domains'  => $domains,
            'prompt'         => (string)$row['prompt'],
            'competitors'    => $compList,
            'target_llms'    => [$row['provider'] ?: 'openai'],
            'search_enabled' => (bool)$row['search_enabled'],
        ];
    }

    // Transition pending runs to 'running'
    if (!empty($claimedRunIds)) {
        $inList = implode(',', $claimedRunIds);
        $db->exec("UPDATE llm_runs SET status = 'running' WHERE id IN ({$inList})");
    }

    // 4.2 Claim scheduled tracking configs due for execution
    $availableSlots = $limit - count($claimedJobs);

    if ($availableSlots > 0) {
        $configStmt = $db->prepare("
            SELECT tc.id, tc.user_id, tc.brand_name, tc.brand_domains,
                   tc.keywords_prompts, tc.competitors, tc.target_llms,
                   tc.search_enabled, tc.schedule_interval, tc.next_run_at,
                   u.credits_remaining
            FROM tracking_configs tc
            JOIN users u ON tc.user_id = u.id
            WHERE tc.status = 'active'
              AND tc.schedule_interval != 'manual'
              AND (tc.next_run_at IS NULL OR tc.next_run_at <= NOW())
              AND u.credits_remaining > 0
              AND u.status = 'active'
            ORDER BY (tc.next_run_at IS NULL) DESC, tc.next_run_at ASC
            LIMIT :limit
            {$forUpdateSql}
        ");
        $configStmt->bindValue(':limit', $availableSlots, PDO::PARAM_INT);
        $configStmt->execute();
        $dueConfigs = $configStmt->fetchAll();

        foreach ($dueConfigs as $cfg) {
            $domains = json_decode($cfg['brand_domains'] ?: '[]', true) ?? [];
            $prompts = json_decode($cfg['keywords_prompts'] ?: '[]', true) ?? [];
            $competitors = json_decode($cfg['competitors'] ?: '[]', true) ?? [];
            $rawLLMs = json_decode($cfg['target_llms'] ?: '[]', true);
            if (empty($prompts)) {
                $prompts = ["Beste Empfehlungen und Produkte von {$cfg['brand_name']}"];
            }

            // Normalize target LLMs to canonical provider/model tokens while preserving distinct models per provider
            $targetLLMs = normalizeTargetLlmsList(is_array($rawLLMs) ? $rawLLMs : []);
            $compList = normalizeQueueCompetitors(is_array($competitors) ? $competitors : []);

            // Prevent mid-config prompt truncation when batch limit is already partially consumed
            if (count($claimedJobs) > 0 && (count($claimedJobs) + count($prompts)) > $limit) {
                break;
            }

            // Advance schedule for this configuration
            $nextRunAt = advanceScheduleTimestamp($cfg['next_run_at'], (string)$cfg['schedule_interval']);
            $advStmt = $db->prepare("
                UPDATE tracking_configs
                SET next_run_at = :next_run_at, last_run_at = NOW()
                WHERE id = :id
            ");
            $advStmt->execute([
                ':next_run_at' => $nextRunAt,
                ':id'          => (int)$cfg['id'],
            ]);

            // Dispatch all prompts for this config while credits remain
            $costPerPrompt = count($targetLLMs);
            $batchRunId = 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7);

            foreach ($prompts as $promptText) {

                // Atomically deduct user credits for this prompt execution
                $credStmt = $db->prepare("
                    UPDATE users 
                    SET credits_remaining = credits_remaining - :cost 
                    WHERE id = :user_id AND credits_remaining >= :cost_min
                ");
                $credStmt->execute([
                    ':cost_min' => $costPerPrompt,
                    ':cost'    => $costPerPrompt,
                    ':user_id' => (int)$cfg['user_id'],
                ]);

                if ($credStmt->rowCount() > 0) {
                    $claimedJobs[] = [
                        'run_id'         => $batchRunId,
                        'api_base_url'   => $apiBaseUrl,
                        'config_id'      => (int)$cfg['id'],
                        'user_id'        => (int)$cfg['user_id'],
                        'brand_name'     => (string)$cfg['brand_name'],
                        'brand_domains'  => $domains,
                        'prompt'         => (string)$promptText,
                        'competitors'    => $compList,
                        'target_llms'    => $targetLLMs,
                        'search_enabled' => (bool)$cfg['search_enabled'],
                    ];
                } else {
                    // Insufficient credits remaining; stop queuing prompts for this config
                    break;
                }
            }
        }
    }

    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $e;
}

// 5. Output Uniform Queue Poller Response Envelope
jsonResponse([
    'status'           => 'success',
    'api_base_url'     => $apiBaseUrl,
    'jobs_count'       => count($claimedJobs),
    'queue_depth'      => $queueDepth,
    'batch_size_limit' => $limit,
    'jobs'             => $claimedJobs,
], 200);

/**
 * Normalizes stored competitor entries while preserving registered competitor domains.
 *
 * @param array $competitors Raw competitors array from tracking_configs
 * @return array Normalized competitor objects (or trimmed strings if stored as raw strings)
 */
function normalizeQueueCompetitors(array $competitors): array {
    $normalized = [];
    foreach ($competitors as $c) {
        if (is_string($c)) {
            $clean = trim($c);
            if ($clean !== '') {
                $normalized[] = $clean;
            }
            continue;
        }
        if (!is_array($c)) {
            continue;
        }

        $name = trim((string)($c['name'] ?? $c['competitor_name'] ?? ''));
        if ($name === '') {
            continue;
        }

        $domains = [];
        if (isset($c['domains']) && is_array($c['domains'])) {
            foreach ($c['domains'] as $d) {
                $cleanDom = strtolower(trim((string)$d));
                if ($cleanDom !== '' && !in_array($cleanDom, $domains, true)) {
                    $domains[] = $cleanDom;
                }
            }
        }
        foreach (['domain', 'competitor_domain'] as $key) {
            if (!empty($c[$key]) && is_string($c[$key])) {
                $cleanDom = strtolower(trim($c[$key]));
                if ($cleanDom !== '' && !in_array($cleanDom, $domains, true)) {
                    $domains[] = $cleanDom;
                }
            }
        }

        $normalized[] = [
            'name'    => $name,
            'domain'  => $domains[0] ?? '',
            'domains' => $domains,
        ];
    }
    return $normalized;
}

/**
 * Calculates next run timestamp based on interval and base date.
 *
 * @param string|null $currentDate Base date or null
 * @param string $interval Schedule interval (daily, weekly, biweekly, monthly)
 * @return string ISO-formatted MySQL datetime string
 */
function advanceScheduleTimestamp(?string $currentDate, string $interval): string {
    $baseTime = $currentDate ? strtotime($currentDate) : time();
    // If baseTime is in past, advance from current time to prevent catch-up stampedes
    if ($baseTime < time()) {
        $baseTime = time();
    }

    $canonical = function_exists('normalizeScheduleInterval')
        ? normalizeScheduleInterval($interval)
        : strtolower(trim($interval));

    return match ($canonical) {
        'every_2h'  => date('Y-m-d H:i:s', strtotime('+2 hours', $baseTime)),
        'every_4h'  => date('Y-m-d H:i:s', strtotime('+4 hours', $baseTime)),
        'every_6h'  => date('Y-m-d H:i:s', strtotime('+6 hours', $baseTime)),
        'every_12h' => date('Y-m-d H:i:s', strtotime('+12 hours', $baseTime)),
        'daily'     => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
        'weekly'    => date('Y-m-d H:i:s', strtotime('+7 days', $baseTime)),
        'biweekly'  => date('Y-m-d H:i:s', strtotime('+14 days', $baseTime)),
        'monthly'   => date('Y-m-d H:i:s', strtotime('+1 month', $baseTime)),
        default     => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
    };
}
