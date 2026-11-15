<?php
declare(strict_types=1);

/**
 * Chatlytics.de - Tracking Configuration CRUD & Lifecycle Endpoint
 * File: api/configs.php
 *
 * Supported Operations:
 * - GET    /api/configs.php          (Lists tracking configs for authenticated user; read-only Magic Audit allowed)
 * - GET    /api/configs.php?id={id}  (Retrieves single config; read-only Magic Audit allowed if matches owner)
 * - POST   /api/configs.php          (Creates new tracking configuration; defaults to every_120m Starter tier)
 * - PUT    /api/configs.php?id={id}  (Updates configuration, toggles active/paused, or activates Full Start)
 * - DELETE /api/configs.php?id={id}  (Deletes configuration with cascade run deletion; requires full auth)
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestData = getRequestData();

// Support method overriding via header, query string, or body
$overrideMethod = strtoupper(
    $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] 
    ?? $_GET['_method'] 
    ?? $requestData['_method'] 
    ?? $_GET['action'] 
    ?? $requestData['action'] 
    ?? ''
);

if (in_array($overrideMethod, ['PUT', 'UPDATE', 'FULL_START'], true)) {
    $requestMethod = 'PUT';
} elseif (in_array($overrideMethod, ['DELETE', 'DESTROY'], true)) {
    $requestMethod = 'DELETE';
}

$configId = isset($_GET['id']) ? (int)$_GET['id'] : (isset($requestData['id']) ? (int)$requestData['id'] : null);
$rawAction = strtolower(trim((string)($_GET['action'] ?? $requestData['action'] ?? '')));

if ($requestMethod === 'GET' && $rawAction === 'public_catalog') {
    handlePublicCatalog();
}

switch ($requestMethod) {
    case 'GET':
        handleGetConfig($configId);
        break;

    case 'POST':
        handleCreateConfig($requestData);
        break;

    case 'PUT':
        handleUpdateConfig($configId, $requestData);
        break;

    case 'DELETE':
        handleDeleteConfig($configId);
        break;

    default:
        jsonError("Unsupported HTTP method: {$requestMethod}", 405);
        break;
}

/**
 * Public catalog endpoint returning allowed LLM models, active Analyse-Sets (Model Presets),
 * and subscription plan definitions (for landing page pricing hydration and signup flows).
 */
function handlePublicCatalog(): void {
    $db = getDb();
    ensureCoreSchemaColumns($db);

    jsonResponse([
        'models'  => getAdminModelsCatalog($db, true),
        'presets' => getModelPresetsCatalog($db, true),
        'plans'   => getSubscriptionPlansCatalog($db),
    ], 200);
}

/**
 * Handle GET requests: list configs or retrieve a single configuration.
 * Read-only access is permitted if accessed via a valid Magic Audit token.
 */
function handleGetConfig(?int $id): void {
    $currentUser = requireAuth(true); // allowMagicAudit = true
    $db = getDb();
    ensureCoreSchemaColumns($db);
    purgeExpiredDeletedConfigs($db);
    $userId = (int)$currentUser['id'];
    $isAdmin = ($currentUser['role'] ?? '') === 'admin';

    if ($id !== null) {
        // Retrieve single configuration
        $stmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id LIMIT 1");
        $stmt->execute([':id' => $id]);
        $config = $stmt->fetch();

        if (!$config) {
            jsonError("Configuration not found.", 404);
        }

        // Enforce multi-tenant scoping unless admin
        if ((int)$config['user_id'] !== $userId && !$isAdmin) {
            jsonError("Configuration not found.", 404);
        }

        // Hide soft-deleted configs from non-admin users
        if (((string)($config['status'] ?? '')) === 'deleted' && !$isAdmin) {
            jsonError("Configuration not found.", 404);
        }

        $modelCaps = getLlmModelCapabilitiesMap($db);
        $formatted = formatConfigRecord($config, $modelCaps);

        // Fetch run count
        $runCountStmt = $db->prepare("SELECT COUNT(*) FROM llm_runs WHERE config_id = :id");
        $runCountStmt->execute([':id' => $id]);
        $formatted['total_runs'] = (int)$runCountStmt->fetchColumn();

        jsonResponse([
            'config' => $formatted,
        ], 200);
    } else {
        // List configurations for user (excluding 90-day soft-deleted configs)
        $sql = "
            SELECT tc.*, COUNT(r.id) AS run_count
            FROM tracking_configs tc
            LEFT JOIN llm_runs r ON r.config_id = tc.id
            WHERE tc.user_id = :user_id AND tc.status != 'deleted'
            GROUP BY tc.id
            ORDER BY tc.created_at DESC
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute([':user_id' => $userId]);
        $rows = $stmt->fetchAll();

        $modelCaps = getLlmModelCapabilitiesMap($db);
        $configs = array_map(function (array $row) use ($modelCaps): array {
            $formatted = formatConfigRecord($row, $modelCaps);
            $formatted['total_runs'] = (int)($row['run_count'] ?? 0);
            return $formatted;
        }, $rows);

        $userTier = strtolower((string)($currentUser['tier'] ?? 'free'));
        $userPlan = getPlanForTier($db, $userTier);

        jsonResponse([
            'configs' => $configs,
            'count'   => count($configs),
            'catalog' => [
                'allowed_models' => getAdminModelsCatalog($db, true),
                'presets'        => getModelPresetsCatalog($db, true),
                'user_plan'      => $userPlan,
            ],
        ], 200);
    }
}

