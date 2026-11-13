<?php
declare(strict_types=1);

/**
 * Chatlytics.de - Tracking Configuration CRUD Endpoint
 * File: api/configs.php
 *
 * Supported Operations:
 * - GET    /api/configs.php          (Lists tracking configs for authenticated user; read-only Magic Audit allowed)
 * - GET    /api/configs.php?id={id}  (Retrieves single config; read-only Magic Audit allowed if matches owner)
 * - POST   /api/configs.php          (Creates new tracking configuration; requires full auth)
 * - PUT    /api/configs.php?id={id}  (Updates existing configuration; requires full auth)
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

if (in_array($overrideMethod, ['PUT', 'UPDATE'], true)) {
    $requestMethod = 'PUT';
} elseif (in_array($overrideMethod, ['DELETE', 'DESTROY'], true)) {
    $requestMethod = 'DELETE';
}

$configId = isset($_GET['id']) ? (int)$_GET['id'] : (isset($requestData['id']) ? (int)$requestData['id'] : null);

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
 * Handle GET requests: list configs or retrieve a single configuration.
 * Read-only access is permitted if accessed via a valid Magic Audit token.
 */
function handleGetConfig(?int $id): void {
    $currentUser = requireAuth(true); // allowMagicAudit = true
    $db = getDb();
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

        $formatted = formatConfigRecord($config);

        // Fetch run count
        $runCountStmt = $db->prepare("SELECT COUNT(*) FROM llm_runs WHERE config_id = :id");
        $runCountStmt->execute([':id' => $id]);
        $formatted['total_runs'] = (int)$runCountStmt->fetchColumn();

        jsonResponse([
            'config' => $formatted,
        ], 200);
    } else {
        // List configurations for user
        $sql = "
            SELECT tc.*, COUNT(r.id) AS run_count
            FROM tracking_configs tc
            LEFT JOIN llm_runs r ON r.config_id = tc.id
            WHERE tc.user_id = :user_id AND tc.status != 'archived'
            GROUP BY tc.id
            ORDER BY tc.created_at DESC
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute([':user_id' => $userId]);
        $rows = $stmt->fetchAll();

        $configs = array_map(function (array $row): array {
            $formatted = formatConfigRecord($row);
            $formatted['total_runs'] = (int)($row['run_count'] ?? 0);
            return $formatted;
        }, $rows);

        jsonResponse([
            'configs' => $configs,
            'count'   => count($configs),
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
    $validated = validateAndSanitizeConfigInput($data);

    $db = getDb();

    $nextRunAt = calculateNextRunAt($validated['schedule_interval']);

    $sql = "
        INSERT INTO tracking_configs (
            user_id, name, brand_name, brand_domains, keywords_prompts,
            competitors, target_llms, search_enabled, schedule_interval,
            status, next_run_at
        ) VALUES (
            :user_id, :name, :brand_name, :brand_domains, :keywords_prompts,
            :competitors, :target_llms, :search_enabled, :schedule_interval,
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
        ':competitors'       => json_encode($validated['competitors'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':target_llms'       => json_encode($validated['target_llms'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':search_enabled'    => $validated['search_enabled'],
        ':schedule_interval' => $validated['schedule_interval'],
        ':status'            => $validated['status'],
        ':next_run_at'       => $nextRunAt,
    ]);

    $newConfigId = (int)$db->lastInsertId();

    // Fetch created configuration
    $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
    $fetchStmt->execute([':id' => $newConfigId]);
    $created = $fetchStmt->fetch();

    $formatted = formatConfigRecord($created);
    $formatted['total_runs'] = 0;

    jsonResponse([
        'config'  => $formatted,
        'message' => 'Tracking configuration created successfully.',
    ], 201);
}

/**
 * Handle PUT request: update existing configuration properties.
 * Guarded by requireAuth(allowMagicAudit: true) and assertNotAuditMode.
 */
function handleUpdateConfig(?int $id, array $data): void {
    $currentUser = requireAuth(true);
    assertNotAuditMode($currentUser);

    if ($id === null || $id <= 0) {
        jsonError("A valid config ID is required in URL or body.", 422);
    }

    $db = getDb();
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

    $validated = validateAndSanitizeConfigInput($data, true, $existing);

    $nextRunAt = calculateNextRunAt($validated['schedule_interval']);

    $sql = "
        UPDATE tracking_configs SET
            name = :name,
            brand_name = :brand_name,
            brand_domains = :brand_domains,
            keywords_prompts = :keywords_prompts,
            competitors = :competitors,
            target_llms = :target_llms,
            search_enabled = :search_enabled,
            schedule_interval = :schedule_interval,
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
        ':competitors'       => json_encode($validated['competitors'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':target_llms'       => json_encode($validated['target_llms'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':search_enabled'    => $validated['search_enabled'],
        ':schedule_interval' => $validated['schedule_interval'],
        ':status'            => $validated['status'],
        ':next_run_at'       => $nextRunAt,
        ':id'                => $id,
    ]);

    // Fetch updated
    $fetchStmt = $db->prepare("SELECT * FROM tracking_configs WHERE id = :id");
    $fetchStmt->execute([':id' => $id]);
    $updated = $fetchStmt->fetch();

    jsonResponse([
        'config'  => formatConfigRecord($updated),
        'message' => 'Configuration updated successfully.',
    ], 200);
}

/**
 * Handle DELETE request: delete configuration and cascade associated runs.
 * Guarded by requireAuth(allowMagicAudit: true) and assertNotAuditMode.
 */
function handleDeleteConfig(?int $id): void {
    $currentUser = requireAuth(true);
    assertNotAuditMode($currentUser);

    if ($id === null || $id <= 0) {
        jsonError("A valid config ID is required.", 422);
    }

    $db = getDb();
    $userId = (int)$currentUser['id'];
    $isAdmin = ($currentUser['role'] ?? '') === 'admin';

    $checkStmt = $db->prepare("SELECT id, user_id FROM tracking_configs WHERE id = :id LIMIT 1");
    $checkStmt->execute([':id' => $id]);
    $config = $checkStmt->fetch();

    if (!$config) {
        jsonError("Configuration not found.", 404);
    }

    if ((int)$config['user_id'] !== $userId && !$isAdmin) {
        jsonError("Configuration not found.", 404);
    }

    // Deletion cascades to llm_runs, run_competitors, and run_citations via foreign keys
    $delStmt = $db->prepare("DELETE FROM tracking_configs WHERE id = :id");
    $delStmt->execute([':id' => $id]);

    jsonResponse([
        'success' => true,
        'id'      => $id,
        'message' => 'Configuration deleted successfully.',
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
        $targetLLMs = ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash'];
    }

    // 6. schedule_interval
    $VALID_INTERVALS = ['manual', 'daily', 'weekly', 'biweekly', 'monthly'];
    if (isset($data['schedule_interval'])) {
        $scheduleInterval = strtolower(trim((string)$data['schedule_interval']));
        if (!in_array($scheduleInterval, $VALID_INTERVALS, true)) {
            jsonError("Invalid schedule_interval. Allowed: manual, daily, weekly, biweekly, monthly", 422);
        }
    } elseif ($isUpdate && $existing) {
        $scheduleInterval = (string)$existing['schedule_interval'];
    } else {
        $scheduleInterval = 'daily';
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
    $VALID_STATUSES = ['active', 'paused', 'archived'];
    if (isset($data['status']) && in_array($data['status'], $VALID_STATUSES, true)) {
        $status = (string)$data['status'];
    } elseif ($isUpdate && $existing) {
        $status = (string)$existing['status'];
    } else {
        $status = 'active';
    }

    return [
        'name'              => $name,
        'brand_name'        => $brandName,
        'brand_domains'     => $brandDomains,
        'keywords_prompts'  => $keywordsPrompts,
        'competitors'       => $competitors,
        'target_llms'       => $targetLLMs,
        'schedule_interval' => $scheduleInterval,
        'search_enabled'    => $searchEnabled,
        'status'            => $status,
    ];
}

/**
 * Calculates next_run_at timestamp based on the selected schedule interval.
 */
function calculateNextRunAt(string $interval): ?string {
    return match ($interval) {
        'manual'   => null,
        'daily'    => date('Y-m-d H:i:s', strtotime('+1 day')),
        'weekly'   => date('Y-m-d H:i:s', strtotime('+1 week')),
        'biweekly' => date('Y-m-d H:i:s', strtotime('+2 weeks')),
        'monthly'  => date('Y-m-d H:i:s', strtotime('+1 month')),
        default    => date('Y-m-d H:i:s', strtotime('+1 day')),
    };
}

/**
 * Formats database tracking_configs record into normalized JSON object for responses.
 */
function formatConfigRecord(array $row): array {
    $domains = json_decode($row['brand_domains'] ?: '[]', true) ?? [];
    $prompts = json_decode($row['keywords_prompts'] ?: '[]', true) ?? [];
    $competitors = json_decode($row['competitors'] ?: '[]', true) ?? [];
    $targetLLMs = json_decode($row['target_llms'] ?: '[]', true) ?? [];

    return [
        'id'                => (int)$row['id'],
        'user_id'           => (int)$row['user_id'],
        'name'              => $row['name'],
        'brand_name'        => $row['brand_name'],
        'brand_domains'     => $domains,
        'keywords_prompts'  => $prompts,
        'prompts'           => $prompts, // Alias for client/test compatibility
        'competitors'       => $competitors,
        'target_llms'       => $targetLLMs,
        'search_enabled'    => (bool)$row['search_enabled'],
        'schedule_interval' => $row['schedule_interval'],
        'status'            => $row['status'],
        'last_run_at'       => $row['last_run_at'],
        'next_run_at'       => $row['next_run_at'],
        'created_at'        => $row['created_at'],
        'updated_at'        => $row['updated_at'],
    ];
}
