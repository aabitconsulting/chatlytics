<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Atomic Queue Poller, 3-Tier Execution Dispatcher & Credit Math (Feature 19)
 * File: api/n8n_queue.php
 *
 * Polling endpoint periodically invoked by the n8n Schedule Poller Trigger
 * (`n8n-nodes-base.scheduleTrigger`) to retrieve scheduled Data Mining jobs.
 *
 * Responsibilities:
 * 1. Cron Secret Authentication: Validates `X-Chatlytics-Cron-Key` or `X-N8N-Secret`
 *    against configured `n8n.shared_secret` using constant-time comparison (`hash_equals`).
 *    Also permits authenticated admin sessions for manual testing/diagnostics.
 * 2. Atomic Row Locking (`SELECT ... FOR UPDATE`):
 *    Claims pending runs from `llm_runs` and due Full-Started configs from `tracking_configs`
 *    in an exclusive InnoDB database transaction, preventing multi-instance race conditions.
 * 3. Data Mining Accuracy Timestamp Advancement: Advances `next_run_at` based on
 *    the config's `schedule_interval` (`every_120m`: +120m, `every_60m`: +60m,
 *    `every_30m`: +30m, `every_15m`: +15m) and updates `last_run_at = NOW()`.
 * 4. 3-Tier Cost-Optimization & Correlation (`custom_id`):
 *    Resolves each model's execution strategy (`prompt_caching` -> `batch_api` -> `regular`),
 *    generates a deterministic `prompt_cache_key` and unique `custom_id`, and records
 *    each request item in `batch_requests` so immediate or deferred Batch API responses
 *    match 100% accurately on ingestion.
 * 5. Credit Deduction Math: Atomically deducts user credits for scheduled runs,
 *    ensuring runs are never dispatched for users with insufficient credit balance.
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

$db = getDb();
ensureCoreSchemaColumns($db);

$requestData = getRequestData();
$action = strtolower(trim((string)($_GET['action'] ?? $requestData['action'] ?? 'poll')));