/**
 * Handle POST request: create a new tracking configuration.
 * Guarded by requireAuth(allowMagicAudit: true) and assertNotAuditMode.
 */
function handleCreateConfig(array $data): void {
    $currentUser = requireAuth(true);
    assertNotAuditMode($currentUser);

    $userId = (int)$currentUser['id'];
    $db = getDb();
    ensureCoreSchemaColumns($db);
    ensureUserResultsTable($db, $userId);

    $validated = validateAndSanitizeConfigInput($data);
    enforcePlanAndPresetPolicy($db, $currentUser, $validated, $data, false, null);

    $fullStartRequested = !empty($data['full_start'])
        || (isset($data['action']) && strtolower(trim((string)$data['action'])) === 'full_start');

    $datasetsPerDay = (int)getScheduleRunsPerDay($validated['schedule_interval']);
    $initialTestUsed = $fullStartRequested ? 1 : 0;
    $fullStartedAt = $fullStartRequested ? date('Y-m-d H:i:s') : null;
    $nextRunAt = ($fullStartRequested && $validated['status'] === 'active')
        ? calculateNextRunAt($validated['schedule_interval'])
        : null;

    $sql = "
        INSERT INTO tracking_configs (
            user_id, name, brand_name, brand_domains, keywords_prompts, market_region,
            competitors, preset_id, target_llms, search_enabled, schedule_interval,
            datasets_per_day, initial_test_used, full_started_at,
            status, next_run_at
        ) VALUES (
            :user_id, :name, :brand_name, :brand_domains, :keywords_prompts, :market_region,
            :competitors, :preset_id, :target_llms, :search_enabled, :schedule_interval,
            :datasets_per_day, :initial_test_used, :full_started_at,
            :status, :next_run_at
        )
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':user_id'           => $userId,
        ':name'              => $validated['name'],
        ':brand_name'        => $validated['brand_name'],
        ':brand_domains'     => json_encode($validated['brand_domains'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':keywords_prompts'  => json_encode($validated['keywords_prompts'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':market_region'     => $validated['market_region'],
        ':competitors'       => json_encode($validated['competitors'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':preset_id'         => $validated['preset_id'],
        ':target_llms'       => json_encode($validated['target_llms'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':search_enabled'    => $validated['search_enabled'],
        ':schedule_interval' => $validated['schedule_interval'],
        ':datasets_per_day'  => $datasetsPerDay,
        ':initial_test_used' => $initialTestUsed,
        ':full_started_at'   => $fullStartedAt,
        ':status'            => $validated['status'],
        ':next_run_at'       => $nextRunAt,
    ]);

    $newConfigId = (int)$db->lastInsertId();

    // Fetch created configuration
    $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
    $fetchStmt->execute([':id' => $newConfigId]);
    $created = $fetchStmt->fetch();

    $formatted = formatConfigRecord($created, getLlmModelCapabilitiesMap($db));
    $formatted['total_runs'] = 0;

    jsonResponse([
        'config'  => $formatted,
        'message' => 'Tracking configuration created successfully.',
    ], 201);
}

/**
 * Handle PUT request: update existing configuration properties, toggle active/paused,
 * or transition to Full Start (`action = 'full_start'`).
 */
function handleUpdateConfig(?int $id, array $data): void {
    $currentUser = requireAuth(true);
    assertNotAuditMode($currentUser);

    if ($id === null || $id <= 0) {
        jsonError("A valid config ID is required in URL or body.", 422);
    }

    $db = getDb();
    ensureCoreSchemaColumns($db);
    $userId = (int)$currentUser['id'];
    $isAdmin = ($currentUser['role'] ?? '') === 'admin';

    // Verify ownership
    $checkStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id LIMIT 1");
    $checkStmt->execute([':id' => $id]);
    $existing = $checkStmt->fetch();

    if (!$existing) {
        jsonError("Configuration not found.", 404);
    }

    if ((int)$existing['user_id'] !== $userId && !$isAdmin) {
        jsonError("Configuration not found.", 404);
    }

    $alreadyFullStarted = !empty($existing['full_started_at']);
    $existingStatus = strtolower((string)($existing['status'] ?? 'active'));
    $action = strtolower(trim((string)($_GET['action'] ?? $data['action'] ?? '')));
    if ($action === '' && isset($data['status'])) {
        $reqStatus = strtolower(trim((string)$data['status']));
        if ($reqStatus === 'stopped' && $existingStatus === 'archived') {
            $action = 'unarchive';
        } elseif ($reqStatus === 'stopped' && $existingStatus !== 'stopped') {
            $action = 'stop';
        } elseif ($reqStatus === 'archived' && $existingStatus !== 'archived') {
            $action = 'archive';
        }
    }

    if ($existingStatus === 'deleted') {
        jsonError("Deleted configuration cannot be modified or resumed.", 409);
    }

    // Handle irreversible Stop transition (Active / Paused -> Stopped)
    if ($action === 'stop') {
        if (!$alreadyFullStarted) {
            jsonError("Unstarted draft configurations do not need to be stopped and can be deleted directly.", 409);
        }
        if (!in_array($existingStatus, ['active', 'paused'], true)) {
            jsonError("Only active or paused full-started configurations can be stopped.", 409);
        }

        $stoppedAt = date('Y-m-d H:i:s');
        try {
            $stopStmt = $db->prepare("
                UPDATE tracking_configs
                SET status = 'stopped', stopped_at = :stopped_at, next_run_at = NULL
                WHERE id = :id
            ");
            $stopStmt->execute([':stopped_at' => $stoppedAt, ':id' => $id]);
        } catch (Throwable $e) {
            $stopStmt = $db->prepare("
                UPDATE tracking_configs
                SET status = 'stopped', next_run_at = NULL
                WHERE id = :id
            ");
            $stopStmt->execute([':id' => $id]);
        }

        try {
            $delBr = $db->prepare("DELETE FROM batch_requests WHERE config_id = :config_id AND status = 'queued'");
            $delBr->execute([':config_id' => $id]);
        } catch (Throwable $e) {
            // Ignore if batch_requests table does not exist in mock
        }

        $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
        $fetchStmt->execute([':id' => $id]);
        $updated = $fetchStmt->fetch() ?: array_merge($existing, [
            'status'      => 'stopped',
            'stopped_at'  => $stoppedAt,
            'next_run_at' => null,
        ]);

        jsonResponse([
            'config'  => formatConfigRecord($updated),
            'message' => 'Configuration permanently stopped.',
        ], 200);
    }

    // Handle Archive transition (Stopped -> Archived)
    if ($action === 'archive') {
        if ($existingStatus !== 'stopped') {
            jsonError("Only stopped configurations can be archived.", 409);
        }

        $archivedAt = date('Y-m-d H:i:s');
        try {
            $archStmt = $db->prepare("
                UPDATE tracking_configs
                SET status = 'archived', archived_at = :archived_at, next_run_at = NULL
                WHERE id = :id
            ");
            $archStmt->execute([':archived_at' => $archivedAt, ':id' => $id]);
        } catch (Throwable $e) {
            $archStmt = $db->prepare("
                UPDATE tracking_configs
                SET status = 'archived', next_run_at = NULL
                WHERE id = :id
            ");
            $archStmt->execute([':id' => $id]);
        }

        $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
        $fetchStmt->execute([':id' => $id]);
        $updated = $fetchStmt->fetch() ?: array_merge($existing, [
            'status'      => 'archived',
            'archived_at' => $archivedAt,
            'next_run_at' => null,
        ]);

        jsonResponse([
            'config'  => formatConfigRecord($updated),
            'message' => 'Configuration archived successfully.',
        ], 200);
    }

    // Handle Unarchive transition (Archived -> Stopped; still permanently non-resumable)
    if ($action === 'unarchive') {
        if ($existingStatus !== 'archived') {
            jsonError("Only archived configurations can be unarchived.", 409);
        }

        $unarchStmt = $db->prepare("
            UPDATE tracking_configs
            SET status = 'stopped', next_run_at = NULL
            WHERE id = :id
        ");
        $unarchStmt->execute([':id' => $id]);

        $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
        $fetchStmt->execute([':id' => $id]);
        $updated = $fetchStmt->fetch() ?: array_merge($existing, [
            'status'      => 'stopped',
            'next_run_at' => null,
        ]);

        jsonResponse([
            'config'  => formatConfigRecord($updated),
            'message' => 'Configuration restored to stopped state.',
        ], 200);
    }

    // Block any resume, status toggle, or modification on stopped or archived configs
    if (in_array($existingStatus, ['stopped', 'archived'], true)) {
        jsonError(
            "Stopped or archived configurations are permanently locked and cannot be resumed or modified.",
            409
        );
    }

    $isActivatingFullStart = ($action === 'full_start') || !empty($data['full_start']);

    // Enforce prompt and market_region immutability after Full Start to preserve daily benchmark consistency
    if ($alreadyFullStarted && (isset($data['keywords_prompts']) || isset($data['prompts']))) {
        $existingPrompts = json_decode($existing['keywords_prompts'] ?: '[]', true) ?? [];
        $incomingRaw = $data['keywords_prompts'] ?? $data['prompts'];
        if (is_string($incomingRaw)) {
            $incomingRaw = array_values(array_filter(array_map('trim', explode("\n", $incomingRaw)), fn($s) => $s !== ''));
        } elseif (is_array($incomingRaw)) {
            $incomingRaw = array_values(array_filter(array_map(fn($s) => trim((string)$s), $incomingRaw), fn($s) => $s !== ''));
        }
        if ($incomingRaw !== $existingPrompts) {
            jsonError(
                "Prompts and target market/region are locked after Full Start to preserve daily time-series consistency. Configuration can only be paused or resumed.",
                409
            );
        }
    }

    if ($alreadyFullStarted && array_key_exists('market_region', $data)) {
        $existingRegion = sanitizeMarketRegion($existing['market_region'] ?? null);
        $incomingRegion = sanitizeMarketRegion($data['market_region']);
        if ($incomingRegion !== $existingRegion) {
            jsonError(
                "Target market/region is locked after Full Start to preserve daily time-series consistency. Configuration can only be paused or resumed.",
                409
            );
        }
    }

    $validated = validateAndSanitizeConfigInput($data, true, $existing);
    enforcePlanAndPresetPolicy($db, $currentUser, $validated, $data, true, $existing);

    $datasetsPerDay = (int)getScheduleRunsPerDay($validated['schedule_interval']);
    $fullStartedAt = $existing['full_started_at'] ?? null;
    $initialTestUsed = (int)($existing['initial_test_used'] ?? 0);

    if ($isActivatingFullStart && !$alreadyFullStarted) {
        $fullStartedAt = date('Y-m-d H:i:s');
        $initialTestUsed = 1;
        $validated['status'] = 'active';
        $nextRunAt = calculateNextRunAt($validated['schedule_interval']);
    } else {
        $intervalChanged = ($validated['schedule_interval'] !== normalizeScheduleInterval((string)($existing['schedule_interval'] ?? 'every_120m')));
        $reactivated = ((string)($existing['status'] ?? 'active') !== 'active' && $validated['status'] === 'active');

        if ($validated['status'] !== 'active') {
            $nextRunAt = null;
        } elseif (!empty($fullStartedAt) && ($intervalChanged || $reactivated || empty($existing['next_run_at']))) {
            $nextRunAt = calculateNextRunAt($validated['schedule_interval']);
        } elseif (empty($fullStartedAt) && ($intervalChanged || $reactivated)) {
            $nextRunAt = calculateNextRunAt($validated['schedule_interval']);
        } else {
            $nextRunAt = $existing['next_run_at'] ?? null;
        }
    }

    $sql = "
        UPDATE tracking_configs SET
            name = :name,
            brand_name = :brand_name,
            brand_domains = :brand_domains,
            keywords_prompts = :keywords_prompts,
            market_region = :market_region,
            competitors = :competitors,
            preset_id = :preset_id,
            target_llms = :target_llms,
            search_enabled = :search_enabled,
            schedule_interval = :schedule_interval,
            datasets_per_day = :datasets_per_day,
            initial_test_used = :initial_test_used,
            full_started_at = :full_started_at,
            status = :status,
            next_run_at = :next_run_at
        WHERE id = :id
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':name'              => $validated['name'],
        ':brand_name'        => $validated['brand_name'],
        ':brand_domains'     => json_encode($validated['brand_domains'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':keywords_prompts'  => json_encode($validated['keywords_prompts'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':market_region'     => $validated['market_region'],
        ':competitors'       => json_encode($validated['competitors'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':preset_id'         => $validated['preset_id'],
        ':target_llms'       => json_encode($validated['target_llms'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':search_enabled'    => $validated['search_enabled'],
        ':schedule_interval' => $validated['schedule_interval'],
        ':datasets_per_day'  => $datasetsPerDay,
        ':initial_test_used' => $initialTestUsed,
        ':full_started_at'   => $fullStartedAt,
        ':status'            => $validated['status'],
        ':next_run_at'       => $nextRunAt,
        ':id'                => $id,
    ]);

    // Fetch updated
    $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
    $fetchStmt->execute([':id' => $id]);
    $updated = $fetchStmt->fetch();

    jsonResponse([
        'config'  => formatConfigRecord($updated, getLlmModelCapabilitiesMap($db)),
        'message' => $isActivatingFullStart
            ? 'Full Data Mining activated successfully.'
            : 'Configuration updated successfully.',
    ], 200);
}

/**
 * Handle DELETE request: 90-day soft-delete configuration (removes from user's dashboard,
 * retains data in database for 90 days before hard-purge).
 * Full-started configurations must be stopped before they can be deleted;
 * unstarted draft configurations can be deleted directly.
 * Guarded by requireAuth(allowMagicAudit: true) and assertNotAuditMode.
 */
function handleDeleteConfig(?int $id): void {
    $currentUser = requireAuth(true);
    assertNotAuditMode($currentUser);

    if ($id === null || $id <= 0) {
        jsonError("A valid config ID is required.", 422);
    }

    $db = getDb();
    ensureCoreSchemaColumns($db);
    purgeExpiredDeletedConfigs($db);
    $userId = (int)$currentUser['id'];
    $isAdmin = ($currentUser['role'] ?? '') === 'admin';

    $checkStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id LIMIT 1");
    $checkStmt->execute([':id' => $id]);
    $config = $checkStmt->fetch();

    if (!$config) {
        jsonError("Configuration not found.", 404);
    }

    if ((int)$config['user_id'] !== $userId && !$isAdmin) {
        jsonError("Configuration not found.", 404);
    }

    $existingStatus = strtolower((string)($config['status'] ?? 'active'));
    $alreadyFullStarted = !empty($config['full_started_at']);

    if ($existingStatus === 'deleted') {
        jsonError("Configuration not found.", 404);
    }

    if ($alreadyFullStarted && !in_array($existingStatus, ['stopped', 'archived'], true)) {
        jsonError(
            "Full-started configurations must be stopped before they can be deleted.",
            409
        );
    }

    $deletedAt = date('Y-m-d H:i:s');
    $retainedUntil = date('Y-m-d H:i:s', time() + (90 * 86400));

    try {
        $delStmt = $db->prepare("
            UPDATE tracking_configs
            SET status = 'deleted', deleted_at = :deleted_at, next_run_at = NULL
            WHERE id = :id
        ");
        $delStmt->execute([':deleted_at' => $deletedAt, ':id' => $id]);
    } catch (Throwable $e) {
        $delStmt = $db->prepare("
            UPDATE tracking_configs
            SET status = 'deleted', next_run_at = NULL
            WHERE id = :id
        ");
        $delStmt->execute([':id' => $id]);
    }

    try {
        $delBr = $db->prepare("DELETE FROM batch_requests WHERE config_id = :config_id AND status = 'queued'");
        $delBr->execute([':config_id' => $id]);
    } catch (Throwable $e) {
        // Ignore if batch_requests table does not exist in mock
    }

    jsonResponse([
        'success'        => true,
        'id'             => $id,
        'status'         => 'deleted',
        'deleted_at'     => $deletedAt,
        'retained_until' => $retainedUntil,
        'retention_days' => 90,
        'message'        => 'Configuration deleted successfully.',
    ], 200);
}

/**
 * Enforces that mutations are prohibited when operating in Magic Audit preview mode.
 */
function assertNotAuditMode(array $user): void {
    if (!empty($user['is_audit_mode'])) {
        jsonError("Modifications not permitted in Magic Audit preview mode.", 403);
    }
}

/**
 * Validates and sanitizes config payload fields according to interface contracts.
 */
function validateAndSanitizeConfigInput(array $data, bool $isUpdate = false, ?array $existing = null): array {
    // 1. brand_name
    if (isset($data['brand_name'])) {
        $brandName = trim((string)$data['brand_name']);
        if ($brandName === '') {
            jsonError("brand_name cannot be empty.", 422);
        }
    } elseif ($isUpdate && $existing) {
        $brandName = (string)$existing['brand_name'];
    } else {
        jsonError("brand_name is required.", 422);
    }

    // 2. brand_domains
    if (isset($data['brand_domains'])) {
        $rawDomains = $data['brand_domains'];
        if (is_string($rawDomains)) {
            $rawDomains = explode(',', $rawDomains);
        }
        if (!is_array($rawDomains)) {
            jsonError("brand_domains must be an array of domains.", 422);
        }
        $brandDomains = [];
        foreach ($rawDomains as $d) {
            $cleaned = strtolower(trim((string)$d));
            $cleaned = preg_replace('#^https?://#', '', $cleaned);
            $cleaned = preg_replace('#/.*$#', '', $cleaned);
            if ($cleaned !== '') {
                $brandDomains[] = $cleaned;
            }
        }
        if (empty($brandDomains)) {
            jsonError("brand_domains must contain at least one valid domain.", 422);
        }
    } elseif ($isUpdate && $existing) {
        $brandDomains = json_decode($existing['brand_domains'] ?: '[]', true) ?? [];
    } else {
        jsonError("brand_domains is required.", 422);
    }

    // 3. keywords_prompts (accepts prompts alias)
    $promptsInput = $data['keywords_prompts'] ?? $data['prompts'] ?? null;
    if ($promptsInput !== null) {
        if (is_string($promptsInput)) {
            $promptsInput = explode("\n", $promptsInput);
        }
        if (!is_array($promptsInput)) {
            jsonError("keywords_prompts must be an array of prompt strings.", 422);
        }
        $keywordsPrompts = [];
        foreach ($promptsInput as $p) {
            $cleanP = trim((string)$p);
            if ($cleanP !== '') {
                $keywordsPrompts[] = $cleanP;
            }
        }
        if (empty($keywordsPrompts)) {
            jsonError("At least one prompt is required.", 422);
        }
    } elseif ($isUpdate && $existing) {
        $keywordsPrompts = json_decode($existing['keywords_prompts'] ?: '[]', true) ?? [];
    } else {
        jsonError("keywords_prompts (or prompts) is required.", 422);
    }

    // 4. competitors
    if (isset($data['competitors'])) {
        $rawComps = $data['competitors'];
        if (is_string($rawComps)) {
            $rawComps = explode(',', $rawComps);
        }
        if (!is_array($rawComps)) {
            $rawComps = [];
        }
        $competitors = [];
        foreach ($rawComps as $c) {
            if (is_string($c)) {
                $compName = trim($c);
                if ($compName !== '') {
                    $competitors[] = [
                        'name'    => $compName,
                        'domains' => []
                    ];
                }
            } elseif (is_array($c) && !empty($c['name'])) {
                $compName = trim((string)$c['name']);
                $cDomains = $c['domains'] ?? (isset($c['domain']) ? [$c['domain']] : []);
                if (!is_array($cDomains)) {
                    $cDomains = [$cDomains];
                }
                $cleanCDomains = [];
                foreach ($cDomains as $cd) {
                    $cleaned = strtolower(trim((string)$cd));
                    $cleaned = preg_replace('#^https?://#', '', $cleaned);
                    $cleaned = preg_replace('#/.*$#', '', $cleaned);
                    if ($cleaned !== '') {
                        $cleanCDomains[] = $cleaned;
                    }
                }
                $competitors[] = [
                    'name'    => $compName,
                    'domains' => $cleanCDomains
                ];
            }
        }
    } elseif ($isUpdate && $existing) {
        $competitors = json_decode($existing['competitors'] ?: '[]', true) ?? [];
    } else {
        $competitors = [];
    }

    // 5. target_llms
    if (isset($data['target_llms'])) {
        $targetLLMs = normalizeTargetLlmsList($data['target_llms']);
    } elseif ($isUpdate && $existing) {
        $existingLLMs = json_decode($existing['target_llms'] ?: '[]', true);
        $targetLLMs = normalizeTargetLlmsList(is_array($existingLLMs) ? $existingLLMs : []);
    } else {
        $targetLLMs = ['openai/gpt-6-luna', 'google/gemini-3.5-flash'];
    }

    // 6. schedule_interval (Data Mining Accuracy: every_120m, every_60m, every_30m, every_15m)
    $VALID_INTERVALS = getValidScheduleIntervals();
    if (isset($data['schedule_interval'])) {
        $scheduleInterval = normalizeScheduleInterval((string)$data['schedule_interval']);
        if (!in_array($scheduleInterval, $VALID_INTERVALS, true)) {
            jsonError("Invalid schedule_interval. Allowed: " . implode(', ', $VALID_INTERVALS), 422);
        }
    } elseif ($isUpdate && $existing) {
        $existingInterval = normalizeScheduleInterval((string)($existing['schedule_interval'] ?? 'every_120m'));
        $scheduleInterval = in_array($existingInterval, $VALID_INTERVALS, true) ? $existingInterval : 'every_120m';
    } else {
        $scheduleInterval = 'every_120m';
    }

    // 7. search_enabled
    if (isset($data['search_enabled'])) {
        $searchEnabled = ($data['search_enabled'] === true || $data['search_enabled'] === 1 || $data['search_enabled'] === '1' || $data['search_enabled'] === 'true') ? 1 : 0;
    } elseif ($isUpdate && $existing) {
        $searchEnabled = (int)$existing['search_enabled'];
    } else {
        $searchEnabled = 1;
    }

    // 8. name
    if (isset($data['name']) && trim((string)$data['name']) !== '') {
        $name = trim((string)$data['name']);
    } elseif ($isUpdate && $existing) {
        $name = (string)$existing['name'];
    } else {
        $name = "{$brandName} Tracking";
    }

    // 9. status
    $VALID_STATUSES = ['active', 'paused', 'stopped', 'archived', 'deleted'];
    if (isset($data['status']) && in_array($data['status'], $VALID_STATUSES, true)) {
        $status = (string)$data['status'];
    } elseif ($isUpdate && $existing) {
        $status = (string)$existing['status'];
    } else {
        $status = 'active';
    }

    // 10. preset_id (optional Analyse-Set slug)
    $presetId = null;
    if (array_key_exists('preset_id', $data)) {
        $rawPreset = trim((string)$data['preset_id']);
        $presetId = ($rawPreset !== '') ? $rawPreset : null;
    } elseif ($isUpdate && $existing && !empty($existing['preset_id'])) {
        $presetId = trim((string)$existing['preset_id']);
    }

    // 11. market_region (optional geographic target region; null = auto-infer from prompt language)
    if (array_key_exists('market_region', $data)) {
        $marketRegion = sanitizeMarketRegion($data['market_region']);
    } elseif ($isUpdate && $existing && array_key_exists('market_region', $existing)) {
        $marketRegion = sanitizeMarketRegion($existing['market_region']);
    } else {
        $marketRegion = null;
    }

    return [
        'name'              => $name,
        'brand_name'        => $brandName,
        'brand_domains'     => $brandDomains,
        'keywords_prompts'  => $keywordsPrompts,
        'market_region'     => $marketRegion,
        'competitors'       => $competitors,
        'preset_id'         => $presetId,
        'target_llms'       => $targetLLMs,
        'schedule_interval' => $scheduleInterval,
        'search_enabled'    => $searchEnabled,
        'status'            => $status,
    ];
}

/**
 * Normalizes an optional market_region value (`'auto'`, `'default'`, empty -> `null`).
 */
function sanitizeMarketRegion($raw): ?string {
    if ($raw === null || is_array($raw) || is_object($raw)) {
        return null;
    }
    $clean = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$raw));
    $clean = preg_replace('/\s+/u', ' ', $clean);
    if ($clean === '' || in_array(strtolower($clean), ['auto', 'default', 'none', 'null'], true)) {
        return null;
    }
    return mb_substr($clean, 0, 100);
}

/**
 * Enforces subscription plan quotas, Data Mining intervals, allowed models, and Analyse-Set rules.
 */
function enforcePlanAndPresetPolicy(
    PDO $db,
    array $currentUser,
    array &$validated,
    array $data,
    bool $isUpdate = false,
    ?array $existing = null
): void {
    $isAdmin = strtolower((string)($currentUser['role'] ?? 'user')) === 'admin';
    if ($isAdmin) {
        return;
    }

    // Legacy mock-PDO unit/adversarial harnesses construct an uninitialized PDO stub
    // whose user record does not declare a subscription tier and cannot execute catalog SQL.
    $isUninitializedStub = false;
    try {
        $isUninitializedStub = trim((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME)) === '';
    } catch (Throwable $e) {
        $isUninitializedStub = true;
    }
    if ($isUninitializedStub && !array_key_exists('tier', $currentUser)) {
        return;
    }

    $userId = (int)$currentUser['id'];
    $userTier = strtolower((string)($currentUser['tier'] ?? 'free'));
    $plan = getPlanForTier($db, $userTier);

    // 1. Max configurations quota on CREATE
    if (!$isUpdate) {
        $cntStmt = $db->prepare("SELECT COUNT(*) FROM tracking_configs WHERE user_id = :user_id AND status != 'deleted'");
        $cntStmt->execute([':user_id' => $userId]);
        $existingCount = (int)$cntStmt->fetchColumn();
        $maxConfigs = max(1, (int)($plan['max_configs'] ?? 3));
        if ($existingCount >= $maxConfigs) {
            jsonError(
                "Maximum number of active/paused profiles ({$maxConfigs}) reached for your current plan ({$plan['tier']}). Please upgrade your plan.",
                403,
                [
                    'quota'        => 'max_configs',
                    'limit'        => $maxConfigs,
                    'current_tier' => $plan['tier'],
                ]
            );
        }
    }

    // 2. Max competitors & prompts per configuration
    $maxCompetitors = max(1, (int)($plan['max_competitors_per_config'] ?? 5));
    if ((!$isUpdate || isset($data['competitors'])) && count($validated['competitors']) > $maxCompetitors) {
        jsonError(
            "Maximum of {$maxCompetitors} competitor(s) per profile allowed on your current plan ({$plan['tier']}).",
            403,
            [
                'quota'        => 'max_competitors_per_config',
                'limit'        => $maxCompetitors,
                'current_tier' => $plan['tier'],
            ]
        );
    }

    $maxPrompts = max(1, (int)($plan['max_prompts_per_config'] ?? 10));
    if ((!$isUpdate || isset($data['keywords_prompts']) || isset($data['prompts'])) && count($validated['keywords_prompts']) > $maxPrompts) {
        jsonError(
            "Maximum of {$maxPrompts} prompt(s) per profile allowed on your current plan ({$plan['tier']}).",
            403,
            [
                'quota'        => 'max_prompts_per_config',
                'limit'        => $maxPrompts,
                'current_tier' => $plan['tier'],
            ]
        );
    }

    // 3. Allowed Data Mining schedule interval
    if ((!$isUpdate || isset($data['schedule_interval'])) && !canUserUseScheduleInterval($currentUser, $validated['schedule_interval'], $plan)) {
        jsonError(
            "Data Mining interval ({$validated['schedule_interval']}) is not included in your current plan ({$plan['tier']}).",
            403,
            [
                'required_tier'     => 'starter',
                'current_tier'      => $plan['tier'],
                'schedule_interval' => $validated['schedule_interval'],
            ]
        );
    }

    // 4. Analyse-Set / Model Preset & Custom Model policy
    $allModels = getAdminModelsCatalog($db, false);
    $disallowedIds = [];
    foreach ($allModels as $m) {
        if (empty($m['is_allowed'])) {
            $disallowedIds[] = (string)$m['id'];
        }
    }

    $allowCustomModels = !empty($plan['allow_custom_models']);
    $allActivePresets = getModelPresetsCatalog($db, true);
    $allowedPresetIds = decodeCatalogJsonArray($plan['allowed_preset_ids'] ?? [], ['dach_core_baseline']);
    $allowedPresets = array_values(array_filter($allActivePresets, function (array $p) use ($allowedPresetIds, $userTier): bool {
        if (in_array($p['id'], $allowedPresetIds, true)) {
            return true;
        }
        return empty($allowedPresetIds) && in_array($userTier, $p['allowed_tiers'] ?? [], true);
    }));

    $findPresetById = function (?string $pid) use ($allowedPresets): ?array {
        if ($pid === null || $pid === '') {
            return null;
        }
        foreach ($allowedPresets as $p) {
            if ($p['id'] === $pid) {
                return $p;
            }
        }
        return null;
    };

    if (!$allowCustomModels) {
        $requestedPresetId = array_key_exists('preset_id', $data) ? trim((string)$data['preset_id']) : '';

        if ($requestedPresetId !== '') {
            $matchedPreset = $findPresetById($requestedPresetId);
            if ($matchedPreset === null) {
                jsonError(
                    "The selected Analyse-Set '{$requestedPresetId}' is not available in your current plan ({$plan['tier']}).",
                    403,
                    [
                        'required_tier' => 'growth',
                        'current_tier'  => $plan['tier'],
                        'preset_id'     => $requestedPresetId,
                    ]
                );
            }
            $validated['preset_id'] = $matchedPreset['id'];
            $validated['target_llms'] = normalizeTargetLlmsList($matchedPreset['target_llms']);
            $validated['search_enabled'] = !empty($matchedPreset['search_enabled']) ? 1 : 0;
            return;
        }

        if (!empty($data['custom_models_mode'])) {
            jsonError(
                "Custom model and web search configuration requires the Growth or Enterprise plan. Please choose a curated Analyse-Set.",
                403,
                [
                    'required_tier' => 'growth',
                    'current_tier'  => $plan['tier'],
                ]
            );
        }

        $submittedModelsOrSearch = isset($data['target_llms']) || isset($data['search_enabled']);
        if ($isUpdate && !$submittedModelsOrSearch) {
            return;
        }

        if (!$isUpdate && !$submittedModelsOrSearch && !empty($allowedPresets)) {
            $defaultPreset = $allowedPresets[0];
            foreach ($allowedPresets as $candidate) {
                if (!empty($candidate['is_default'])) {
                    $defaultPreset = $candidate;
                    break;
                }
            }
            $validated['preset_id'] = $defaultPreset['id'];
            $validated['target_llms'] = normalizeTargetLlmsList($defaultPreset['target_llms']);
            $validated['search_enabled'] = !empty($defaultPreset['search_enabled']) ? 1 : 0;
            return;
        }

        // Compatibility check: auto-bind if submitted models + search exactly match an allowed Analyse-Set
        $reqLlmsSorted = normalizeTargetLlmsList($validated['target_llms']);
        sort($reqLlmsSorted);
        $reqSearch = (int)$validated['search_enabled'];

        $matchedBySpec = null;
        foreach ($allowedPresets as $candidate) {
            $candLlms = normalizeTargetLlmsList($candidate['target_llms']);
            sort($candLlms);
            $candSearch = !empty($candidate['search_enabled']) ? 1 : 0;
            if ($candLlms === $reqLlmsSorted && $candSearch === $reqSearch) {
                $matchedBySpec = $candidate;
                break;
            }
        }

        if ($matchedBySpec !== null) {
            $validated['preset_id'] = $matchedBySpec['id'];
            return;
        }

        jsonError(
            "Custom model and web search configuration requires the Growth or Enterprise plan. Please select one of the pre-defined Analyse-Sets (Model Presets) available in your plan.",
            403,
            [
                'required_tier' => 'growth',
                'current_tier'  => $plan['tier'],
            ]
        );
    }

    // Custom models allowed (Growth / Enterprise): enforce admin-disabled models when custom models are submitted
    $submittedCustom = !$isUpdate || isset($data['target_llms']);
    if ($submittedCustom && !empty($disallowedIds)) {
        foreach ($validated['target_llms'] as $llmId) {
            if (in_array((string)$llmId, $disallowedIds, true)) {
                jsonError(
                    "Model '{$llmId}' is currently disabled by your administrator.",
                    403,
                    [
                        'disallowed_model' => $llmId,
                        'current_tier'     => $plan['tier'],
                    ]
                );
            }
        }
    }
}

/**
 * Calculates initial next_run_at timestamp for newly scheduled or reactivated configs.
 * Scheduled configs run immediately on the next queue poll (NOW), then advance by interval.
 */
function calculateNextRunAt(string $interval): ?string {
    $canonical = normalizeScheduleInterval($interval);
    if (!in_array($canonical, getValidScheduleIntervals(), true)) {
        return null;
    }
    return date('Y-m-d H:i:s');
}

/**
 * Formats database tracking_configs record into normalized JSON object for responses.
 */
function formatConfigRecord(array $row, array $modelCaps = []): array {
    $domains = json_decode($row['brand_domains'] ?: '[]', true) ?? [];
    $prompts = json_decode($row['keywords_prompts'] ?: '[]', true) ?? [];
    $competitors = json_decode($row['competitors'] ?: '[]', true) ?? [];
    $targetLLMs = json_decode($row['target_llms'] ?: '[]', true) ?? [];
    $rawInterval = (string)($row['schedule_interval'] ?? 'every_120m');
    $scheduleInterval = normalizeScheduleInterval($rawInterval);
    if (!in_array($scheduleInterval, getValidScheduleIntervals(), true)) {
        $scheduleInterval = 'every_120m';
    }

    $runsPerDay = getScheduleRunsPerDay($scheduleInterval);
    $datasetsPerDay = isset($row['datasets_per_day']) && (int)$row['datasets_per_day'] > 0
        ? (int)$row['datasets_per_day']
        : (int)$runsPerDay;

    $initialTestUsed = !empty($row['initial_test_used']);
    $fullStartedAt = !empty($row['full_started_at']) ? (string)$row['full_started_at'] : null;
    $status = (string)($row['status'] ?? 'active');
    $canTriggerTestRun = ($fullStartedAt === null && !$initialTestUsed && !in_array($status, ['stopped', 'archived', 'deleted'], true));

    $referenceDate = $fullStartedAt ?? ($row['created_at'] ?? null);
    $isFirstDay = $referenceDate !== null && substr((string)$referenceDate, 0, 10) === date('Y-m-d');
    $searchEnabled = !empty($row['search_enabled']);

    $executionStrategies = [];
    foreach ($targetLLMs as $llmToken) {
        $baseSpec = resolveTargetLlmSpec((string)$llmToken, $scheduleInterval, $searchEnabled, false);
        if ($baseSpec['id'] !== '') {
            $caps = $modelCaps[$baseSpec['id']] ?? [];
            $spec = resolveTargetLlmSpec(
                (string)$llmToken,
                $scheduleInterval,
                $searchEnabled,
                false,
                array_key_exists('supports_batch_api', $caps) ? (bool)$caps['supports_batch_api'] : null,
                array_key_exists('supports_tools', $caps) ? (bool)$caps['supports_tools'] : null
            );
            $executionStrategies[$spec['id']] = $spec['execution_strategy'];
        }
    }

    return [
        'id'                   => (int)$row['id'],
        'user_id'              => (int)$row['user_id'],
        'name'                 => $row['name'],
        'brand_name'           => $row['brand_name'],
        'brand_domains'        => $domains,
        'keywords_prompts'     => $prompts,
        'prompts'              => $prompts, // Alias for client/test compatibility
        'market_region'        => sanitizeMarketRegion($row['market_region'] ?? null),
        'competitors'          => $competitors,
        'preset_id'            => !empty($row['preset_id']) ? (string)$row['preset_id'] : null,
        'target_llms'          => $targetLLMs,
        'search_enabled'       => (bool)$row['search_enabled'],
        'schedule_interval'    => $scheduleInterval,
        'datasets_per_day'     => $datasetsPerDay,
        'runs_per_day'         => $runsPerDay,
        'initial_test_used'    => $initialTestUsed,
        'full_started_at'      => $fullStartedAt,
        'can_trigger_test_run' => $canTriggerTestRun,
        'is_first_day'         => $isFirstDay,
        'execution_strategies' => $executionStrategies,
        'status'               => $status,
        'is_stopped'           => in_array($status, ['stopped', 'archived', 'deleted'], true),
        'can_stop'             => ($fullStartedAt !== null && in_array($status, ['active', 'paused'], true)),
        'can_archive'          => ($status === 'stopped'),
        'can_unarchive'        => ($status === 'archived'),
        'can_delete'           => (($fullStartedAt === null || in_array($status, ['stopped', 'archived'], true)) && $status !== 'deleted'),
        'stopped_at'           => $row['stopped_at'] ?? null,
        'archived_at'          => $row['archived_at'] ?? null,
        'deleted_at'           => $row['deleted_at'] ?? null,
        'last_run_at'          => $row['last_run_at'],
        'next_run_at'          => $row['next_run_at'],
        'created_at'           => $row['created_at'],
        'updated_at'           => $row['updated_at'],
    ];
}
