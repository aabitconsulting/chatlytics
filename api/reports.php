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

// 3. Resolve Primary & Comparison Period Date Ranges (complying with Boundary 3.7)
$periodParam = strtolower(trim((string)($_GET['period'] ?? $requestData['period'] ?? '30d')));
$startDateParam = trim((string)($_GET['start_date'] ?? $requestData['start_date'] ?? ''));
$endDateParam = trim((string)($_GET['end_date'] ?? $requestData['end_date'] ?? ''));
$compareModeParam = strtolower(trim((string)($_GET['compare_mode'] ?? $requestData['compare_mode'] ?? 'previous')));
$compareStartParam = trim((string)($_GET['compare_start_date'] ?? $requestData['compare_start_date'] ?? ''));
$compareEndParam = trim((string)($_GET['compare_end_date'] ?? $requestData['compare_end_date'] ?? ''));

$isCustomRange = false;
$days = 30;
$nowTs = time();

if ($startDateParam !== '' && $endDateParam !== '') {
    $startTs = strtotime($startDateParam);
    $endTs = strtotime($endDateParam);
    if ($startTs !== false && $endTs !== false && $endTs >= $startTs) {
        $isCustomRange = true;
        $startDay = date('Y-m-d', $startTs);
        $endDay = date('Y-m-d', $endTs);
        $curStart = $startDay . ' 00:00:00';
        $curEnd = $endDay . ' 23:59:59';
        $spanDays = max(1, (int)round((strtotime($endDay) - strtotime($startDay)) / 86400) + 1);
        $prevStartDefault = date('Y-m-d 00:00:00', strtotime($startDay . " -{$spanDays} days"));
        $prevEndDefault = date('Y-m-d 23:59:59', strtotime($startDay . " -1 day"));
        $periodLabel = 'custom';
    }
}

if (!$isCustomRange) {
    if ($periodParam === 'all') {
        $days = 3650;
        $periodLabel = 'all';
        $curStart = date('Y-m-d H:i:s', strtotime('-3650 days', $nowTs));
        $curEnd = date('Y-m-d H:i:s', $nowTs);
        $prevStartDefault = null;
        $prevEndDefault = null;
    } elseif ($periodParam === '24h' || $periodParam === '1d') {
        $days = 1;
        $periodLabel = '24h';
        $curStartTs = $nowTs - 86400;
        $curStart = date('Y-m-d H:i:s', $curStartTs);
        $curEnd = date('Y-m-d H:i:s', $nowTs);
        $prevStartDefault = date('Y-m-d H:i:s', $curStartTs - 86400);
        $prevEndDefault = date('Y-m-d H:i:s', $curStartTs - 1);
    } else {
        if (preg_match('/^(\d+)d$/', $periodParam, $m)) {
            $parsedDays = (int)$m[1];
            if ($parsedDays < 1) $parsedDays = 7;
            if ($parsedDays > 365) $parsedDays = 365;
            $days = $parsedDays;
            $periodLabel = "{$days}d";
        } else {
            $days = 30;
            $periodLabel = '30d';
        }

        $curStartTs = strtotime("-{$days} days", $nowTs);
        $curStart = date('Y-m-d H:i:s', $curStartTs);
        $curEnd = date('Y-m-d H:i:s', $nowTs);
        $prevStartDefault = date('Y-m-d H:i:s', strtotime("-" . ($days * 2) . " days", $nowTs));
        $prevEndDefault = date('Y-m-d H:i:s', $curStartTs - 1);
    }
}

// Resolve Comparison Period (previous [default], custom, none)
$compareActive = false;
$compareMode = 'none';
$prevStart = null;
$prevEnd = null;

