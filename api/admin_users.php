<?php
declare(strict_types=1);

/**
 * Chatlytics.de - Admin Cockpit & 1-Click Demo Seeder Endpoint
 * File: api/admin_users.php
 *
 * Supported Actions (Guarded by requireAdmin):
 * - GET  /api/admin_users.php?action=list                  (Paginated user list with run counts)
 * - POST /api/admin_users.php?action=adjust_credits        ({ user_id, delta, reason } or { user_id, credits })
 * - POST /api/admin_users.php?action=generate_magic_token  ({ user_id })
 * - POST /api/admin_users.php?action=seed_demo_data        (1-Click German B2B realistic demo data seeder)
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

// Enforce Admin Role Authorization Guard
$adminUser = requireAdmin();

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestData = getRequestData();
$action = (string)($_GET['action'] ?? $requestData['action'] ?? '');

if ($action === '') {
    $action = ($requestMethod === 'GET') ? 'list' : 'adjust_credits';
}

switch ($action) {
    case 'list':
        handleListUsers($requestData);
        break;

    case 'adjust_credits':
        handleAdjustCredits($requestData);
        break;

    case 'generate_magic_token':
        handleGenerateMagicToken($requestData);
        break;

    case 'seed_demo':
    case 'seed_demo_data':
        handleSeedDemoData();
        break;

    case 'pause_all_configs':
        handlePauseAllConfigs($requestData);
        break;

    case 'set_user_status':
        handleSetUserStatus($requestData, $adminUser);
        break;

    case 'update_user_tier':
        handleUpdateUserTier($requestData);
        break;

    case 'list_models':
        handleListModels();
        break;

    case 'save_model':
        handleSaveModel($requestData);
        break;

    case 'toggle_model':
        handleToggleModel($requestData);
        break;

    case 'sync_n8n_models':
        handleSyncN8nModels($requestData);
        break;

    case 'list_presets':
        handleListPresets();
        break;

    case 'save_preset':
        handleSavePreset($requestData);
        break;

    case 'delete_preset':
        handleDeletePreset($requestData);
        break;

    case 'list_plans':
        handleListPlans();
        break;

    case 'save_plan':
        handleSavePlan($requestData);
        break;

    default:
        jsonError("Invalid admin action: {$action}", 400);
        break;
}

/**
 * List users with pagination, profile counts, token telemetry, credit balances, tiers, created_at, status.
 */
function handleListUsers(array $data): void {
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $page = max(1, (int)($_GET['page'] ?? $data['page'] ?? 1));
    $limit = min(100, max(1, (int)($_GET['limit'] ?? $data['limit'] ?? 20)));
    $offset = ($page - 1) * $limit;
    $search = trim((string)($_GET['search'] ?? $data['search'] ?? ''));

    $where = "WHERE 1=1";
    $params = [];

    if ($search !== '') {
        $where .= " AND (u.email LIKE :search_email OR u.company_name LIKE :search_company)";
        $searchPattern = '%' . $search . '%';
        $params[':search_email'] = $searchPattern;
        $params[':search_company'] = $searchPattern;
    }

    // Count total users matching search
    $countStmt = $db->prepare("SELECT COUNT(*) FROM users u $where");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $rawUsers = [];
    $platformKpis = [
        'total_users'    => $total,
        'total_configs'  => 0,
        'active_configs' => 0,
        'total_runs'     => 0,
        'total_credits'  => 0,
        'total_tokens'   => 0,
    ];

    try {
        // Query users with isolated subqueries to prevent cartesian multiplication
        $sql = "
            SELECT 
                u.id,
                u.email,
                u.company_name,
                u.role,
                u.tier,
                u.credits_remaining,
                u.status,
                u.created_at,
                u.updated_at,
                u.magic_audit_token,
                u.stripe_customer_id,
                u.stripe_subscription_id,
                COALESCE(r_agg.run_count, 0) AS run_count,
                COALESCE(r_agg.total_input_tokens, 0) AS total_input_tokens,
                COALESCE(r_agg.total_output_tokens, 0) AS total_output_tokens,
                COALESCE(r_agg.total_cached_tokens, 0) AS total_cached_tokens,
                COALESCE(tc_agg.config_count, 0) AS config_count,
                COALESCE(tc_agg.active_config_count, 0) AS active_config_count,
                COALESCE(tc_agg.paused_config_count, 0) AS paused_config_count
            FROM users u
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(id) AS run_count,
                    COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                    COALESCE(SUM(cached_tokens), 0) AS total_cached_tokens
                FROM llm_runs
                GROUP BY user_id
            ) r_agg ON r_agg.user_id = u.id
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(id) AS config_count,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_config_count,
                    SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_config_count
                FROM tracking_configs
                WHERE status != 'deleted'
                GROUP BY user_id
            ) tc_agg ON tc_agg.user_id = u.id
            $where
            ORDER BY u.created_at DESC
            LIMIT :limit OFFSET :offset
        ";

        $stmt = $db->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $rawUsers = $stmt->fetchAll();

        // Global platform KPI totals (scalar subqueries, safe against pagination cutoffs)
        $userKpiRow = $db->query("SELECT COUNT(*) AS cnt, COALESCE(SUM(credits_remaining), 0) AS credits FROM users")->fetch();
        $cfgKpiRow = $db->query("SELECT COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_cnt FROM tracking_configs WHERE status != 'deleted'")->fetch();
        $runKpiRow = $db->query("SELECT COUNT(*) AS cnt, COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS tokens FROM llm_runs")->fetch();
        $platformKpis = [
            'total_users'    => (int)($userKpiRow['cnt'] ?? $total),
            'total_credits'  => (int)($userKpiRow['credits'] ?? 0),
            'total_configs'  => (int)($cfgKpiRow['cnt'] ?? 0),
            'active_configs' => (int)($cfgKpiRow['active_cnt'] ?? 0),
            'total_runs'     => (int)($runKpiRow['cnt'] ?? 0),
            'total_tokens'   => (int)($runKpiRow['tokens'] ?? 0),
        ];
    } catch (Throwable $e) {
        // Fallback for minimal SQLite unit-test schemas lacking tracking_configs or token columns
        $fallbackSql = "
            SELECT 
                u.id,
                u.email,
                u.company_name,
                u.role,
                u.tier,
                u.credits_remaining,
                u.status,
                u.created_at,
                u.updated_at,
                u.magic_audit_token,
                COUNT(r.id) AS run_count
            FROM users u
            LEFT JOIN llm_runs r ON r.user_id = u.id
            $where
            GROUP BY u.id
            ORDER BY u.created_at DESC
            LIMIT :limit OFFSET :offset
        ";
        $stmt = $db->prepare($fallbackSql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $rawUsers = $stmt->fetchAll();
    }

    $formattedUsers = array_map(function (array $u): array {
        $uid = (int)$u['id'];
        $runCount = (int)($u['run_count'] ?? 0);
        $configCount = (int)($u['config_count'] ?? 0);
        $inTok = (int)($u['total_input_tokens'] ?? 0);
        $outTok = (int)($u['total_output_tokens'] ?? 0);
        $cachedTok = (int)($u['total_cached_tokens'] ?? 0);
        $totalTok = $inTok + $outTok;

        return [
            'id'                     => $uid,
            'email'                  => $u['email'],
            'company_name'           => $u['company_name'],
            'role'                   => $u['role'],
            'tier'                   => $u['tier'],
            'credits_remaining'      => (int)$u['credits_remaining'],
            'run_count'              => $runCount,
            'config_count'           => $configCount,
            'active_config_count'    => (int)($u['active_config_count'] ?? 0),
            'paused_config_count'    => (int)($u['paused_config_count'] ?? 0),
            'total_input_tokens'     => $inTok,
            'total_output_tokens'    => $outTok,
            'total_cached_tokens'    => $cachedTok,
            'total_tokens'           => $totalTok,
            'avg_tokens_per_run'     => $runCount > 0 ? (int)round($totalTok / $runCount) : 0,
            'avg_tokens_per_config'  => $configCount > 0 ? (int)round($totalTok / $configCount) : 0,
            'status'                 => $u['status'],
            'created_at'             => $u['created_at'],
            'updated_at'             => $u['updated_at'],
            'magic_audit_token'      => $u['magic_audit_token'],
            'stripe_customer_id'     => $u['stripe_customer_id'] ?? null,
            'stripe_subscription_id' => $u['stripe_subscription_id'] ?? null,
            'results_table'          => getUserResultsTableName($uid),
        ];
    }, $rawUsers);

    jsonResponse([
        'users'         => $formattedUsers,
        'platform_kpis' => $platformKpis,
        'pagination'    => [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]
    ]);
}

