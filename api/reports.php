<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Period-over-Period (PoP) Analytics & 4-Quadrant GEO Diagnostic Endpoint
 * File: api/reports.php
 * Feature 21 (Milestone 4)
 *
 * Memory-safe (<128MB) SQL aggregation endpoint for B2B dashboards & Magic Audits.
 * Supported query parameters:
 * - period: 7d, 14d, 30d, 90d, all (default: 30d)
 * - start_date, end_date: custom ISO date range
 * - config_id: optional filter by tracking configuration
 * - audit_token: Magic Audit read-only token
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

// 1. Authentication (Allow Magic Audit preview mode)
$currentUser = requireAuth(true);
$userId = (int)$currentUser['id'];
$isAdmin = ($currentUser['role'] ?? '') === 'admin';
$isAuditMode = !empty($currentUser['is_audit_mode']);

$db = getDb();
$requestData = getRequestData();

// 2. Tenant Scoping & Config Resolution
$configId = isset($_GET['config_id']) && is_numeric($_GET['config_id'])
    ? (int)$_GET['config_id']
    : (isset($requestData['config_id']) && is_numeric($requestData['config_id']) ? (int)$requestData['config_id'] : null);

if ($configId !== null) {
    $cfgStmt = $db->prepare("SELECT id, user_id FROM tracking_configs WHERE id = :id LIMIT 1");
    $cfgStmt->execute([':id' => $configId]);
    $cfg = $cfgStmt->fetch();
    if (!$cfg) {
        jsonError("Configuration not found.", 404);
    }
    if ((int)$cfg['user_id'] !== $userId && !$isAdmin) {
        jsonError("Configuration not found.", 404);
    }
}

// 3. Resolve Period & Date Ranges (complying with Boundary 3.7)
$periodParam = strtolower(trim((string)($_GET['period'] ?? $requestData['period'] ?? '30d')));
$startDateParam = trim((string)($_GET['start_date'] ?? $requestData['start_date'] ?? ''));
$endDateParam = trim((string)($_GET['end_date'] ?? $requestData['end_date'] ?? ''));

$isCustomRange = false;
$days = 30;

if ($startDateParam !== '' && $endDateParam !== '') {
    $startTs = strtotime($startDateParam);
    $endTs = strtotime($endDateParam);
    if ($startTs !== false && $endTs !== false && $endTs >= $startTs) {
        $isCustomRange = true;
        $curStart = date('Y-m-d 00:00:00', $startTs);
        $curEnd = date('Y-m-d 23:59:59', $endTs);
        $diffDays = max(1, (int)round(($endTs - $startTs) / 86400));
        $prevStart = date('Y-m-d 00:00:00', strtotime($curStart . " -{$diffDays} days"));
        $prevEnd = date('Y-m-d 23:59:59', strtotime($curStart . " -1 second"));
        $periodLabel = 'custom';
    }
}

if (!$isCustomRange) {
    if ($periodParam === 'all') {
        $days = 3650;
        $periodLabel = 'all';
    } elseif (preg_match('/^(\d+)d$/', $periodParam, $m)) {
        $parsedDays = (int)$m[1];
        if ($parsedDays < 1) $parsedDays = 7;
        if ($parsedDays > 365) $parsedDays = 365;
        $days = $parsedDays;
        $periodLabel = "{$days}d";
    } else {
        $days = 30;
        $periodLabel = '30d';
    }

    $curStart = date('Y-m-d H:i:s', strtotime("-{$days} days"));
    $curEnd = date('Y-m-d H:i:s');
    $prevStart = date('Y-m-d H:i:s', strtotime("-" . ($days * 2) . " days"));
    $prevEnd = $curStart;
}

// 4. Build Scope WHERE clause
$whereConditions = ["r.status = 'completed'"];
$baseParams = [];

if ($configId !== null) {
    $whereConditions[] = "r.config_id = :cfg_id";
    $baseParams[':cfg_id'] = $configId;
} elseif (!$isAdmin || $isAuditMode || empty($_GET['all_users'])) {
    $whereConditions[] = "r.user_id = :usr_id";
    $baseParams[':usr_id'] = $userId;
}

$baseWhere = implode(' AND ', $whereConditions);

// 5. Query 1: Current Period KPI & MECE Aggregations
$curParams = array_merge($baseParams, [
    ':cur_start' => $curStart,
    ':cur_end'   => $curEnd,
]);

