<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Thread-Safe Native PDO Database Singleton
 *
 * Implements strict UTF-8 connection caching, disabled emulated prepares,
 * non-persistent connection pooling (preventing FastCGI starvation),
 * and exception-driven error handling.
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

            $initCommandAttr = class_exists('Pdo\Mysql')
                ? \Pdo\Mysql::ATTR_INIT_COMMAND
                : PDO::MYSQL_ATTR_INIT_COMMAND;

            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false, // Enforce native prepared statements (prevents SQL injection)
                PDO::ATTR_PERSISTENT => false,        // Avoid connection pool starvation on FastCGI / Plesk
                $initCommandAttr => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
            ];

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
