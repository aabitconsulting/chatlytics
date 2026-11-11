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

    default:
        jsonError("Invalid admin action: {$action}", 400);
        break;
}

/**
 * List users with pagination, credit balances, tiers, run counts, created_at, status.
 */
function handleListUsers(array $data): void {
    $db = getDb();

    $page = max(1, (int)($_GET['page'] ?? $data['page'] ?? 1));
    $limit = min(100, max(1, (int)($_GET['limit'] ?? $data['limit'] ?? 20)));
    $offset = ($page - 1) * $limit;
    $search = trim((string)($_GET['search'] ?? $data['search'] ?? ''));

    $where = "WHERE 1=1";
    $params = [];

    if ($search !== '') {
        $where .= " AND (u.email LIKE :search OR u.company_name LIKE :search)";
        $params[':search'] = '%' . $search . '%';
    }

    // Count total users
    $countStmt = $db->prepare("SELECT COUNT(*) FROM users u $where");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    // Query users with run count join
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
            COUNT(r.id) AS run_count
        FROM users u
        LEFT JOIN llm_runs r ON r.user_id = u.id
        $where
        GROUP BY u.id
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

    $formattedUsers = array_map(function (array $u): array {
        return [
            'id'                => (int)$u['id'],
            'email'             => $u['email'],
            'company_name'      => $u['company_name'],
            'role'              => $u['role'],
            'tier'              => $u['tier'],
            'credits_remaining' => (int)$u['credits_remaining'],
            'run_count'         => (int)$u['run_count'],
            'status'            => $u['status'],
            'created_at'        => $u['created_at'],
            'updated_at'        => $u['updated_at'],
            'magic_audit_token' => $u['magic_audit_token'],
        ];
    }, $rawUsers);

    jsonResponse([
        'users'      => $formattedUsers,
        'pagination' => [
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
        // Atomic delta calculation with non-negative lower bound
        $stmt = $db->prepare("
            UPDATE users 
            SET credits_remaining = GREATEST(0, credits_remaining + :delta) 
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
 * historical runs across OpenAI, Claude, and Gemini, competitors, and grounding citations
 * spanning all 4 MECE categories and all 4 GEO quadrants over a 30-day timeline.
 */
function handleSeedDemoData(): void {
    $db = getDb();
    $db->beginTransaction();

    try {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        $options = defined('PASSWORD_ARGON2ID') ? [
            'memory_cost' => 65536,
            'time_cost'   => 4,
            'threads'     => 1,
        ] : ['cost' => 12];
        $defaultHash = password_hash('DemoAccount2026!', $algo, $options);

        // Account Definitions
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
                    'target_llms'       => ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-1.5-pro'],
                    'schedule_interval' => 'daily',
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
                    'target_llms'       => ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-1.5-pro'],
                    'schedule_interval' => 'daily',
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
                    'target_llms'       => ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-1.5-pro'],
                    'schedule_interval' => 'daily',
                    'search_enabled'    => 1,
                ]
            ]
        ];

        $seededAccountNames = [];
        $totalConfigsCreated = 0;
        $totalRunsCreated = 0;

        foreach ($accounts as $acc) {
            $email = $acc['email'];
            $seededAccountNames[] = $acc['config']['brand_name'];

            // Upsert user
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

            // Create tracking config
            $cfg = $acc['config'];
            $insConfig = $db->prepare("
                INSERT INTO tracking_configs (
                    user_id, name, brand_name, brand_domains, keywords_prompts,
                    competitors, target_llms, search_enabled, schedule_interval,
                    status, next_run_at
                ) VALUES (
                    :user_id, :name, :brand_name, :brand_domains, :keywords_prompts,
                    :competitors, :target_llms, :search_enabled, :schedule_interval,
                    'active', DATE_ADD(NOW(), INTERVAL 1 DAY)
                )
            ");
            $insConfig->execute([
                ':user_id'           => $userId,
                ':name'              => $cfg['name'],
                ':brand_name'        => $cfg['brand_name'],
                ':brand_domains'     => json_encode($cfg['brand_domains']),
                ':keywords_prompts'  => json_encode($cfg['keywords_prompts']),
                ':competitors'       => json_encode($cfg['competitors']),
                ':target_llms'       => json_encode($cfg['target_llms']),
                ':search_enabled'    => $cfg['search_enabled'],
                ':schedule_interval' => $cfg['schedule_interval'],
            ]);
            $configId = (int)$db->lastInsertId();
            $totalConfigsCreated++;

            // Matrix of Run Templates covering all 4 MECE categories and all 4 GEO quadrants
            $runTemplates = [
                // 1. Direct Win (Clean)
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
                // 2. Buried Winner (Brand wins text and citation, but placed >50%)
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
                // 3. Brand Halo Trap (Competitor leads, brand trapped secondarily)
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
                // 4. Citation Hijack (Brand mentioned, but citations hijack to competitor domain)
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
                // 5. Parametric Blindspot (Brand cited in grounding, but missing from synthesized text)
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
                // 6. Generic (Neither brand nor competitor mentioned)
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
            ];

            $providers = [
                ['provider' => 'openai',    'model' => 'gpt-4o'],
                ['provider' => 'anthropic', 'model' => 'claude-3-5-sonnet'],
                ['provider' => 'gemini',    'model' => 'gemini-1.5-pro'],
            ];

            $primaryCompetitor = $cfg['competitors'][0];

            foreach ($runTemplates as $tmpl) {
                foreach ($providers as $prov) {
                    $promptText = $cfg['keywords_prompts'][array_rand($cfg['keywords_prompts'])];
                    $createdAt = date('Y-m-d H:i:s', strtotime("-{$tmpl['day_offset']} days"));

                    $insRun = $db->prepare("
                        INSERT INTO llm_runs (
                            config_id, user_id, prompt, provider, model, brand_name, status,
                            brand_mentioned, brand_prominence_rank, char_earliness,
                            word_earliness, relative_position_pct, total_chars, total_words,
                            mece_category, geo_quadrant, has_citations, brand_cited,
                            competitor_cited, raw_response_text, run_duration_ms, cost_credits,
                            created_at
                        ) VALUES (
                            :config_id, :user_id, :prompt, :provider, :model, :brand_name, 'completed',
                            :brand_mentioned, :brand_prominence_rank, :char_earliness,
                            :word_earliness, :relative_position_pct, 1280, 185,
                            :mece_category, :geo_quadrant, :has_citations, :brand_cited,
                            :competitor_cited, :raw_response_text, 1450, 1,
                            :created_at
                        )
                    ");

                    $insRun->execute([
                        ':config_id'              => $configId,
                        ':user_id'                => $userId,
                        ':prompt'                 => $promptText,
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
                        ':raw_response_text'      => "Synthesized analysis for {$cfg['brand_name']}.",
                        ':created_at'             => $createdAt,
                    ]);

                    $runId = (int)$db->lastInsertId();
                    $totalRunsCreated++;

                    // Insert competitor record if competitor was present
                    if ($tmpl['comp_mentioned']) {
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
                            ':competitor_name'   => $primaryCompetitor['name'],
                            ':competitor_domain' => $primaryCompetitor['domain'] ?? null,
                            ':char_earliness'    => $tmpl['comp_earliness'],
                            ':word_earliness'    => $tmpl['comp_earliness'] ? (int)ceil($tmpl['comp_earliness'] / 7) : null,
                            ':relative_pos'      => $tmpl['comp_earliness'] ? round(($tmpl['comp_earliness'] / 1280) * 100, 2) : null,
                            ':recommended'       => $tmpl['comp_rec'],
                            ':created_at'        => $createdAt,
                        ]);
                    }

                    // Insert citations
                    if ($tmpl['has_cit']) {
                        if ($tmpl['brand_cited']) {
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
                                ':domain'     => $cfg['brand_domains'][0],
                                ':url'        => "https://www.{$cfg['brand_domains'][0]}/overview",
                                ':title'      => "{$cfg['brand_name']} Official Platform",
                                ':created_at' => $createdAt,
                            ]);
                        }

                        if ($tmpl['comp_cited']) {
                            $compDomain = $primaryCompetitor['domain'] ?? 'competitor.com';
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
                                ':domain'     => $compDomain,
                                ':url'        => "https://www.{$compDomain}/product",
                                ':title'      => "{$primaryCompetitor['name']} Product Overview",
                                ':created_at' => $createdAt,
                            ]);
                        }
                    }
                }
            }
        }

        $db->commit();

        jsonResponse([
            'success'          => true,
            'seeded_accounts'  => $seededAccountNames,
            'configs_created'  => $totalConfigsCreated,
            'runs_created'     => $totalRunsCreated,
            'message'          => 'Demo data successfully seeded across 3 German B2B accounts with MECE and GEO history.',
        ], 200);

    } catch (Throwable $e) {
        $db->rollBack();
        error_log("Seed demo data failure: " . $e->getMessage());
        jsonError("Failed to seed demo data: " . $e->getMessage(), 500);
    }
}
