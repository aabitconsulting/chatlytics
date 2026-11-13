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
                `execution_strategy` TEXT NOT NULL DEFAULT 'prompt_caching',
                `prompt_cache_key` TEXT NULL DEFAULT NULL,
                `cached_tokens` INTEGER NOT NULL DEFAULT 0,
                `trigger_source` TEXT NOT NULL DEFAULT 'batch_queue',
                `is_test_run` INTEGER NOT NULL DEFAULT 0,
                `prompt` TEXT NOT NULL,
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
    } else {
        $db->exec("
            CREATE TABLE IF NOT EXISTS `{$table}` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                `run_id` BIGINT UNSIGNED NULL DEFAULT NULL,
                `config_id` BIGINT UNSIGNED NULL DEFAULT NULL,
                `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
                `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `cached_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
                `trigger_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch_queue',
                `is_test_run` TINYINT(1) NOT NULL DEFAULT 0,
                `prompt` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
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

    $strategy = (string)($row['execution_strategy'] ?? 'prompt_caching');
    if (!in_array($strategy, ['prompt_caching', 'batch_api', 'regular'], true)) {
        $strategy = 'prompt_caching';
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
            `execution_strategy`, `prompt_cache_key`, `cached_tokens`,
            `trigger_source`, `is_test_run`,
            `prompt`, `llm_answer`, `provider`, `model`, `brand_name`, `status`,
            `brand_mentioned`, `char_earliness`, `word_earliness`, `relative_position_pct`,
            `total_chars`, `total_words`, `mece_category`, `geo_quadrant`,
            `brand_cited`, `competitor_cited`, `competitors_json`, `citations_json`,
            `error_message`, `scheduled_at`, `created_at`
        ) VALUES (
            :run_id, :config_id, :custom_id, :batch_id,
            :execution_strategy, :prompt_cache_key, :cached_tokens,
            :trigger_source, :is_test_run,
            :prompt, :llm_answer, :provider, :model, :brand_name, :status,
            :brand_mentioned, :char_earliness, :word_earliness, :relative_position_pct,
            :total_chars, :total_words, :mece_category, :geo_quadrant,
            :brand_cited, :competitor_cited, :competitors_json, :citations_json,
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
        ':cached_tokens'         => max(0, (int)($row['cached_tokens'] ?? 0)),
        ':trigger_source'        => (string)($row['trigger_source'] ?? 'batch_queue'),
        ':is_test_run'           => !empty($row['is_test_run']) ? 1 : 0,
        ':prompt'                => (string)($row['prompt'] ?? ''),
        ':llm_answer'            => isset($row['llm_answer']) ? (string)$row['llm_answer'] : null,
        ':provider'              => (string)($row['provider'] ?? 'openai'),
        ':model'                 => (string)($row['model'] ?? ''),
        ':brand_name'            => (string)($row['brand_name'] ?? ''),
        ':status'                => $status,
        ':brand_mentioned'       => !empty($row['brand_mentioned']) ? 1 : 0,
        ':char_earliness'        => isset($row['char_earliness']) && $row['char_earliness'] !== null ? (int)$row['char_earliness'] : null,
        ':word_earliness'        => isset($row['word_earliness']) && $row['word_earliness'] !== null ? (int)$row['word_earliness'] : null,
        ':relative_position_pct' => isset($row['relative_position_pct']) && $row['relative_position_pct'] !== null ? (float)$row['relative_position_pct'] : null,
        ':total_chars'           => max(0, (int)($row['total_chars'] ?? 0)),
        ':total_words'           => max(0, (int)($row['total_words'] ?? 0)),
        ':mece_category'         => (string)($row['mece_category'] ?? '4_GENERIC'),
        ':geo_quadrant'          => (string)($row['geo_quadrant'] ?? 'NONE'),
        ':brand_cited'           => !empty($row['brand_cited']) ? 1 : 0,
        ':competitor_cited'      => !empty($row['competitor_cited']) ? 1 : 0,
        ':competitors_json'      => $competitorsJson,
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
                `execution_strategy` TEXT NOT NULL DEFAULT 'prompt_caching',
                `provider_batch_id` TEXT NULL DEFAULT NULL,
                `run_id` INTEGER NULL DEFAULT NULL,
                `user_id` INTEGER NOT NULL,
                `config_id` INTEGER NOT NULL,
                `prompt` TEXT NOT NULL,
                `provider` TEXT NOT NULL,
                `model` TEXT NOT NULL,
                `brand_name` TEXT NOT NULL,
                `brand_domains` TEXT NOT NULL,
                `competitors` TEXT NOT NULL,
                `search_enabled` INTEGER NOT NULL DEFAULT 1,
                `is_test_run` INTEGER NOT NULL DEFAULT 0,
                `status` TEXT NOT NULL DEFAULT 'queued',
                `scheduled_for` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `submitted_at` DATETIME NULL DEFAULT NULL,
                `completed_at` DATETIME NULL DEFAULT NULL,
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ");

        // 2. Check tracking_configs columns if table exists
        $tcColsStmt = $db->query("PRAGMA table_info(tracking_configs)");
        $tcCols = $tcColsStmt ? array_column($tcColsStmt->fetchAll(), 'name') : [];
        if (!empty($tcCols)) {
            if (!in_array('datasets_per_day', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN datasets_per_day INTEGER NOT NULL DEFAULT 12");
            }
            if (!in_array('initial_test_used', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN initial_test_used INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('full_started_at', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN full_started_at DATETIME NULL DEFAULT NULL");
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
                $db->exec("ALTER TABLE llm_runs ADD COLUMN execution_strategy TEXT NOT NULL DEFAULT 'prompt_caching'");
            }
            if (!in_array('prompt_cache_key', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN prompt_cache_key TEXT NULL DEFAULT NULL");
            }
            if (!in_array('cached_tokens', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0");
            }
            if (!in_array('is_test_run', $lrCols, true)) {
                $db->exec("ALTER TABLE llm_runs ADD COLUMN is_test_run INTEGER NOT NULL DEFAULT 0");
            }
        }
    } catch (Throwable $e) {
        // Ignore schema inspection errors on partial mock schemas
    }
}
