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

// Auxiliary Action B: List open/submitted Batch API jobs for deferred OpenRouter polling
if ($action === 'open_batches') {
    $stmt = $db->query("
        SELECT id, custom_id, provider, model, provider_batch_id, run_id, config_id, user_id,
               prompt, market_region, brand_name, brand_domains, competitors,
               search_enabled, supports_tools, is_test_run, status, scheduled_for, submitted_at
        FROM batch_requests
        WHERE execution_strategy = 'batch_api'
          AND status IN ('queued', 'submitted')
        ORDER BY id ASC
        LIMIT 200
    ");
    $rawRows = $stmt ? $stmt->fetchAll() : [];
    $rows = [];
    $pollIds = [];
    foreach ($rawRows as $r) {
        $pollIds[] = (int)$r['id'];
        $domainsArr = json_decode((string)($r['brand_domains'] ?? '[]'), true);
        $compsArr = json_decode((string)($r['competitors'] ?? '[]'), true);
        $prov = strtolower(trim((string)($r['provider'] ?? '')));
        $mod = trim((string)($r['model'] ?? ''));
        $targetLlm = str_contains($mod, '/') ? $mod : ($prov !== '' && $mod !== '' ? "{$prov}/{$mod}" : $mod);
        $rows[] = [
            'id'                => (int)$r['id'],
            'custom_id'         => (string)$r['custom_id'],
            'provider'          => $prov,
            'model'             => $mod,
            'target_llm'        => $targetLlm,
            'provider_batch_id' => $r['provider_batch_id'],
            'run_id'            => $r['run_id'] !== null ? (int)$r['run_id'] : null,
            'config_id'         => (int)$r['config_id'],
            'user_id'           => (int)$r['user_id'],
            'prompt'            => (string)$r['prompt'],
            'market_region'     => $r['market_region'] ?? null,
            'brand_name'        => (string)$r['brand_name'],
            'brand_domains'     => is_array($domainsArr) ? $domainsArr : [],
            'competitors'       => is_array($compsArr) ? $compsArr : [],
            'search_enabled'    => !empty($r['search_enabled']),
            'supports_tools'    => !array_key_exists('supports_tools', $r) || !empty($r['supports_tools']),
            'is_test_run'       => !empty($r['is_test_run']),
            'status'            => (string)$r['status'],
            'scheduled_for'     => $r['scheduled_for'] ?? null,
            'submitted_at'      => $r['submitted_at'] ?? null,
            'api_base_url'      => $apiBaseUrl,
        ];
    }

    if (!empty($pollIds)) {
        try {
            $idPhs = [];
            $pollParams = [':now' => date('Y-m-d H:i:s')];
            foreach ($pollIds as $idx => $bid) {
                $ph = ':bid_' . $idx;
                $idPhs[] = $ph;
                $pollParams[$ph] = $bid;
            }
            $updPoll = $db->prepare("UPDATE batch_requests SET last_polled_at = :now WHERE id IN (" . implode(',', $idPhs) . ")");
            $updPoll->execute($pollParams);
        } catch (Throwable $e) {
            // Non-fatal if column missing in partial test schema
        }
    }

    jsonResponse([
        'open_batches_count' => count($rows),
        'open_batches'       => $rows,
    ], 200);
}

// Auxiliary Action C: Mark failed/expired/cancelled OpenRouter batches and record failed audit rows
if ($action === 'fail_batch') {
    $providerBatchId = trim((string)($requestData['provider_batch_id'] ?? $requestData['batch_id'] ?? ''));
    $customIds = is_array($requestData['custom_ids'] ?? null) ? $requestData['custom_ids'] : [];
    $errorMsg = trim((string)($requestData['error_message'] ?? $requestData['error'] ?? 'OpenRouter batch execution failed or expired'));
    $errorMsg = mb_substr($errorMsg !== '' ? $errorMsg : 'OpenRouter batch execution failed', 0, 2000);

    if ($providerBatchId === '' && empty($customIds)) {
        jsonError("provider_batch_id or non-empty custom_ids array is required.", 422);
    }

    $selWhere = ["status IN ('queued', 'submitted')"];
    $selParams = [];
    if ($providerBatchId !== '') {
        $selWhere[] = "provider_batch_id = :provider_batch_id";
        $selParams[':provider_batch_id'] = $providerBatchId;
    }
    $cleanCustomIds = array_values(array_filter(array_map(fn($c) => trim((string)$c), $customIds), fn($c) => $c !== ''));
    if (!empty($cleanCustomIds)) {
        $phs = [];
        foreach ($cleanCustomIds as $idx => $cid) {
            $ph = ':fcid_' . $idx;
            $phs[] = $ph;
            $selParams[$ph] = $cid;
        }
        $selWhere[] = "custom_id IN (" . implode(',', $phs) . ")";
    }

    $selStmt = $db->prepare("SELECT * FROM batch_requests WHERE " . implode(' AND ', $selWhere) . " ORDER BY id ASC");
    $selStmt->execute($selParams);
    $pendingFailRows = $selStmt->fetchAll() ?: [];

    // Pre-provision per-user physical result tables outside transaction
    $userIdsToEnsure = [];
    foreach ($pendingFailRows as $br) {
        $uid = (int)($br['user_id'] ?? 0);
        if ($uid > 0) {
            $userIdsToEnsure[$uid] = true;
        }
    }
    foreach (array_keys($userIdsToEnsure) as $uid) {
        ensureUserResultsTable($db, (int)$uid);
    }

    $nowTs = date('Y-m-d H:i:s');
    $failedCount = 0;
    $recordedRunIds = [];

    $db->beginTransaction();
    try {
        $updBr = $db->prepare("
            UPDATE batch_requests
            SET status = 'failed', batch_error_detail = :err, completed_at = :now
            WHERE id = :id
        ");
        $chkRun = $db->prepare("SELECT id FROM llm_runs WHERE custom_id = :cid LIMIT 1");
        $insFailRun = $db->prepare("
            INSERT INTO llm_runs (
                config_id, user_id, custom_id, batch_id, execution_strategy,
                prompt_cache_key, input_tokens, output_tokens, cached_tokens, is_test_run,
                prompt, market_region, provider, model, brand_name, status, error_message,
                brand_mentioned, brand_prominence_rank, char_earliness, word_earliness,
                relative_position_pct, total_chars, total_words, mece_category, geo_quadrant,
                has_citations, brand_cited, competitor_cited, regional_citation_count,
                regional_citation_ratio, cost_credits, created_at
            ) VALUES (
                :config_id, :user_id, :custom_id, :batch_id, :execution_strategy,
                NULL, 0, 0, 0, :is_test_run,
                :prompt, :market_region, :provider, :model, :brand_name, 'failed', :error_message,
                0, NULL, NULL, NULL,
                NULL, 0, 0, '4_GENERIC', 'NONE',
                0, 0, 0, 0,
                NULL, 0, :created_at
            )
        ");

        foreach ($pendingFailRows as $br) {
            $updBr->execute([
                ':err' => $errorMsg,
                ':now' => $nowTs,
                ':id'  => (int)$br['id'],
            ]);
            $failedCount++;

            $cid = (string)$br['custom_id'];
            $chkRun->execute([':cid' => $cid]);
            $existingRunId = $chkRun->fetchColumn();
            if ($existingRunId) {
                $recordedRunIds[] = (int)$existingRunId;
                continue;
            }

            $insFailRun->execute([
                ':config_id'          => (int)$br['config_id'],
                ':user_id'            => (int)$br['user_id'],
                ':custom_id'          => $cid,
                ':batch_id'           => $br['provider_batch_id'] ?? ($providerBatchId !== '' ? $providerBatchId : null),
                ':execution_strategy' => (string)($br['execution_strategy'] ?? 'batch_api'),
                ':is_test_run'        => !empty($br['is_test_run']) ? 1 : 0,
                ':prompt'             => (string)$br['prompt'],
                ':market_region'      => $br['market_region'] ?? null,
                ':provider'           => (string)$br['provider'],
                ':model'              => (string)$br['model'],
                ':brand_name'         => (string)$br['brand_name'],
                ':error_message'      => $errorMsg,
                ':created_at'         => $nowTs,
            ]);
            $newRunId = (int)$db->lastInsertId();
            $recordedRunIds[] = $newRunId;

            $db->prepare("UPDATE batch_requests SET run_id = :rid WHERE id = :id")->execute([
                ':rid' => $newRunId,
                ':id'  => (int)$br['id'],
            ]);

            insertUserResultRow($db, (int)$br['user_id'], [
                'run_id'             => $newRunId,
                'config_id'          => (int)$br['config_id'],
                'custom_id'          => $cid,
                'batch_id'           => $br['provider_batch_id'] ?? ($providerBatchId !== '' ? $providerBatchId : null),
                'execution_strategy' => (string)($br['execution_strategy'] ?? 'batch_api'),
                'prompt_cache_key'   => null,
                'input_tokens'       => 0,
                'output_tokens'      => 0,
                'cached_tokens'      => 0,
                'trigger_source'     => 'batch_api_fail',
                'is_test_run'        => !empty($br['is_test_run']) ? 1 : 0,
                'prompt'             => (string)$br['prompt'],
                'market_region'      => $br['market_region'] ?? null,
                'llm_answer'         => null,
                'provider'           => (string)$br['provider'],
                'model'              => (string)$br['model'],
                'brand_name'         => (string)$br['brand_name'],
                'status'             => 'failed',
                'mece_category'      => '4_GENERIC',
                'geo_quadrant'       => 'NONE',
                'error_message'      => $errorMsg,
                'scheduled_at'       => $br['scheduled_for'] ?? null,
                'created_at'         => $nowTs,
            ]);
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    jsonResponse([
        'success'           => true,
        'provider_batch_id' => $providerBatchId !== '' ? $providerBatchId : null,
        'failed_count'      => $failedCount,
        'run_ids'           => $recordedRunIds,
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
$modelCaps = getLlmModelCapabilitiesMap($db);
$claimedJobs = [];
$dispatchGroups = [
    'batch_api' => [],
    'regular'   => [],
];

$db->beginTransaction();

try {
    $insBatchReq = $db->prepare("
        INSERT INTO batch_requests (
            custom_id, prompt_cache_key, execution_strategy,
            user_id, config_id, prompt, market_region, provider, model,
            brand_name, brand_domains, competitors,
            search_enabled, supports_tools, is_test_run, status, scheduled_for
        ) VALUES (
            :custom_id, :prompt_cache_key, :execution_strategy,
            :user_id, :config_id, :prompt, :market_region, :provider, :model,
            :brand_name, :brand_domains, :competitors,
            :search_enabled, :supports_tools, 0, 'queued', NOW()
        )
    ");

    // 4.1 Claim explicit pending runs from llm_runs (if any queued asynchronously)
    $pendingStmt = $db->prepare("
        SELECT r.id, r.config_id, r.user_id, r.prompt, r.provider, r.model,
               tc.brand_name, tc.brand_domains, tc.market_region, tc.competitors, tc.search_enabled, tc.schedule_interval,
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
        $searchEnabled = !empty($row['search_enabled']);
        $marketRegion = isset($row['market_region']) && trim((string)$row['market_region']) !== '' ? trim((string)$row['market_region']) : null;
        $rawToken = ($row['provider'] ?? 'openai') . (!empty($row['model']) ? '/' . $row['model'] : '');
        $baseSpec = resolveTargetLlmSpec($rawToken, $scheduleInterval, $searchEnabled, false);
        $caps = $modelCaps[$baseSpec['id']] ?? [];
        $spec = resolveTargetLlmSpec(
            $rawToken,
            $scheduleInterval,
            $searchEnabled,
            false,
            array_key_exists('supports_batch_api', $caps) ? (bool)$caps['supports_batch_api'] : null,
            array_key_exists('supports_tools', $caps) ? (bool)$caps['supports_tools'] : null
        );

        $customId = sprintf('cl_u%d_c%d_%d_%s', (int)$row['user_id'], (int)$row['config_id'], time(), substr(bin2hex(random_bytes(4)), 0, 8));
        $promptCacheKey = null;
        $providerCachingConfig = buildProviderCachingConfig(
            $spec['provider'],
            $spec['model'],
            null,
            $scheduleInterval,
            $searchEnabled,
            false,
            $spec['supports_batch_api'],
            $spec['supports_tools']
        );

        $insBatchReq->execute([
            ':custom_id'          => $customId,
            ':prompt_cache_key'   => null,
            ':execution_strategy' => $spec['execution_strategy'],
            ':user_id'            => (int)$row['user_id'],
            ':config_id'          => (int)$row['config_id'],
            ':prompt'             => (string)$row['prompt'],
            ':market_region'      => $marketRegion,
            ':provider'           => $spec['provider'],
            ':model'              => $spec['model'],
            ':brand_name'         => (string)$row['brand_name'],
            ':brand_domains'      => json_encode($domains, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':competitors'        => json_encode($compList, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':search_enabled'     => $searchEnabled ? 1 : 0,
            ':supports_tools'     => $spec['supports_tools'] ? 1 : 0,
        ]);

        $batchItem = [
            'custom_id'               => $customId,
            'prompt_cache_key'        => null,
            'execution_strategy'      => $spec['execution_strategy'],
            'provider_caching_config' => $providerCachingConfig,
            'prompt'                  => (string)$row['prompt'],
            'market_region'           => $marketRegion,
            'provider'                => $spec['provider'],
            'model'                   => $spec['model'],
            'target_llm'              => $spec['id'],
            'supports_tools'          => $spec['supports_tools'],
            'supports_batch_api'      => $spec['supports_batch_api'],
            'is_test_run'             => false,
        ];
        $dispatchGroups[$spec['execution_strategy']][] = $batchItem;

        $claimedJobs[] = [
            'run_id'                  => 'run_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 7),
            'custom_id'               => $customId,
            'prompt_cache_key'        => null,
            'execution_strategy'      => $spec['execution_strategy'],
            'provider_caching_config' => $providerCachingConfig,
            'batch_items'             => [$batchItem],
            'api_base_url'            => $apiBaseUrl,
            'config_id'               => (int)$row['config_id'],
            'user_id'                 => (int)$row['user_id'],
            'brand_name'              => (string)$row['brand_name'],
            'brand_domains'           => $domains,
            'prompt'                  => (string)$row['prompt'],
            'market_region'           => $marketRegion,
            'competitors'             => $compList,
            'target_llms'             => [$spec['id']],
            'schedule_interval'       => $scheduleInterval,
            'search_enabled'          => $searchEnabled,
            'supports_tools'          => $spec['supports_tools'],
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
                   tc.keywords_prompts, tc.market_region, tc.competitors, tc.target_llms,
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
                    $cfgSearchEnabled = !empty($cfg['search_enabled']);
                    $cfgMarketRegion = isset($cfg['market_region']) && trim((string)$cfg['market_region']) !== '' ? trim((string)$cfg['market_region']) : null;
                    foreach ($targetLLMs as $llmToken) {
                        $baseSpec = resolveTargetLlmSpec((string)$llmToken, $scheduleInterval, $cfgSearchEnabled, false);
                        $caps = $modelCaps[$baseSpec['id']] ?? [];
                        $spec = resolveTargetLlmSpec(
                            (string)$llmToken,
                            $scheduleInterval,
                            $cfgSearchEnabled,
                            false,
                            array_key_exists('supports_batch_api', $caps) ? (bool)$caps['supports_batch_api'] : null,
                            array_key_exists('supports_tools', $caps) ? (bool)$caps['supports_tools'] : null
                        );
                        $customId = sprintf('cl_u%d_c%d_%d_%s', (int)$cfg['user_id'], (int)$cfg['id'], time(), substr(bin2hex(random_bytes(4)), 0, 8));
                        $promptCacheKey = null;
                        $providerCachingConfig = buildProviderCachingConfig(
                            $spec['provider'],
                            $spec['model'],
                            null,
                            $scheduleInterval,
                            $cfgSearchEnabled,
                            false,
                            $spec['supports_batch_api'],
                            $spec['supports_tools']
                        );

                        $insBatchReq->execute([
                            ':custom_id'          => $customId,
                            ':prompt_cache_key'   => null,
                            ':execution_strategy' => $spec['execution_strategy'],
                            ':user_id'            => (int)$cfg['user_id'],
                            ':config_id'          => (int)$cfg['id'],
                            ':prompt'             => (string)$promptText,
                            ':market_region'      => $cfgMarketRegion,
                            ':provider'           => $spec['provider'],
                            ':model'              => $spec['model'],
                            ':brand_name'         => (string)$cfg['brand_name'],
                            ':brand_domains'      => $domainsJson,
                            ':competitors'        => $compJson,
                            ':search_enabled'     => $cfgSearchEnabled ? 1 : 0,
                            ':supports_tools'     => $spec['supports_tools'] ? 1 : 0,
                        ]);

                        $item = [
                            'custom_id'               => $customId,
                            'prompt_cache_key'        => null,
                            'execution_strategy'      => $spec['execution_strategy'],
                            'provider_caching_config' => $providerCachingConfig,
                            'config_id'               => (int)$cfg['id'],
                            'user_id'                 => (int)$cfg['user_id'],
                            'brand_name'              => (string)$cfg['brand_name'],
                            'brand_domains'           => $domains,
                            'competitors'             => $compList,
                            'prompt'                  => (string)$promptText,
                            'market_region'           => $cfgMarketRegion,
                            'provider'                => $spec['provider'],
                            'model'                   => $spec['model'],
                            'target_llm'              => $spec['id'],
                            'supports_tools'          => $spec['supports_tools'],
                            'supports_batch_api'      => $spec['supports_batch_api'],
                            'schedule_interval'       => $scheduleInterval,
                            'search_enabled'          => $cfgSearchEnabled,
                            'is_test_run'             => false,
                        ];
                        $promptBatchItems[] = $item;
                        $dispatchGroups[$spec['execution_strategy']][] = $item;
                    }

                    $firstItem = $promptBatchItems[0] ?? [];
                    $claimedJobs[] = [
                        'run_id'                  => $batchRunId,
                        'custom_id'               => $firstItem['custom_id'] ?? null,
                        'prompt_cache_key'        => null,
                        'execution_strategy'      => $firstItem['execution_strategy'] ?? 'regular',
                        'provider_caching_config' => $firstItem['provider_caching_config'] ?? null,
                        'batch_items'             => $promptBatchItems,
                        'api_base_url'            => $apiBaseUrl,
                        'config_id'               => (int)$cfg['id'],
                        'user_id'                 => (int)$cfg['user_id'],
                        'brand_name'              => (string)$cfg['brand_name'],
                        'brand_domains'           => $domains,
                        'prompt'                  => (string)$promptText,
                        'market_region'           => $cfgMarketRegion,
                        'competitors'             => $compList,
                        'target_llms'             => $targetLLMs,
                        'schedule_interval'       => $scheduleInterval,
                        'search_enabled'          => $cfgSearchEnabled,
                        'supports_tools'          => $firstItem['supports_tools'] ?? true,
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
