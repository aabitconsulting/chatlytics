<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Per-User Physical Result Table Explorer Endpoint
 * File: api/user_results.php
 *
 * Queries the authenticated user's dedicated physical table `user_results_<user_id>`
 * to power the expandable Accordion Result Lookup Table in the dashboard.
 *
 * Supported Query Parameters (GET):
 * - config_id: optional filter by tracking configuration ID
 * - model:     optional filter by canonical model (`openai/gpt-6-luna`), model name, or provider
 * - prompt:    optional exact filter by prompt string
 * - mece:      optional filter by MECE category (`1_DIRECT_WIN`, `2_BRAND_HALO`, `3_COMPETITOR_TAKEOVER`, `4_GENERIC`)
 * - search:    optional free-text substring search across `prompt`, `llm_answer`, and `custom_id`
 * - page:      1-based page number (default: 1)
 * - limit:     page size (default: 25, max: 100)
 *
 * Day-1 Suppression Rule:
 * - Pre-start test runs (`is_test_run = 1`) are always shown immediately.
 * - Scheduled Data Mining runs (`is_test_run = 0`) are hidden while the configuration
 *   is still on its first calendar day (`DATE(COALESCE(full_started_at, created_at)) = CURDATE()`).
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    jsonError("Method not allowed. Only GET requests are accepted.", 405);
}

$currentUser = requireAuth(true); // Allow Magic Audit read-only mode
$userId = (int)$currentUser['id'];
$isAdmin = ($currentUser['role'] ?? '') === 'admin';

$db = getDb();
ensureCoreSchemaColumns($db);

// Allow admin to inspect a specific user_id if requested, otherwise scope strictly to $userId
$targetUserId = ($isAdmin && isset($_GET['user_id']) && (int)$_GET['user_id'] > 0)
    ? (int)$_GET['user_id']
    : $userId;

$table = ensureUserResultsTable($db, $targetUserId);

