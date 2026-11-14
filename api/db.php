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
                `input_tokens` INTEGER NOT NULL DEFAULT 0,
                `output_tokens` INTEGER NOT NULL DEFAULT 0,
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
                `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
                `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
                `input_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
                `output_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
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
            `execution_strategy`, `prompt_cache_key`, `input_tokens`, `output_tokens`, `cached_tokens`,
            `trigger_source`, `is_test_run`,
            `prompt`, `llm_answer`, `provider`, `model`, `brand_name`, `status`,
            `brand_mentioned`, `char_earliness`, `word_earliness`, `relative_position_pct`,
            `total_chars`, `total_words`, `mece_category`, `geo_quadrant`,
            `brand_cited`, `competitor_cited`, `competitors_json`, `citations_json`,
            `error_message`, `scheduled_at`, `created_at`
        ) VALUES (
            :run_id, :config_id, :custom_id, :batch_id,
            :execution_strategy, :prompt_cache_key, :input_tokens, :output_tokens, :cached_tokens,
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
        ':input_tokens'          => max(0, (int)($row['input_tokens'] ?? 0)),
        ':output_tokens'         => max(0, (int)($row['output_tokens'] ?? 0)),
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
            if (!in_array('preset_id', $tcCols, true)) {
                $db->exec("ALTER TABLE tracking_configs ADD COLUMN preset_id TEXT NULL DEFAULT NULL");
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
                $db->exec("ALTER TABLE llm_runs ADD COLUMN execution_strategy TEXT NOT NULL DEFAULT 'prompt_caching'");
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
            'execution_strategy'  => 'prompt_caching',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'OpenAI - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 10,
        ],
        [
            'id'                  => 'gemini/models/gemini-3.5-flash',
            'provider'            => 'gemini',
            'model_name'          => 'models/gemini-3.5-flash',
            'display_name'        => 'Google · Gemini 3.5 Flash',
            'eu_hosted'           => false,
            'supports_web_search' => true,
            'execution_strategy'  => 'prompt_caching',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'Google_AI Studio - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 20,
        ],
        [
            'id'                  => 'mistral/mistral-medium-latest',
            'provider'            => 'mistral',
            'model_name'          => 'mistral-medium-latest',
            'display_name'        => 'Mistral Medium Latest',
            'eu_hosted'           => true,
            'supports_web_search' => false,
            'execution_strategy'  => 'prompt_caching',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'Mistral - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 30,
        ],
        [
            'id'                  => 'mistral/mistral-large-latest',
            'provider'            => 'mistral',
            'model_name'          => 'mistral-large-latest',
            'display_name'        => 'Mistral Large Latest',
            'eu_hosted'           => true,
            'supports_web_search' => false,
            'execution_strategy'  => 'prompt_caching',
            'is_allowed'          => true,
            'is_default'          => false,
            'n8n_credential_name' => 'Mistral - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 40,
        ],
        [
            'id'                  => 'mistral/zai-glm-5-3',
            'provider'            => 'mistral',
            'model_name'          => 'zai-glm-5-3',
            'display_name'        => 'Z.ai GLM 5.3 (Mistral EU)',
            'eu_hosted'           => true,
            'supports_web_search' => false,
            'execution_strategy'  => 'regular',
            'is_allowed'          => true,
            'is_default'          => true,
            'n8n_credential_name' => 'Mistral - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 50,
        ],
        [
            'id'                  => 'mistral/zai-glm-5-3-flash',
            'provider'            => 'mistral',
            'model_name'          => 'zai-glm-5-3-flash',
            'display_name'        => 'Z.ai GLM 5.3 Flash (Mistral EU)',
            'eu_hosted'           => true,
            'supports_web_search' => false,
            'execution_strategy'  => 'regular',
            'is_allowed'          => true,
            'is_default'          => false,
            'n8n_credential_name' => 'Mistral - Chatlytics - Chatlytics-dev-1',
            'n8n_sync_status'     => 'seeded',
            'last_synced_at'      => null,
            'sort_order'          => 60,
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
            'name_de'        => 'DACH Basis-Radar (Live-Suche)',
            'name_en'        => 'DACH Core Radar (Live Search)',
            'description_de' => 'Direktvergleich über OpenAI GPT-6 Luna und Google Gemini 3.5 Flash inkl. Live-Websuche & Quellenzitaten.',
            'description_en' => 'Head-to-head benchmark across OpenAI GPT-6 Luna and Google Gemini 3.5 Flash with live web search & citations.',
            'badge_de'       => 'Standard',
            'badge_en'       => 'Default',
            'target_llms'    => ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash'],
            'search_enabled' => true,
            'allowed_tiers'  => ['free', 'starter', 'growth', 'enterprise_managed'],
            'is_default'     => true,
            'is_active'      => true,
            'sort_order'     => 10,
        ],
        [
            'id'             => 'parametric_brand_memory',
            'name_de'        => 'Parametrisches Marken-Gedächtnis (Ohne Websuche)',
            'name_en'        => 'Parametric Brand Memory (No Web Search)',
            'description_de' => 'Prüft das reine Modellwissen über OpenAI, Gemini und Mistral EU ohne Beeinflussung durch Live-Suchergebnisse.',
            'description_en' => 'Evaluates pure parametric training memory across OpenAI, Gemini, and Mistral EU without live web search.',
            'badge_de'       => 'Starter & höher',
            'badge_en'       => 'Starter+',
            'target_llms'    => ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash', 'mistral/mistral-medium-latest'],
            'search_enabled' => false,
            'allowed_tiers'  => ['starter', 'growth', 'enterprise_managed'],
            'is_default'     => false,
            'is_active'      => true,
            'sort_order'     => 20,
        ],
        [
            'id'             => 'eu_sovereign_dsgvo',
            'name_de'        => 'EU-Souveränitäts-Set (Mistral & GLM EU)',
            'name_en'        => 'EU Sovereign Suite (Mistral & GLM EU)',
            'description_de' => '100 % europäische Inferenz auf dem Frankfurter/EU-Endpunkt (Mistral Medium, Mistral Large & Z.ai GLM 5.3).',
            'description_en' => '100% European inference on Mistral EU endpoints (Mistral Medium, Mistral Large & Z.ai GLM 5.3).',
            'badge_de'       => 'EU-Hosted',
            'badge_en'       => 'EU-Hosted',
            'target_llms'    => ['mistral/mistral-medium-latest', 'mistral/mistral-large-latest', 'mistral/zai-glm-5-3'],
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
            'description_de' => 'Umfassende Multi-LLM-Abdeckung über US-Frontier-Modelle (mit Live-Grounding) und europäische Sprachmodelle.',
            'description_en' => 'Complete multi-LLM coverage combining US frontier models (with live grounding) and European models.',
            'badge_de'       => 'Vollabdeckung',
            'badge_en'       => 'Full Coverage',
            'target_llms'    => ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash', 'mistral/mistral-medium-latest', 'mistral/zai-glm-5-3'],
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
                'Basis Analyse-Set: DACH Basis-Radar inkl. Live-Websuche',
                'Basis-Ergebnis nach Empfehlungs-Stufen',
                'Zugang über geschäftliche E-Mail-Adresse',
            ],
            'features_en'                => [
                '40 live queries (Lifetime)',
                'Up to 3 brand profiles (default)',
                'Core Model Preset: DACH Core Radar incl. live web search',
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
                'Alle kuratierten Analyse-Sets (Parametrisch, EU-Souveränität & 360° Benchmark)',
                'Volle Ursachen- & Maßnahmen-Matrix',
                'CSV-/JSON-Export für eigenes Reporting',
            ],
            'features_en'                => [
                '500 live queries per month',
                'Up to 5 brand profiles or product lines',
                'Up to 5 competitors per profile',
                'All curated Model Presets (Parametric, EU Sovereign & 360° Benchmark)',
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
                'Freie Modellwahl & Websuche-Steuerung (inkl. EU-Hosted & alle Analyse-Sets)',
                'Schreibgeschützte Vorstandsreports per Link',
                'Historischer Sichtbarkeits-Trend über alle Modelle',
                'Priorisierte Content- & Schema.org-Maßnahmen',
            ],
            'features_en'                => [
                '2,000 live queries per month',
                '10 brand profiles / markets',
                'Up to 10 competitors per profile',
                'Free custom model & web-search control (incl. EU-Hosted & all Model Presets)',
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
                    `execution_strategy` TEXT NOT NULL DEFAULT 'prompt_caching',
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
        } else {
            $db->exec("
                CREATE TABLE IF NOT EXISTS `llm_models` (
                    `id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `model_name` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `display_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                    `eu_hosted` TINYINT(1) NOT NULL DEFAULT 0,
                    `supports_web_search` TINYINT(1) NOT NULL DEFAULT 0,
                    `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
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
    } catch (\Throwable $e) {
        // Ignore on partial test schemas without write permissions or minimal mocks
    }
}

/**
 * Formats a database row or seed definition for `llm_models`.
 */
function formatLlmModelRow(array $row): array
{
    $strategy = (string)($row['execution_strategy'] ?? 'prompt_caching');
    if (!in_array($strategy, ['prompt_caching', 'batch_api', 'regular'], true)) {
        $strategy = 'prompt_caching';
    }
    return [
        'id'                  => (string)($row['id'] ?? ''),
        'provider'            => strtolower((string)($row['provider'] ?? 'openai')),
        'model_name'          => (string)($row['model_name'] ?? ''),
        'display_name'        => (string)($row['display_name'] ?? ''),
        'eu_hosted'           => !empty($row['eu_hosted']),
        'supports_web_search' => !empty($row['supports_web_search']),
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

    $strategy = (string)($data['execution_strategy'] ?? 'prompt_caching');
    if (!in_array($strategy, ['prompt_caching', 'batch_api', 'regular'], true)) {
        $strategy = 'prompt_caching';
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
            $strategy = in_array((string)$existing['execution_strategy'], ['prompt_caching', 'batch_api', 'regular'], true)
                ? (string)$existing['execution_strategy']
                : $strategy;
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
            execution_strategy, is_allowed, is_default, n8n_credential_name,
            n8n_sync_status, last_synced_at, sort_order
        ) VALUES (
            :id, :provider, :model_name, :display_name, :eu_hosted, :supports_web_search,
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