if ($compareModeParam === 'none' || $compareModeParam === 'off') {
    $compareActive = false;
    $compareMode = 'none';
} elseif ($compareModeParam === 'custom' || ($compareStartParam !== '' && $compareEndParam !== '')) {
    $cStartTs = strtotime($compareStartParam);
    $cEndTs = strtotime($compareEndParam);
    if ($compareStartParam !== '' && $compareEndParam !== '' && $cStartTs !== false && $cEndTs !== false && $cEndTs >= $cStartTs) {
        $compareActive = true;
        $compareMode = 'custom';
        $prevStart = date('Y-m-d 00:00:00', $cStartTs);
        $prevEnd = date('Y-m-d 23:59:59', $cEndTs);
    } elseif ($periodLabel !== 'all' && $prevStartDefault !== null && $prevEndDefault !== null) {
        $compareActive = true;
        $compareMode = 'previous';
        $prevStart = $prevStartDefault;
        $prevEnd = $prevEndDefault;
    }
} elseif ($periodLabel !== 'all' && $prevStartDefault !== null && $prevEndDefault !== null) {
    $compareActive = true;
    $compareMode = 'previous';
    $prevStart = $prevStartDefault;
    $prevEnd = $prevEndDefault;
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

// 6. Query 2: Comparison Period Baseline Aggregations
$prevTotal = 0;
$prevMentions = 0;
$prevVisible = 0;
$prevCited = 0;
$prevAvgEarly = 0.0;

if ($compareActive && $prevStart !== null && $prevEnd !== null) {
    $prevParams = array_merge($baseParams, [
        ':prev_start' => $prevStart,
        ':prev_end'   => $prevEnd,
    ]);
    $prevSql = "
        SELECT 
            COUNT(*) AS total_runs,
            SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions_count,
            SUM(CASE WHEN r.brand_mentioned = 1 OR r.brand_cited = 1 THEN 1 ELSE 0 END) AS visible_runs,
            SUM(CASE WHEN r.brand_cited = 1 THEN 1 ELSE 0 END) AS cited_runs,
            AVG(CASE WHEN r.brand_mentioned = 1 THEN r.relative_position_pct ELSE NULL END) AS avg_earliness
        FROM llm_runs r
        WHERE {$baseWhere}
          AND r.created_at >= :prev_start AND r.created_at <= :prev_end
    ";
    $stmtPrev = $db->prepare($prevSql);
    $stmtPrev->execute($prevParams);
    $prev = $stmtPrev->fetch() ?: [];
    $prevTotal = (int)($prev['total_runs'] ?? 0);
    $prevMentions = (int)($prev['mentions_count'] ?? 0);
    $prevVisible = (int)($prev['visible_runs'] ?? 0);
    $prevCited = (int)($prev['cited_runs'] ?? 0);
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

if ($compareActive && $prevTotal > 0) {
    $prevSom = round(($prevMentions / $prevTotal) * 100, 2);
    $prevVis = round(($prevVisible / $prevTotal) * 100, 1);
    $prevCit = round(($prevCited / $prevTotal) * 100, 1);
    $somDelta = round($somScore - $prevSom, 2);
    $visibilityDelta = round($visibilityIndex - $prevVis, 1);
    $earlinessDelta = round($curAvgEarly - $prevAvgEarly, 1);
    $citationDelta = round($citationShare - $prevCit, 1);
} else {
    $somDelta = null;
    $visibilityDelta = null;
    $earlinessDelta = null;
    $citationDelta = null;
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
            ROUND(SUM(CASE WHEN rc.mentioned = 1 THEN 1.0 ELSE 0.0 END) / :tot_runs * 100.0, 1) AS visibility_pct,
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

// 12. Query 5: Adaptive Primary & Comparison Timeline Data Points
$curDurationSec = max(0, strtotime($curEnd) - strtotime($curStart));
$granularity = ($curDurationSec <= 48 * 3600) ? 'hour' : 'day';

$timelineResult = ($curTotal > 0)
    ? fetchTimelineSeries($db, $baseWhere, $baseParams, $curStart, $curEnd, $granularity, $periodLabel === 'all')
    : ['points' => [], 'total_slots' => computeTimelineSlots($curStart, $curEnd, $granularity)];

$comparisonTimelineResult = ($compareActive && $prevTotal > 0 && $prevStart !== null && $prevEnd !== null)
    ? fetchTimelineSeries($db, $baseWhere, $baseParams, $prevStart, $prevEnd, $granularity, false)
    : ['points' => [], 'total_slots' => ($compareActive && $prevStart && $prevEnd ? computeTimelineSlots($prevStart, $prevEnd, $granularity) : 0)];

$timeline = $timelineResult['points'];
$comparisonTimeline = $comparisonTimelineResult['points'];
$totalSlots = max(
    1,
    (int)$timelineResult['total_slots'],
    (int)$comparisonTimelineResult['total_slots']
);

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
        'citation_delta'    => $citationDelta,
        'runs_delta'        => ($compareActive && $prevTotal > 0) ? ($curTotal - $prevTotal) : null,
        'previous_total'    => $compareActive ? $prevTotal : null,
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
    'timeline'            => $timeline,
    'comparison_timeline' => $comparisonTimeline,
    'date_range' => [
        'period'         => $periodLabel,
        'compare_mode'   => $compareMode,
        'granularity'    => $granularity,
        'total_slots'    => $totalSlots,
        'current_start'  => $curStart,
        'current_end'    => $curEnd,
        'previous_start' => $prevStart,
        'previous_end'   => $prevEnd,
    ],
    'is_audit_mode' => $isAuditMode,
], 200);

/**
 * Computes expected number of time buckets between start and end for a given granularity.
 */
function computeTimelineSlots(string $start, string $end, string $granularity): int
{
    $startTs = strtotime($start);
    $endTs = strtotime($end);
    if ($startTs === false || $endTs === false || $endTs < $startTs) {
        return 1;
    }

    if ($granularity === 'hour') {
        $aStart = strtotime(date('Y-m-d H:00:00', $startTs));
        $aEnd = strtotime(date('Y-m-d H:00:00', $endTs));
        return max(1, (int)round(($aEnd - $aStart) / 3600) + 1);
    }

    $aStart = strtotime(date('Y-m-d 00:00:00', $startTs));
    $aEnd = strtotime(date('Y-m-d 00:00:00', $endTs));
    return max(1, (int)round(($aEnd - $aStart) / 86400) + 1);
}

/**
 * Queries and normalizes hourly or daily aggregated metrics for a single period.
 * Uses floating-point literals (1.0 / 100.0) so SQLite and MySQL produce identical percentages.
 *
 * @return array{points: array<int, array<string, mixed>>, total_slots: int}
 */
function fetchTimelineSeries(
    PDO $db,
    string $baseWhere,
    array $baseParams,
    string $start,
    string $end,
    string $granularity,
    bool $anchorToFirstBucket = false
): array {
    $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    if ($granularity === 'hour') {
        $bucketExpr = ($driver === 'sqlite')
            ? "strftime('%Y-%m-%d %H:00:00', r.created_at)"
            : "DATE_FORMAT(r.created_at, '%Y-%m-%d %H:00:00')";
    } else {
        $bucketExpr = "DATE(r.created_at)";
    }

    $sql = "
        SELECT 
            {$bucketExpr} AS date_point,
            COUNT(*) AS total_runs,
            SUM(CASE WHEN r.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions,
            ROUND(SUM(CASE WHEN r.brand_mentioned = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0, 1) AS som_score,
            ROUND(SUM(CASE WHEN r.brand_mentioned = 1 OR r.brand_cited = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0, 1) AS visibility_index,
            ROUND(SUM(CASE WHEN r.brand_cited = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0, 1) AS citation_share,
            ROUND(AVG(CASE WHEN r.brand_mentioned = 1 THEN r.relative_position_pct ELSE NULL END), 1) AS avg_earliness,
            SUM(CASE WHEN r.mece_category = '1_DIRECT_WIN' THEN 1 ELSE 0 END) AS direct_wins
        FROM llm_runs r
        WHERE {$baseWhere}
          AND r.created_at >= :range_start AND r.created_at <= :range_end
        GROUP BY {$bucketExpr}
        ORDER BY date_point ASC
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute(array_merge($baseParams, [
        ':range_start' => $start,
        ':range_end'   => $end,
    ]));
    $rows = $stmt->fetchAll() ?: [];

    if (empty($rows)) {
        return [
            'points'      => [],
            'total_slots' => computeTimelineSlots($start, $end, $granularity),
        ];
    }

    $stepSeconds = ($granularity === 'hour') ? 3600 : 86400;
    $rawAnchorStart = ($anchorToFirstBucket && !empty($rows[0]['date_point']))
        ? (string)$rows[0]['date_point']
        : $start;
    $anchorTs = strtotime($rawAnchorStart);
    $alignedAnchorTs = ($granularity === 'hour')
        ? strtotime(date('Y-m-d H:00:00', $anchorTs))
        : strtotime(date('Y-m-d 00:00:00', $anchorTs));

    $effectiveEndTs = strtotime($end);
    $alignedEndTs = ($granularity === 'hour')
        ? strtotime(date('Y-m-d H:00:00', $effectiveEndTs))
        : strtotime(date('Y-m-d 00:00:00', $effectiveEndTs));

    $totalSlots = max(1, (int)round(($alignedEndTs - $alignedAnchorTs) / $stepSeconds) + 1);
    $points = [];

    foreach ($rows as $row) {
        $pointStr = (string)$row['date_point'];
        $pointTs = strtotime($pointStr);
        $alignedPointTs = ($granularity === 'hour')
            ? strtotime(date('Y-m-d H:00:00', $pointTs))
            : strtotime(date('Y-m-d 00:00:00', $pointTs));
        $slotIndex = max(0, (int)round(($alignedPointTs - $alignedAnchorTs) / $stepSeconds));

        $points[] = [
            'date_point'       => $pointStr,
            'slot_index'       => $slotIndex,
            'total_runs'       => (int)($row['total_runs'] ?? 0),
            'mentions'         => (int)($row['mentions'] ?? 0),
            'som_score'        => (float)($row['som_score'] ?? 0),
            'visibility_index' => (float)($row['visibility_index'] ?? 0),
            'citation_share'   => (float)($row['citation_share'] ?? 0),
            'avg_earliness'    => $row['avg_earliness'] !== null ? (float)$row['avg_earliness'] : null,
            'direct_wins'      => (int)($row['direct_wins'] ?? 0),
        ];
    }

    return [
        'points'      => $points,
        'total_slots' => $totalSlots,
    ];
}