$kpiSql = "
    SELECT 
        COUNT(*) AS total_runs,
        SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions_count,
        SUM(CASE WHEN r.brand_mentioned = 1 OR r.brand_cited = 1 THEN 1 ELSE 0 END) AS visible_runs,
        AVG(CASE WHEN r.brand_mentioned = 1 THEN r.relative_position_pct ELSE NULL END) AS avg_earliness,
        SUM(CASE WHEN r.brand_cited = 1 THEN 1 ELSE 0 END) AS cited_runs,
        SUM(CASE WHEN r.mece_category = '1_DIRECT_WIN' THEN 1 ELSE 0 END) AS direct_win_count,
        SUM(CASE WHEN r.mece_category = '2_BRAND_HALO' THEN 1 ELSE 0 END) AS brand_halo_count,
        SUM(CASE WHEN r.mece_category = '3_COMPETITOR_TAKEOVER' THEN 1 ELSE 0 END) AS competitor_takeover_count,
        SUM(CASE WHEN r.mece_category = '4_GENERIC' THEN 1 ELSE 0 END) AS generic_count,
        SUM(CASE WHEN r.geo_quadrant = '1_CITATION_HIJACK' THEN 1 ELSE 0 END) AS geo_hijack_count,
        SUM(CASE WHEN r.geo_quadrant = '2_PARAMETRIC_BLINDSPOT' THEN 1 ELSE 0 END) AS geo_blindspot_count,
        SUM(CASE WHEN r.geo_quadrant = '3_BRAND_HALO_TRAP' THEN 1 ELSE 0 END) AS geo_trap_count,
        SUM(CASE WHEN r.geo_quadrant = '4_BURIED_WINNER' THEN 1 ELSE 0 END) AS geo_buried_count,
        SUM(CASE WHEN r.geo_quadrant = 'NONE' THEN 1 ELSE 0 END) AS geo_none_count
    FROM llm_runs r
    WHERE {$baseWhere}
      AND r.created_at >= :cur_start AND r.created_at <= :cur_end
";
$stmtCur = $db->prepare($kpiSql);
$stmtCur->execute($curParams);
$cur = $stmtCur->fetch() ?: [];

$curTotal = (int)($cur['total_runs'] ?? 0);
$curMentions = (int)($cur['mentions_count'] ?? 0);
$curVisible = (int)($cur['visible_runs'] ?? 0);
$curCited = (int)($cur['cited_runs'] ?? 0);
$curAvgEarly = $cur['avg_earliness'] !== null ? round((float)$cur['avg_earliness'], 1) : 0.0;

// 6. Query 2: Previous Period Baseline Aggregations
$prevTotal = 0;
$prevMentions = 0;
$prevVisible = 0;
$prevAvgEarly = 0.0;

if ($periodLabel !== 'all') {
    $prevParams = array_merge($baseParams, [
        ':prev_start' => $prevStart,
        ':prev_end'   => $prevEnd,
    ]);
    $prevSql = "
        SELECT 
            COUNT(*) AS total_runs,
            SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions_count,
            SUM(CASE WHEN r.brand_mentioned = 1 OR r.brand_cited = 1 THEN 1 ELSE 0 END) AS visible_runs,
            AVG(CASE WHEN r.brand_mentioned = 1 THEN r.relative_position_pct ELSE NULL END) AS avg_earliness
        FROM llm_runs r
        WHERE {$baseWhere}
          AND r.created_at >= :prev_start AND r.created_at < :prev_end
    ";
    $stmtPrev = $db->prepare($prevSql);
    $stmtPrev->execute($prevParams);
    $prev = $stmtPrev->fetch() ?: [];
    $prevTotal = (int)($prev['total_runs'] ?? 0);
    $prevMentions = (int)($prev['mentions_count'] ?? 0);
    $prevVisible = (int)($prev['visible_runs'] ?? 0);
    $prevAvgEarly = $prev['avg_earliness'] !== null ? round((float)$prev['avg_earliness'], 1) : 0.0;
}

// 7. Compute Core Metrics & PoP Deltas (with divide-by-zero protection)
if ($curTotal > 0) {
    $somScore = round(($curMentions / $curTotal) * 100, 2);
    $visibilityIndex = round(($curVisible / $curTotal) * 100, 1);
    $citationShare = round(($curCited / $curTotal) * 100, 1);
} else {
    $somScore = 0.0;
    $visibilityIndex = 0.0;
    $citationShare = 0.0;
}