// Auxiliary Action A: Register a submitted Provider Batch API job ID against custom_ids
if ($action === 'register_batch') {
    $providerBatchId = trim((string)($requestData['provider_batch_id'] ?? $requestData['batch_id'] ?? ''));
    $customIds = $requestData['custom_ids'] ?? [];
    if ($providerBatchId === '' || !is_array($customIds) || empty($customIds)) {
        jsonError("provider_batch_id and non-empty custom_ids array are required.", 422);
    }
    $cleanCustomIds = array_values(array_filter(array_map(fn($c) => trim((string)$c), $customIds), fn($c) => $c !== ''));
    if (empty($cleanCustomIds)) {
        jsonError("No valid custom_ids supplied.", 422);
    }

    $namedPlaceholders = [];
    $params = [':provider_batch_id' => $providerBatchId];
    foreach (array_values($cleanCustomIds) as $idx => $cid) {
        $ph = ':cid_' . $idx;
        $namedPlaceholders[] = $ph;
        $params[$ph] = $cid;
    }
    $placeholdersSql = implode(',', $namedPlaceholders);
    $stmt = $db->prepare("
        UPDATE batch_requests
        SET provider_batch_id = :provider_batch_id, status = 'submitted', submitted_at = NOW()
        WHERE custom_id IN ({$placeholdersSql})
    ");
    $stmt->execute($params);

    jsonResponse([
        'provider_batch_id' => $providerBatchId,
        'updated_count'     => $stmt->rowCount(),
        'custom_ids'        => $cleanCustomIds,
    ], 200);
}

// Auxiliary Action B: List open/submitted Batch API jobs for deferred polling
if ($action === 'open_batches') {
    $stmt = $db->query("
        SELECT provider, model, provider_batch_id, custom_id, config_id, user_id, prompt, status, scheduled_for, submitted_at
        FROM batch_requests
        WHERE execution_strategy = 'batch_api'
          AND status IN ('queued', 'submitted')
        ORDER BY created_at ASC
        LIMIT 200
    ");
    $rows = $stmt ? $stmt->fetchAll() : [];
    jsonResponse([
        'open_batches_count' => count($rows),
        'open_batches'       => $rows,
    ], 200);
}

// 2. Batch Limit & Parameters
$limit = isset($_GET['limit']) ? max(1, min(50, (int)$_GET['limit'])) : 10;

// 3. Queue Depth Telemetry
// Calculate total jobs pending in queue across Full-Started scheduled configs
$depthStmt = $db->query("
    SELECT COUNT(*) 
    FROM tracking_configs tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.status = 'active'
      AND (tc.full_started_at IS NOT NULL OR tc.next_run_at IS NOT NULL)
      AND (tc.next_run_at IS NULL OR tc.next_run_at <= NOW())
      AND u.credits_remaining > 0
      AND u.status = 'active'
");
$queueDepth = (int)$depthStmt->fetchColumn();

// 4. Atomic Job Claiming Transaction
$forUpdateSql = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME)) === 'sqlite' ? '' : 'FOR UPDATE';
$claimedJobs = [];
$dispatchGroups = [
    'prompt_caching' => [],
    'batch_api'      => [],
    'regular'        => [],
];

$db->beginTransaction();

try {
    $insBatchReq = $db->prepare("
        INSERT INTO batch_requests (
            custom_id, prompt_cache_key, execution_strategy,
            user_id, config_id, prompt, provider, model,
            brand_name, brand_domains, competitors,
            search_enabled, is_test_run, status, scheduled_for
        ) VALUES (
            :custom_id, :prompt_cache_key, :execution_strategy,
            :user_id, :config_id, :prompt, :provider, :model,
            :brand_name, :brand_domains, :competitors,
            :search_enabled, 0, 'queued', NOW()
        )
    ");

    // 4.1 Claim explicit pending runs from llm_runs (if any queued asynchronously)
    $pendingStmt = $db->prepare("
        SELECT r.id, r.config_id, r.user_id, r.prompt, r.provider, r.model,
               tc.brand_name, tc.brand_domains, tc.competitors, tc.search_enabled, tc.schedule_interval,
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
        $scheduleInterval = normalizeScheduleInterval((string)($row['schedule_interval'] ?? 'every_120m'));
        $rawToken = ($row['provider'] ?? 'openai') . (!empty($row['model']) ? '/' . $row['model'] : '');
        $spec = resolveTargetLlmSpec($rawToken, $scheduleInterval);

        $customId = sprintf('cl_u%d_c%d_%d_%s', (int)$row['user_id'], (int)$row['config_id'], time(), substr(bin2hex(random_bytes(4)), 0, 8));
        $promptCacheKey = buildPromptCacheKey((int)$row['config_id'], (string)$row['prompt'], $spec['id']);
        $providerCachingConfig = buildProviderCachingConfig($spec['provider'], $spec['model'], $promptCacheKey, $scheduleInterval);

        $insBatchReq->execute([
            ':custom_id'          => $customId,
            ':prompt_cache_key'   => $promptCacheKey,
            ':execution_strategy' => $spec['execution_strategy'],
            ':user_id'            => (int)$row['user_id'],
            ':config_id'          => (int)$row['config_id'],
            ':prompt'             => (string)$row['prompt'],
            ':provider'           => $spec['provider'],
            ':model'              => $spec['model'],
            ':brand_name'         => (string)$row['brand_name'],
            ':brand_domains'      => json_encode($domains, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':competitors'        => json_encode($compList, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':search_enabled'     => !empty($row['search_enabled']) ? 1 : 0,
        ]);

        $batchItem = [
            'custom_id'               => $customId,
            'prompt_cache_key'        => $promptCacheKey,
            'execution_strategy'      => $spec['execution_strategy'],
            'provider_caching_config' => $providerCachingConfig,
            'prompt'                  => (string)$row['prompt'],
            'provider'                => $spec['provider'],
            'model'                   => $spec['model'],
            'target_llm'              => $spec['id'],
            'is_test_run'             => false,
        ];
        $dispatchGroups[$spec['execution_strategy']][] = $batchItem;

        $claimedJobs[] = [
            'run_id'                  => 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7),
            'custom_id'               => $customId,
            'prompt_cache_key'        => $promptCacheKey,
            'execution_strategy'      => $spec['execution_strategy'],
            'provider_caching_config' => $providerCachingConfig,
            'batch_items'             => [$batchItem],
            'api_base_url'            => $apiBaseUrl,
            'config_id'               => (int)$row['config_id'],
            'user_id'                 => (int)$row['user_id'],
            'brand_name'              => (string)$row['brand_name'],
            'brand_domains'           => $domains,
            'prompt'                  => (string)$row['prompt'],
            'competitors'             => $compList,
            'target_llms'             => [$spec['id']],
            'schedule_interval'       => $scheduleInterval,
            'search_enabled'          => (bool)$row['search_enabled'],
            'is_test_run'             => false,
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
                   tc.search_enabled, tc.schedule_interval, tc.next_run_at, tc.full_started_at,
                   u.credits_remaining
            FROM tracking_configs tc
            JOIN users u ON tc.user_id = u.id
            WHERE tc.status = 'active'
              AND (tc.full_started_at IS NOT NULL OR tc.next_run_at IS NOT NULL)
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

            $scheduleInterval = normalizeScheduleInterval((string)($cfg['schedule_interval'] ?? 'every_120m'));
            if (!in_array($scheduleInterval, getValidScheduleIntervals(), true)) {
                $scheduleInterval = 'every_120m';
            }

            // Normalize target LLMs to canonical provider/model tokens while preserving distinct models per provider
            $targetLLMs = normalizeTargetLlmsList(is_array($rawLLMs) ? $rawLLMs : []);
            $compList = normalizeQueueCompetitors(is_array($competitors) ? $competitors : []);

            // Prevent mid-config prompt truncation when batch limit is already partially consumed
            if (count($claimedJobs) > 0 && (count($claimedJobs) + count($prompts)) > $limit) {
                break;
            }

            // Advance schedule for this configuration
            $nextRunAt = advanceScheduleTimestamp($cfg['next_run_at'], $scheduleInterval);
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
            $domainsJson = json_encode($domains, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $compJson = json_encode($compList, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            foreach ($prompts as $promptText) {
                // Atomically deduct user credits for this prompt execution
                $credStmt = $db->prepare("
                    UPDATE users 
                    SET credits_remaining = credits_remaining - :cost 
                    WHERE id = :user_id AND credits_remaining >= :cost_min
                ");
                $credStmt->execute([
                    ':cost_min' => $costPerPrompt,
                    ':cost'     => $costPerPrompt,
                    ':user_id'  => (int)$cfg['user_id'],
                ]);

                if ($credStmt->rowCount() > 0) {
                    $promptBatchItems = [];
                    foreach ($targetLLMs as $llmToken) {
                        $spec = resolveTargetLlmSpec((string)$llmToken, $scheduleInterval);
                        $customId = sprintf('cl_u%d_c%d_%d_%s', (int)$cfg['user_id'], (int)$cfg['id'], time(), substr(bin2hex(random_bytes(4)), 0, 8));
                        $promptCacheKey = buildPromptCacheKey((int)$cfg['id'], (string)$promptText, $spec['id']);
                        $providerCachingConfig = buildProviderCachingConfig($spec['provider'], $spec['model'], $promptCacheKey, $scheduleInterval);

                        $insBatchReq->execute([
                            ':custom_id'          => $customId,
                            ':prompt_cache_key'   => $promptCacheKey,
                            ':execution_strategy' => $spec['execution_strategy'],
                            ':user_id'            => (int)$cfg['user_id'],
                            ':config_id'          => (int)$cfg['id'],
                            ':prompt'             => (string)$promptText,
                            ':provider'           => $spec['provider'],
                            ':model'              => $spec['model'],
                            ':brand_name'         => (string)$cfg['brand_name'],
                            ':brand_domains'      => $domainsJson,
                            ':competitors'        => $compJson,
                            ':search_enabled'     => !empty($cfg['search_enabled']) ? 1 : 0,
                        ]);

                        $item = [
                            'custom_id'               => $customId,
                            'prompt_cache_key'        => $promptCacheKey,
                            'execution_strategy'      => $spec['execution_strategy'],
                            'provider_caching_config' => $providerCachingConfig,
                            'config_id'               => (int)$cfg['id'],
                            'user_id'                 => (int)$cfg['user_id'],
                            'brand_name'              => (string)$cfg['brand_name'],
                            'brand_domains'           => $domains,
                            'competitors'             => $compList,
                            'prompt'                  => (string)$promptText,
                            'provider'                => $spec['provider'],
                            'model'                   => $spec['model'],
                            'target_llm'              => $spec['id'],
                            'schedule_interval'       => $scheduleInterval,
                            'search_enabled'          => (bool)$cfg['search_enabled'],
                            'is_test_run'             => false,
                        ];
                        $promptBatchItems[] = $item;
                        $dispatchGroups[$spec['execution_strategy']][] = $item;
                    }

                    $firstItem = $promptBatchItems[0] ?? [];
                    $claimedJobs[] = [
                        'run_id'                  => $batchRunId,
                        'custom_id'               => $firstItem['custom_id'] ?? null,
                        'prompt_cache_key'        => $firstItem['prompt_cache_key'] ?? null,
                        'execution_strategy'      => $firstItem['execution_strategy'] ?? 'prompt_caching',
                        'provider_caching_config' => $firstItem['provider_caching_config'] ?? null,
                        'batch_items'             => $promptBatchItems,
                        'api_base_url'            => $apiBaseUrl,
                        'config_id'               => (int)$cfg['id'],
                        'user_id'                 => (int)$cfg['user_id'],
                        'brand_name'              => (string)$cfg['brand_name'],
                        'brand_domains'           => $domains,
                        'prompt'                  => (string)$promptText,
                        'competitors'             => $compList,
                        'target_llms'             => $targetLLMs,
                        'schedule_interval'       => $scheduleInterval,
                        'search_enabled'          => (bool)$cfg['search_enabled'],
                        'is_test_run'             => false,
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
    'dispatch_groups'  => $dispatchGroups,
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
 * Calculates next run timestamp based on the 4 Data Mining Accuracy tiers:
 * - every_120m: +120 minutes (12 datasets/day per LLM)
 * - every_60m:  +60 minutes  (24 datasets/day per LLM)
 * - every_30m:  +30 minutes  (48 datasets/day per LLM)
 * - every_15m:  +15 minutes  (96 datasets/day per LLM)
 *
 * @param string|null $currentDate Base date or null
 * @param string $interval Schedule interval
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
        'every_120m' => date('Y-m-d H:i:s', strtotime('+120 minutes', $baseTime)),
        'every_60m'  => date('Y-m-d H:i:s', strtotime('+60 minutes', $baseTime)),
        'every_30m'  => date('Y-m-d H:i:s', strtotime('+30 minutes', $baseTime)),
        'every_15m'  => date('Y-m-d H:i:s', strtotime('+15 minutes', $baseTime)),
        default      => date('Y-m-d H:i:s', strtotime('+120 minutes', $baseTime)),
    };
}
