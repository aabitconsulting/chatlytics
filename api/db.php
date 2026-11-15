<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Thread-Safe Native PDO Database Singleton & Dynamic Per-User Table Helpers
 *
 * Implements strict UTF-8 connection caching, disabled emulated prepares,
 * non-persistent connection pooling (preventing FastCGI starvation),
 * exception-driven error handling, and per-user physical table provisioning
 * (`user_results_<user_id>`).
 */

require_once __DIR__ . '/bootstrap.php';

final class Database
{
    private static ?PDO $instance = null;

    /**
     * Private constructor to prevent direct instantiation.
     */
    private function __construct()
    {
    }

    /**
     * Private clone to prevent duplicating singleton.
     */
    private function __clone()
    {
    }

    /**
     * Retrieve or initialize the thread-safe PDO connection.
     *
     * @return PDO
     */
    public static function getConnection(): PDO
    {
        if (self::$instance === null) {
            $config = getConfig()['db'] ?? [];

            $host = (string)($config['host'] ?? '127.0.0.1');
            $port = (int)($config['port'] ?? 3306);
            $dbname = (string)($config['dbname'] ?? 'chatlytics_db');
            $charset = (string)($config['charset'] ?? 'utf8mb4');
            $username = (string)($config['username'] ?? 'chatlytics_user');
            $password = (string)($config['password'] ?? '');

            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                $host,
                $port,
                $dbname,
                $charset
            );

            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false, // Enforce native prepared statements (prevents SQL injection)
                PDO::ATTR_PERSISTENT => false,        // Avoid connection pool starvation on FastCGI / Plesk
            ];
            if (class_exists('Pdo\Mysql')) {
                $options[\Pdo\Mysql::ATTR_INIT_COMMAND] = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci";
            } elseif (defined('PDO::MYSQL_ATTR_INIT_COMMAND')) {
                $options[constant('PDO::MYSQL_ATTR_INIT_COMMAND')] = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci";
            }

            try {
                self::$instance = new PDO($dsn, $username, $password, $options);
            } catch (PDOException $e) {
                error_log("Database connection failure: " . $e->getMessage());
                jsonError("Database connection unavailable", 503);
            }
        }

        return self::$instance;
    }

    /**
     * Override or mock the PDO connection (useful for automated testing).
     *
     * @param PDO|null $pdo
     * @return void
     */
    public static function setConnection(?PDO $pdo): void
    {
        self::$instance = $pdo;
        if ($pdo !== null) {
            ensureCoreSchemaColumns($pdo);
        }
    }

    /**
     * Reset cached PDO connection.
     *
     * @return void
     */
    public static function resetConnection(): void
    {
        self::$instance = null;
    }
}

/**
 * Global helper function to retrieve active PDO database connection.
 *
 * @return PDO
 */
function getDb(): PDO
{
    return Database::getConnection();
}

/**
 * Returns the strictly sanitized physical table name for a user's LLM results.
 * Table name is deterministically formatted as `user_results_<positive_int>`
 * using integer casting so SQL injection is impossible.
 *
 * @param int $userId
 * @return string
 */
function getUserResultsTableName(int $userId): string
{
    $safeId = max(1, (int)$userId);
    return 'user_results_' . $safeId;
}

/**
 * Idempotently provisions the physical per-user result table `user_results_<user_id>`.
 * Must be called BEFORE starting a database transaction (`$db->beginTransaction()`)
 * because MySQL `CREATE TABLE IF NOT EXISTS` triggers an implicit commit.
 * Supports both MySQL 8.0+ / MariaDB and SQLite (for automated test suites).
 *
 * @param PDO $db
 * @param int $userId
 * @return string The provisioned table name
 */