if ($prevTotal > 0 && $periodLabel !== 'all') {
    $prevSom = round(($prevMentions / $prevTotal) * 100, 2);
    $prevVis = round(($prevVisible / $prevTotal) * 100, 1);
    $somDelta = round($somScore - $prevSom, 2);
    $visibilityDelta = round($visibilityIndex - $prevVis, 1);
    $earlinessDelta = round($curAvgEarly - $prevAvgEarly, 1);
} else {
    $somDelta = null;
    $visibilityDelta = null;
    $earlinessDelta = null;
}

// 8. MECE Breakdown (Strictly 4 snake_case keys whose sum equals total_runs)
$meceBreakdown = [
    'direct_win'          => (int)($cur['direct_win_count'] ?? 0),
    'brand_halo'          => (int)($cur['brand_halo_count'] ?? 0),
    'competitor_takeover' => (int)($cur['competitor_takeover_count'] ?? 0),
    'generic'             => (int)($cur['generic_count'] ?? 0),
];

// 9. GEO Diagnostics
$quadrantCounts = [
    '1_CITATION_HIJACK'      => (int)($cur['geo_hijack_count'] ?? 0),
    '2_PARAMETRIC_BLINDSPOT' => (int)($cur['geo_blindspot_count'] ?? 0),
    '3_BRAND_HALO_TRAP'      => (int)($cur['geo_trap_count'] ?? 0),
    '4_BURIED_WINNER'        => (int)($cur['geo_buried_count'] ?? 0),
    'NONE'                   => (int)($cur['geo_none_count'] ?? 0),
];

// Determine active diagnostic quadrant
$activeQuadrant = 'NONE';
$anomalyCandidates = ['1_CITATION_HIJACK', '4_BURIED_WINNER', '3_BRAND_HALO_TRAP', '2_PARAMETRIC_BLINDSPOT'];
$maxCount = 0;
foreach ($anomalyCandidates as $quad) {
    if ($quadrantCounts[$quad] > $maxCount) {
        $maxCount = $quadrantCounts[$quad];
        $activeQuadrant = $quad;
    }
}

$prescriptions = [
    '1_CITATION_HIJACK' => [
        'de' => 'Wettbewerber kapert Ihre Quellen. Schema.org Markup aktualisieren.',
        'en' => 'Competitor is hijacking your citations. Update Schema.org markup.',
    ],
    '2_PARAMETRIC_BLINDSPOT' => [
        'de' => 'Domain zitiert, aber Marke im Synthesetext ausgelassen. Entitäts-Kookkurrenzen ausbauen.',
        'en' => 'Domain cited, but brand omitted from synthesis text. Expand entity co-occurrences.',
    ],
    '3_BRAND_HALO_TRAP' => [
        'de' => 'Marke im Windschatten des Wettbewerbers gefangen. Differenzierende Alleinstellungsmerkmale schärfen.',
        'en' => 'Brand trapped in competitor shadow. Sharpen differentiating USPs.',
    ],
    '4_BURIED_WINNER' => [
        'de' => 'Gewinner, aber spät genannt. Semantische Dichte optimieren.',
        'en' => 'Winner, but cited late. Optimize semantic density.',
    ],
    'NONE' => [
        'de' => 'Keine kritischen GEO-Anomalien festgestellt. Sichtbarkeit stabil.',
        'en' => 'No critical GEO anomalies detected. Visibility stable.',
    ],
];

// 10. Query 3: Competitor Leaderboard (Top 10)
$compLeaderboard = [];
if ($curTotal > 0) {
    $compSql = "
        SELECT 
            rc.competitor_name,
            rc.competitor_domain,
            COUNT(*) AS total_tracked,
            SUM(CASE WHEN rc.mentioned = 1 THEN 1 ELSE 0 END) AS mentions,
            ROUND(SUM(CASE WHEN rc.mentioned = 1 THEN 1 ELSE 0 END) / :tot_runs * 100, 1) AS visibility_pct,
            ROUND(AVG(CASE WHEN rc.mentioned = 1 THEN rc.relative_position_pct ELSE NULL END), 1) AS avg_relative_pos,
            SUM(CASE WHEN rc.recommended = 1 THEN 1 ELSE 0 END) AS recommendations_count
        FROM run_competitors rc
        INNER JOIN llm_runs r ON r.id = rc.run_id
        WHERE {$baseWhere}
          AND r.created_at >= :cur_start AND r.created_at <= :cur_end
        GROUP BY rc.competitor_name, rc.competitor_domain
        ORDER BY mentions DESC, visibility_pct DESC
        LIMIT 10
    ";
    $compStmt = $db->prepare($compSql);
    $compParams = array_merge($curParams, [':tot_runs' => $curTotal]);
    $compStmt->execute($compParams);
    $compLeaderboard = $compStmt->fetchAll() ?: [];
}