// Backfill any historical llm_runs for this user that are not yet in `user_results_<user_id>`
try {
    $missingStmt = $db->prepare("
        SELECT r.*
        FROM llm_runs r
        LEFT JOIN `{$table}` ur ON ur.run_id = r.id
        WHERE r.user_id = :uid AND ur.id IS NULL
        ORDER BY r.id ASC
        LIMIT 200
    ");
    $missingStmt->execute([':uid' => $targetUserId]);
    $missingRuns = $missingStmt->fetchAll();

    foreach ($missingRuns as $mRun) {
        $mRunId = (int)$mRun['id'];
        $compStmt = $db->prepare("SELECT competitor_name, competitor_domain, mentioned, char_earliness, word_earliness, relative_position_pct, prominence_rank, recommended, sentiment FROM run_competitors WHERE run_id = :rid");
        $compStmt->execute([':rid' => $mRunId]);
        $comps = $compStmt->fetchAll() ?: [];

        $citStmt = $db->prepare("SELECT citation_url, citation_domain, citation_title, is_brand_domain, is_competitor_domain, citation_index FROM run_citations WHERE run_id = :rid ORDER BY citation_index ASC");
        $citStmt->execute([':rid' => $mRunId]);
        $cits = $citStmt->fetchAll() ?: [];

        insertUserResultRow($db, $targetUserId, [
            'run_id'                => $mRunId,
            'config_id'             => isset($mRun['config_id']) ? (int)$mRun['config_id'] : null,
            'custom_id'             => $mRun['custom_id'] ?? ('cl_legacy_run_' . $mRunId),
            'batch_id'              => $mRun['batch_id'] ?? null,
            'execution_strategy'    => $mRun['execution_strategy'] ?? 'prompt_caching',
            'prompt_cache_key'      => $mRun['prompt_cache_key'] ?? null,
            'cached_tokens'         => (int)($mRun['cached_tokens'] ?? 0),
            'trigger_source'        => !empty($mRun['is_test_run']) ? 'test_run' : 'scheduled_queue',
            'is_test_run'           => !empty($mRun['is_test_run']) ? 1 : 0,
            'prompt'                => (string)($mRun['prompt'] ?? ''),
            'llm_answer'            => $mRun['raw_response_text'] ?? null,
            'provider'              => (string)($mRun['provider'] ?? 'openai'),
            'model'                 => (string)($mRun['model'] ?? ''),
            'brand_name'            => (string)($mRun['brand_name'] ?? ''),
            'status'                => ($mRun['status'] ?? 'completed') === 'failed' ? 'failed' : 'completed',
            'brand_mentioned'       => !empty($mRun['brand_mentioned']) ? 1 : 0,
            'char_earliness'        => $mRun['char_earliness'] ?? null,
            'word_earliness'        => $mRun['word_earliness'] ?? null,
            'relative_position_pct' => $mRun['relative_position_pct'] ?? null,
            'total_chars'           => (int)($mRun['total_chars'] ?? 0),
            'total_words'           => (int)($mRun['total_words'] ?? 0),
            'mece_category'         => (string)($mRun['mece_category'] ?? '4_GENERIC'),
            'geo_quadrant'          => (string)($mRun['geo_quadrant'] ?? 'NONE'),
            'brand_cited'           => !empty($mRun['brand_cited']) ? 1 : 0,
            'competitor_cited'      => !empty($mRun['competitor_cited']) ? 1 : 0,
            'competitors_json'      => $comps,
            'citations_json'        => $cits,
            'error_message'         => $mRun['error_message'] ?? null,
            'scheduled_at'          => $mRun['created_at'] ?? null,
            'created_at'            => $mRun['created_at'] ?? date('Y-m-d H:i:s'),
        ]);
    }
} catch (Throwable $e) {
    // Non-fatal if backfill encounters partial mock schema
}

// Parse query filters
$configId = isset($_GET['config_id']) && $_GET['config_id'] !== '' ? (int)$_GET['config_id'] : null;
$modelFilter = trim((string)($_GET['model'] ?? ''));
$promptFilter = trim((string)($_GET['prompt'] ?? ''));
$meceFilter = trim((string)($_GET['mece'] ?? ''));
$searchFilter = trim((string)($_GET['search'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$limit = min(100, max(1, (int)($_GET['limit'] ?? 25)));
$offset = ($page - 1) * $limit;

$todayDate = date('Y-m-d');
$isFirstDayConfig = false;

if ($configId !== null && $configId > 0) {
    $cfgChk = $db->prepare("SELECT id, user_id, full_started_at, created_at FROM tracking_configs WHERE id = :id LIMIT 1");
    $cfgChk->execute([':id' => $configId]);
    $cfgRow = $cfgChk->fetch();
    if (!$cfgRow || ((int)$cfgRow['user_id'] !== $targetUserId && !$isAdmin)) {
        jsonError("Configuration not found or access denied.", 404);
    }
    $refDate = $cfgRow['full_started_at'] ?: ($cfgRow['created_at'] ?? null);
    if ($refDate !== null && substr((string)$refDate, 0, 10) === $todayDate) {
        $isFirstDayConfig = true;
    }
}

// Build WHERE clause with Day-1 rule:
// - Pre-start test runs (`ur.is_test_run = 1`) are ALWAYS visible.
// - Scheduled runs (`ur.is_test_run = 0`) are visible only when the config is NOT on Day 1
//   (`SUBSTR(COALESCE(tc.full_started_at, tc.created_at), 1, 10) < :today_date` or `SUBSTR(ur.created_at, 1, 10) < :today_date_run`).
$whereClauses = [
    "(ur.is_test_run = 1 OR tc.id IS NULL OR SUBSTR(COALESCE(tc.full_started_at, tc.created_at), 1, 10) < :today_date)"
];
$params = [
    ':today_date' => $todayDate,
];

if ($configId !== null && $configId > 0) {
    $whereClauses[] = "ur.config_id = :config_id";
    $params[':config_id'] = $configId;
}

if ($modelFilter !== '') {
    $spec = resolveTargetLlmSpec($modelFilter);
    $whereClauses[] = "(LOWER(ur.model) = LOWER(:model_exact) OR LOWER(ur.provider || '/' || ur.model) = LOWER(:model_canon) OR LOWER(CONCAT(ur.provider, '/', ur.model)) = LOWER(:model_canon_2) OR LOWER(ur.provider) = LOWER(:model_prov))";
    $params[':model_exact'] = $spec['model'] !== '' ? $spec['model'] : $modelFilter;
    $params[':model_canon'] = $spec['id'] !== '' ? $spec['id'] : $modelFilter;
    $params[':model_canon_2'] = $spec['id'] !== '' ? $spec['id'] : $modelFilter;
    $params[':model_prov'] = $modelFilter;
}

if ($promptFilter !== '') {
    $whereClauses[] = "ur.prompt = :prompt_filter";
    $params[':prompt_filter'] = $promptFilter;
}

if ($meceFilter !== '' && in_array($meceFilter, ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'], true)) {
    $whereClauses[] = "ur.mece_category = :mece_filter";
    $params[':mece_filter'] = $meceFilter;
}

if ($searchFilter !== '') {
    $whereClauses[] = "(ur.prompt LIKE :search_p OR ur.llm_answer LIKE :search_a OR ur.custom_id LIKE :search_c)";
    $likeVal = '%' . $searchFilter . '%';
    $params[':search_p'] = $likeVal;
    $params[':search_a'] = $likeVal;
    $params[':search_c'] = $likeVal;
}

$whereSql = 'WHERE ' . implode(' AND ', $whereClauses);

// Note: SQLite supports `||` while MySQL uses `CONCAT()`. Let's use driver-aware model condition:
$driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
if ($modelFilter !== '') {
    $whereClauses = array_filter($whereClauses, fn($c) => !str_contains($c, ':model_exact'));
    unset($params[':model_canon_2']);
    if ($driver === 'sqlite') {
        $whereClauses[] = "(LOWER(ur.model) = LOWER(:model_exact) OR LOWER(ur.provider || '/' || ur.model) = LOWER(:model_canon) OR LOWER(ur.provider) = LOWER(:model_prov))";
    } else {
        $whereClauses[] = "(LOWER(ur.model) = LOWER(:model_exact) OR LOWER(CONCAT(ur.provider, '/', ur.model)) = LOWER(:model_canon) OR LOWER(ur.provider) = LOWER(:model_prov))";
    }
    $whereSql = 'WHERE ' . implode(' AND ', $whereClauses);
}

$countSql = "
    SELECT COUNT(*)
    FROM `{$table}` ur
    LEFT JOIN tracking_configs tc ON tc.id = ur.config_id
    {$whereSql}
";
$countStmt = $db->prepare($countSql);
$countStmt->execute($params);
$totalRows = (int)$countStmt->fetchColumn();

$querySql = "
    SELECT ur.*
    FROM `{$table}` ur
    LEFT JOIN tracking_configs tc ON tc.id = ur.config_id
    {$whereSql}
    ORDER BY ur.created_at DESC, ur.id DESC
    LIMIT :limit OFFSET :offset
";
$stmt = $db->prepare($querySql);
foreach ($params as $k => $v) {
    $stmt->bindValue($k, $v);
}
$stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
$stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
$stmt->execute();
$rawRows = $stmt->fetchAll() ?: [];

$formattedResults = array_map(function (array $r): array {
    $comps = [];
    if (!empty($r['competitors_json'])) {
        $decoded = is_string($r['competitors_json']) ? json_decode($r['competitors_json'], true) : $r['competitors_json'];
        if (is_array($decoded)) {
            $comps = $decoded;
        }
    }
    $cits = [];
    if (!empty($r['citations_json'])) {
        $decoded = is_string($r['citations_json']) ? json_decode($r['citations_json'], true) : $r['citations_json'];
        if (is_array($decoded)) {
            $cits = $decoded;
        }
    }

    $spec = resolveTargetLlmSpec(($r['provider'] ?? 'openai') . '/' . ($r['model'] ?? ''));

    return [
        'id'                    => (int)$r['id'],
        'run_id'                => isset($r['run_id']) && $r['run_id'] !== null ? (int)$r['run_id'] : null,
        'config_id'             => isset($r['config_id']) && $r['config_id'] !== null ? (int)$r['config_id'] : null,
        'custom_id'             => $r['custom_id'] ?? null,
        'batch_id'              => $r['batch_id'] ?? null,
        'execution_strategy'    => (string)($r['execution_strategy'] ?? $spec['execution_strategy']),
        'prompt_cache_key'      => $r['prompt_cache_key'] ?? null,
        'cached_tokens'         => (int)($r['cached_tokens'] ?? 0),
        'trigger_source'        => (string)($r['trigger_source'] ?? 'batch_queue'),
        'is_test_run'           => !empty($r['is_test_run']),
        'prompt'                => (string)($r['prompt'] ?? ''),
        'llm_answer'            => (string)($r['llm_answer'] ?? ''),
        'provider'              => (string)($r['provider'] ?? 'openai'),
        'model'                 => (string)($r['model'] ?? ''),
        'canonical_model'       => $spec['id'],
        'eu_hosted'             => $spec['eu_hosted'],
        'brand_name'            => (string)($r['brand_name'] ?? ''),
        'status'                => (string)($r['status'] ?? 'completed'),
        'brand_mentioned'       => !empty($r['brand_mentioned']),
        'char_earliness'        => $r['char_earliness'] !== null ? (int)$r['char_earliness'] : null,
        'word_earliness'        => $r['word_earliness'] !== null ? (int)$r['word_earliness'] : null,
        'relative_position_pct' => $r['relative_position_pct'] !== null ? round((float)$r['relative_position_pct'], 2) : null,
        'total_chars'           => (int)($r['total_chars'] ?? 0),
        'total_words'           => (int)($r['total_words'] ?? 0),
        'mece_category'         => (string)($r['mece_category'] ?? '4_GENERIC'),
        'geo_quadrant'          => (string)($r['geo_quadrant'] ?? 'NONE'),
        'brand_cited'           => !empty($r['brand_cited']),
        'competitor_cited'      => !empty($r['competitor_cited']),
        'competitors'           => $comps,
        'citations'             => $cits,
        'error_message'         => $r['error_message'] ?? null,
        'scheduled_at'          => $r['scheduled_at'] ?? null,
        'created_at'            => (string)($r['created_at'] ?? ''),
    ];
}, $rawRows);

jsonResponse([
    'results_table' => $table,
    'user_id'       => $targetUserId,
    'is_first_day'  => $isFirstDayConfig,
    'results'       => $formattedResults,
    'pagination'    => [
        'page'        => $page,
        'limit'       => $limit,
        'total'       => $totalRows,
        'total_pages' => max(1, (int)ceil($totalRows / $limit)),
    ],
], 200);