function ensureUserResultsTable(PDO $db, int $userId): string
{
    $table = getUserResultsTableName($userId);
    try {
        $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    } catch (Throwable $e) {
        return $table;
    }

    if ($driver === 'sqlite') {
        $db->exec("
            CREATE TABLE IF NOT EXISTS `{$table}` (
                `id` INTEGER PRIMARY KEY AUTOINCREMENT,
                `run_id` INTEGER NULL DEFAULT NULL,
                `config_id` INTEGER NULL DEFAULT NULL,
                `custom_id` TEXT NULL DEFAULT NULL,
                `batch_id` TEXT NULL DEFAULT NULL,
                `execution_strategy` TEXT NOT NULL DEFAULT 'regular',
                `prompt_cache_key` TEXT NULL DEFAULT NULL,
                `input_tokens` INTEGER NOT NULL DEFAULT 0,
                `output_tokens` INTEGER NOT NULL DEFAULT 0,
                `cached_tokens` INTEGER NOT NULL DEFAULT 0,
                `trigger_source` TEXT NOT NULL DEFAULT 'batch_queue',
                `is_test_run` INTEGER NOT NULL DEFAULT 0,
                `prompt` TEXT NOT NULL,
                `market_region` TEXT NULL DEFAULT NULL,
                `prompt_language` TEXT NULL DEFAULT NULL,
                `effective_region` TEXT NULL DEFAULT NULL,
                `region_source` TEXT NULL DEFAULT NULL,
                `llm_answer` TEXT NULL DEFAULT NULL,
                `provider` TEXT NOT NULL,
                `model` TEXT NOT NULL,
                `brand_name` TEXT NOT NULL DEFAULT '',
                `status` TEXT NOT NULL DEFAULT 'completed',
                `brand_mentioned` INTEGER NOT NULL DEFAULT 0,
                `char_earliness` INTEGER NULL DEFAULT NULL,
                `word_earliness` INTEGER NULL DEFAULT NULL,
                `relative_position_pct` REAL NULL DEFAULT NULL,
                `total_chars` INTEGER NOT NULL DEFAULT 0,
                `total_words` INTEGER NOT NULL DEFAULT 0,
                `mece_category` TEXT NOT NULL DEFAULT '4_GENERIC',
                `geo_quadrant` TEXT NOT NULL DEFAULT 'NONE',
                `brand_cited` INTEGER NOT NULL DEFAULT 0,
                `competitor_cited` INTEGER NOT NULL DEFAULT 0,
                `regional_citation_count` INTEGER NOT NULL DEFAULT 0,
                `regional_citation_ratio` REAL NULL DEFAULT NULL,
                `competitors_json` TEXT NULL DEFAULT NULL,
                `citations_json` TEXT NULL DEFAULT NULL,
                `error_message` TEXT NULL DEFAULT NULL,
                `scheduled_at` DATETIME NULL DEFAULT NULL,
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ");
        $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS `idx_{$table}_custom_id` ON `{$table}` (`custom_id`) WHERE `custom_id` IS NOT NULL");
        $db->exec("CREATE INDEX IF NOT EXISTS `idx_{$table}_config_created` ON `{$table}` (`config_id`, `created_at`)");
        $db->exec("CREATE INDEX IF NOT EXISTS `idx_{$table}_model_created` ON `{$table}` (`provider`, `model`, `created_at`)");
        try {
            $urColsStmt = $db->query("PRAGMA table_info(`{$table}`)");
            $urCols = $urColsStmt ? array_column($urColsStmt->fetchAll(), 'name') : [];
            if (!empty($urCols)) {
                if (!in_array('input_tokens', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `input_tokens` INTEGER NOT NULL DEFAULT 0");
                }
                if (!in_array('output_tokens', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `output_tokens` INTEGER NOT NULL DEFAULT 0");
                }
                if (!in_array('market_region', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `market_region` TEXT NULL DEFAULT NULL");
                }
                if (!in_array('prompt_language', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `prompt_language` TEXT NULL DEFAULT NULL");
                }
                if (!in_array('effective_region', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `effective_region` TEXT NULL DEFAULT NULL");
                }
                if (!in_array('region_source', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `region_source` TEXT NULL DEFAULT NULL");
                }
                if (!in_array('regional_citation_count', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `regional_citation_count` INTEGER NOT NULL DEFAULT 0");
                }
                if (!in_array('regional_citation_ratio', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `regional_citation_ratio` REAL NULL DEFAULT NULL");
                }
            }
        } catch (Throwable $e) {
            // Ignore column upgrade failure on mock drivers
        }
    } else {
        $db->exec("
            CREATE TABLE IF NOT EXISTS `{$table}` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                `run_id` BIGINT UNSIGNED NULL DEFAULT NULL,
                `config_id` BIGINT UNSIGNED NULL DEFAULT NULL,
                `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
                `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `input_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
                `output_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
                `cached_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
                `trigger_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch_queue',
                `is_test_run` TINYINT(1) NOT NULL DEFAULT 0,
                `prompt` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
                `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `prompt_language` VARCHAR(16) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `effective_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `region_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `llm_answer` MEDIUMTEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                `model` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                `brand_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
                `status` ENUM('completed', 'failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
                `brand_mentioned` TINYINT(1) NOT NULL DEFAULT 0,
                `char_earliness` INT NULL DEFAULT NULL,
                `word_earliness` INT NULL DEFAULT NULL,
                `relative_position_pct` DECIMAL(5,2) NULL DEFAULT NULL,
                `total_chars` INT UNSIGNED NOT NULL DEFAULT 0,
                `total_words` INT UNSIGNED NOT NULL DEFAULT 0,
                `mece_category` ENUM('1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '4_GENERIC',
                `geo_quadrant` ENUM('1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NONE',
                `brand_cited` TINYINT(1) NOT NULL DEFAULT 0,
                `competitor_cited` TINYINT(1) NOT NULL DEFAULT 0,
                `regional_citation_count` INT UNSIGNED NOT NULL DEFAULT 0,
                `regional_citation_ratio` DECIMAL(5,2) NULL DEFAULT NULL,
                `competitors_json` JSON NULL DEFAULT NULL,
                `citations_json` JSON NULL DEFAULT NULL,
                `error_message` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `scheduled_at` TIMESTAMP NULL DEFAULT NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `idx_ur_custom_id` (`custom_id`),
                KEY `idx_ur_config_created` (`config_id`, `created_at`),
                KEY `idx_ur_model_created` (`provider`, `model`, `created_at`),
                KEY `idx_ur_mece` (`mece_category`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        try {
            $urColsStmt = $db->query("SHOW COLUMNS FROM `{$table}`");
            $urCols = $urColsStmt ? array_column($urColsStmt->fetchAll(), 'Field') : [];
            if (!empty($urCols)) {
                if (!in_array('input_tokens', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `input_tokens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `prompt_cache_key`");
                }
                if (!in_array('output_tokens', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `output_tokens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `input_tokens`");
                }
                if (!in_array('market_region', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt`");
                }
                if (!in_array('prompt_language', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `prompt_language` VARCHAR(16) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `market_region`");
                }
                if (!in_array('effective_region', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `effective_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt_language`");
                }
                if (!in_array('region_source', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `region_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `effective_region`");
                }
                if (!in_array('regional_citation_count', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `regional_citation_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `competitor_cited`");
                }
                if (!in_array('regional_citation_ratio', $urCols, true)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `regional_citation_ratio` DECIMAL(5,2) NULL DEFAULT NULL AFTER `regional_citation_count`");
                }
            }
        } catch (Throwable $e) {
            // Ignore column upgrade failure on mock drivers
        }
    }

    return $table;
}

/**
 * Inserts a single LLM flow result record into the user's physical table `user_results_<user_id>`.
 * Note: Call `ensureUserResultsTable($db, $userId)` BEFORE starting any enclosing transaction.
 *
 * @param PDO $db
 * @param int $userId
 * @param array<string, mixed> $row
 * @return int Inserted row ID
 */
function insertUserResultRow(PDO $db, int $userId, array $row): int
{
    $table = getUserResultsTableName($userId);

    $competitorsJson = $row['competitors_json'] ?? null;
    if (is_array($competitorsJson)) {
        $competitorsJson = json_encode($competitorsJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    $citationsJson = $row['citations_json'] ?? null;
    if (is_array($citationsJson)) {
        $citationsJson = json_encode($citationsJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    $strategy = (string)($row['execution_strategy'] ?? 'regular');
    if (!in_array($strategy, ['prompt_caching', 'batch_api', 'regular'], true)) {
        $strategy = 'regular';
    }

    $status = (string)($row['status'] ?? 'completed');
    if (!in_array($status, ['completed', 'failed'], true)) {
        $status = 'completed';
    }

    $createdAt = isset($row['created_at']) && is_string($row['created_at']) && trim($row['created_at']) !== ''
        ? trim($row['created_at'])
        : date('Y-m-d H:i:s');

    $sql = "
        INSERT INTO `{$table}` (
            `run_id`, `config_id`, `custom_id`, `batch_id`,
            `execution_strategy`, `prompt_cache_key`, `input_tokens`, `output_tokens`, `cached_tokens`,
            `trigger_source`, `is_test_run`,
            `prompt`, `market_region`, `prompt_language`, `effective_region`, `region_source`,
            `llm_answer`, `provider`, `model`, `brand_name`, `status`,
            `brand_mentioned`, `char_earliness`, `word_earliness`, `relative_position_pct`,
            `total_chars`, `total_words`, `mece_category`, `geo_quadrant`,
            `brand_cited`, `competitor_cited`, `regional_citation_count`, `regional_citation_ratio`,
            `competitors_json`, `citations_json`,
            `error_message`, `scheduled_at`, `created_at`
        ) VALUES (
            :run_id, :config_id, :custom_id, :batch_id,
            :execution_strategy, :prompt_cache_key, :input_tokens, :output_tokens, :cached_tokens,
            :trigger_source, :is_test_run,
            :prompt, :market_region, :prompt_language, :effective_region, :region_source,
            :llm_answer, :provider, :model, :brand_name, :status,
            :brand_mentioned, :char_earliness, :word_earliness, :relative_position_pct,
            :total_chars, :total_words, :mece_category, :geo_quadrant,
            :brand_cited, :competitor_cited, :regional_citation_count, :regional_citation_ratio,
            :competitors_json, :citations_json,
            :error_message, :scheduled_at, :created_at
        )
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':run_id'                => isset($row['run_id']) ? (int)$row['run_id'] : null,
        ':config_id'             => isset($row['config_id']) ? (int)$row['config_id'] : null,
        ':custom_id'             => isset($row['custom_id']) && $row['custom_id'] !== '' ? (string)$row['custom_id'] : null,
        ':batch_id'              => isset($row['batch_id']) && $row['batch_id'] !== '' ? (string)$row['batch_id'] : null,
        ':execution_strategy'    => $strategy,
        ':prompt_cache_key'      => isset($row['prompt_cache_key']) && $row['prompt_cache_key'] !== '' ? (string)$row['prompt_cache_key'] : null,
        ':input_tokens'          => max(0, (int)($row['input_tokens'] ?? 0)),
        ':output_tokens'         => max(0, (int)($row['output_tokens'] ?? 0)),
        ':cached_tokens'         => max(0, (int)($row['cached_tokens'] ?? 0)),
        ':trigger_source'        => (string)($row['trigger_source'] ?? 'batch_queue'),
        ':is_test_run'           => !empty($row['is_test_run']) ? 1 : 0,
        ':prompt'                  => (string)($row['prompt'] ?? ''),
        ':market_region'           => isset($row['market_region']) && trim((string)$row['market_region']) !== '' ? trim((string)$row['market_region']) : null,
        ':prompt_language'         => isset($row['prompt_language']) && trim((string)$row['prompt_language']) !== '' ? trim((string)$row['prompt_language']) : null,
        ':effective_region'        => isset($row['effective_region']) && trim((string)$row['effective_region']) !== '' ? trim((string)$row['effective_region']) : null,
        ':region_source'           => isset($row['region_source']) && trim((string)$row['region_source']) !== '' ? trim((string)$row['region_source']) : null,
        ':llm_answer'              => isset($row['llm_answer']) ? (string)$row['llm_answer'] : null,
        ':provider'                => (string)($row['provider'] ?? 'openai'),
        ':model'                   => (string)($row['model'] ?? ''),
        ':brand_name'              => (string)($row['brand_name'] ?? ''),
        ':status'                  => $status,
        ':brand_mentioned'         => !empty($row['brand_mentioned']) ? 1 : 0,
        ':char_earliness'          => isset($row['char_earliness']) && $row['char_earliness'] !== null ? (int)$row['char_earliness'] : null,
        ':word_earliness'          => isset($row['word_earliness']) && $row['word_earliness'] !== null ? (int)$row['word_earliness'] : null,
        ':relative_position_pct'   => isset($row['relative_position_pct']) && $row['relative_position_pct'] !== null ? (float)$row['relative_position_pct'] : null,
        ':total_chars'             => max(0, (int)($row['total_chars'] ?? 0)),
        ':total_words'             => max(0, (int)($row['total_words'] ?? 0)),
        ':mece_category'           => (string)($row['mece_category'] ?? '4_GENERIC'),
        ':geo_quadrant'            => (string)($row['geo_quadrant'] ?? 'NONE'),
        ':brand_cited'             => !empty($row['brand_cited']) ? 1 : 0,
        ':competitor_cited'        => !empty($row['competitor_cited']) ? 1 : 0,
        ':regional_citation_count' => max(0, (int)($row['regional_citation_count'] ?? 0)),
        ':regional_citation_ratio' => isset($row['regional_citation_ratio']) && $row['regional_citation_ratio'] !== null ? (float)$row['regional_citation_ratio'] : null,
        ':competitors_json'        => $competitorsJson,
        ':citations_json'        => $citationsJson,
        ':error_message'         => isset($row['error_message']) && $row['error_message'] !== '' ? (string)$row['error_message'] : null,
        ':scheduled_at'          => isset($row['scheduled_at']) && $row['scheduled_at'] !== '' ? (string)$row['scheduled_at'] : null,
        ':created_at'            => $createdAt,
    ]);

    return (int)$db->lastInsertId();
}

/**
 * Ensures the `batch_requests` correlation table and new columns on `tracking_configs`
 * and `llm_runs` exist. Particularly useful in SQLite-backed unit/integration tests
 * that construct minimal table schemas.
 *
 * @param PDO $db
 * @return void
 */
function ensureCoreSchemaColumns(PDO $db): void
{
    try {
        if ($db->inTransaction()) {
            return;
        }
        $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    } catch (\Throwable $e) {
        // Mocked / uninitialized PDO subclasses (unit tests) expose no driver: skip self-heal.
        return;
    }
    if ($driver === 'mysql') {
        try {
            $colCheck = $db->query("SHOW COLUMNS FROM `tracking_configs` LIKE 'preset_id'");
            if ($colCheck && $colCheck->fetch() === false) {
                $db->exec("ALTER TABLE `tracking_configs` ADD COLUMN `preset_id` VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `competitors`");
            }
        } catch (\Throwable $e) {
            // Ignore on empty / uninitialized MySQL DB
        }
        ensureAdminCatalogTables($db);
        return;
    }

    if ($driver === 'mysql') {
        if (!$db->inTransaction()) {
            try {
                $mysqlColumnPatches = [
                    'tracking_configs' => [
                        'market_region' => "ALTER TABLE `tracking_configs` ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `keywords_prompts`",
                    ],
                    'batch_requests' => [
                        'market_region'      => "ALTER TABLE `batch_requests` ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt`",
                        'supports_tools'     => "ALTER TABLE `batch_requests` ADD COLUMN `supports_tools` TINYINT(1) NOT NULL DEFAULT 1 AFTER `search_enabled`",
                        'last_polled_at'     => "ALTER TABLE `batch_requests` ADD COLUMN `last_polled_at` TIMESTAMP NULL DEFAULT NULL AFTER `submitted_at`",
                        'batch_error_detail' => "ALTER TABLE `batch_requests` ADD COLUMN `batch_error_detail` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `last_polled_at`",
                    ],
                    'llm_runs' => [
                        'market_region'           => "ALTER TABLE `llm_runs` ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt`",
                        'prompt_language'         => "ALTER TABLE `llm_runs` ADD COLUMN `prompt_language` VARCHAR(16) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `market_region`",
                        'effective_region'        => "ALTER TABLE `llm_runs` ADD COLUMN `effective_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt_language`",
                        'region_source'           => "ALTER TABLE `llm_runs` ADD COLUMN `region_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `effective_region`",
                        'regional_citation_count' => "ALTER TABLE `llm_runs` ADD COLUMN `regional_citation_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `competitor_cited`",
                        'regional_citation_ratio' => "ALTER TABLE `llm_runs` ADD COLUMN `regional_citation_ratio` DECIMAL(5,2) NULL DEFAULT NULL AFTER `regional_citation_count`",
                    ],
                    'run_citations' => [
                        'is_regional_tld' => "ALTER TABLE `run_citations` ADD COLUMN `is_regional_tld` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_competitor_domain`",
                    ],
                ];
                foreach ($mysqlColumnPatches as $tbl => $patches) {
                    $cStmt = $db->query("SHOW COLUMNS FROM `{$tbl}`");
                    $existingCols = $cStmt ? array_column($cStmt->fetchAll(), 'Field') : [];
                    if (!empty($existingCols)) {
                        foreach ($patches as $colName => $alterSql) {
                            if (!in_array($colName, $existingCols, true)) {
                                $db->exec($alterSql);
                            }
                        }
                    }
                }
            } catch (Throwable $e) {
                // Ignore schema inspection errors on limited privileges or mocks
            }
        }
        ensureAdminCatalogTables($db);
        return;
    }

    if ($driver !== 'sqlite') {
        return;
    }

    try {
        // 1. Ensure batch_requests table exists in SQLite
        $db->exec("
            CREATE TABLE IF NOT EXISTS `batch_requests` (
                `id` INTEGER PRIMARY KEY AUTOINCREMENT,
                `custom_id` TEXT UNIQUE NOT NULL,
                `prompt_cache_key` TEXT NULL DEFAULT NULL,
                `execution_strategy` TEXT NOT NULL DEFAULT 'regular',
                `provider_batch_id` TEXT NULL DEFAULT NULL,
                `run_id` INTEGER NULL DEFAULT NULL,
                `user_id` INTEGER NOT NULL,
                `config_id` INTEGER NOT NULL,
                `prompt` TEXT NOT NULL,
                `market_region` TEXT NULL DEFAULT NULL,
                `provider` TEXT NOT NULL,
                `model` TEXT NOT NULL,
                `brand_name` TEXT NOT NULL,
                `brand_domains` TEXT NOT NULL,
                `competitors` TEXT NOT NULL,
                `search_enabled` INTEGER NOT NULL DEFAULT 1,
                `supports_tools` INTEGER NOT NULL DEFAULT 1,
                `is_test_run` INTEGER NOT NULL DEFAULT 0,
                `status` TEXT NOT NULL DEFAULT 'queued',
                `scheduled_for` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `submitted_at` DATETIME NULL DEFAULT NULL,
                `last_polled_at` DATETIME NULL DEFAULT NULL,
                `batch_error_detail` TEXT NULL DEFAULT NULL,
                `completed_at` DATETIME NULL DEFAULT NULL,
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ");

        $brColsStmt = $db->query("PRAGMA table_info(batch_requests)");
        $brCols = $brColsStmt ? array_column($brColsStmt->fetchAll(), 'name') : [];
        if (!empty($brCols)) {
            if (!in_array('market_region', $brCols, true)) {
                $db->exec("ALTER TABLE batch_requests ADD COLUMN market_region TEXT NULL DEFAULT NULL");
            }
            if (!in_array('supports_tools', $brCols, true)) {
                $db->exec("ALTER TABLE batch_requests ADD COLUMN supports_tools INTEGER NOT NULL DEFAULT 1");
            }
            if (!in_array('last_polled_at', $brCols, true)) {
                $db->exec("ALTER TABLE batch_requests ADD COLUMN last_polled_at DATETIME NULL DEFAULT NULL");
            }
            if (!in_array('batch_error_detail', $brCols, true)) {
                $db->exec("ALTER TABLE batch_requests ADD COLUMN batch_error_detail TEXT NULL DEFAULT NULL");
            }
        }

        // 2. Check tracking_configs columns if table exists
        $tcColsStmt = $db->query("PRAGMA table_info(tracking_configs)");
        $tcCols = $tcColsStmt ? array_column($tcColsStmt->fetchAll(), 'name') : [];
        if (!empty($tcCols)) {
            if (!in_array('preset_id', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN preset_id TEXT NULL DEFAULT NULL");
            }
            if (!in_array('market_region', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN market_region TEXT NULL DEFAULT NULL");
            }
            if (!in_array('datasets_per_day', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN datasets_per_day INTEGER NOT NULL DEFAULT 12");
            }
            if (!in_array('initial_test_used', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN initial_test_used INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('full_started_at', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN full_started_at DATETIME NULL DEFAULT NULL");
            }
            if (!in_array('stopped_at', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN stopped_at DATETIME NULL DEFAULT NULL");
            }
            if (!in_array('archived_at', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN archived_at DATETIME NULL DEFAULT NULL");
            }
            if (!in_array('deleted_at', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL");
            }
        }

        // 3. Check llm_runs columns if table exists
        $lrColsStmt = $db->query("PRAGMA table_info(llm_runs)");
        $lrCols = $lrColsStmt ? array_column($lrColsStmt->fetchAll(), 'name') : [];
        if (!empty($lrCols)) {
            if (!in_array('custom_id', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN custom_id TEXT NULL DEFAULT NULL");
            }
            if (!in_array('batch_id', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN batch_id TEXT NULL DEFAULT NULL");
            }
            if (!in_array('execution_strategy', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN execution_strategy TEXT NOT NULL DEFAULT 'regular'");
            }
            if (!in_array('prompt_cache_key', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN prompt_cache_key TEXT NULL DEFAULT NULL");
            }
            if (!in_array('input_tokens', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('output_tokens', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('cached_tokens', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('is_test_run', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN is_test_run INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('market_region', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN market_region TEXT NULL DEFAULT NULL");
            }
            if (!in_array('prompt_language', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN prompt_language TEXT NULL DEFAULT NULL");
            }
            if (!in_array('effective_region', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN effective_region TEXT NULL DEFAULT NULL");
            }
            if (!in_array('region_source', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN region_source TEXT NULL DEFAULT NULL");
            }
            if (!in_array('regional_citation_count', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN regional_citation_count INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('regional_citation_ratio', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN regional_citation_ratio REAL NULL DEFAULT NULL");
            }
        }

        // 4. Check run_citations columns if table exists
        $rcColsStmt = $db->query("PRAGMA table_info(run_citations)");
        $rcCols = $rcColsStmt ? array_column($rcColsStmt->fetchAll(), 'name') : [];
        if (!empty($rcCols) && !in_array('is_regional_tld', $rcCols, true)) {
            $db->exec("ALTER TABLE run_citations ADD COLUMN is_regional_tld INTEGER NOT NULL DEFAULT 0");
        }
    } catch (Throwable $e) {
        // Ignore schema inspection errors on partial mock schemas
    }

    ensureAdminCatalogTables($db);
}

/**
 * Hard-purges configurations in 'deleted' state whose 90-day retention window has expired
 * (`deleted_at <= NOW() - 90 days`), along with their associated `user_results_<user_id>`,
 * `batch_requests`, and `llm_runs` rows.
 *
 * @param PDO $db
 * @return int Number of expired deleted configurations permanently purged
 */
function purgeExpiredDeletedConfigs(PDO $db): int
{
    try {
        if ($db->inTransaction()) {
            return 0;
        }
        // Only run when driver is known (skip uninitialized unit test mocks)
        $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
        if ($driver === '') {
            return 0;
        }
    } catch (Throwable $e) {
        return 0;
    }

    $purged = 0;
    try {
        $cutoff = date('Y-m-d H:i:s', time() - (90 * 86400));
        $stmt = $db->prepare("
            SELECT id, user_id
            FROM tracking_configs
            WHERE status = 'deleted'
              AND deleted_at IS NOT NULL
              AND deleted_at <= :cutoff
        ");
        $stmt->execute([':cutoff' => $cutoff]);
        $expired = $stmt->fetchAll();

        if (empty($expired)) {
            return 0;
        }

        foreach ($expired as $row) {
            $cfgId = (int)($row['id'] ?? 0);
            $uid = (int)($row['user_id'] ?? 0);
            if ($cfgId <= 0) {
                continue;
            }

            // 1. Delete matching rows from physical user_results_<user_id> table if it exists
            if ($uid > 0) {
                try {
                    $urTable = getUserResultsTableName($uid);
                    $delUr = $db->prepare("DELETE FROM `{$urTable}` WHERE config_id = :config_id");
                    $delUr->execute([':config_id' => $cfgId]);
                } catch (Throwable $urErr) {
                    // Table may not exist yet; ignore
                }
            }

            // 2. Delete pending/historical batch_requests for this config
            try {
                $delBr = $db->prepare("DELETE FROM batch_requests WHERE config_id = :config_id");
                $delBr->execute([':config_id' => $cfgId]);
            } catch (Throwable $brErr) {
                // Ignore if batch_requests table is absent
            }

            // 3. Delete child llm_runs explicitly (in case SQLite foreign_keys PRAGMA is off)
            try {
                $delRuns = $db->prepare("DELETE FROM llm_runs WHERE config_id = :config_id");
                $delRuns->execute([':config_id' => $cfgId]);
            } catch (Throwable $runErr) {
                // Ignore
            }

            // 4. Hard-delete the tracking_configs record
            $delCfg = $db->prepare("DELETE FROM tracking_configs WHERE id = :id");
            $delCfg->execute([':id' => $cfgId]);
            if ($delCfg->rowCount() > 0) {
                $purged++;
            }
        }
    } catch (Throwable $e) {
        // Ignore on partial mock schemas that do not have deleted_at column
    }

    return $purged;
}


/**
 * Decodes a JSON column value safely into an array of strings or fallback.
 *
 * @param mixed $raw
 * @param array $fallback
 * @return array
 */
function decodeCatalogJsonArray(mixed $raw, array $fallback = []): array
{
    if (is_array($raw)) {
        return array_values($raw);
    }
    if (!is_string($raw) || trim($raw) === '') {
        return $fallback;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? array_values($decoded) : $fallback;
}

/**
 * Returns default managed LLM models seeded into `llm_models`.
 *
 * @return array<int, array<string, mixed>>
 */
function getDefaultLlmModelsSeed(): array
{
    return [
        [
            'id'                  => 'openai/gpt-6-luna',
            'provider'            => 'openai',
            'model_name'          => 'gpt-6-luna',
            'display_name'        => 'OpenAI · GPT-6 Luna',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 10,
        ],
        [
            'id'                  => 'google/gemini-3.5-flash',
            'provider'            => 'google',
            'model_name'          => 'gemini-3.5-flash',
            'display_name'        => 'Google · Gemini 3.5 Flash',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 20,
        ],
        [
            'id'                  => 'mistralai/mistral-medium-3-5',
            'provider'            => 'mistralai',
            'model_name'          => 'mistral-medium-3-5',
            'display_name'        => 'Mistral · Medium 3.5',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 30,
        ],
        [
            'id'                  => 'mistralai/mistral-large-4-0',
            'provider'            => 'mistralai',
            'model_name'          => 'mistral-large-4-0',
            'display_name'        => 'Mistral · Large 4.0',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => false,
            'supports_tools'      => true,
            'execution_strategy'  => 'regular',
            'is_allowed'          => true,
            'is_default'          => false,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 40,
        ],
        [
            'id'                  => 'z-ai/glm-5.3',
            'provider'            => 'z-ai',
            'model_name'          => 'glm-5.3',
            'display_name'        => 'Z.ai · GLM 5.3',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 50,
        ],
        [
            'id'                  => 'z-ai/glm-5.3-flash',
            'provider'            => 'z-ai',
            'model_name'          => 'glm-5.3-flash',
            'display_name'        => 'Z.ai · GLM 5.3 Flash',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => false,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 60,
        ],
        [
            'id'                  => 'anthropic/claude-sonnet-5.5',
            'provider'            => 'anthropic',
            'model_name'          => 'claude-sonnet-5.5',
            'display_name'        => 'Anthropic · Claude Sonnet 5.5',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'supports_batch_api'  => true,
            'supports_tools'      => true,
            'execution_strategy'  => 'batch_api',
            'is_allowed'          => true,
            'is_default'          => false,
            'n8n_credential_name' => 'OpenRouter - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 70,
        ],
    ];
}

/**
 * Returns default curated Analyse-Sets (Model Presets) seeded into `model_presets`.
 *
 * @return array<int, array<string, mixed>>
 */
function getDefaultModelPresetsSeed(): array
{
    return [
        [
            'id'             => 'dach_core_baseline',
            'name_de'        => 'Basis-Radar (Live-Suche)',
            'name_en'        => 'Core Radar (Live Search)',
            'description_de' => 'Direktvergleich über OpenAI GPT-6 Luna und Google Gemini 3.5 Flash via OpenRouter inkl. Live-Websuche & Quellenzitaten.',
            'description_en' => 'Head-to-head benchmark across OpenAI GPT-6 Luna and Google Gemini 3.5 Flash via OpenRouter with live web search & citations.',
            'badge_de'       => 'Standard',
            'badge_en'       => 'Default',
            'target_llms'    => ['openai/gpt-6-luna', 'google/gemini-3.5-flash'],
            'search_enabled' => true,
            'allowed_tiers'  => ['free', 'starter', 'growth', 'enterprise_managed'],
            'is_default'     => true,
            'is_active'      => true,
            'sort_order'     => 10,
        ],
        [
            'id'             => 'parametric_brand_memory',
            'name_de'        => 'Parametrisches Marken-Gedächtnis (Batch / Ohne Websuche)',
            'name_en'        => 'Parametric Brand Memory (Batch / No Web Search)',
            'description_de' => 'Prüft das reine Modellwissen über OpenAI, Google Gemini und Mistral via OpenRouter Batch-API ohne Live-Suchergebnisse.',
            'description_en' => 'Evaluates pure parametric training memory across OpenAI, Google Gemini, and Mistral via OpenRouter Batch API without live web search.',
            'badge_de'       => 'Batch-API',
            'badge_en'       => 'Batch API',
            'target_llms'    => ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-medium-3-5'],
            'search_enabled' => false,
            'allowed_tiers'  => ['starter', 'growth', 'enterprise_managed'],
            'is_default'     => false,
            'is_active'      => true,
            'sort_order'     => 20,
        ],
        [
            'id'             => 'eu_sovereign_dsgvo',
            'name_de'        => 'Europäisches & GLM Benchmark-Set (Mistral & GLM)',
            'name_en'        => 'European & GLM Benchmark Suite (Mistral & GLM)',
            'description_de' => 'Vergleich führender europäischer und globaler Sprachmodelle via OpenRouter (Mistral Medium 3.5, Mistral Large 4.0 & Z.ai GLM 5.3).',
            'description_en' => 'Benchmark across Mistral Medium 3.5, Mistral Large 4.0 & Z.ai GLM 5.3 via OpenRouter.',
            'badge_de'       => 'OpenRouter',
            'badge_en'       => 'OpenRouter',
            'target_llms'    => ['mistralai/mistral-medium-3-5', 'mistralai/mistral-large-4-0', 'z-ai/glm-5.3'],
            'search_enabled' => false,
            'allowed_tiers'  => ['starter', 'growth', 'enterprise_managed'],
            'is_default'     => false,
            'is_active'      => true,
            'sort_order'     => 30,
        ],
        [
            'id'             => 'executive_full_spectrum',
            'name_de'        => '360° Vorstands-Benchmark (Alle Kernmodelle + Suche)',
            'name_en'        => '360° Executive Benchmark (All Core Models + Search)',
            'description_de' => 'Umfassende Multi-LLM-Abdeckung über führende Frontier- und Open-Weights-Modelle via OpenRouter mit Live-Websuche.',
            'description_en' => 'Complete multi-LLM coverage combining frontier and open-weights models via OpenRouter with live web search.',
            'badge_de'       => 'Vollabdeckung',
            'badge_en'       => 'Full Coverage',
            'target_llms'    => ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-medium-3-5', 'z-ai/glm-5.3'],
            'search_enabled' => true,
            'allowed_tiers'  => ['starter', 'growth', 'enterprise_managed'],
            'is_default'     => false,
            'is_active'      => true,
            'sort_order'     => 40,
        ],
    ];
}

/**
 * Returns default subscription plan configurations & Stripe mappings seeded into `subscription_plans`.
 *
 * @return array<int, array<string, mixed>>
 */
function getDefaultSubscriptionPlansSeed(): array
{
    return [
        [
            'tier'                       => 'free',
            'name_de'                    => 'Free',
            'name_en'                    => 'Free',
            'subtitle_de'                => 'Für den ersten Realitätscheck Ihrer Marke.',
            'subtitle_en'                => 'For your brand\'s initial reality check.',
            'price_eur'                  => 0,
            'price_label_de'             => '0 €',
            'price_label_en'             => '€0',
            'billing_period_de'          => 'einmalig',
            'billing_period_en'          => 'one-time',
            'stripe_product_id'          => '',
            'stripe_price_id'            => '',
            'stripe_checkout_url'        => '',
            'included_credits'           => 40,
            'max_configs'                => 3,
            'max_competitors_per_config' => 5,
            'max_prompts_per_config'     => 10,
            'allowed_intervals'          => ['every_120m'],
            'allow_custom_models'        => false,
            'allowed_preset_ids'         => ['dach_core_baseline'],
            'features_de'                => [
                '40 Live-Abfragen (Lifetime)',
                'Bis zu 3 Marken-Profile (Standard)',
                'Basis Analyse-Set: Basis-Radar inkl. Live-Websuche',
                'Basis-Ergebnis nach Empfehlungs-Stufen',
                'Zugang über geschäftliche E-Mail-Adresse',
            ],
            'features_en'                => [
                '40 live queries (Lifetime)',
                'Up to 3 brand profiles (default)',
                'Core Model Preset: Core Radar incl. live web search',
                'Basic visibility rating by recommendation tiers',
                'Access via business email address',
            ],
            'sort_order'                 => 10,
        ],
        [
            'tier'                       => 'starter',
            'name_de'                    => 'Starter',
            'name_en'                    => 'Starter',
            'subtitle_de'                => 'Für wachsende Marken und SEO-/Content-Teams.',
            'subtitle_en'                => 'For growing brands and SEO/Content teams.',
            'price_eur'                  => 149,
            'price_label_de'             => '149 €',
            'price_label_en'             => '€149',
            'billing_period_de'          => '/ Monat',
            'billing_period_en'          => '/ month',
            'stripe_product_id'          => 'prod_starter_chatlytics',
            'stripe_price_id'            => 'price_starter_monthly_eur149',
            'stripe_checkout_url'        => '',
            'included_credits'           => 500,
            'max_configs'                => 5,
            'max_competitors_per_config' => 5,
            'max_prompts_per_config'     => 15,
            'allowed_intervals'          => ['every_120m', 'every_60m', 'every_30m', 'every_15m'],
            'allow_custom_models'        => false,
            'allowed_preset_ids'         => ['dach_core_baseline', 'parametric_brand_memory', 'eu_sovereign_dsgvo', 'executive_full_spectrum'],
            'features_de'                => [
                '500 Live-Abfragen pro Monat',
                'Bis zu 5 Marken-Profile oder Produktlinien',
                'Bis zu 5 Wettbewerber pro Profil',
                'Alle kuratierten Analyse-Sets (Parametrisch Batch, Mistral/GLM & 360° Benchmark)',
                'Volle Ursachen- & Maßnahmen-Matrix',
                'CSV-/JSON-Export für eigenes Reporting',
            ],
            'features_en'                => [
                '500 live queries per month',
                'Up to 5 brand profiles or product lines',
                'Up to 5 competitors per profile',
                'All curated Model Presets (Parametric Batch, Mistral/GLM & 360° Benchmark)',
                'Full cause & action matrix',
                'CSV / JSON export for custom reporting',
            ],
            'sort_order'                 => 20,
        ],
        [
            'tier'                       => 'growth',
            'name_de'                    => 'Growth',
            'name_en'                    => 'Growth',
            'subtitle_de'                => 'Für ambitionierte D2C-Brands und B2B-Teams.',
            'subtitle_en'                => 'For ambitious D2C brands and B2B teams.',
            'price_eur'                  => 399,
            'price_label_de'             => '399 €',
            'price_label_en'             => '€399',
            'billing_period_de'          => '/ Monat',
            'billing_period_en'          => '/ month',
            'stripe_product_id'          => 'prod_growth_chatlytics',
            'stripe_price_id'            => 'price_growth_monthly_eur399',
            'stripe_checkout_url'        => '',
            'included_credits'           => 2000,
            'max_configs'                => 10,
            'max_competitors_per_config' => 10,
            'max_prompts_per_config'     => 25,
            'allowed_intervals'          => ['every_120m', 'every_60m', 'every_30m', 'every_15m'],
            'allow_custom_models'        => true,
            'allowed_preset_ids'         => ['dach_core_baseline', 'parametric_brand_memory', 'eu_sovereign_dsgvo', 'executive_full_spectrum'],
            'features_de'                => [
                '2.000 Live-Abfragen pro Monat',
                '10 Marken-Profile / Märkte',
                'Bis zu 10 Wettbewerber pro Profil',
                'Freie Modellwahl & Websuche-Steuerung (alle OpenRouter-Modelle & Analyse-Sets)',
                'Schreibgeschützte Vorstandsreports per Link',
                'Historischer Sichtbarkeits-Trend über alle Modelle',
                'Priorisierte Content- & Schema.org-Maßnahmen',
            ],
            'features_en'                => [
                '2,000 live queries per month',
                '10 brand profiles / markets',
                'Up to 10 competitors per profile',
                'Free custom model & web-search control (all OpenRouter models & Model Presets)',
                'Read-only executive reports via shareable link',
                'Historical visibility trends across all models',
                'Prioritized content & Schema.org actions',
            ],
            'sort_order'                 => 30,
        ],
        [
            'tier'                       => 'enterprise_managed',
            'name_de'                    => 'Managed GEO & Pipeline Defense',
            'name_en'                    => 'Managed GEO & Pipeline Defense',
            'subtitle_de'                => 'Wir finden nicht nur Lücken — wir schließen sie gemeinsam mit Ihrem Team.',
            'subtitle_en'                => 'We do not just find gaps — we close them together with your team.',
            'price_eur'                  => 1950,
            'price_label_de'             => '1.950 €+',
            'price_label_en'             => '€1,950+',
            'billing_period_de'          => '/ Monat',
            'billing_period_en'          => '/ month',
            'stripe_product_id'          => 'prod_enterprise_chatlytics',
            'stripe_price_id'            => 'price_enterprise_monthly_eur1950',
            'stripe_checkout_url'        => '',
            'included_credits'           => 10000,
            'max_configs'                => 100,
            'max_competitors_per_config' => 25,
            'max_prompts_per_config'     => 100,
            'allowed_intervals'          => ['every_120m', 'every_60m', 'every_30m', 'every_15m'],
            'allow_custom_models'        => true,
            'allowed_preset_ids'         => ['dach_core_baseline', 'parametric_brand_memory', 'eu_sovereign_dsgvo', 'executive_full_spectrum'],
            'features_de'                => [
                '10.000+ Live-Abfragen pro Monat (Multi-Region)',
                'Unbegrenzte freie Modellwahl & individuelle Analyse-Sets',
                'Monatlicher Editorial- & Schema.org-Umsetzungsplan',
                'Direkte Content-Optimierung gegen gekaperte Vorlagen',
                'Quartalsweises Executive Briefing mit Geschäftsführung & dedizierter GEO-Stratege',
            ],
            'features_en'                => [
                '10,000+ live queries per month (Multi-Region)',
                'Unlimited custom model control & bespoke Model Presets',
                'Monthly editorial & Schema.org implementation plan',
                'Direct content optimization against hijacked prompts',
                'Quarterly executive briefing & dedicated GEO strategist',
            ],
            'sort_order'                 => 40,
        ],
    ];
}

/**
 * Ensures `llm_models`, `model_presets`, and `subscription_plans` exist and are seeded idempotently.
 */
function ensureAdminCatalogTables(PDO $db): void
{
    try {
        if ($db->inTransaction()) {
            return;
        }
        $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
        if ($driver !== 'sqlite' && $driver !== 'mysql') {
            return;
        }

        if ($driver === 'sqlite') {
            $db->exec("
                CREATE TABLE IF NOT EXISTS `llm_models` (
                    `id` TEXT PRIMARY KEY,
                    `provider` TEXT NOT NULL,
                    `model_name` TEXT NOT NULL,
                    `display_name` TEXT NOT NULL,
                    `eu_hosted` INTEGER NOT NULL DEFAULT 0,
                    `supports_web_search` INTEGER NOT NULL DEFAULT 0,
                    `supports_batch_api` INTEGER NOT NULL DEFAULT 0,
                    `supports_tools` INTEGER NOT NULL DEFAULT 1,
                    `execution_strategy` TEXT NOT NULL DEFAULT 'batch_api',
                    `is_allowed` INTEGER NOT NULL DEFAULT 1,
                    `is_default` INTEGER NOT NULL DEFAULT 0,
                    `n8n_credential_name` TEXT NULL DEFAULT NULL,
                    `n8n_sync_status` TEXT NOT NULL DEFAULT 'seeded',
                    `last_synced_at` DATETIME NULL DEFAULT NULL,
                    `sort_order` INTEGER NOT NULL DEFAULT 100,
                    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `model_presets` (
                    `id` TEXT PRIMARY KEY,
                    `name_de` TEXT NOT NULL,
                    `name_en` TEXT NOT NULL,
                    `description_de` TEXT NOT NULL,
                    `description_en` TEXT NOT NULL,
                    `badge_de` TEXT NULL DEFAULT NULL,
                    `badge_en` TEXT NULL DEFAULT NULL,
                    `target_llms` TEXT NOT NULL,
                    `search_enabled` INTEGER NOT NULL DEFAULT 1,
                    `allowed_tiers` TEXT NOT NULL,
                    `is_default` INTEGER NOT NULL DEFAULT 0,
                    `is_active` INTEGER NOT NULL DEFAULT 1,
                    `sort_order` INTEGER NOT NULL DEFAULT 100,
                    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `subscription_plans` (
                    `tier` TEXT PRIMARY KEY,
                    `name_de` TEXT NOT NULL,
                    `name_en` TEXT NOT NULL,
                    `subtitle_de` TEXT NOT NULL,
                    `subtitle_en` TEXT NOT NULL,
                    `price_eur` INTEGER NOT NULL DEFAULT 0,
                    `price_label_de` TEXT NOT NULL DEFAULT '0 €',
                    `price_label_en` TEXT NOT NULL DEFAULT '€0',
                    `billing_period_de` TEXT NOT NULL DEFAULT '/ Monat',
                    `billing_period_en` TEXT NOT NULL DEFAULT '/ month',
                    `stripe_product_id` TEXT NULL DEFAULT NULL,
                    `stripe_price_id` TEXT NULL DEFAULT NULL,
                    `stripe_checkout_url` TEXT NULL DEFAULT NULL,
                    `included_credits` INTEGER NOT NULL DEFAULT 40,
                    `max_configs` INTEGER NOT NULL DEFAULT 1,
                    `max_competitors_per_config` INTEGER NOT NULL DEFAULT 2,
                    `max_prompts_per_config` INTEGER NOT NULL DEFAULT 5,
                    `allowed_intervals` TEXT NOT NULL,
                    `allow_custom_models` INTEGER NOT NULL DEFAULT 0,
                    `allowed_preset_ids` TEXT NOT NULL,
                    `features_de` TEXT NOT NULL,
                    `features_en` TEXT NOT NULL,
                    `sort_order` INTEGER NOT NULL DEFAULT 10,
                    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `openrouter_providers` (
                    `provider_key` TEXT PRIMARY KEY,
                    `display_name` TEXT NOT NULL,
                    `is_relevant` INTEGER NOT NULL DEFAULT 0,
                    `is_default` INTEGER NOT NULL DEFAULT 0,
                    `discovered_model_count` INTEGER NOT NULL DEFAULT 0,
                    `sample_models` TEXT NULL DEFAULT NULL,
                    `last_discovered_at` DATETIME NULL DEFAULT NULL,
                    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");
        } else {
            $db->exec("
                CREATE TABLE IF NOT EXISTS `llm_models` (
                    `id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `model_name` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `display_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `eu_hosted` TINYINT(1) NOT NULL DEFAULT 0,
                    `supports_web_search` TINYINT(1) NOT NULL DEFAULT 0,
                    `supports_batch_api` TINYINT(1) NOT NULL DEFAULT 0,
                    `supports_tools` TINYINT(1) NOT NULL DEFAULT 1,
                    `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch_api',
                    `is_allowed` TINYINT(1) NOT NULL DEFAULT 1,
                    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
                    `n8n_credential_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `n8n_sync_status` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'seeded',
                    `last_synced_at` TIMESTAMP NULL DEFAULT NULL,
                    `sort_order` INT NOT NULL DEFAULT 100,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    KEY `idx_lm_provider_allowed` (`provider`, `is_allowed`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `model_presets` (
                    `id` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `name_de` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `name_en` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `description_de` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
                    `description_en` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
                    `badge_de` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `badge_en` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `target_llms` JSON NOT NULL,
                    `search_enabled` TINYINT(1) NOT NULL DEFAULT 1,
                    `allowed_tiers` JSON NOT NULL,
                    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
                    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
                    `sort_order` INT NOT NULL DEFAULT 100,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `subscription_plans` (
                    `tier` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `name_de` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `name_en` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `subtitle_de` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `subtitle_en` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `price_eur` INT NOT NULL DEFAULT 0,
                    `price_label_de` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0 €',
                    `price_label_en` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '€0',
                    `billing_period_de` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '/ Monat',
                    `billing_period_en` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '/ month',
                    `stripe_product_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `stripe_price_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `stripe_checkout_url` VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                    `included_credits` INT NOT NULL DEFAULT 40,
                    `max_configs` INT NOT NULL DEFAULT 1,
                    `max_competitors_per_config` INT NOT NULL DEFAULT 2,
                    `max_prompts_per_config` INT NOT NULL DEFAULT 5,
                    `allowed_intervals` JSON NOT NULL,
                    `allow_custom_models` TINYINT(1) NOT NULL DEFAULT 0,
                    `allowed_preset_ids` JSON NOT NULL,
                    `features_de` JSON NOT NULL,
                    `features_en` JSON NOT NULL,
                    `sort_order` INT NOT NULL DEFAULT 10,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`tier`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
            $db->exec("
                CREATE TABLE IF NOT EXISTS `openrouter_providers` (
                    `provider_key` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `display_name` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `is_relevant` TINYINT(1) NOT NULL DEFAULT 0,
                    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
                    `discovered_model_count` INT NOT NULL DEFAULT 0,
                    `sample_models` JSON NULL,
                    `last_discovered_at` TIMESTAMP NULL DEFAULT NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`provider_key`),
                    KEY `idx_op_relevant` (`is_relevant`, `provider_key`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
        }

        // Upgrade existing llm_models schema idempotently
        if ($driver === 'sqlite') {
            $lmColsStmt = $db->query("PRAGMA table_info(llm_models)");
            $lmCols = $lmColsStmt ? array_column($lmColsStmt->fetchAll(), 'name') : [];
            if (!empty($lmCols)) {
                if (!in_array('supports_batch_api', $lmCols, true)) {
                    $db->exec("ALTER TABLE llm_models ADD COLUMN supports_batch_api INTEGER NOT NULL DEFAULT 0");
                }
                if (!in_array('supports_tools', $lmCols, true)) {
                    $db->exec("ALTER TABLE llm_models ADD COLUMN supports_tools INTEGER NOT NULL DEFAULT 1");
                }
            }
        } else {
            $lmColsStmt = $db->query("SHOW COLUMNS FROM `llm_models`");
            $lmCols = $lmColsStmt ? array_column($lmColsStmt->fetchAll(), 'Field') : [];
            if (!empty($lmCols)) {
                if (!in_array('supports_batch_api', $lmCols, true)) {
                    $db->exec("ALTER TABLE `llm_models` ADD COLUMN `supports_batch_api` TINYINT(1) NOT NULL DEFAULT 0 AFTER `supports_web_search`");
                }
                if (!in_array('supports_tools', $lmCols, true)) {
                    $db->exec("ALTER TABLE `llm_models` ADD COLUMN `supports_tools` TINYINT(1) NOT NULL DEFAULT 1 AFTER `supports_batch_api`");
                }
            }
        }

        // Seed default models when table is empty
        $mCount = (int)$db->query("SELECT COUNT(*) FROM llm_models")->fetchColumn();
        if ($mCount === 0) {
            foreach (getDefaultLlmModelsSeed() as $modelSeed) {
                upsertLlmModel($db, $modelSeed, false);
            }
        }

        // Seed default presets when table is empty
        $pCount = (int)$db->query("SELECT COUNT(*) FROM model_presets")->fetchColumn();
        if ($pCount === 0) {
            foreach (getDefaultModelPresetsSeed() as $presetSeed) {
                upsertModelPreset($db, $presetSeed);
            }
        }

        // Seed default subscription plans when table is empty
        $sCount = (int)$db->query("SELECT COUNT(*) FROM subscription_plans")->fetchColumn();
        if ($sCount === 0) {
            foreach (getDefaultSubscriptionPlansSeed() as $planSeed) {
                upsertSubscriptionPlan($db, $planSeed);
            }
        }

        // Seed default OpenRouter relevant providers when table is empty
        $opCount = (int)$db->query("SELECT COUNT(*) FROM openrouter_providers")->fetchColumn();
        if ($opCount === 0) {
            foreach (getDefaultOpenRouterProvidersSeed() as $provSeed) {
                upsertOpenRouterProvider($db, $provSeed, false);
            }
        }
    } catch (\Throwable $e) {
        // Ignore on partial test schemas without write permissions or minimal mocks
    }
}

/**
 * Formats a database row or seed definition for `llm_models`.
 */
function formatLlmModelRow(array $row): array
{
    $supportsBatch = !empty($row['supports_batch_api']);
    $supportsTools = !array_key_exists('supports_tools', $row) || !empty($row['supports_tools']);
    $strategy = (string)($row['execution_strategy'] ?? ($supportsBatch ? 'batch_api' : 'regular'));
    if ($strategy === 'prompt_caching' || !in_array($strategy, ['batch_api', 'regular'], true)) {
        $strategy = $supportsBatch ? 'batch_api' : 'regular';
    }
    return [
        'id'                  => (string)($row['id'] ?? ''),
        'provider'            => strtolower((string)($row['provider'] ?? 'openai')),
        'model_name'          => (string)($row['model_name'] ?? ''),
        'display_name'        => (string)($row['display_name'] ?? ''),
        'eu_hosted'           => !empty($row['eu_hosted']),
        'supports_web_search' => !empty($row['supports_web_search']),
        'supports_batch_api'  => $supportsBatch,
        'supports_tools'      => $supportsTools,
        'execution_strategy'  => $strategy,
        'is_allowed'          => !isset($row['is_allowed']) || !empty($row['is_allowed']),
        'is_default'          => !empty($row['is_default']),
        'n8n_credential_name' => $row['n8n_credential_name'] ?? null,
        'n8n_sync_status'     => (string)($row['n8n_sync_status'] ?? 'seeded'),
        'last_synced_at'      => $row['last_synced_at'] ?? null,
        'sort_order'          => (int)($row['sort_order'] ?? 100),
    ];
}

/**
 * Formats a database row or seed definition for `model_presets`.
 */
function formatModelPresetRow(array $row): array
{
    return [
        'id'             => (string)($row['id'] ?? ''),
        'name_de'        => (string)($row['name_de'] ?? ''),
        'name_en'        => (string)($row['name_en'] ?? ''),
        'description_de' => (string)($row['description_de'] ?? ''),
        'description_en' => (string)($row['description_en'] ?? ''),
        'badge_de'       => $row['badge_de'] !== null ? (string)$row['badge_de'] : null,
        'badge_en'       => $row['badge_en'] !== null ? (string)$row['badge_en'] : null,
        'target_llms'    => decodeCatalogJsonArray($row['target_llms'] ?? [], []),
        'search_enabled' => !empty($row['search_enabled']),
        'allowed_tiers'  => decodeCatalogJsonArray($row['allowed_tiers'] ?? [], ['starter', 'growth', 'enterprise_managed']),
        'is_default'     => !empty($row['is_default']),
        'is_active'      => !isset($row['is_active']) || !empty($row['is_active']),
        'sort_order'     => (int)($row['sort_order'] ?? 100),
    ];
}

/**
 * Formats a database row or seed definition for `subscription_plans`.
 */
function formatSubscriptionPlanRow(array $row): array
{
    return [
        'tier'                       => (string)($row['tier'] ?? 'free'),
        'name_de'                    => (string)($row['name_de'] ?? ''),
        'name_en'                    => (string)($row['name_en'] ?? ''),
        'subtitle_de'                => (string)($row['subtitle_de'] ?? ''),
        'subtitle_en'                => (string)($row['subtitle_en'] ?? ''),
        'price_eur'                  => (int)($row['price_eur'] ?? 0),
        'price_label_de'             => (string)($row['price_label_de'] ?? '0 €'),
        'price_label_en'             => (string)($row['price_label_en'] ?? '€0'),
        'billing_period_de'          => (string)($row['billing_period_de'] ?? '/ Monat'),
        'billing_period_en'          => (string)($row['billing_period_en'] ?? '/ month'),
        'stripe_product_id'          => (string)($row['stripe_product_id'] ?? ''),
        'stripe_price_id'            => (string)($row['stripe_price_id'] ?? ''),
        'stripe_checkout_url'        => (string)($row['stripe_checkout_url'] ?? ''),
        'included_credits'           => max(0, (int)($row['included_credits'] ?? 0)),
        'max_configs'                => max(1, (int)($row['max_configs'] ?? 1)),
        'max_competitors_per_config' => max(1, (int)($row['max_competitors_per_config'] ?? 2)),
        'max_prompts_per_config'     => max(1, (int)($row['max_prompts_per_config'] ?? 5)),
        'allowed_intervals'          => decodeCatalogJsonArray($row['allowed_intervals'] ?? [], ['every_120m']),
        'allow_custom_models'        => !empty($row['allow_custom_models']),
        'allowed_preset_ids'         => decodeCatalogJsonArray($row['allowed_preset_ids'] ?? [], ['dach_core_baseline']),
        'features_de'                => decodeCatalogJsonArray($row['features_de'] ?? [], []),
        'features_en'                => decodeCatalogJsonArray($row['features_en'] ?? [], []),
        'sort_order'                 => (int)($row['sort_order'] ?? 10),
    ];
}

/**
 * Inserts or updates a managed LLM model row safely (MySQL & SQLite compatible, zero duplicate named params).
 */
function upsertLlmModel(PDO $db, array $data, bool $preserveAdminFlagsIfExists = false): array
{
    $id = trim((string)($data['id'] ?? ''));
    $provider = strtolower(trim((string)($data['provider'] ?? '')));
    $modelName = trim((string)($data['model_name'] ?? ''));

    if ($id === '' && $provider !== '' && $modelName !== '') {
        $id = $provider . '/' . $modelName;
    } elseif ($id !== '' && ($provider === '' || $modelName === '') && str_contains($id, '/')) {
        [$pPart, $mPart] = explode('/', $id, 2);
        if ($provider === '') {
            $provider = strtolower(trim($pPart));
        }
        if ($modelName === '') {
            $modelName = trim($mPart);
        }
    }

    $supportsBatch = !empty($data['supports_batch_api']);
    $supportsTools = !array_key_exists('supports_tools', $data) || !empty($data['supports_tools']);
    $strategy = (string)($data['execution_strategy'] ?? ($supportsBatch ? 'batch_api' : 'regular'));
    if ($strategy === 'prompt_caching' || !in_array($strategy, ['batch_api', 'regular'], true)) {
        $strategy = $supportsBatch ? 'batch_api' : 'regular';
    }

    $isAllowed = !isset($data['is_allowed']) || !empty($data['is_allowed']);
    $isDefault = !empty($data['is_default']);
    $sortOrder = (int)($data['sort_order'] ?? 100);
    $euHosted = !empty($data['eu_hosted']);
    $supportsSearch = !empty($data['supports_web_search']);

    if ($preserveAdminFlagsIfExists) {
        $existingStmt = $db->prepare("SELECT * FROM llm_models WHERE id = :id LIMIT 1");
        $existingStmt->execute([':id' => $id]);
        $existing = $existingStmt->fetch();
        if ($existing) {
            $isAllowed = !empty($existing['is_allowed']);
            $isDefault = !empty($existing['is_default']);
            $supportsBatch = array_key_exists('supports_batch_api', $data) ? !empty($data['supports_batch_api']) : !empty($existing['supports_batch_api']);
            $supportsTools = array_key_exists('supports_tools', $data) ? !empty($data['supports_tools']) : (!array_key_exists('supports_tools', $existing) || !empty($existing['supports_tools']));
            $existingStrat = (string)($existing['execution_strategy'] ?? '');
            if ($existingStrat === 'batch_api' || $existingStrat === 'regular') {
                $strategy = ($existingStrat === 'batch_api' && !$supportsBatch && array_key_exists('supports_batch_api', $data))
                    ? 'regular'
                    : $existingStrat;
            } else {
                $strategy = $supportsBatch ? 'batch_api' : 'regular';
            }
            $sortOrder = (int)($existing['sort_order'] ?? $sortOrder);
            $euHosted = array_key_exists('eu_hosted', $data) ? !empty($data['eu_hosted']) : !empty($existing['eu_hosted']);
            $supportsSearch = array_key_exists('supports_web_search', $data) ? !empty($data['supports_web_search']) : !empty($existing['supports_web_search']);
        }
    }

    $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    $conflictClause = ($driver === 'sqlite')
        ? "ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            model_name = excluded.model_name,
            display_name = excluded.display_name,
            eu_hosted = excluded.eu_hosted,
            supports_web_search = excluded.supports_web_search,
            supports_batch_api = excluded.supports_batch_api,
            supports_tools = excluded.supports_tools,
            execution_strategy = excluded.execution_strategy,
            is_allowed = excluded.is_allowed,
            is_default = excluded.is_default,
            n8n_credential_name = excluded.n8n_credential_name,
            n8n_sync_status = excluded.n8n_sync_status,
            last_synced_at = excluded.last_synced_at,
            sort_order = excluded.sort_order"
        : "ON DUPLICATE KEY UPDATE
            provider = VALUES(provider),
            model_name = VALUES(model_name),
            display_name = VALUES(display_name),
            eu_hosted = VALUES(eu_hosted),
            supports_web_search = VALUES(supports_web_search),
            supports_batch_api = VALUES(supports_batch_api),
            supports_tools = VALUES(supports_tools),
            execution_strategy = VALUES(execution_strategy),
            is_allowed = VALUES(is_allowed),
            is_default = VALUES(is_default),
            n8n_credential_name = VALUES(n8n_credential_name),
            n8n_sync_status = VALUES(n8n_sync_status),
            last_synced_at = VALUES(last_synced_at),
            sort_order = VALUES(sort_order)";

    $sql = "
        INSERT INTO llm_models (
            id, provider, model_name, display_name, eu_hosted, supports_web_search,
            supports_batch_api, supports_tools,
            execution_strategy, is_allowed, is_default, n8n_credential_name,
            n8n_sync_status, last_synced_at, sort_order
        ) VALUES (
            :id, :provider, :model_name, :display_name, :eu_hosted, :supports_web_search,
            :supports_batch_api, :supports_tools,
            :execution_strategy, :is_allowed, :is_default, :n8n_credential_name,
            :n8n_sync_status, :last_synced_at, :sort_order
        )
        {$conflictClause}
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':id'                  => $id,
        ':provider'            => $provider,
        ':model_name'          => $modelName,
        ':display_name'        => trim((string)($data['display_name'] ?? $id)),
        ':eu_hosted'           => $euHosted ? 1 : 0,
        ':supports_web_search' => $supportsSearch ? 1 : 0,
        ':supports_batch_api'  => $supportsBatch ? 1 : 0,
        ':supports_tools'      => $supportsTools ? 1 : 0,
        ':execution_strategy'  => $strategy,
        ':is_allowed'          => $isAllowed ? 1 : 0,
        ':is_default'          => $isDefault ? 1 : 0,
        ':n8n_credential_name' => $data['n8n_credential_name'] ?? null,
        ':n8n_sync_status'     => (string)($data['n8n_sync_status'] ?? 'seeded'),
        ':last_synced_at'      => $data['last_synced_at'] ?? null,
        ':sort_order'          => $sortOrder,
    ]);

    return formatLlmModelRow([
        'id'                  => $id,
        'provider'            => $provider,
        'model_name'          => $modelName,
        'display_name'        => trim((string)($data['display_name'] ?? $id)),
        'eu_hosted'           => $euHosted ? 1 : 0,
        'supports_web_search' => $supportsSearch ? 1 : 0,
        'supports_batch_api'  => $supportsBatch ? 1 : 0,
        'supports_tools'      => $supportsTools ? 1 : 0,
        'execution_strategy'  => $strategy,
        'is_allowed'          => $isAllowed ? 1 : 0,
        'is_default'          => $isDefault ? 1 : 0,
        'n8n_credential_name' => $data['n8n_credential_name'] ?? null,
        'n8n_sync_status'     => (string)($data['n8n_sync_status'] ?? 'seeded'),
        'last_synced_at'      => $data['last_synced_at'] ?? null,
        'sort_order'          => $sortOrder,
    ]);
}

/**
 * Inserts or updates an Analyse-Set (`model_presets`) row safely.
 */
function upsertModelPreset(PDO $db, array $data): array
{
    $id = preg_replace('/[^a-z0-9_-]/i', '_', trim((string)($data['id'] ?? '')));
    $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    $conflictClause = ($driver === 'sqlite')
        ? "ON CONFLICT(id) DO UPDATE SET
            name_de = excluded.name_de,
            name_en = excluded.name_en,
            description_de = excluded.description_de,
            description_en = excluded.description_en,
            badge_de = excluded.badge_de,
            badge_en = excluded.badge_en,
            target_llms = excluded.target_llms,
            search_enabled = excluded.search_enabled,
            allowed_tiers = excluded.allowed_tiers,
            is_default = excluded.is_default,
            is_active = excluded.is_active,
            sort_order = excluded.sort_order"
        : "ON DUPLICATE KEY UPDATE
            name_de = VALUES(name_de),
            name_en = VALUES(name_en),
            description_de = VALUES(description_de),
            description_en = VALUES(description_en),
            badge_de = VALUES(badge_de),
            badge_en = VALUES(badge_en),
            target_llms = VALUES(target_llms),
            search_enabled = VALUES(search_enabled),
            allowed_tiers = VALUES(allowed_tiers),
            is_default = VALUES(is_default),
            is_active = VALUES(is_active),
            sort_order = VALUES(sort_order)";

    $targetLlms = decodeCatalogJsonArray($data['target_llms'] ?? [], []);
    $allowedTiers = decodeCatalogJsonArray($data['allowed_tiers'] ?? [], ['starter', 'growth', 'enterprise_managed']);

    $sql = "
        INSERT INTO model_presets (
            id, name_de, name_en, description_de, description_en, badge_de, badge_en,
            target_llms, search_enabled, allowed_tiers, is_default, is_active, sort_order
        ) VALUES (
            :id, :name_de, :name_en, :description_de, :description_en, :badge_de, :badge_en,
            :target_llms, :search_enabled, :allowed_tiers, :is_default, :is_active, :sort_order
        )
        {$conflictClause}
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':id'             => $id,
        ':name_de'        => trim((string)($data['name_de'] ?? $id)),
        ':name_en'        => trim((string)($data['name_en'] ?? $id)),
        ':description_de' => trim((string)($data['description_de'] ?? '')),
        ':description_en' => trim((string)($data['description_en'] ?? '')),
        ':badge_de'       => ($data['badge_de'] ?? null) !== null ? trim((string)$data['badge_de']) : null,
        ':badge_en'       => ($data['badge_en'] ?? null) !== null ? trim((string)$data['badge_en']) : null,
        ':target_llms'    => json_encode(array_values($targetLlms), JSON_UNESCAPED_UNICODE),
        ':search_enabled' => !empty($data['search_enabled']) ? 1 : 0,
        ':allowed_tiers'  => json_encode(array_values($allowedTiers), JSON_UNESCAPED_UNICODE),
        ':is_default'     => !empty($data['is_default']) ? 1 : 0,
        ':is_active'      => (!isset($data['is_active']) || !empty($data['is_active'])) ? 1 : 0,
        ':sort_order'     => (int)($data['sort_order'] ?? 100),
    ]);

    return formatModelPresetRow([
        'id'             => $id,
        'name_de'        => trim((string)($data['name_de'] ?? $id)),
        'name_en'        => trim((string)($data['name_en'] ?? $id)),
        'description_de' => trim((string)($data['description_de'] ?? '')),
        'description_en' => trim((string)($data['description_en'] ?? '')),
        'badge_de'       => $data['badge_de'] ?? null,
        'badge_en'       => $data['badge_en'] ?? null,
        'target_llms'    => $targetLlms,
        'search_enabled' => !empty($data['search_enabled']),
        'allowed_tiers'  => $allowedTiers,
        'is_default'     => !empty($data['is_default']),
        'is_active'      => !isset($data['is_active']) || !empty($data['is_active']),
        'sort_order'     => (int)($data['sort_order'] ?? 100),
    ]);
}

/**
 * Inserts or updates a subscription plan row (`subscription_plans`) safely.
 */
function upsertSubscriptionPlan(PDO $db, array $data): array
{
    $tier = strtolower(trim((string)($data['tier'] ?? 'free')));
    $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    $conflictClause = ($driver === 'sqlite')
        ? "ON CONFLICT(tier) DO UPDATE SET
            name_de = excluded.name_de,
            name_en = excluded.name_en,
            subtitle_de = excluded.subtitle_de,
            subtitle_en = excluded.subtitle_en,
            price_eur = excluded.price_eur,
            price_label_de = excluded.price_label_de,
            price_label_en = excluded.price_label_en,
            billing_period_de = excluded.billing_period_de,
            billing_period_en = excluded.billing_period_en,
            stripe_product_id = excluded.stripe_product_id,
            stripe_price_id = excluded.stripe_price_id,
            stripe_checkout_url = excluded.stripe_checkout_url,
            included_credits = excluded.included_credits,
            max_configs = excluded.max_configs,
            max_competitors_per_config = excluded.max_competitors_per_config,
            max_prompts_per_config = excluded.max_prompts_per_config,
            allowed_intervals = excluded.allowed_intervals,
            allow_custom_models = excluded.allow_custom_models,
            allowed_preset_ids = excluded.allowed_preset_ids,
            features_de = excluded.features_de,
            features_en = excluded.features_en,
            sort_order = excluded.sort_order"
        : "ON DUPLICATE KEY UPDATE
            name_de = VALUES(name_de),
            name_en = VALUES(name_en),
            subtitle_de = VALUES(subtitle_de),
            subtitle_en = VALUES(subtitle_en),
            price_eur = VALUES(price_eur),
            price_label_de = VALUES(price_label_de),
            price_label_en = VALUES(price_label_en),
            billing_period_de = VALUES(billing_period_de),
            billing_period_en = VALUES(billing_period_en),
            stripe_product_id = VALUES(stripe_product_id),
            stripe_price_id = VALUES(stripe_price_id),
            stripe_checkout_url = VALUES(stripe_checkout_url),
            included_credits = VALUES(included_credits),
            max_configs = VALUES(max_configs),
            max_competitors_per_config = VALUES(max_competitors_per_config),
            max_prompts_per_config = VALUES(max_prompts_per_config),
            allowed_intervals = VALUES(allowed_intervals),
            allow_custom_models = VALUES(allow_custom_models),
            allowed_preset_ids = VALUES(allowed_preset_ids),
            features_de = VALUES(features_de),
            features_en = VALUES(features_en),
            sort_order = VALUES(sort_order)";

    $allowedIntervals = decodeCatalogJsonArray($data['allowed_intervals'] ?? [], ['every_120m']);
    $allowedPresets = decodeCatalogJsonArray($data['allowed_preset_ids'] ?? [], ['dach_core_baseline']);
    $featuresDe = decodeCatalogJsonArray($data['features_de'] ?? [], []);
    $featuresEn = decodeCatalogJsonArray($data['features_en'] ?? [], []);

    $sql = "
        INSERT INTO subscription_plans (
            tier, name_de, name_en, subtitle_de, subtitle_en,
            price_eur, price_label_de, price_label_en, billing_period_de, billing_period_en,
            stripe_product_id, stripe_price_id, stripe_checkout_url,
            included_credits, max_configs, max_competitors_per_config, max_prompts_per_config,
            allowed_intervals, allow_custom_models, allowed_preset_ids,
            features_de, features_en, sort_order
        ) VALUES (
            :tier, :name_de, :name_en, :subtitle_de, :subtitle_en,
            :price_eur, :price_label_de, :price_label_en, :billing_period_de, :billing_period_en,
            :stripe_product_id, :stripe_price_id, :stripe_checkout_url,
            :included_credits, :max_configs, :max_competitors_per_config, :max_prompts_per_config,
            :allowed_intervals, :allow_custom_models, :allowed_preset_ids,
            :features_de, :features_en, :sort_order
        )
        {$conflictClause}
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':tier'                       => $tier,
        ':name_de'                    => trim((string)($data['name_de'] ?? ucfirst($tier))),
        ':name_en'                    => trim((string)($data['name_en'] ?? ucfirst($tier))),
        ':subtitle_de'                => trim((string)($data['subtitle_de'] ?? '')),
        ':subtitle_en'                => trim((string)($data['subtitle_en'] ?? '')),
        ':price_eur'                  => max(0, (int)($data['price_eur'] ?? 0)),
        ':price_label_de'             => trim((string)($data['price_label_de'] ?? '0 €')),
        ':price_label_en'             => trim((string)($data['price_label_en'] ?? '€0')),
        ':billing_period_de'          => trim((string)($data['billing_period_de'] ?? '/ Monat')),
        ':billing_period_en'          => trim((string)($data['billing_period_en'] ?? '/ month')),
        ':stripe_product_id'          => trim((string)($data['stripe_product_id'] ?? '')),
        ':stripe_price_id'            => trim((string)($data['stripe_price_id'] ?? '')),
        ':stripe_checkout_url'        => trim((string)($data['stripe_checkout_url'] ?? '')),
        ':included_credits'           => max(0, (int)($data['included_credits'] ?? 0)),
        ':max_configs'                => max(1, (int)($data['max_configs'] ?? 1)),
        ':max_competitors_per_config' => max(1, (int)($data['max_competitors_per_config'] ?? 2)),
        ':max_prompts_per_config'     => max(1, (int)($data['max_prompts_per_config'] ?? 5)),
        ':allowed_intervals'          => json_encode(array_values($allowedIntervals), JSON_UNESCAPED_UNICODE),
        ':allow_custom_models'        => !empty($data['allow_custom_models']) ? 1 : 0,
        ':allowed_preset_ids'         => json_encode(array_values($allowedPresets), JSON_UNESCAPED_UNICODE),
        ':features_de'                => json_encode(array_values($featuresDe), JSON_UNESCAPED_UNICODE),
        ':features_en'                => json_encode(array_values($featuresEn), JSON_UNESCAPED_UNICODE),
        ':sort_order'                 => (int)($data['sort_order'] ?? 10),
    ]);

    return formatSubscriptionPlanRow([
        'tier'                       => $tier,
        'name_de'                    => trim((string)($data['name_de'] ?? ucfirst($tier))),
        'name_en'                    => trim((string)($data['name_en'] ?? ucfirst($tier))),
        'subtitle_de'                => trim((string)($data['subtitle_de'] ?? '')),
        'subtitle_en'                => trim((string)($data['subtitle_en'] ?? '')),
        'price_eur'                  => max(0, (int)($data['price_eur'] ?? 0)),
        'price_label_de'             => trim((string)($data['price_label_de'] ?? '0 €')),
        'price_label_en'             => trim((string)($data['price_label_en'] ?? '€0')),
        'billing_period_de'          => trim((string)($data['billing_period_de'] ?? '/ Monat')),
        'billing_period_en'          => trim((string)($data['billing_period_en'] ?? '/ month')),
        'stripe_product_id'          => trim((string)($data['stripe_product_id'] ?? '')),
        'stripe_price_id'            => trim((string)($data['stripe_price_id'] ?? '')),
        'stripe_checkout_url'        => trim((string)($data['stripe_checkout_url'] ?? '')),
        'included_credits'           => max(0, (int)($data['included_credits'] ?? 0)),
        'max_configs'                => max(1, (int)($data['max_configs'] ?? 1)),
        'max_competitors_per_config' => max(1, (int)($data['max_competitors_per_config'] ?? 2)),
        'max_prompts_per_config'     => max(1, (int)($data['max_prompts_per_config'] ?? 5)),
        'allowed_intervals'          => $allowedIntervals,
        'allow_custom_models'        => !empty($data['allow_custom_models']),
        'allowed_preset_ids'         => $allowedPresets,
        'features_de'                => $featuresDe,
        'features_en'                => $featuresEn,
        'sort_order'                 => (int)($data['sort_order'] ?? 10),
    ]);
}

/**
 * Returns managed LLM models catalog ordered by sort_order, falling back to default seeds on minimal mocks.
 *
 * @return array<int, array<string, mixed>>
 */
function getAdminModelsCatalog(PDO $db, bool $onlyAllowed = false): array
{
    try {
        ensureAdminCatalogTables($db);
        $sql = $onlyAllowed
            ? "SELECT * FROM llm_models WHERE is_allowed = 1 ORDER BY sort_order ASC, id ASC"
            : "SELECT * FROM llm_models ORDER BY sort_order ASC, id ASC";
        $rows = $db->query($sql)->fetchAll();
        if (!empty($rows)) {
            return array_map('formatLlmModelRow', $rows);
        }
    } catch (\Throwable $e) {
        // Fallback to seed list if table cannot be queried on minimal mock
    }

    $seed = getDefaultLlmModelsSeed();
    if ($onlyAllowed) {
        $seed = array_values(array_filter($seed, fn($m) => !empty($m['is_allowed'])));
    }
    return array_map('formatLlmModelRow', $seed);
}

/**
 * Returns an associative lookup map keyed by canonical model ID (`provider/model`)
 * containing capability flags (`supports_batch_api`, `supports_tools`, `supports_web_search`, `execution_strategy`).
 *
 * @return array<string, array{supports_batch_api:bool,supports_tools:bool,supports_web_search:bool,execution_strategy:string}>
 */
function getLlmModelCapabilitiesMap(PDO $db): array
{
    $map = [];
    foreach (getAdminModelsCatalog($db, false) as $modelRow) {
        $id = (string)($modelRow['id'] ?? '');
        if ($id !== '') {
            $map[$id] = [
                'supports_batch_api'  => !empty($modelRow['supports_batch_api']),
                'supports_tools'      => !array_key_exists('supports_tools', $modelRow) || !empty($modelRow['supports_tools']),
                'supports_web_search' => !empty($modelRow['supports_web_search']),
                'execution_strategy'  => (string)($modelRow['execution_strategy'] ?? 'regular'),
            ];
        }
    }
    return $map;
}

/**
 * Returns curated Analyse-Sets (`model_presets`) ordered by sort_order.
 *
 * @return array<int, array<string, mixed>>
 */
function getModelPresetsCatalog(PDO $db, bool $onlyActive = false): array
{
    try {
        ensureAdminCatalogTables($db);
        $sql = $onlyActive
            ? "SELECT * FROM model_presets WHERE is_active = 1 ORDER BY sort_order ASC, id ASC"
            : "SELECT * FROM model_presets ORDER BY sort_order ASC, id ASC";
        $rows = $db->query($sql)->fetchAll();
        if (!empty($rows)) {
            return array_map('formatModelPresetRow', $rows);
        }
    } catch (\Throwable $e) {
        // Fallback to seed list on minimal mock
    }

    $seed = getDefaultModelPresetsSeed();
    if ($onlyActive) {
        $seed = array_values(array_filter($seed, fn($p) => !empty($p['is_active'])));
    }
    return array_map('formatModelPresetRow', $seed);
}

/**
 * Returns all configured subscription plans ordered by sort_order.
 *
 * @return array<int, array<string, mixed>>
 */
function getSubscriptionPlansCatalog(PDO $db): array
{
    try {
        ensureAdminCatalogTables($db);
        $rows = $db->query("SELECT * FROM subscription_plans ORDER BY sort_order ASC, price_eur ASC")->fetchAll();
        if (!empty($rows)) {
            return array_map('formatSubscriptionPlanRow', $rows);
        }
    } catch (\Throwable $e) {
        // Fallback to seed list on minimal mock
    }

    return array_map('formatSubscriptionPlanRow', getDefaultSubscriptionPlansSeed());
}

/**
 * Returns the subscription plan configuration for a specific tier (falling back to 'free').
 */
function getPlanForTier(PDO $db, string $tier): array
{
    $normalized = strtolower(trim($tier));
    $plans = getSubscriptionPlansCatalog($db);
    foreach ($plans as $plan) {
        if ($plan['tier'] === $normalized) {
            return $plan;
        }
    }
    foreach ($plans as $plan) {
        if ($plan['tier'] === 'free') {
            return $plan;
        }
    }
    return formatSubscriptionPlanRow(getDefaultSubscriptionPlansSeed()[0]);
}

/**
 * Canonicalizes provider alias keys (`zhipu` -> `z-ai`, `moonshot` -> `moonshotai`)
 * without conflating distinct OpenRouter namespaces (`meta` vs `meta-llama`).
 */
function normalizeCanonicalOpenRouterProvider(string $providerKey): string
{
    $key = strtolower(trim($providerKey));
    if ($key === 'zhipu') {
        return 'z-ai';
    }
    if ($key === 'moonshot') {
        return 'moonshotai';
    }
    return $key;
}

/**
 * Returns a human-readable display label for an OpenRouter provider namespace.
 */
function getOpenRouterProviderDisplayName(string $providerKey): string
{
    $key = strtolower(trim($providerKey));
    static $labels = [
        'openai'     => 'OpenAI',
        'google'     => 'Google',
        'anthropic'  => 'Anthropic',
        'mistralai'  => 'Mistral AI',
        'x-ai'       => 'xAI (Grok)',
        'deepseek'   => 'DeepSeek',
        'qwen'       => 'Qwen',
        'xiaomi'     => 'Xiaomi',
        'z-ai'       => 'Z.ai (GLM)',
        'meta-llama' => 'Meta Llama',
        'meta'       => 'Meta (Muse Spark / Wonder)',
        'nvidia'     => 'NVIDIA',
        'azure'      => 'Azure OpenAI',
        'microsoft'  => 'Microsoft',
        'perplexity' => 'Perplexity',
        'moonshotai' => 'Moonshot AI (Kimi)',
        'minimax'    => 'MiniMax',
        'cohere'     => 'Cohere',
        'amazon'     => 'Amazon Bedrock / Nova',
        'ai21'       => 'AI21 Labs',
    ];
    if (isset($labels[$key])) {
        return $labels[$key];
    }
    return ucwords(str_replace(['-', '_'], ' ', $key));
}

/**
 * Returns default OpenRouter provider seed rows matching `getDefaultOpenRouterProviders()`.
 *
 * @return array<int, array<string, mixed>>
 */
function getDefaultOpenRouterProvidersSeed(): array
{
    $defaults = function_exists('getDefaultOpenRouterProviders')
        ? getDefaultOpenRouterProviders()
        : [
            'openai', 'google', 'anthropic', 'mistralai', 'x-ai',
            'deepseek', 'qwen', 'xiaomi', 'z-ai', 'meta-llama', 'meta',
            'nvidia', 'azure', 'microsoft', 'perplexity', 'moonshotai', 'minimax',
        ];
    $seed = [];
    foreach ($defaults as $key) {
        $norm = strtolower(trim((string)$key));
        if ($norm === '') {
            continue;
        }
        $seed[] = [
            'provider_key'           => $norm,
            'display_name'           => getOpenRouterProviderDisplayName($norm),
            'is_relevant'            => true,
            'is_default'             => true,
            'discovered_model_count' => 0,
            'sample_models'          => [],
            'last_discovered_at'     => null,
        ];
    }
    return $seed;
}

/**
 * Formats an `openrouter_providers` database row into API shape.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function formatOpenRouterProviderRow(array $row): array
{
    $key = strtolower(trim((string)($row['provider_key'] ?? '')));
    $display = trim((string)($row['display_name'] ?? ''));
    return [
        'provider_key'           => $key,
        'display_name'           => $display !== '' ? $display : getOpenRouterProviderDisplayName($key),
        'is_relevant'            => !empty($row['is_relevant']),
        'is_default'             => !empty($row['is_default']),
        'discovered_model_count' => max(0, (int)($row['discovered_model_count'] ?? 0)),
        'sample_models'          => decodeCatalogJsonArray($row['sample_models'] ?? [], []),
        'last_discovered_at'     => $row['last_discovered_at'] ?? null,
    ];
}

/**
 * Inserts or updates an OpenRouter provider record (SQLite + MySQL compatible).
 */
function upsertOpenRouterProvider(PDO $db, array $data, bool $preserveSelectionIfExists = true): array
{
    $key = strtolower(trim((string)($data['provider_key'] ?? '')));
    if ($key === '') {
        throw new \InvalidArgumentException('provider_key is required');
    }

    $defaultSet = array_flip(array_map('strtolower', function_exists('getDefaultOpenRouterProviders')
        ? getDefaultOpenRouterProviders()
        : []));
    $isRelevant = !empty($data['is_relevant']);
    $isDefault = array_key_exists('is_default', $data) ? !empty($data['is_default']) : isset($defaultSet[$key]);
    $displayName = trim((string)($data['display_name'] ?? ''));
    if ($displayName === '') {
        $displayName = getOpenRouterProviderDisplayName($key);
    }
    $discoveredCount = max(0, (int)($data['discovered_model_count'] ?? 0));
    $sampleModels = is_array($data['sample_models'] ?? null)
        ? array_values(array_slice($data['sample_models'], 0, 5))
        : decodeCatalogJsonArray($data['sample_models'] ?? [], []);
    $lastDiscoveredAt = $data['last_discovered_at'] ?? null;

    if ($preserveSelectionIfExists) {
        $existingStmt = $db->prepare("SELECT * FROM openrouter_providers WHERE provider_key = :k LIMIT 1");
        $existingStmt->execute([':k' => $key]);
        $existing = $existingStmt->fetch();
        if ($existing) {
            $isRelevant = !empty($existing['is_relevant']);
            $isDefault = $isDefault || !empty($existing['is_default']);
            if ($discoveredCount === 0 && !empty($existing['discovered_model_count'])) {
                $discoveredCount = (int)$existing['discovered_model_count'];
            }
            if (empty($sampleModels) && !empty($existing['sample_models'])) {
                $sampleModels = decodeCatalogJsonArray($existing['sample_models'], []);
            }
            if ($lastDiscoveredAt === null && !empty($existing['last_discovered_at'])) {
                $lastDiscoveredAt = $existing['last_discovered_at'];
            }
        }
    }

    $sampleJson = json_encode($sampleModels, JSON_UNESCAPED_UNICODE);
    if ($sampleJson === false) {
        $sampleJson = '[]';
    }

    $driver = strtolower((string)$db->getAttribute(PDO::ATTR_DRIVER_NAME));
    $conflictClause = ($driver === 'sqlite')
        ? "ON CONFLICT(provider_key) DO UPDATE SET
            display_name = excluded.display_name,
            is_relevant = excluded.is_relevant,
            is_default = excluded.is_default,
            discovered_model_count = excluded.discovered_model_count,
            sample_models = excluded.sample_models,
            last_discovered_at = excluded.last_discovered_at"
        : "ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            is_relevant = VALUES(is_relevant),
            is_default = VALUES(is_default),
            discovered_model_count = VALUES(discovered_model_count),
            sample_models = VALUES(sample_models),
            last_discovered_at = VALUES(last_discovered_at)";

    $stmt = $db->prepare("
        INSERT INTO openrouter_providers (
            provider_key, display_name, is_relevant, is_default,
            discovered_model_count, sample_models, last_discovered_at
        ) VALUES (
            :provider_key, :display_name, :is_relevant, :is_default,
            :discovered_model_count, :sample_models, :last_discovered_at
        )
        {$conflictClause}
    ");
    $stmt->execute([
        ':provider_key'           => $key,
        ':display_name'           => $displayName,
        ':is_relevant'            => $isRelevant ? 1 : 0,
        ':is_default'             => $isDefault ? 1 : 0,
        ':discovered_model_count' => $discoveredCount,
        ':sample_models'          => $sampleJson,
        ':last_discovered_at'     => $lastDiscoveredAt,
    ]);

    return formatOpenRouterProviderRow([
        'provider_key'           => $key,
        'display_name'           => $displayName,
        'is_relevant'            => $isRelevant ? 1 : 0,
        'is_default'             => $isDefault ? 1 : 0,
        'discovered_model_count' => $discoveredCount,
        'sample_models'          => $sampleModels,
        'last_discovered_at'     => $lastDiscoveredAt,
    ]);
}

/**
 * Extracts aggregated provider summaries from a raw OpenRouter `/api/v1/models` `data` array.
 *
 * @param array<int, array<string, mixed>> $rawModels
 * @return array<int, array<string, mixed>>
 */
function extractOpenRouterProvidersFromRawModels(array $rawModels): array
{
    $byProvider = [];
    foreach ($rawModels as $raw) {
        if (!is_array($raw)) {
            continue;
        }
        $rawId = trim((string)($raw['id'] ?? ''));
        if ($rawId === '' || !str_contains($rawId, '/')) {
            continue;
        }
        $cleanId = preg_replace('/:(batch|online)$/i', '', $rawId);
        [$prefix] = explode('/', $cleanId, 2);
        $providerKey = strtolower(trim($prefix));
        if ($providerKey === '') {
            continue;
        }

        if (!isset($byProvider[$providerKey])) {
            $byProvider[$providerKey] = [
                'provider_key'           => $providerKey,
                'display_name'           => getOpenRouterProviderDisplayName($providerKey),
                'discovered_model_count' => 0,
                'sample_models'          => [],
                '_seen_ids'              => [],
            ];
        }

        if (!isset($byProvider[$providerKey]['_seen_ids'][$cleanId])) {
            $byProvider[$providerKey]['_seen_ids'][$cleanId] = true;
            $byProvider[$providerKey]['discovered_model_count']++;
            if (count($byProvider[$providerKey]['sample_models']) < 5) {
                $byProvider[$providerKey]['sample_models'][] = $cleanId;
            }
        }
    }

    $result = [];
    foreach ($byProvider as $item) {
        unset($item['_seen_ids']);
        $result[] = $item;
    }
    usort($result, static function ($a, $b) {
        $cmp = ($b['discovered_model_count'] <=> $a['discovered_model_count']);
        return $cmp !== 0 ? $cmp : strcmp($a['provider_key'], $b['provider_key']);
    });
    return $result;
}

/**
 * Persists newly discovered OpenRouter providers while preserving existing admin `is_relevant` flags.
 *
 * @param array<int, array<string, mixed>> $providersList
 */
function syncDiscoveredOpenRouterProviders(PDO $db, array $providersList, ?string $syncedAt = null): void
{
    ensureAdminCatalogTables($db);
    $timestamp = $syncedAt ?: gmdate('Y-m-d H:i:s');
    $startedTx = false;
    if (!$db->inTransaction()) {
        $db->beginTransaction();
        $startedTx = true;
    }

    try {
        foreach ($providersList as $item) {
            if (!is_array($item)) {
                continue;
            }
            $key = strtolower(trim((string)($item['provider_key'] ?? $item['id'] ?? '')));
            if ($key === '') {
                continue;
            }
            upsertOpenRouterProvider($db, [
                'provider_key'           => $key,
                'display_name'           => (string)($item['display_name'] ?? getOpenRouterProviderDisplayName($key)),
                'is_relevant'            => false,
                'discovered_model_count' => max(0, (int)($item['discovered_model_count'] ?? $item['model_count'] ?? 0)),
                'sample_models'          => is_array($item['sample_models'] ?? null) ? $item['sample_models'] : [],
                'last_discovered_at'     => $timestamp,
            ], true);
        }
        if ($startedTx) {
            $db->commit();
        }
    } catch (\Throwable $e) {
        if ($startedTx && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

/**
 * Computes active/paused tracking config and active preset usage per model ID and per provider.
 * Works identically on MySQL and SQLite without requiring JSON_TABLE.
 *
 * @return array{by_model:array<string,array<string,mixed>>,by_provider:array<string,array<string,mixed>>}
 */
function getModelActiveUsageStats(PDO $db): array
{
    $modelMeta = [];
    try {
        foreach ($db->query("SELECT id, provider, display_name, is_allowed, is_default FROM llm_models")->fetchAll() as $mRow) {
            $mid = trim((string)($mRow['id'] ?? ''));
            if ($mid !== '') {
                $modelMeta[$mid] = [
                    'display_name' => (string)($mRow['display_name'] ?? $mid),
                    'provider'     => normalizeCanonicalOpenRouterProvider((string)($mRow['provider'] ?? '')),
                    'is_allowed'   => !empty($mRow['is_allowed']),
                    'is_default'   => !empty($mRow['is_default']),
                ];
            }
        }
    } catch (\Throwable $e) {
        // Ignore on minimal test schemas without llm_models
    }

    $resolveToken = static function (string $rawToken): array {
        $clean = trim($rawToken);
        if ($clean === '') {
            return ['id' => '', 'provider' => ''];
        }
        if (function_exists('resolveTargetLlmSpec')) {
            $spec = resolveTargetLlmSpec($clean);
            $id = trim((string)($spec['id'] ?? ''));
            $prov = normalizeCanonicalOpenRouterProvider((string)($spec['provider'] ?? ''));
            if ($prov === '' && str_contains($id, '/')) {
                $prov = normalizeCanonicalOpenRouterProvider(explode('/', $id, 2)[0]);
            }
            return ['id' => $id, 'provider' => $prov];
        }
        $clean = preg_replace('/:(batch|online)$/i', '', $clean);
        if (!str_contains($clean, '/')) {
            return ['id' => $clean, 'provider' => normalizeCanonicalOpenRouterProvider($clean)];
        }
        [$p] = explode('/', $clean, 2);
        return ['id' => $clean, 'provider' => normalizeCanonicalOpenRouterProvider($p)];
    };

    $byModel = [];
    $byProviderInternal = [];

    $ensureModelEntry = static function (string $modelId, string $provider) use (&$byModel, &$byProviderInternal, $modelMeta): void {
        if (!isset($byModel[$modelId])) {
            $meta = $modelMeta[$modelId] ?? null;
            $effectiveProvider = $provider !== '' ? $provider : ($meta['provider'] ?? '');
            $byModel[$modelId] = [
                'model_id'            => $modelId,
                'provider'            => $effectiveProvider,
                'display_name'        => $meta['display_name'] ?? $modelId,
                'is_allowed'          => $meta ? !empty($meta['is_allowed']) : false,
                'is_default'          => $meta ? !empty($meta['is_default']) : false,
                'active_config_count' => 0,
                'paused_config_count' => 0,
                'total_config_count'  => 0,
                'preset_count'        => 0,
                'config_samples'      => [],
                'preset_names'        => [],
            ];
        }
        $pKey = $byModel[$modelId]['provider'];
        if ($pKey !== '' && !isset($byProviderInternal[$pKey])) {
            $byProviderInternal[$pKey] = [
                'active_config_ids' => [],
                'paused_config_ids' => [],
                'preset_ids'        => [],
                'model_ids'         => [],
            ];
        }
        if ($pKey !== '') {
            $byProviderInternal[$pKey]['model_ids'][$modelId] = true;
        }
    };

    // Seed entries for every managed model that is already in llm_models (only emitted under used_models if actually used)
    // Scan tracking_configs (status IN ('active', 'paused'))
    $configRows = [];
    try {
        $configRows = $db->query("SELECT id, name, brand_name, status, target_llms, deleted_at FROM tracking_configs WHERE status IN ('active', 'paused')")->fetchAll();
    } catch (\Throwable $e) {
        try {
            $configRows = $db->query("SELECT id, name, status, target_llms FROM tracking_configs WHERE status IN ('active', 'paused')")->fetchAll();
        } catch (\Throwable $inner) {
            $configRows = [];
        }
    }

    foreach ($configRows as $cfg) {
        if (!empty($cfg['deleted_at'])) {
            continue;
        }
        $cfgId = (int)($cfg['id'] ?? 0);
        $status = strtolower(trim((string)($cfg['status'] ?? 'active')));
        if ($status !== 'active' && $status !== 'paused') {
            continue;
        }
        $cfgName = trim((string)($cfg['name'] ?? ($cfg['brand_name'] ?? '')));
        if ($cfgName === '') {
            $cfgName = 'Config #' . $cfgId;
        }
        $llms = decodeCatalogJsonArray($cfg['target_llms'] ?? [], []);
        $seenModelsInCfg = [];
        foreach ($llms as $tok) {
            $resolved = $resolveToken((string)$tok);
            $mid = $resolved['id'];
            $prov = $resolved['provider'];
            if ($mid === '' || isset($seenModelsInCfg[$mid])) {
                continue;
            }
            $seenModelsInCfg[$mid] = true;
            $ensureModelEntry($mid, $prov);
            if ($status === 'active') {
                $byModel[$mid]['active_config_count']++;
            } else {
                $byModel[$mid]['paused_config_count']++;
            }
            $byModel[$mid]['total_config_count']++;
            if (count($byModel[$mid]['config_samples']) < 10) {
                $byModel[$mid]['config_samples'][] = [
                    'id'     => $cfgId,
                    'name'   => $cfgName,
                    'status' => $status,
                ];
            }

            $pKey = $byModel[$mid]['provider'];
            if ($pKey !== '' && $cfgId > 0) {
                if ($status === 'active') {
                    $byProviderInternal[$pKey]['active_config_ids'][$cfgId] = true;
                } else {
                    $byProviderInternal[$pKey]['paused_config_ids'][$cfgId] = true;
                }
            }
        }
    }

    // Scan active model_presets (Analyse-Sets)
    $presetRows = [];
    try {
        $presetRows = $db->query("SELECT id, name_de, name_en, target_llms FROM model_presets WHERE is_active = 1")->fetchAll();
    } catch (\Throwable $e) {
        $presetRows = [];
    }

    foreach ($presetRows as $pRow) {
        $pid = trim((string)($pRow['id'] ?? ''));
        $pName = trim((string)($pRow['name_de'] ?? ($pRow['name_en'] ?? $pid)));
        $llms = decodeCatalogJsonArray($pRow['target_llms'] ?? [], []);
        $seenModelsInPreset = [];
        foreach ($llms as $tok) {
            $resolved = $resolveToken((string)$tok);
            $mid = $resolved['id'];
            $prov = $resolved['provider'];
            if ($mid === '' || isset($seenModelsInPreset[$mid])) {
                continue;
            }
            $seenModelsInPreset[$mid] = true;
            $ensureModelEntry($mid, $prov);
            $byModel[$mid]['preset_count']++;
            if ($pName !== '' && count($byModel[$mid]['preset_names']) < 10) {
                $byModel[$mid]['preset_names'][] = $pName;
            }
            $pKey = $byModel[$mid]['provider'];
            if ($pKey !== '' && $pid !== '') {
                $byProviderInternal[$pKey]['preset_ids'][$pid] = true;
            }
        }
    }

    $byProvider = [];
    foreach ($byProviderInternal as $pKey => $agg) {
        $usedModels = [];
        foreach (array_keys($agg['model_ids']) as $mid) {
            if (isset($byModel[$mid])) {
                $usedModels[] = $byModel[$mid];
            }
        }
        usort($usedModels, static function ($a, $b) {
            $scoreA = ($a['active_config_count'] * 100) + ($a['paused_config_count'] * 10) + $a['preset_count'];
            $scoreB = ($b['active_config_count'] * 100) + ($b['paused_config_count'] * 10) + $b['preset_count'];
            if ($scoreA !== $scoreB) {
                return $scoreB <=> $scoreA;
            }
            return strcmp($a['model_id'], $b['model_id']);
        });
        $byProvider[$pKey] = [
            'active_config_count' => count($agg['active_config_ids']),
            'paused_config_count' => count($agg['paused_config_ids']),
            'total_config_count'  => count($agg['active_config_ids'] + $agg['paused_config_ids']),
            'preset_count'        => count($agg['preset_ids']),
            'used_models'         => $usedModels,
        ];
    }

    return [
        'by_model'    => $byModel,
        'by_provider' => $byProvider,
    ];
}

/**
 * Returns full OpenRouter provider list with selection state, model counts, and active config/preset usage stats.
 *
 * @return array<int, array<string, mixed>>
 */
function getOpenRouterProvidersCatalog(PDO $db): array
{
    ensureAdminCatalogTables($db);
    $rows = $db->query("
        SELECT * FROM openrouter_providers
        ORDER BY is_relevant DESC, is_default DESC, discovered_model_count DESC, provider_key ASC
    ")->fetchAll();

    $providersByKey = [];
    foreach ($rows as $row) {
        $formatted = formatOpenRouterProviderRow($row);
        if ($formatted['provider_key'] !== '') {
            $providersByKey[$formatted['provider_key']] = $formatted;
        }
    }

    // Aggregate llm_models counts per canonical provider
    $catalogCounts = [];
    $allowedCounts = [];
    try {
        foreach ($db->query("SELECT provider, is_allowed FROM llm_models")->fetchAll() as $mRow) {
            $pKey = normalizeCanonicalOpenRouterProvider((string)($mRow['provider'] ?? ''));
            if ($pKey === '') {
                continue;
            }
            $catalogCounts[$pKey] = ($catalogCounts[$pKey] ?? 0) + 1;
            if (!empty($mRow['is_allowed'])) {
                $allowedCounts[$pKey] = ($allowedCounts[$pKey] ?? 0) + 1;
            }
            if (!isset($providersByKey[$pKey])) {
                $providersByKey[$pKey] = formatOpenRouterProviderRow([
                    'provider_key'           => $pKey,
                    'display_name'           => getOpenRouterProviderDisplayName($pKey),
                    'is_relevant'            => 0,
                    'is_default'             => 0,
                    'discovered_model_count' => 0,
                    'sample_models'          => [],
                ]);
            }
        }
    } catch (\Throwable $e) {
        // Ignore when llm_models unavailable
    }

    $usage = getModelActiveUsageStats($db);
    foreach ($usage['by_provider'] as $pKey => $uStats) {
        if ($pKey !== '' && !isset($providersByKey[$pKey])) {
            $providersByKey[$pKey] = formatOpenRouterProviderRow([
                'provider_key'           => $pKey,
                'display_name'           => getOpenRouterProviderDisplayName($pKey),
                'is_relevant'            => 0,
                'is_default'             => 0,
                'discovered_model_count' => 0,
                'sample_models'          => [],
            ]);
        }
    }

    $result = [];
    foreach ($providersByKey as $pKey => $item) {
        $u = $usage['by_provider'][$pKey] ?? null;
        $item['catalog_model_count'] = $catalogCounts[$pKey] ?? 0;
        $item['allowed_model_count'] = $allowedCounts[$pKey] ?? 0;
        $item['active_config_count'] = $u ? (int)$u['active_config_count'] : 0;
        $item['paused_config_count'] = $u ? (int)$u['paused_config_count'] : 0;
        $item['total_config_count']  = $u ? (int)$u['total_config_count'] : 0;
        $item['preset_count']        = $u ? (int)$u['preset_count'] : 0;
        $item['used_models']         = $u ? $u['used_models'] : [];
        $result[] = $item;
    }

    usort($result, static function ($a, $b) {
        if ($a['is_relevant'] !== $b['is_relevant']) {
            return $a['is_relevant'] ? -1 : 1;
        }
        if ($a['is_default'] !== $b['is_default']) {
            return $a['is_default'] ? -1 : 1;
        }
        if ($a['discovered_model_count'] !== $b['discovered_model_count']) {
            return $b['discovered_model_count'] <=> $a['discovered_model_count'];
        }
        return strcmp($a['provider_key'], $b['provider_key']);
    });

    return $result;
}

/**
 * Updates `openrouter_providers.is_relevant` to match `$selectedProviders` and safely prunes
 * only unactivated (`is_allowed = 0 AND is_default = 0`) models with zero active/paused configs
 * or active presets whose provider was deselected.
 *
 * @param array<int, string> $selectedProviders
 * @return array{selected_providers:array<int,string>,pruned_model_ids:array<int,string>,preserved_active_models:array<int,array<string,mixed>>}
 */
function saveRelevantOpenRouterProviders(PDO $db, array $selectedProviders): array
{
    ensureAdminCatalogTables($db);

    $normalized = [];
    $seen = [];
    foreach ($selectedProviders as $rawKey) {
        $key = normalizeCanonicalOpenRouterProvider((string)$rawKey);
        if ($key !== '' && !isset($seen[$key])) {
            $seen[$key] = true;
            $normalized[] = $key;
        }
    }

    $expandedAllowed = function_exists('expandOpenRouterProviderAliases')
        ? expandOpenRouterProviderAliases($normalized)
        : $normalized;
    $expandedSet = array_flip($expandedAllowed);

    $startedTx = false;
    if (!$db->inTransaction()) {
        $db->beginTransaction();
        $startedTx = true;
    }

    $prunedIds = [];
    $preservedModels = [];

    try {
        $db->exec("UPDATE openrouter_providers SET is_relevant = 0");

        foreach ($normalized as $key) {
            $existingStmt = $db->prepare("SELECT provider_key FROM openrouter_providers WHERE provider_key = :k LIMIT 1");
            $existingStmt->execute([':k' => $key]);
            if ($existingStmt->fetch()) {
                $upd = $db->prepare("UPDATE openrouter_providers SET is_relevant = 1 WHERE provider_key = :k");
                $upd->execute([':k' => $key]);
            } else {
                upsertOpenRouterProvider($db, [
                    'provider_key'           => $key,
                    'display_name'           => getOpenRouterProviderDisplayName($key),
                    'is_relevant'            => true,
                    'discovered_model_count' => 0,
                    'sample_models'          => [],
                ], false);
            }
        }

        $usage = getModelActiveUsageStats($db);
        $byModelUsage = $usage['by_model'];

        foreach ($db->query("SELECT id, provider, display_name, is_allowed, is_default FROM llm_models")->fetchAll() as $mRow) {
            $mid = trim((string)($mRow['id'] ?? ''));
            $rawProv = strtolower(trim((string)($mRow['provider'] ?? '')));
            $canonProv = normalizeCanonicalOpenRouterProvider($rawProv);
            if ($mid === '') {
                continue;
            }
            $isProviderRelevant = isset($expandedSet[$rawProv]) || isset($expandedSet[$canonProv]);
            if ($isProviderRelevant) {
                continue;
            }

            $u = $byModelUsage[$mid] ?? null;
            $hasActiveUsage = $u && (
                ($u['active_config_count'] ?? 0) > 0
                || ($u['paused_config_count'] ?? 0) > 0
                || ($u['preset_count'] ?? 0) > 0
            );
            $isActivated = !empty($mRow['is_allowed']) || !empty($mRow['is_default']);

            if (!$isActivated && !$hasActiveUsage) {
                $delStmt = $db->prepare("DELETE FROM llm_models WHERE id = :id");
                $delStmt->execute([':id' => $mid]);
                $prunedIds[] = $mid;
            } else {
                $preservedModels[] = [
                    'model_id'            => $mid,
                    'provider'            => $canonProv,
                    'display_name'        => (string)($mRow['display_name'] ?? $mid),
                    'is_allowed'          => !empty($mRow['is_allowed']),
                    'is_default'          => !empty($mRow['is_default']),
                    'active_config_count' => $u ? (int)$u['active_config_count'] : 0,
                    'paused_config_count' => $u ? (int)$u['paused_config_count'] : 0,
                    'preset_count'        => $u ? (int)$u['preset_count'] : 0,
                ];
            }
        }

        if ($startedTx) {
            $db->commit();
        }
    } catch (\Throwable $e) {
        if ($startedTx && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    return [
        'selected_providers'      => $normalized,
        'pruned_model_ids'        => $prunedIds,
        'preserved_active_models' => $preservedModels,
    ];
}

/**
 * Resets `openrouter_providers.is_relevant` back to the canonical 17 defaults (including `meta`).
 *
 * @return array{selected_providers:array<int,string>,pruned_model_ids:array<int,string>,preserved_active_models:array<int,array<string,mixed>>}
 */
function resetOpenRouterProvidersToDefault(PDO $db): array
{
    ensureAdminCatalogTables($db);
    foreach (getDefaultOpenRouterProvidersSeed() as $seedRow) {
        $existingStmt = $db->prepare("SELECT provider_key FROM openrouter_providers WHERE provider_key = :k LIMIT 1");
        $existingStmt->execute([':k' => $seedRow['provider_key']]);
        if ($existingStmt->fetch()) {
            $upd = $db->prepare("UPDATE openrouter_providers SET is_default = 1 WHERE provider_key = :k");
            $upd->execute([':k' => $seedRow['provider_key']]);
        } else {
            upsertOpenRouterProvider($db, $seedRow, false);
        }
    }

    $defaults = function_exists('getDefaultOpenRouterProviders')
        ? getDefaultOpenRouterProviders()
        : array_column(getDefaultOpenRouterProvidersSeed(), 'provider_key');

    return saveRelevantOpenRouterProviders($db, $defaults);
}