// 11. Query 4: Grounding Citations (Top 10 Domains and URLs)
$topDomains = [];
$topUrls = [];
if ($curTotal > 0) {
    $domSql = "
        SELECT 
            rcit.citation_domain,
            COUNT(*) AS citation_count,
            MAX(rcit.is_brand_domain) AS is_brand_domain,
            MAX(rcit.is_competitor_domain) AS is_competitor_domain
        FROM run_citations rcit
        INNER JOIN llm_runs r ON r.id = rcit.run_id
        WHERE {$baseWhere}
          AND r.created_at >= :cur_start AND r.created_at <= :cur_end
        GROUP BY rcit.citation_domain
        ORDER BY citation_count DESC
        LIMIT 10
    ";
    $domStmt = $db->prepare($domSql);
    $domStmt->execute($curParams);
    $topDomains = $domStmt->fetchAll() ?: [];

    $urlSql = "
        SELECT 
            rcit.citation_url,
            rcit.citation_domain,
            rcit.citation_title,
            COUNT(*) AS citation_count,
            MAX(rcit.is_brand_domain) AS is_brand_domain
        FROM run_citations rcit
        INNER JOIN llm_runs r ON r.id = rcit.run_id
        WHERE {$baseWhere}
          AND r.created_at >= :cur_start AND r.created_at <= :cur_end
          AND rcit.citation_url IS NOT NULL AND rcit.citation_url != ''
        GROUP BY rcit.citation_url, rcit.citation_domain, rcit.citation_title
        ORDER BY citation_count DESC
        LIMIT 10
    ";
    $urlStmt = $db->prepare($urlSql);
    $urlStmt->execute($curParams);
    $topUrls = $urlStmt->fetchAll() ?: [];
}

// 12. Query 5: Timeline Data Points (Daily)
$timeline = [];
if ($curTotal > 0) {
    $timeSql = "
        SELECT 
            DATE(r.created_at) AS date_point,
            COUNT(*) AS total_runs,
            SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions,
            ROUND(SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS som_score,
            ROUND(SUM(CASE WHEN r.brand_mentioned = 1 OR r.brand_cited = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS visibility_index,
            SUM(CASE WHEN r.mece_category = '1_DIRECT_WIN' THEN 1 ELSE 0 END) AS direct_wins
        FROM llm_runs r
        WHERE {$baseWhere}
          AND r.created_at >= :cur_start AND r.created_at <= :cur_end
        GROUP BY DATE(r.created_at)
        ORDER BY date_point ASC
    ";
    $timeStmt = $db->prepare($timeSql);
    $timeStmt->execute($curParams);
    $timeline = $timeStmt->fetchAll() ?: [];
}

// 13. Assemble Final Response
jsonResponse([
    'metrics' => [
        'som_score'          => $somScore,
        'visibility_index'   => $visibilityIndex,
        'avg_earliness'      => $curAvgEarly,
        'total_runs'         => $curTotal,
        'citation_share'     => $citationShare,
        'credits_remaining'  => (int)($currentUser['credits_remaining'] ?? 0),
    ],
    'mece_breakdown' => $meceBreakdown,
    'pop_comparison' => [
        'som_delta'         => $somDelta,
        'visibility_delta'  => $visibilityDelta,
        'earliness_delta'   => $earlinessDelta,
        'runs_delta'        => ($periodLabel !== 'all' && $prevTotal > 0) ? ($curTotal - $prevTotal) : null,
    ],
    'geo_diagnostic' => [
        'active_quadrant' => $activeQuadrant,
        'prescription_de' => $prescriptions[$activeQuadrant]['de'],
        'prescription_en' => $prescriptions[$activeQuadrant]['en'],
        'quadrant_counts' => $quadrantCounts,
    ],
    'competitors' => $compLeaderboard,
    'competitors_leaderboard' => $compLeaderboard,
    'citations' => [
        'domains' => $topDomains,
        'urls'    => $topUrls,
    ],
    'top_citations' => [
        'domains' => $topDomains,
        'urls'    => $topUrls,
    ],
    'timeline' => $timeline,
    'date_range' => [
        'period'         => $periodLabel,
        'current_start'  => $curStart,
        'current_end'    => $curEnd,
        'previous_start' => $prevStart,
        'previous_end'   => $prevEnd,
    ],
    'is_audit_mode' => $isAuditMode,
], 200);