/**
 * Safely add/deduct/set user credits atomically.
 */
function handleAdjustCredits(array $data): void {
    $userId = (int)($data['user_id'] ?? $_GET['user_id'] ?? 0);
    if ($userId <= 0) {
        jsonError("A valid user_id is required.", 422);
    }

    $db = getDb();
    $checkStmt = $db->prepare("SELECT id, credits_remaining, email FROM users WHERE id = :id");
    $checkStmt->execute([':id' => $userId]);
    $user = $checkStmt->fetch();

    if (!$user) {
        jsonError("User not found.", 404);
    }

    $hasDelta = isset($data['delta']);
    $hasCredits = isset($data['credits']);

    if (!$hasDelta && !$hasCredits) {
        jsonError("Either 'delta' or 'credits' must be specified for credit adjustment.", 422);
    }

    if ($hasDelta) {
        $delta = (int)$data['delta'];
        $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
        $clampExpr = $driver === 'sqlite'
            ? 'MAX(0, credits_remaining + :delta)'
            : 'GREATEST(0, credits_remaining + :delta)';
        $stmt = $db->prepare("
            UPDATE users 
            SET credits_remaining = {$clampExpr}
            WHERE id = :id
        ");
        $stmt->execute([':delta' => $delta, ':id' => $userId]);
    } else {
        $newCredits = max(0, (int)$data['credits']);
        $stmt = $db->prepare("
            UPDATE users 
            SET credits_remaining = :credits 
            WHERE id = :id
        ");
        $stmt->execute([':credits' => $newCredits, ':id' => $userId]);
    }

    // Retrieve updated state
    $fetchStmt = $db->prepare("SELECT id, email, credits_remaining FROM users WHERE id = :id");
    $fetchStmt->execute([':id' => $userId]);
    $updated = $fetchStmt->fetch();

    jsonResponse([
        'success'           => true,
        'user_id'           => (int)$updated['id'],
        'email'             => $updated['email'],
        'credits_remaining' => (int)$updated['credits_remaining'],
        'message'           => 'User credits adjusted successfully.',
    ]);
}

/**
 * Regenerate client magic_audit_token and output shareable preview URL.
 */
function handleGenerateMagicToken(array $data): void {
    $userId = (int)($data['user_id'] ?? $_GET['user_id'] ?? 0);
    if ($userId <= 0) {
        jsonError("A valid user_id is required.", 422);
    }

    $db = getDb();
    $checkStmt = $db->prepare("SELECT id, email FROM users WHERE id = :id");
    $checkStmt->execute([':id' => $userId]);
    $user = $checkStmt->fetch();

    if (!$user) {
        jsonError("User not found.", 404);
    }

    $token = bin2hex(random_bytes(24));
    $upd = $db->prepare("UPDATE users SET magic_audit_token = :token WHERE id = :id");
    $upd->execute([':token' => $token, ':id' => $userId]);

    $config = getConfig();
    $baseUrl = rtrim((string)($config['app']['base_url'] ?? 'https://chatlytics.de'), '/');
    $shareableUrl = "{$baseUrl}/dashboard.html?audit_token={$token}";

    jsonResponse([
        'success'           => true,
        'user_id'           => $userId,
        'magic_audit_token' => $token,
        'shareable_url'     => $shareableUrl,
        'link'              => $shareableUrl,
    ]);
}

/**
 * 1-Click Realistic Demo Data Seeder.
 * Injects 3 German B2B SaaS accounts (Personio, Celonis, DeepL) with configs,
 * physical `user_results_<user_id>` tables, historical runs across OpenAI, Mistral,
 * and Gemini, competitors, and grounding citations spanning all 4 MECE categories
 * and all 4 GEO quadrants over a multi-week daily timeline.
 */
function handleSeedDemoData(): void {
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    $options = defined('PASSWORD_ARGON2ID') ? [
        'memory_cost' => 65536,
        'time_cost'   => 4,
        'threads'     => 1,
    ] : ['cost' => 12];
    $defaultHash = password_hash('DemoAccount2026!', $algo, $options);

    // Account Definitions using the 4 Data Mining Accuracy tiers
    $accounts = [
        [
            'email'        => 'demo@personio.de',
            'company_name' => 'Personio SE & Co. KG',
            'tier'         => 'growth',
            'credits'      => 500,
            'config'       => [
                'name'              => 'Personio HR Tech Visibility',
                'brand_name'        => 'Personio',
                'brand_domains'     => ['personio.de', 'personio.com'],
                'keywords_prompts'  => [
                    'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?',
                    'Beste Personalmanagement Software für KMU',
                    'Personio Alternativen und Zeiterfassung Software Vergleich'
                ],
                'competitors'       => [
                    ['name' => 'Workday', 'domain' => 'workday.com'],
                    ['name' => 'BambooHR', 'domain' => 'bamboohr.com'],
                    ['name' => 'Factorial', 'domain' => 'factorial.de'],
                    ['name' => 'Kenjo', 'domain' => 'kenjo.io']
                ],
                'market_region'     => 'DACH',
                'target_llms'       => ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-large-4-0'],
                'schedule_interval' => 'every_60m',
                'datasets_per_day'  => 24,
                'search_enabled'    => 1,
            ]
        ],
        [
            'email'        => 'demo@celonis.com',
            'company_name' => 'Celonis SE',
            'tier'         => 'enterprise_managed',
            'credits'      => 2000,
            'config'       => [
                'name'              => 'Celonis Process Mining Intelligence',
                'brand_name'        => 'Celonis',
                'brand_domains'     => ['celonis.com', 'celonis.de'],
                'keywords_prompts'  => [
                    'Führende Process Mining Software für Großunternehmen',
                    'Celonis vs SAP Signavio Prozessoptimierung',
                    'Process Intelligence und Automatisierungs-Plattformen'
                ],
                'competitors'       => [
                    ['name' => 'SAP Signavio', 'domain' => 'signavio.com'],
                    ['name' => 'UiPath', 'domain' => 'uipath.com'],
                    ['name' => 'ARIS', 'domain' => 'softwareag.com']
                ],
                'market_region'     => 'DACH',
                'target_llms'       => ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-large-4-0'],
                'schedule_interval' => 'every_15m',
                'datasets_per_day'  => 96,
                'search_enabled'    => 1,
            ]
        ],
        [
            'email'        => 'demo@deepl.com',
            'company_name' => 'DeepL SE',
            'tier'         => 'starter',
            'credits'      => 300,
            'config'       => [
                'name'              => 'DeepL AI Translation Benchmark',
                'brand_name'        => 'DeepL',
                'brand_domains'     => ['deepl.com'],
                'keywords_prompts'  => [
                    'Präziseste KI Übersetzungssoftware für Unternehmen',
                    'DeepL vs Google Translate Business Translation',
                    'Beste KI-Tools für professionelle Übersetzungen'
                ],
                'competitors'       => [
                    ['name' => 'Google Translate', 'domain' => 'translate.google.com'],
                    ['name' => 'Microsoft Translator', 'domain' => 'translator.microsoft.com'],
                    ['name' => 'NeuroFlash', 'domain' => 'neuroflash.com']
                ],
                'market_region'     => 'DACH',
                'target_llms'       => ['openai/gpt-6-luna', 'google/gemini-3.5-flash'],
                'schedule_interval' => 'every_120m',
                'datasets_per_day'  => 12,
                'search_enabled'    => 1,
            ]
        ]
    ];

    try {
        // Step 1: Upsert users & provision physical per-user tables BEFORE starting transaction
        // (MySQL CREATE TABLE IF NOT EXISTS causes an implicit commit if run inside a transaction)
        $resolvedUserIds = [];
        $provisionedTables = [];
        foreach ($accounts as $idx => $acc) {
            $email = $acc['email'];
            $findUser = $db->prepare("SELECT id FROM users WHERE email = :email");
            $findUser->execute([':email' => $email]);
            $existingUserId = $findUser->fetchColumn();

            if ($existingUserId) {
                $userId = (int)$existingUserId;
                $updUser = $db->prepare("
                    UPDATE users 
                    SET company_name = :company_name, tier = :tier, credits_remaining = :credits, status = 'active'
                    WHERE id = :id
                ");
                $updUser->execute([
                    ':company_name' => $acc['company_name'],
                    ':tier'         => $acc['tier'],
                    ':credits'      => $acc['credits'],
                    ':id'           => $userId,
                ]);
            } else {
                $apiKey = bin2hex(random_bytes(32));
                $magicToken = bin2hex(random_bytes(24));
                $insUser = $db->prepare("
                    INSERT INTO users (
                        email, password_hash, company_name, role, tier,
                        credits_remaining, api_key, magic_audit_token, status
                    ) VALUES (
                        :email, :password_hash, :company_name, 'user', :tier,
                        :credits, :api_key, :magic_audit_token, 'active'
                    )
                ");
                $insUser->execute([
                    ':email'             => $email,
                    ':password_hash'     => $defaultHash,
                    ':company_name'      => $acc['company_name'],
                    ':tier'              => $acc['tier'],
                    ':credits'           => $acc['credits'],
                    ':api_key'           => $apiKey,
                    ':magic_audit_token' => $magicToken,
                ]);
                $userId = (int)$db->lastInsertId();
            }

            $resolvedUserIds[$idx] = $userId;
            $provisionedTables[] = ensureUserResultsTable($db, $userId);
        }

        // Step 2: Transactionally seed configs, llm_runs, child entities, and user_results_<user_id>
        $db->beginTransaction();

        $seededAccountNames = [];
        $totalConfigsCreated = 0;
        $totalRunsCreated = 0;

        foreach ($accounts as $idx => $acc) {
            $userId = $resolvedUserIds[$idx];
            $cfg = $acc['config'];
            $seededAccountNames[] = $cfg['brand_name'];

            $fullStartedAt = date('Y-m-d H:i:s', strtotime('-35 days'));
            $nextRunAt = date('Y-m-d H:i:s', strtotime('+60 minutes'));

            $insConfig = $db->prepare("
                INSERT INTO tracking_configs (
                    user_id, name, brand_name, brand_domains, keywords_prompts, market_region,
                    competitors, target_llms, search_enabled, schedule_interval,
                    datasets_per_day, initial_test_used, full_started_at,
                    status, next_run_at, created_at
                ) VALUES (
                    :user_id, :name, :brand_name, :brand_domains, :keywords_prompts, :market_region,
                    :competitors, :target_llms, :search_enabled, :schedule_interval,
                    :datasets_per_day, 1, :full_started_at,
                    'active', :next_run_at, :created_at
                )
            ");
            $insConfig->execute([
                ':user_id'           => $userId,
                ':name'              => $cfg['name'],
                ':brand_name'        => $cfg['brand_name'],
                ':brand_domains'     => json_encode($cfg['brand_domains']),
                ':keywords_prompts'  => json_encode($cfg['keywords_prompts']),
                ':market_region'     => $cfg['market_region'] ?? 'DACH',
                ':competitors'       => json_encode($cfg['competitors']),
                ':target_llms'       => json_encode($cfg['target_llms']),
                ':search_enabled'    => $cfg['search_enabled'],
                ':schedule_interval' => $cfg['schedule_interval'],
                ':datasets_per_day'  => $cfg['datasets_per_day'],
                ':full_started_at'   => $fullStartedAt,
                ':next_run_at'       => $nextRunAt,
                ':created_at'        => $fullStartedAt,
            ]);
            $configId = (int)$db->lastInsertId();
            $totalConfigsCreated++;

            // Matrix of Run Templates covering all 4 MECE categories and all 4 GEO quadrants
            $runTemplates = [
                [
                    'mece'             => '1_DIRECT_WIN',
                    'geo'              => 'NONE',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 45,
                    'word_earliness'   => 7,
                    'rel_pos'          => 4.80,
                    'has_cit'          => 1,
                    'brand_cited'      => 1,
                    'comp_cited'       => 0,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 0,
                    'comp_earliness'   => 420,
                    'day_offset'       => 2,
                ],
                [
                    'mece'             => '1_DIRECT_WIN',
                    'geo'              => '4_BURIED_WINNER',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 820,
                    'word_earliness'   => 115,
                    'rel_pos'          => 64.20,
                    'has_cit'          => 1,
                    'brand_cited'      => 1,
                    'comp_cited'       => 0,
                    'comp_mentioned'   => 0,
                    'comp_rec'         => 0,
                    'comp_earliness'   => null,
                    'day_offset'       => 5,
                ],
                [
                    'mece'             => '2_BRAND_HALO',
                    'geo'              => '3_BRAND_HALO_TRAP',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 540,
                    'word_earliness'   => 78,
                    'rel_pos'          => 45.00,
                    'has_cit'          => 1,
                    'brand_cited'      => 0,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 1,
                    'comp_earliness'   => 92,
                    'day_offset'       => 8,
                ],
                [
                    'mece'             => '1_DIRECT_WIN',
                    'geo'              => '1_CITATION_HIJACK',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 110,
                    'word_earliness'   => 16,
                    'rel_pos'          => 9.50,
                    'has_cit'          => 1,
                    'brand_cited'      => 0,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 0,
                    'comp_earliness'   => 490,
                    'day_offset'       => 12,
                ],
                [
                    'mece'             => '3_COMPETITOR_TAKEOVER',
                    'geo'              => '2_PARAMETRIC_BLINDSPOT',
                    'brand_mentioned'  => 0,
                    'char_earliness'   => null,
                    'word_earliness'   => null,
                    'rel_pos'          => null,
                    'has_cit'          => 1,
                    'brand_cited'      => 1,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 1,
                    'comp_earliness'   => 75,
                    'day_offset'       => 18,
                ],
                [
                    'mece'             => '4_GENERIC',
                    'geo'              => 'NONE',
                    'brand_mentioned'  => 0,
                    'char_earliness'   => null,
                    'word_earliness'   => null,
                    'rel_pos'          => null,
                    'has_cit'          => 0,
                    'brand_cited'      => 0,
                    'comp_cited'       => 0,
                    'comp_mentioned'   => 0,
                    'comp_rec'         => 0,
                    'comp_earliness'   => null,
                    'day_offset'       => 24,
                ],
                [
                    'mece'             => '1_DIRECT_WIN',
                    'geo'              => 'NONE',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 32,
                    'word_earliness'   => 5,
                    'rel_pos'          => 3.90,
                    'has_cit'          => 1,
                    'brand_cited'      => 1,
                    'comp_cited'       => 0,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 0,
                    'comp_earliness'   => 460,
                    'day_offset'       => 1,
                ],
                [
                    'mece'             => '2_BRAND_HALO',
                    'geo'              => '3_BRAND_HALO_TRAP',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 480,
                    'word_earliness'   => 70,
                    'rel_pos'          => 39.00,
                    'has_cit'          => 1,
                    'brand_cited'      => 0,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 1,
                    'comp_earliness'   => 84,
                    'day_offset'       => 3,
                ],
                [
                    'mece'             => '1_DIRECT_WIN',
                    'geo'              => 'NONE',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 68,
                    'word_earliness'   => 10,
                    'rel_pos'          => 7.40,
                    'has_cit'          => 1,
                    'brand_cited'      => 1,
                    'comp_cited'       => 0,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 0,
                    'comp_earliness'   => 510,
                    'day_offset'       => 34,
                ],
                [
                    'mece'             => '3_COMPETITOR_TAKEOVER',
                    'geo'              => '1_CITATION_HIJACK',
                    'brand_mentioned'  => 0,
                    'char_earliness'   => null,
                    'word_earliness'   => null,
                    'rel_pos'          => null,
                    'has_cit'          => 1,
                    'brand_cited'      => 0,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 1,
                    'comp_earliness'   => 60,
                    'day_offset'       => 42,
                ],
                [
                    'mece'             => '2_BRAND_HALO',
                    'geo'              => '3_BRAND_HALO_TRAP',
                    'brand_mentioned'  => 1,
                    'char_earliness'   => 610,
                    'word_earliness'   => 88,
                    'rel_pos'          => 49.00,
                    'has_cit'          => 1,
                    'brand_cited'      => 0,
                    'comp_cited'       => 1,
                    'comp_mentioned'   => 1,
                    'comp_rec'         => 1,
                    'comp_earliness'   => 95,
                    'day_offset'       => 51,
                ],
            ];

            $providers = [
                ['provider' => 'openai',    'model' => 'gpt-6-luna',         'strategy' => 'regular',   'input_tokens' => 1420, 'output_tokens' => 310, 'cached_tokens' => 0],
                ['provider' => 'mistralai', 'model' => 'mistral-large-4-0',  'strategy' => 'regular',   'input_tokens' => 1280, 'output_tokens' => 295, 'cached_tokens' => 0],
                ['provider' => 'google',    'model' => 'gemini-3.5-flash',   'strategy' => 'regular',   'input_tokens' => 2320, 'output_tokens' => 340, 'cached_tokens' => 0],
            ];

            $primaryCompetitor = $cfg['competitors'][0];
            $promptCount = count($cfg['keywords_prompts']);

            foreach ($runTemplates as $tIdx => $tmpl) {
                foreach ($providers as $pIdx => $prov) {
                    $promptText = $cfg['keywords_prompts'][($tIdx + $pIdx) % $promptCount];
                    $dayOffset = (int)($tmpl['day_offset'] ?? 1);
                    $createdAt = date('Y-m-d H:i:s', strtotime("-{$dayOffset} days"));
                    $customId = sprintf('cl_u%d_c%d_seed_%d_%d_%s', $userId, $configId, $tIdx, $pIdx, substr(bin2hex(random_bytes(3)), 0, 6));
                    $promptCacheKey = null;
                    $demoRegion = $cfg['market_region'] ?? 'DACH';
                    $demoRegCitCount = ($tmpl['has_cit'] && $tmpl['brand_cited']) ? 1 : 0;
                    $demoTotalCitCount = ($tmpl['brand_cited'] ? 1 : 0) + ($tmpl['comp_cited'] ? 1 : 0);
                    $demoRegCitRatio = $demoTotalCitCount > 0 ? round(($demoRegCitCount / $demoTotalCitCount) * 100, 2) : null;
                    $responseText = "Synthesized AI visibility evaluation for {$cfg['brand_name']} ({$prov['provider']}/{$prov['model']}) on prompt: {$promptText}.";

                    $insRun = $db->prepare("
                        INSERT INTO llm_runs (
                            config_id, user_id, custom_id, execution_strategy, prompt_cache_key, input_tokens, output_tokens, cached_tokens, is_test_run,
                            prompt, market_region, prompt_language, effective_region, region_source,
                            provider, model, brand_name, status,
                            brand_mentioned, brand_prominence_rank, char_earliness,
                            word_earliness, relative_position_pct, total_chars, total_words,
                            mece_category, geo_quadrant, has_citations, brand_cited,
                            competitor_cited, regional_citation_count, regional_citation_ratio,
                            raw_response_text, run_duration_ms, cost_credits,
                            created_at
                        ) VALUES (
                            :config_id, :user_id, :custom_id, :execution_strategy, :prompt_cache_key, :input_tokens, :output_tokens, :cached_tokens, 0,
                            :prompt, :market_region, :prompt_language, :effective_region, :region_source,
                            :provider, :model, :brand_name, 'completed',
                            :brand_mentioned, :brand_prominence_rank, :char_earliness,
                            :word_earliness, :relative_position_pct, 1280, 185,
                            :mece_category, :geo_quadrant, :has_citations, :brand_cited,
                            :competitor_cited, :regional_citation_count, :regional_citation_ratio,
                            :raw_response_text, 1450, 1,
                            :created_at
                        )
                    ");

                    $insRun->execute([
                        ':config_id'              => $configId,
                        ':user_id'                => $userId,
                        ':custom_id'              => $customId,
                        ':execution_strategy'     => $prov['strategy'],
                        ':prompt_cache_key'       => null,
                        ':input_tokens'           => $prov['input_tokens'],
                        ':output_tokens'          => $prov['output_tokens'],
                        ':cached_tokens'          => $prov['cached_tokens'],
                        ':prompt'                 => $promptText,
                        ':market_region'          => $demoRegion,
                        ':prompt_language'        => 'de',
                        ':effective_region'       => $demoRegion,
                        ':region_source'          => 'user_setting',
                        ':provider'               => $prov['provider'],
                        ':model'                  => $prov['model'],
                        ':brand_name'             => $cfg['brand_name'],
                        ':brand_mentioned'        => $tmpl['brand_mentioned'],
                        ':brand_prominence_rank'  => $tmpl['brand_mentioned'] ? 1 : null,
                        ':char_earliness'         => $tmpl['char_earliness'],
                        ':word_earliness'         => $tmpl['word_earliness'],
                        ':relative_position_pct'  => $tmpl['rel_pos'],
                        ':mece_category'          => $tmpl['mece'],
                        ':geo_quadrant'           => $tmpl['geo'],
                        ':has_citations'          => $tmpl['has_cit'],
                        ':brand_cited'            => $tmpl['brand_cited'],
                        ':competitor_cited'       => $tmpl['comp_cited'],
                        ':regional_citation_count'=> $demoRegCitCount,
                        ':regional_citation_ratio'=> $demoRegCitRatio,
                        ':raw_response_text'      => $responseText,
                        ':created_at'             => $createdAt,
                    ]);

                    $runId = (int)$db->lastInsertId();
                    $totalRunsCreated++;

                    $competitorsList = [];
                    if ($tmpl['comp_mentioned']) {
                        $compRow = [
                            'competitor_name'       => $primaryCompetitor['name'],
                            'competitor_domain'     => $primaryCompetitor['domain'] ?? null,
                            'mentioned'             => 1,
                            'char_earliness'        => $tmpl['comp_earliness'],
                            'word_earliness'        => $tmpl['comp_earliness'] ? (int)ceil($tmpl['comp_earliness'] / 7) : null,
                            'relative_position_pct' => $tmpl['comp_earliness'] ? round(($tmpl['comp_earliness'] / 1280) * 100, 2) : null,
                            'recommended'           => $tmpl['comp_rec'],
                        ];
                        $competitorsList[] = $compRow;

                        $insComp = $db->prepare("
                            INSERT INTO run_competitors (
                                run_id, competitor_name, competitor_domain, mentioned, char_earliness,
                                word_earliness, relative_position_pct, recommended,
                                sentiment, created_at
                            ) VALUES (
                                :run_id, :competitor_name, :competitor_domain, 1, :char_earliness,
                                :word_earliness, :relative_pos, :recommended,
                                'neutral', :created_at
                            )
                        ");
                        $insComp->execute([
                            ':run_id'            => $runId,
                            ':competitor_name'   => $compRow['competitor_name'],
                            ':competitor_domain' => $compRow['competitor_domain'],
                            ':char_earliness'    => $compRow['char_earliness'],
                            ':word_earliness'    => $compRow['word_earliness'],
                            ':relative_pos'      => $compRow['relative_position_pct'],
                            ':recommended'       => $compRow['recommended'],
                            ':created_at'        => $createdAt,
                        ]);
                    }

                    $citationsList = [];
                    if ($tmpl['has_cit']) {
                        if ($tmpl['brand_cited']) {
                            $citRow = [
                                'citation_domain'      => $cfg['brand_domains'][0],
                                'citation_url'         => "https://www.{$cfg['brand_domains'][0]}/overview",
                                'citation_title'       => "{$cfg['brand_name']} Official Platform",
                                'is_brand_domain'      => 1,
                                'is_competitor_domain' => 0,
                            ];
                            $citationsList[] = $citRow;

                            $insCit = $db->prepare("
                                INSERT INTO run_citations (
                                    run_id, citation_domain, citation_url, citation_title, is_brand_domain,
                                    is_competitor_domain, citation_index, created_at
                                ) VALUES (
                                    :run_id, :domain, :url, :title, 1, 0, 1, :created_at
                                )
                            ");
                            $insCit->execute([
                                ':run_id'     => $runId,
                                ':domain'     => $citRow['citation_domain'],
                                ':url'        => $citRow['citation_url'],
                                ':title'      => $citRow['citation_title'],
                                ':created_at' => $createdAt,
                            ]);
                        }

                        if ($tmpl['comp_cited']) {
                            $compDomain = $primaryCompetitor['domain'] ?? 'competitor.com';
                            $citRow = [
                                'citation_domain'      => $compDomain,
                                'citation_url'         => "https://www.{$compDomain}/product",
                                'citation_title'       => "{$primaryCompetitor['name']} Product Overview",
                                'is_brand_domain'      => 0,
                                'is_competitor_domain' => 1,
                            ];
                            $citationsList[] = $citRow;

                            $insCit = $db->prepare("
                                INSERT INTO run_citations (
                                    run_id, citation_domain, citation_url, citation_title, is_brand_domain,
                                    is_competitor_domain, citation_index, created_at
                                ) VALUES (
                                    :run_id, :domain, :url, :title, 0, 1, 2, :created_at
                                )
                            ");
                            $insCit->execute([
                                ':run_id'     => $runId,
                                ':domain'     => $citRow['citation_domain'],
                                ':url'        => $citRow['citation_url'],
                                ':title'      => $citRow['citation_title'],
                                ':created_at' => $createdAt,
                            ]);
                        }
                    }

                    // Persist in user's dedicated physical table user_results_<user_id>
                    insertUserResultRow($db, $userId, [
                        'run_id'                => $runId,
                        'config_id'             => $configId,
                        'custom_id'             => $customId,
                        'execution_strategy'    => $prov['strategy'],
                        'prompt_cache_key'      => $promptCacheKey,
                        'input_tokens'          => $prov['input_tokens'],
                        'output_tokens'         => $prov['output_tokens'],
                        'cached_tokens'         => $prov['cached_tokens'],
                        'trigger_source'        => 'seed_demo',
                        'is_test_run'           => 0,
                        'prompt'                  => $promptText,
                        'market_region'           => $demoRegion,
                        'prompt_language'         => 'de',
                        'effective_region'        => $demoRegion,
                        'region_source'           => 'user_setting',
                        'llm_answer'              => $responseText,
                        'provider'                => $prov['provider'],
                        'model'                   => $prov['model'],
                        'brand_name'              => $cfg['brand_name'],
                        'status'                  => 'completed',
                        'brand_mentioned'         => $tmpl['brand_mentioned'],
                        'char_earliness'          => $tmpl['char_earliness'],
                        'word_earliness'          => $tmpl['word_earliness'],
                        'relative_position_pct'   => $tmpl['rel_pos'],
                        'total_chars'             => 1280,
                        'total_words'             => 185,
                        'mece_category'           => $tmpl['mece'],
                        'geo_quadrant'            => $tmpl['geo'],
                        'brand_cited'             => $tmpl['brand_cited'],
                        'competitor_cited'        => $tmpl['comp_cited'],
                        'regional_citation_count' => $demoRegCitCount,
                        'regional_citation_ratio' => $demoRegCitRatio,
                        'competitors_json'      => $competitorsList,
                        'citations_json'        => $citationsList,
                        'scheduled_at'          => $createdAt,
                        'created_at'            => $createdAt,
                    ]);
                }
            }
        }

        $db->commit();

        jsonResponse([
            'success'            => true,
            'seeded_accounts'    => $seededAccountNames,
            'provisioned_tables' => $provisionedTables,
            'configs_created'    => $totalConfigsCreated,
            'runs_created'       => $totalRunsCreated,
            'message'            => 'Demo data successfully seeded across 3 German B2B accounts with MECE, GEO, and per-user result tables.',
        ], 200);

    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log("Seed demo data failure: " . $e->getMessage());
        jsonError("Failed to seed demo data: " . $e->getMessage(), 500);
    }
}


/**
 * Helper: derives provider credential health cards from current managed models catalog.
 *
 * @param array<int, array<string, mixed>> $models
 * @param string $defaultStatus
 * @return array<int, array<string, string>>
 */
function buildProviderCredentialSummary(array $models, string $defaultStatus = 'seeded'): array
{
    $credName = 'OpenRouter - Chatlytics - Chatlytics-dev-1';
    $allowedCount = 0;
    $batchCount = 0;
    $providerCounts = [];
    $resolvedStatus = $defaultStatus;

    foreach ($models as $m) {
        $prov = strtolower((string)($m['provider'] ?? ''));
        if ($prov !== '') {
            $providerCounts[$prov] = ($providerCounts[$prov] ?? 0) + 1;
        }
        if (!empty($m['is_allowed'])) {
            $allowedCount++;
        }
        if (!empty($m['supports_batch_api'])) {
            $batchCount++;
        }
        if (!empty($m['n8n_credential_name'])) {
            $credName = (string)$m['n8n_credential_name'];
        }
        if (!empty($m['n8n_sync_status']) && $m['n8n_sync_status'] === 'connected') {
            $resolvedStatus = 'connected';
        } elseif (!empty($m['n8n_sync_status']) && $resolvedStatus === $defaultStatus) {
            $resolvedStatus = (string)$m['n8n_sync_status'];
        }
    }

    ksort($providerCounts);

    return [[
        'provider'           => 'openrouter',
        'credential_name'    => $credName,
        'status'             => $resolvedStatus,
        'model_count'        => count($models),
        'allowed_count'      => $allowedCount,
        'batch_count'        => $batchCount,
        'providers_detected' => array_keys($providerCounts),
        'provider_counts'    => $providerCounts,
    ]];
}

/**
 * Quick Action: Pause all active tracking configurations for a user and clear queued batch jobs.
 */
function handlePauseAllConfigs(array $data): void
{
    $userId = (int)($data['user_id'] ?? $_GET['user_id'] ?? 0);
    if ($userId <= 0) {
        jsonError("A valid user_id is required.", 422);
    }

    $db = getDb();
    ensureCoreSchemaColumns($db);

    $checkStmt = $db->prepare("SELECT id, email FROM users WHERE id = :id");
    $checkStmt->execute([':id' => $userId]);
    $user = $checkStmt->fetch();
    if (!$user) {
        jsonError("User not found.", 404);
    }

    $pausedCount = 0;
    try {
        $pauseStmt = $db->prepare("
            UPDATE tracking_configs
            SET status = 'paused', next_run_at = NULL
            WHERE user_id = :user_id AND status = 'active'
        ");
        $pauseStmt->execute([':user_id' => $userId]);
        $pausedCount = $pauseStmt->rowCount();
    } catch (Throwable $e) {
        $pausedCount = 0;
    }

    try {
        $delQueue = $db->prepare("DELETE FROM batch_requests WHERE user_id = :user_id AND status = 'queued'");
        $delQueue->execute([':user_id' => $userId]);
    } catch (Throwable $e) {
        // Ignore if batch_requests absent
    }

    jsonResponse([
        'success'      => true,
        'user_id'      => $userId,
        'paused_count' => $pausedCount,
        'message'      => "Paused {$pausedCount} active profile(s) for {$user['email']}.",
    ]);
}

/**
 * Quick Action: Suspend or reactivate a user account (suspending also pauses all active profiles).
 */
function handleSetUserStatus(array $data, array $adminUser): void
{
    $userId = (int)($data['user_id'] ?? $_GET['user_id'] ?? 0);
    if ($userId <= 0) {
        jsonError("A valid user_id is required.", 422);
    }

    $status = strtolower(trim((string)($data['status'] ?? '')));
    if (!in_array($status, ['active', 'suspended'], true)) {
        jsonError("Invalid status. Must be 'active' or 'suspended'.", 422);
    }

    if ($userId === (int)($adminUser['id'] ?? 0) && $status === 'suspended') {
        jsonError("You cannot suspend your own currently signed-in admin account.", 422);
    }

    $db = getDb();
    ensureCoreSchemaColumns($db);

    $checkStmt = $db->prepare("SELECT id, email, status FROM users WHERE id = :id");
    $checkStmt->execute([':id' => $userId]);
    $user = $checkStmt->fetch();
    if (!$user) {
        jsonError("User not found.", 404);
    }

    $updStmt = $db->prepare("UPDATE users SET status = :status WHERE id = :id");
    $updStmt->execute([':status' => $status, ':id' => $userId]);

    $pausedCount = 0;
    if ($status === 'suspended') {
        try {
            $pauseStmt = $db->prepare("
                UPDATE tracking_configs
                SET status = 'paused', next_run_at = NULL
                WHERE user_id = :user_id AND status = 'active'
            ");
            $pauseStmt->execute([':user_id' => $userId]);
            $pausedCount = $pauseStmt->rowCount();

            $delQueue = $db->prepare("DELETE FROM batch_requests WHERE user_id = :user_id AND status = 'queued'");
            $delQueue->execute([':user_id' => $userId]);
        } catch (Throwable $e) {
            // Ignore optional table errors
        }
    }

    jsonResponse([
        'success'              => true,
        'user_id'              => $userId,
        'status'               => $status,
        'paused_configs_count' => $pausedCount,
        'message'              => $status === 'suspended'
            ? "User {$user['email']} suspended and {$pausedCount} active profile(s) paused."
            : "User {$user['email']} reactivated.",
    ]);
}

/**
 * Quick Action: Update a user's subscription tier and optionally apply the plan's included credits.
 */
function handleUpdateUserTier(array $data): void
{
    $userId = (int)($data['user_id'] ?? $_GET['user_id'] ?? 0);
    if ($userId <= 0) {
        jsonError("A valid user_id is required.", 422);
    }

    $tier = strtolower(trim((string)($data['tier'] ?? '')));
    if (!in_array($tier, ['free', 'starter', 'growth', 'enterprise_managed'], true)) {
        jsonError("Invalid tier specified.", 422);
    }

    $db = getDb();
    ensureCoreSchemaColumns($db);

    $checkStmt = $db->prepare("SELECT id, email, credits_remaining FROM users WHERE id = :id");
    $checkStmt->execute([':id' => $userId]);
    $user = $checkStmt->fetch();
    if (!$user) {
        jsonError("User not found.", 404);
    }

    $plan = getPlanForTier($db, $tier);
    $applyCredits = !empty($data['apply_plan_credits']);

    if ($applyCredits) {
        $stmt = $db->prepare("UPDATE users SET tier = :tier, credits_remaining = :credits WHERE id = :id");
        $stmt->execute([
            ':tier'    => $tier,
            ':credits' => (int)$plan['included_credits'],
            ':id'      => $userId,
        ]);
    } else {
        $stmt = $db->prepare("UPDATE users SET tier = :tier WHERE id = :id");
        $stmt->execute([
            ':tier' => $tier,
            ':id'   => $userId,
        ]);
    }

    $fetchStmt = $db->prepare("SELECT id, email, tier, credits_remaining FROM users WHERE id = :id");
    $fetchStmt->execute([':id' => $userId]);
    $updated = $fetchStmt->fetch();

    jsonResponse([
        'success'           => true,
        'user_id'           => (int)$updated['id'],
        'tier'              => $updated['tier'],
        'credits_remaining' => (int)$updated['credits_remaining'],
        'message'           => "Updated {$updated['email']} to tier '{$tier}'.",
    ]);
}

/**
 * Lists all managed LLM models and provider credential health.
 */
function handleListModels(): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);
    $models = getAdminModelsCatalog($db, false);

    jsonResponse([
        'models'               => $models,
        'provider_credentials' => buildProviderCredentialSummary($models),
    ]);
}

/**
 * Creates or updates a managed LLM model entry in `llm_models`.
 */
function handleSaveModel(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $rawId = trim((string)($data['id'] ?? ''));
    $provider = strtolower(trim((string)($data['provider'] ?? '')));
    $modelName = trim((string)($data['model_name'] ?? ''));

    if ($rawId === '' && ($provider === '' || $modelName === '')) {
        jsonError("Model id or provider + model_name are required.", 422);
    }

    $tokenToResolve = $rawId !== '' ? $rawId : ($provider . '/' . $modelName);
    $spec = resolveTargetLlmSpec($tokenToResolve);
    if ($spec['id'] === '' || $spec['provider'] === '') {
        jsonError("Invalid model identifier.", 422);
    }

    $supportsBatch = array_key_exists('supports_batch_api', $data) ? !empty($data['supports_batch_api']) : $spec['supports_batch_api'];
    $supportsTools = array_key_exists('supports_tools', $data) ? !empty($data['supports_tools']) : $spec['supports_tools'];
    $reqStrat = (string)($data['execution_strategy'] ?? ($supportsBatch ? 'batch_api' : 'regular'));
    if ($reqStrat === 'prompt_caching' || !in_array($reqStrat, ['batch_api', 'regular'], true)) {
        $reqStrat = $supportsBatch ? 'batch_api' : 'regular';
    }

    $payload = [
        'id'                  => $spec['id'],
        'provider'            => $provider !== '' ? $provider : $spec['provider'],
        'model_name'          => $modelName !== '' ? $modelName : $spec['model'],
        'display_name'        => trim((string)($data['display_name'] ?? $spec['id'])),
        'eu_hosted'           => false,
        'supports_web_search' => !empty($data['supports_web_search']),
        'supports_batch_api'  => $supportsBatch,
        'supports_tools'      => $supportsTools,
        'execution_strategy'  => $reqStrat,
        'is_allowed'          => !isset($data['is_allowed']) || !empty($data['is_allowed']),
        'is_default'          => !empty($data['is_default']),
        'n8n_credential_name' => $data['n8n_credential_name'] ?? 'OpenRouter - Chatlytics - Chatlytics-dev-1',
        'n8n_sync_status'     => (string)($data['n8n_sync_status'] ?? 'manual'),
        'last_synced_at'      => $data['last_synced_at'] ?? null,
        'sort_order'          => (int)($data['sort_order'] ?? 100),
    ];

    $saved = upsertLlmModel($db, $payload, false);
    $models = getAdminModelsCatalog($db, false);

    jsonResponse([
        'success' => true,
        'model'   => $saved,
        'models'  => $models,
        'message' => "Model '{$saved['display_name']}' saved.",
    ]);
}

/**
 * Toggles model availability or capability flags on `llm_models`.
 */
function handleToggleModel(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $id = trim((string)($data['id'] ?? $data['model_id'] ?? ''));
    if ($id === '') {
        jsonError("Model id is required.", 422);
    }

    $stmt = $db->prepare("SELECT * FROM llm_models WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) {
        jsonError("Model '{$id}' not found.", 404);
    }

    $mergedSupportsBatch = array_key_exists('supports_batch_api', $data) ? !empty($data['supports_batch_api']) : !empty($existing['supports_batch_api']);
    $mergedSupportsTools = array_key_exists('supports_tools', $data) ? !empty($data['supports_tools']) : (!array_key_exists('supports_tools', $existing) || !empty($existing['supports_tools']));
    $mergedStrat = array_key_exists('execution_strategy', $data) ? (string)$data['execution_strategy'] : (string)$existing['execution_strategy'];
    if ($mergedStrat === 'prompt_caching' || !in_array($mergedStrat, ['batch_api', 'regular'], true)) {
        $mergedStrat = $mergedSupportsBatch ? 'batch_api' : 'regular';
    }

    $merged = [
        'id'                  => (string)$existing['id'],
        'provider'            => (string)$existing['provider'],
        'model_name'          => (string)$existing['model_name'],
        'display_name'        => array_key_exists('display_name', $data) ? (string)$data['display_name'] : (string)$existing['display_name'],
        'eu_hosted'           => false,
        'supports_web_search' => array_key_exists('supports_web_search', $data) ? !empty($data['supports_web_search']) : !empty($existing['supports_web_search']),
        'supports_batch_api'  => $mergedSupportsBatch,
        'supports_tools'      => $mergedSupportsTools,
        'execution_strategy'  => $mergedStrat,
        'is_allowed'          => array_key_exists('is_allowed', $data) ? !empty($data['is_allowed']) : !empty($existing['is_allowed']),
        'is_default'          => array_key_exists('is_default', $data) ? !empty($data['is_default']) : !empty($existing['is_default']),
        'n8n_credential_name' => $existing['n8n_credential_name'] ?? null,
        'n8n_sync_status'     => (string)($existing['n8n_sync_status'] ?? 'seeded'),
        'last_synced_at'      => $existing['last_synced_at'] ?? null,
        'sort_order'          => array_key_exists('sort_order', $data) ? (int)$data['sort_order'] : (int)$existing['sort_order'],
    ];

    $saved = upsertLlmModel($db, $merged, false);

    jsonResponse([
        'success' => true,
        'model'   => $saved,
        'models'  => getAdminModelsCatalog($db, false),
    ]);
}

/**
 * Queries connected n8n workflow credentials/models live (`action=discover_models`) and syncs `llm_models`,
 * gracefully falling back to the local seeded catalog when n8n is unreachable.
 */
function handleSyncN8nModels(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $appConfig = getConfig();
    $envUrl = getenv('N8N_WEBHOOK_URL');
    $webhookUrl = trim((string)($envUrl !== false && $envUrl !== '' ? $envUrl : ($appConfig['n8n']['webhook_url'] ?? '')));
    $envSecret = getenv('N8N_SHARED_SECRET');
    $sharedSecret = (string)($envSecret !== false ? $envSecret : ($appConfig['n8n']['shared_secret'] ?? ''));

    $now = date('Y-m-d H:i:s');
    $syncedLive = false;
    $discoveredModels = [];
    $providerCredentials = [];
    $errorDetail = '';

    if ($webhookUrl !== '' && preg_match('#^https?://#i', $webhookUrl) === 1) {
        $payloadJson = json_encode(['action' => 'discover_models', 'timestamp' => date('c')]);
        $rawResp = false;
        $httpCode = 0;

        if (function_exists('curl_init')) {
            $ch = curl_init($webhookUrl);
            if ($ch !== false) {
                $host = strtolower((string)(parse_url($webhookUrl, PHP_URL_HOST) ?? ''));
                $isLocal = in_array($host, ['127.0.0.1', 'localhost', '::1'], true);
                curl_setopt_array($ch, [
                    CURLOPT_POST           => true,
                    CURLOPT_POSTFIELDS     => $payloadJson,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT        => 15,
                    CURLOPT_CONNECTTIMEOUT => 4,
                    CURLOPT_HTTPHEADER     => [
                        'Content-Type: application/json',
                        'X-N8N-Secret: ' . $sharedSecret,
                        'X-Chatlytics-Webhook-Secret: ' . $sharedSecret,
                    ],
                ]);
                if ($isLocal) {
                    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
                }
                $rawResp = curl_exec($ch);
                $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                if ($rawResp === false) {
                    $errorDetail = curl_error($ch);
                }
                curl_close($ch);
            }
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'method'        => 'POST',
                    'header'        => "Content-Type: application/json\r\nX-N8N-Secret: {$sharedSecret}\r\n",
                    'content'       => $payloadJson,
                    'timeout'       => 15,
                    'ignore_errors' => true,
                ],
            ]);
            $rawResp = @file_get_contents($webhookUrl, false, $ctx);
            $httpCode = ($rawResp !== false) ? 200 : 0;
        }

        if (is_string($rawResp) && $rawResp !== '' && $httpCode >= 200 && $httpCode < 300) {
            $decoded = json_decode($rawResp, true);
            if (is_array($decoded) && !empty($decoded['models']) && is_array($decoded['models'])) {
                $syncedLive = true;
                $discoveredModels = $decoded['models'];
                if (!empty($decoded['provider_credentials']) && is_array($decoded['provider_credentials'])) {
                    $providerCredentials = $decoded['provider_credentials'];
                }
            }
        }
    }

    if ($syncedLive) {
        $allowedProviders = getAllowedOpenRouterProviders();
        $batchBases = [];
        foreach ($discoveredModels as $item) {
            if (is_array($item)) {
                $rawId = strtolower(trim((string)($item['id'] ?? '')));
                if (str_ends_with($rawId, ':batch')) {
                    $batchBases[substr($rawId, 0, -6)] = true;
                }
            }
        }

        $syncedCount = 0;
        foreach ($discoveredModels as $idx => $item) {
            if (!is_array($item)) {
                continue;
            }
            $rawTok = trim((string)($item['id'] ?? (($item['provider'] ?? '') . '/' . ($item['model_name'] ?? ''))));
            if ($rawTok === '' || str_ends_with(strtolower($rawTok), ':batch')) {
                continue;
            }
            $rawLower = strtolower($rawTok);
            $rawPrefix = str_contains($rawLower, '/') ? explode('/', $rawLower, 2)[0] : '';
            if ($rawPrefix !== '' && !in_array($rawPrefix, $allowedProviders, true)) {
                continue;
            }
            foreach (['embedding', 'embed', 'tts', 'whisper', 'dall-e', 'sora', 'imagen', 'veo', 'lyria', 'music', 'moderation', 'guard', 'realtime', '-image', 'image-preview', 'flux', 'midjourney', 'audio', 'speech'] as $blockedFrag) {
                if (str_contains($rawLower, $blockedFrag)) {
                    continue 2;
                }
            }
            $arch = is_array($item['architecture'] ?? null) ? $item['architecture'] : [];
            $inMods = is_array($arch['input_modalities'] ?? null) ? array_map('strtolower', $arch['input_modalities']) : ['text'];
            $outMods = is_array($arch['output_modalities'] ?? null) ? array_map('strtolower', $arch['output_modalities']) : ['text'];
            if (!in_array('text', $inMods, true) || !in_array('text', $outMods, true)) {
                continue;
            }
            if (in_array('image', $outMods, true) || in_array('audio', $outMods, true) || in_array('video', $outMods, true)) {
                continue;
            }

            $supportsBatch = !empty($item['supports_batch_api']) || !empty($batchBases[$rawLower]);
            $supportsTools = !array_key_exists('supports_tools', $item) || !empty($item['supports_tools']);
            $spec = resolveTargetLlmSpec($rawTok, 'every_120m', false, false, $supportsBatch, $supportsTools);
            if ($spec['id'] === '' || !in_array($spec['provider'], $allowedProviders, true)) {
                continue;
            }

            $itemStrategy = (string)($item['execution_strategy'] ?? ($supportsBatch ? 'batch_api' : 'regular'));
            if ($itemStrategy === 'prompt_caching' || !in_array($itemStrategy, ['batch_api', 'regular'], true)) {
                $itemStrategy = $supportsBatch ? 'batch_api' : 'regular';
            }

            upsertLlmModel($db, [
                'id'                  => $spec['id'],
                'provider'            => $spec['provider'],
                'model_name'          => $spec['model'],
                'display_name'        => (string)($item['display_name'] ?? $spec['id']),
                'eu_hosted'           => false,
                'supports_web_search' => array_key_exists('supports_web_search', $item) ? !empty($item['supports_web_search']) : true,
                'supports_batch_api'  => $supportsBatch,
                'supports_tools'      => $supportsTools,
                'execution_strategy'  => $itemStrategy,
                // Brand-new discovered OpenRouter models stay curated (is_allowed = false) until Admin activates them;
                // existing rows preserve Admin is_allowed / is_default choices.
                'is_allowed'          => !empty($item['is_allowed']),
                'is_default'          => !empty($item['is_default']),
                'n8n_credential_name' => $item['n8n_credential_name'] ?? 'OpenRouter - Chatlytics - Chatlytics-dev-1',
                'n8n_sync_status'     => 'connected',
                'last_synced_at'      => $now,
                'sort_order'          => (int)($item['sort_order'] ?? (100 + $idx * 10)),
            ], true);
            $syncedCount++;
        }

        $models = getAdminModelsCatalog($db, false);
        jsonResponse([
            'success'              => true,
            'synced'               => true,
            'fallback'             => false,
            'source'               => 'n8n_live',
            'last_synced_at'       => $now,
            'provider_credentials' => !empty($providerCredentials) ? $providerCredentials : buildProviderCredentialSummary($models, 'connected'),
            'models'               => $models,
            'message'              => $syncedCount . ' OpenRouter model(s) synchronized from live n8n credentials.',
        ]);
    }

    // Offline / fallback path: mark sync timestamp & local cache status gracefully
    try {
        $updSync = $db->prepare("UPDATE llm_models SET n8n_sync_status = 'fallback_local', last_synced_at = :ts");
        $updSync->execute([':ts' => $now]);
    } catch (Throwable $e) {
        // Ignore if table not writable
    }

    $models = getAdminModelsCatalog($db, false);
    jsonResponse([
        'success'              => true,
        'synced'               => false,
        'fallback'             => true,
        'source'               => 'fallback_local',
        'last_synced_at'       => $now,
        'provider_credentials' => buildProviderCredentialSummary($models, 'fallback_local'),
        'models'               => $models,
        'detail'               => $errorDetail,
        'message'              => 'n8n webhook unreachable; loaded local managed model catalog.',
    ]);
}

/**
 * Lists all curated Analyse-Sets (`model_presets`).
 */
function handleListPresets(): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    jsonResponse([
        'presets' => getModelPresetsCatalog($db, false),
    ]);
}

/**
 * Creates or updates an Analyse-Set (`model_presets`).
 */
function handleSavePreset(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $nameDe = trim((string)($data['name_de'] ?? ''));
    $nameEn = trim((string)($data['name_en'] ?? ''));
    if ($nameDe === '' && $nameEn === '') {
        jsonError("A German or English preset name is required.", 422);
    }
    if ($nameDe === '') {
        $nameDe = $nameEn;
    }
    if ($nameEn === '') {
        $nameEn = $nameDe;
    }

    $rawId = trim((string)($data['id'] ?? ''));
    if ($rawId === '') {
        $rawId = strtolower(preg_replace('/[^a-z0-9]+/i', '_', $nameEn ?: $nameDe));
        $rawId = trim($rawId, '_');
    } else {
        $rawId = strtolower(preg_replace('/[^a-z0-9_-]+/i', '_', $rawId));
    }
    if ($rawId === '') {
        jsonError("A valid preset id slug is required.", 422);
    }

    $rawLlms = decodeCatalogJsonArray($data['target_llms'] ?? [], []);
    $normalizedLlms = [];
    foreach ($rawLlms as $token) {
        $spec = resolveTargetLlmSpec((string)$token);
        if ($spec['id'] !== '' && !in_array($spec['id'], $normalizedLlms, true)) {
            $normalizedLlms[] = $spec['id'];
        }
    }
    if (empty($normalizedLlms)) {
        jsonError("An Analyse-Set must include at least one valid LLM model.", 422);
    }

    $allowedTiers = array_values(array_intersect(
        decodeCatalogJsonArray($data['allowed_tiers'] ?? [], ['starter', 'growth', 'enterprise_managed']),
        ['free', 'starter', 'growth', 'enterprise_managed']
    ));
    if (empty($allowedTiers)) {
        $allowedTiers = ['growth', 'enterprise_managed'];
    }

    $saved = upsertModelPreset($db, [
        'id'             => $rawId,
        'name_de'        => $nameDe,
        'name_en'        => $nameEn,
        'description_de' => trim((string)($data['description_de'] ?? '')),
        'description_en' => trim((string)($data['description_en'] ?? '')),
        'badge_de'       => ($data['badge_de'] ?? null) !== null ? trim((string)$data['badge_de']) : null,
        'badge_en'       => ($data['badge_en'] ?? null) !== null ? trim((string)$data['badge_en']) : null,
        'target_llms'    => $normalizedLlms,
        'search_enabled' => !empty($data['search_enabled']),
        'allowed_tiers'  => $allowedTiers,
        'is_default'     => !empty($data['is_default']) || $rawId === 'dach_core_baseline',
        'is_active'      => !isset($data['is_active']) || !empty($data['is_active']),
        'sort_order'     => (int)($data['sort_order'] ?? 100),
    ]);

    // Ensure subscription_plans.allowed_preset_ids stays synchronized with selected allowed_tiers
    foreach (getSubscriptionPlansCatalog($db) as $plan) {
        $planTier = $plan['tier'];
        $currentPresetIds = $plan['allowed_preset_ids'] ?? [];
        $shouldInclude = in_array($planTier, $allowedTiers, true);
        $hasPreset = in_array($rawId, $currentPresetIds, true);
        if ($shouldInclude && !$hasPreset) {
            $plan['allowed_preset_ids'] = array_values(array_merge($currentPresetIds, [$rawId]));
            upsertSubscriptionPlan($db, $plan);
        } elseif (!$shouldInclude && $hasPreset) {
            $plan['allowed_preset_ids'] = array_values(array_filter($currentPresetIds, fn($pid) => $pid !== $rawId));
            upsertSubscriptionPlan($db, $plan);
        }
    }

    jsonResponse([
        'success' => true,
        'preset'  => $saved,
        'presets' => getModelPresetsCatalog($db, false),
        'message' => "Analyse-Set '{$saved['name_de']}' saved.",
    ]);
}

/**
 * Deletes a non-default Analyse-Set (`model_presets`).
 */
function handleDeletePreset(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $id = trim((string)($data['id'] ?? $_GET['id'] ?? ''));
    if ($id === '') {
        jsonError("Preset id is required.", 422);
    }

    $stmt = $db->prepare("SELECT * FROM model_presets WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $id]);
    $preset = $stmt->fetch();
    if (!$preset) {
        jsonError("Analyse-Set '{$id}' not found.", 404);
    }

    if (!empty($preset['is_default']) || $id === 'dach_core_baseline') {
        jsonError("The default Analyse-Set cannot be deleted.", 422);
    }

    $del = $db->prepare("DELETE FROM model_presets WHERE id = :id");
    $del->execute([':id' => $id]);

    // Remove deleted preset from subscription_plans.allowed_preset_ids cleanly
    foreach (getSubscriptionPlansCatalog($db) as $plan) {
        $current = $plan['allowed_preset_ids'] ?? [];
        if (in_array($id, $current, true)) {
            $plan['allowed_preset_ids'] = array_values(array_filter($current, fn($pid) => $pid !== $id));
            upsertSubscriptionPlan($db, $plan);
        }
    }

    jsonResponse([
        'success' => true,
        'id'      => $id,
        'presets' => getModelPresetsCatalog($db, false),
        'message' => "Analyse-Set '{$id}' deleted.",
    ]);
}

/**
 * Lists all configured subscription plans and Stripe mappings.
 */
function handleListPlans(): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    jsonResponse([
        'plans' => getSubscriptionPlansCatalog($db),
    ]);
}

/**
 * Saves subscription plan entitlements, quotas, model policy & Stripe Product/Price mapping.
 */
function handleSavePlan(array $data): void
{
    $db = getDb();
    ensureCoreSchemaColumns($db);

    $tier = strtolower(trim((string)($data['tier'] ?? '')));
    if (!in_array($tier, ['free', 'starter', 'growth', 'enterprise_managed'], true)) {
        jsonError("Invalid subscription tier '{$tier}'.", 422);
    }

    $existing = getPlanForTier($db, $tier);

    $allowedIntervalsRaw = array_key_exists('allowed_intervals', $data)
        ? decodeCatalogJsonArray($data['allowed_intervals'], $existing['allowed_intervals'])
        : $existing['allowed_intervals'];
    $allowedIntervals = [];
    foreach ($allowedIntervalsRaw as $iv) {
        $norm = normalizeScheduleInterval((string)$iv);
        if (!in_array($norm, $allowedIntervals, true)) {
            $allowedIntervals[] = $norm;
        }
    }
    if (empty($allowedIntervals)) {
        $allowedIntervals = ['every_120m'];
    }

    $merged = array_merge($existing, [
        'tier'                       => $tier,
        'name_de'                    => array_key_exists('name_de', $data) ? trim((string)$data['name_de']) : $existing['name_de'],
        'name_en'                    => array_key_exists('name_en', $data) ? trim((string)$data['name_en']) : $existing['name_en'],
        'subtitle_de'                => array_key_exists('subtitle_de', $data) ? trim((string)$data['subtitle_de']) : $existing['subtitle_de'],
        'subtitle_en'                => array_key_exists('subtitle_en', $data) ? trim((string)$data['subtitle_en']) : $existing['subtitle_en'],
        'price_eur'                  => array_key_exists('price_eur', $data) ? max(0, (int)$data['price_eur']) : (int)$existing['price_eur'],
        'price_label_de'             => array_key_exists('price_label_de', $data) ? trim((string)$data['price_label_de']) : $existing['price_label_de'],
        'price_label_en'             => array_key_exists('price_label_en', $data) ? trim((string)$data['price_label_en']) : $existing['price_label_en'],
        'billing_period_de'          => array_key_exists('billing_period_de', $data) ? trim((string)$data['billing_period_de']) : $existing['billing_period_de'],
        'billing_period_en'          => array_key_exists('billing_period_en', $data) ? trim((string)$data['billing_period_en']) : $existing['billing_period_en'],
        'stripe_product_id'          => array_key_exists('stripe_product_id', $data) ? trim((string)$data['stripe_product_id']) : $existing['stripe_product_id'],
        'stripe_price_id'            => array_key_exists('stripe_price_id', $data) ? trim((string)$data['stripe_price_id']) : $existing['stripe_price_id'],
        'stripe_checkout_url'        => array_key_exists('stripe_checkout_url', $data) ? trim((string)$data['stripe_checkout_url']) : $existing['stripe_checkout_url'],
        'included_credits'           => array_key_exists('included_credits', $data) ? max(0, (int)$data['included_credits']) : (int)$existing['included_credits'],
        'max_configs'                => array_key_exists('max_configs', $data) ? max(1, (int)$data['max_configs']) : (int)$existing['max_configs'],
        'max_competitors_per_config' => array_key_exists('max_competitors_per_config', $data) ? max(1, (int)$data['max_competitors_per_config']) : (int)$existing['max_competitors_per_config'],
        'max_prompts_per_config'     => array_key_exists('max_prompts_per_config', $data) ? max(1, (int)$data['max_prompts_per_config']) : (int)$existing['max_prompts_per_config'],
        'allowed_intervals'          => $allowedIntervals,
        'allow_custom_models'        => array_key_exists('allow_custom_models', $data) ? !empty($data['allow_custom_models']) : !empty($existing['allow_custom_models']),
        'allowed_preset_ids'         => array_key_exists('allowed_preset_ids', $data)
            ? decodeCatalogJsonArray($data['allowed_preset_ids'], $existing['allowed_preset_ids'])
            : $existing['allowed_preset_ids'],
        'features_de'                => array_key_exists('features_de', $data)
            ? decodeCatalogJsonArray($data['features_de'], $existing['features_de'])
            : $existing['features_de'],
        'features_en'                => array_key_exists('features_en', $data)
            ? decodeCatalogJsonArray($data['features_en'], $existing['features_en'])
            : $existing['features_en'],
        'sort_order'                 => array_key_exists('sort_order', $data) ? (int)$data['sort_order'] : (int)$existing['sort_order'],
    ]);

    $saved = upsertSubscriptionPlan($db, $merged);

    // Sync model_presets.allowed_tiers bidirectionally when plan's allowed_preset_ids changes
    if (array_key_exists('allowed_preset_ids', $data)) {
        $selectedIds = $saved['allowed_preset_ids'] ?? [];
        foreach (getModelPresetsCatalog($db, false) as $preset) {
            $presetId = $preset['id'];
            $tiersList = $preset['allowed_tiers'] ?? [];
            $shouldAllow = in_array($presetId, $selectedIds, true);
            $currentlyAllows = in_array($tier, $tiersList, true);
            if ($shouldAllow && !$currentlyAllows) {
                $preset['allowed_tiers'] = array_values(array_merge($tiersList, [$tier]));
                upsertModelPreset($db, $preset);
            } elseif (!$shouldAllow && $currentlyAllows) {
                $preset['allowed_tiers'] = array_values(array_filter($tiersList, fn($t) => $t !== $tier));
                upsertModelPreset($db, $preset);
            }
        }
    }

    jsonResponse([
        'success' => true,
        'plan'    => $saved,
        'plans'   => getSubscriptionPlansCatalog($db),
        'message' => "Plan '{$tier}' saved.",
    ]);
}
