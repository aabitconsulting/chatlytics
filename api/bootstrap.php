<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Universal API Bootstrap
 *
 * Included at the top of all API endpoints (/api/*.php).
 * Handles:
 * - Cascading out-of-webroot configuration resolution
 * - Strict error reporting & global JSON exception/error handling
 * - Security headers & CORS negotiation (including preflight OPTIONS)
 * - Uniform API response envelope helpers (jsonResponse, jsonError)
 * - Safe request payload parsing (JSON body, POST, GET)
 * - 3-tier Identity & Authentication resolution (Bearer token, Session, Magic Audit)
 * - 3-tier Provider Execution Strategy Cascade (prompt_caching -> batch_api -> regular)
 * - 4-tier Data Mining Accuracy Schedules (every_120m, every_60m, every_30m, every_15m)
 */

// -----------------------------------------------------------------------------
// 1. Cascading Configuration Resolution
// -----------------------------------------------------------------------------

final class Config
{
    private static ?array $config = null;

    /**
     * Resolves configuration via 4-tier cascade:
     * 1. CHATLYTICS_CONFIG_PATH environment variable override
     * 2. dirname(__DIR__, 2) . '/env.php' (Plesk standard: strictly above webroot)
     * 3. __DIR__ . '/../env.php' (Local project root)
     * 4. __DIR__ . '/../env.example.php' (Safe fallback)
     *
     * @return array
     */
    public static function get(): array
    {
        if (self::$config !== null) {
            return self::$config;
        }

        $candidates = [];

        // 1. Explicit environment variable override
        $envPath = getenv('CHATLYTICS_CONFIG_PATH');
        if ($envPath !== false && is_string($envPath) && trim($envPath) !== '') {
            $candidates[] = trim($envPath);
        }

        // 2. Plesk standard: strictly above webroot (e.g. /var/www/vhosts/chatlytics.de/env.php)
        $candidates[] = dirname(__DIR__, 2) . '/env.php';

        // 3. Local project root
        $candidates[] = __DIR__ . '/../env.php';

        // 4. Safe fallback: example template
        $candidates[] = __DIR__ . '/../env.example.php';

        foreach ($candidates as $candidate) {
            if (file_exists($candidate) && is_readable($candidate)) {
                $loaded = require $candidate;
                if (is_array($loaded)) {
                    self::$config = $loaded;
                    return self::$config;
                }
            }
        }

        // Safe default fallback structure if no file is present
        self::$config = [
            'app' => [
                'env' => 'development',
                'debug' => true,
                'base_url' => 'http://localhost:8000',
                'cors_allowed_origins' => ['http://localhost:8000', 'https://chatlytics.de'],
                'session_name' => 'CHATLYTICS_SESSID',
                'session_lifetime' => 604800,
                'work_email_validation' => true,
            ],
            'db' => [
                'host' => '127.0.0.1',
                'port' => 3306,
                'dbname' => 'chatlytics_db',
                'username' => 'chatlytics_user',
                'password' => '',
                'charset' => 'utf8mb4',
            ],
            'n8n' => [
                'webhook_url' => 'https://n8n.chatlytics.de/webhook/chatlytics-run',
                'shared_secret' => '',
                'api_timeout_seconds' => 15,
            ],
            'stripe' => [
                'secret_key' => '',
                'publishable_key' => '',
                'webhook_secret' => '',
                'prices' => ['starter' => '', 'growth' => '', 'credits_100' => ''],
            ],
            'security' => [
                'jwt_secret' => '',
                'rate_limit_per_minute' => 60,
            ],
        ];

        return self::$config;
    }

    /**
     * Explicitly set or mock configuration (useful for automated testing).
     *
     * @param array|null $customConfig
     * @return void
     */
    public static function set(?array $customConfig): void
    {
        self::$config = $customConfig;
    }

    /**
     * Reset cached configuration.
     *
     * @return void
     */
    public static function reset(): void
    {
        self::$config = null;
    }
}

/**
 * Global helper to access loaded configuration array.
 *
 * @return array
 */
function getConfig(): array
{
    return Config::get();
}

// -----------------------------------------------------------------------------
// 2. Error Reporting & Exception Handlers
// -----------------------------------------------------------------------------

error_reporting(E_ALL);

$appConfig = getConfig()['app'] ?? [];
$isDebug = !empty($appConfig['debug']);

if ($isDebug) {
    ini_set('display_errors', '1');
    ini_set('display_startup_errors', '1');
} else {
    ini_set('display_errors', '0');
    ini_set('display_startup_errors', '0');
}

// Global Exception Handler
set_exception_handler(function (Throwable $e) use ($isDebug): void {
    error_log(sprintf(
        "[Chatlytics Uncaught Exception] %s: %s in %s:%d\nStack trace:\n%s",
        get_class($e),
        $e->getMessage(),
        $e->getFile(),
        $e->getLine(),
        $e->getTraceAsString()
    ));

    $statusCode = 500;
    if ($e instanceof InvalidArgumentException) {
        $statusCode = 400;
    }

    $message = $isDebug
        ? sprintf('%s: %s in %s:%d', get_class($e), $e->getMessage(), $e->getFile(), $e->getLine())
        : 'An internal server error occurred.';

    jsonError($message, $statusCode, $isDebug ? ['trace' => explode("\n", $e->getTraceAsString())] : []);
});

// Global Error Handler converting warnings/notices to ErrorException (ignoring deprecations)
set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline): bool {
    if ($errno === E_DEPRECATED || $errno === E_USER_DEPRECATED) {
        return true;
    }
    if (!(error_reporting() & $errno)) {
        return false;
    }
    throw new ErrorException($errstr, 0, $errno, $errfile, $errline);
});

// Fatal error shutdown handler
register_shutdown_function(function () use ($isDebug): void {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log(sprintf(
            "[Chatlytics Fatal Error] %s in %s:%d",
            $error['message'],
            $error['file'],
            $error['line']
        ));
        $message = $isDebug
            ? sprintf('Fatal Error: %s in %s:%d', $error['message'], $error['file'], $error['line'])
            : 'A fatal server error occurred.';
        jsonError($message, 500);
    }
});

// -----------------------------------------------------------------------------
// 3. Security Headers & CORS Negotiation
// -----------------------------------------------------------------------------

function sendSecurityHeaders(): void
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('X-XSS-Protection: 1; mode=block');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.stripe.com;");
}

function handleCors(): void
{
    $config = getConfig();
    $allowedOrigins = $config['app']['cors_allowed_origins'] ?? [];
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        if (!headers_sent()) {
            header("Access-Control-Allow-Origin: {$origin}");
            header('Access-Control-Allow-Credentials: true');
            header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Audit-Token, X-Chatlytics-Cron-Key, X-N8N-Secret, X-Chatlytics-Ingest-Key, X-Requested-With');
            header('Access-Control-Max-Age: 86400');
        }
    }

    // Preflight OPTIONS handler
    if (isset($_SERVER['REQUEST_METHOD']) && strtoupper($_SERVER['REQUEST_METHOD']) === 'OPTIONS') {
        if (!headers_sent()) {
            http_response_code(204);
        }
        exit;
    }
}

sendSecurityHeaders();
handleCors();

// -----------------------------------------------------------------------------
// 4. Uniform JSON Response & Input Parsing Helpers
// -----------------------------------------------------------------------------

/**
 * Output a standardized JSON response envelope and terminate execution.
 *
 * @param mixed $data Primary response data
 * @param int $statusCode HTTP status code (default 200)
 * @param array $headers Optional custom headers
 * @param string $message Optional custom message
 * @return void
 */
function jsonResponse(mixed $data = null, int $statusCode = 200, array $headers = [], string $message = ''): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    if (!headers_sent()) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');

        foreach ($headers as $headerName => $headerValue) {
            header("{$headerName}: {$headerValue}");
        }
    }

    $status = ($statusCode >= 200 && $statusCode < 400) ? 'success' : 'error';
    $payload = [
        'status' => $status,
        'code' => $statusCode,
        'message' => $message !== '' ? $message : ($status === 'success' ? 'OK' : 'Error'),
        'data' => $data,
    ];

    // Surface top-level keys if data is an associative array for maximum client compatibility
    if (is_array($data)) {
        foreach ($data as $key => $value) {
            if (!array_key_exists($key, $payload)) {
                $payload[$key] = $value;
            }
        }
    }

    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Output a standardized JSON error response envelope and terminate execution.
 *
 * @param string $message Error description
 * @param int $statusCode HTTP error status code (default 400)
 * @param array $errors Optional array of detailed validation errors
 * @return void
 */
function jsonError(string $message, int $statusCode = 400, array $errors = []): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    if (!headers_sent()) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
    }

    $payload = [
        'status' => 'error',
        'code' => $statusCode,
        'message' => $message,
        'data' => !empty($errors) ? ['errors' => $errors] : null,
        'errors' => $errors,
    ];

    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Seamlessly parses request parameters from JSON body, POST, and GET.
 *
 * @return array
 */
function getRequestData(): array
{
    $rawInput = file_get_contents('php://input');
    $jsonData = [];
    if ($rawInput !== false && $rawInput !== '') {
        $decoded = json_decode($rawInput, true);
        if (is_array($decoded)) {
            $jsonData = $decoded;
        }
    }

    return array_merge($_GET, $_POST, $jsonData);
}

// -----------------------------------------------------------------------------
// 5. Session Management Helper
// -----------------------------------------------------------------------------

function startSessionIfNeeded(): void
{
    if (session_status() === PHP_SESSION_NONE && !headers_sent()) {
        $config = getConfig();
        $sessionName = $config['app']['session_name'] ?? 'CHATLYTICS_SESSID';
        $lifetime = (int)($config['app']['session_lifetime'] ?? (86400 * 7));

        session_name($sessionName);
        session_set_cookie_params([
            'lifetime' => $lifetime,
            'path' => '/',
            'domain' => '',
            'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }
}

// -----------------------------------------------------------------------------
// 6. Identity & Authentication Resolvers
// -----------------------------------------------------------------------------

/**
 * Extracts Bearer token from HTTP request headers.
 *
 * @return string|null
 */
function getBearerToken(): ?string
{
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? null;

    if ($authHeader === null && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? null;
    }

    if ($authHeader !== null && preg_match('/^Bearer\s+(.+)$/i', trim($authHeader), $matches)) {
        return trim($matches[1]);
    }

    return null;
}

/**
 * Extracts and validates Magic Audit token from query string or header.
 *
 * @return string|null
 */
function getMagicAuditToken(): ?string
{
    $token = $_GET['audit_token']
        ?? $_SERVER['HTTP_X_AUDIT_TOKEN']
        ?? null;

    if ($token !== null && is_string($token)) {
        $clean = trim($token);
        if (strlen($clean) >= 16 && strlen($clean) <= 64 && preg_match('/^[a-zA-Z0-9_-]+$/', $clean)) {
            return $clean;
        }
    }

    return null;
}

/**
 * 3-Tier Identity Resolution:
 * 1. Authorization: Bearer <api_key> (resolving users.api_key)
 * 2. PHP Session $_SESSION['user_id'] (resolving users.id)
 * 3. Magic Audit Token (?audit_token=... or X-Audit-Token) when $allowMagicAudit === true
 *
 * @param bool $allowMagicAudit Whether to resolve read-only Magic Audit token
 * @return array|null User profile array or null if unauthenticated
 */
function getCurrentUser(bool $allowMagicAudit = false): ?array
{
    // Lazy include db.php if getDb function is not yet registered
    if (!function_exists('getDb')) {
        $dbPath = __DIR__ . '/db.php';
        if (file_exists($dbPath)) {
            require_once $dbPath;
        }
    }

    // 1. Bearer Token Resolution
    $bearerToken = getBearerToken();
    if ($bearerToken !== null && $bearerToken !== '') {
        try {
            if (function_exists('getDb')) {
                $db = getDb();
                $stmt = $db->prepare('SELECT * FROM users WHERE api_key = :api_key AND status = "active" LIMIT 1');
                $stmt->execute([':api_key' => $bearerToken]);
                $user = $stmt->fetch();
                if ($user) {
                    unset($user['password_hash']);
                    $user['is_audit_mode'] = false;
                    return $user;
                }
            }
        } catch (Throwable $e) {
            error_log("Bearer auth resolution error: " . $e->getMessage());
        }
    }

    // 2. Session Authentication Resolution
    startSessionIfNeeded();
    if (!empty($_SESSION['user_id'])) {
        try {
            if (function_exists('getDb')) {
                $db = getDb();
                $stmt = $db->prepare('SELECT * FROM users WHERE id = :id AND status = "active" LIMIT 1');
                $stmt->execute([':id' => $_SESSION['user_id']]);
                $user = $stmt->fetch();
                if ($user) {
                    unset($user['password_hash']);
                    $user['is_audit_mode'] = false;
                    return $user;
                }
            }
        } catch (Throwable $e) {
            error_log("Session auth resolution error: " . $e->getMessage());
        }
    }

    // 3. Magic Audit Token Resolution
    if ($allowMagicAudit) {
        $auditToken = getMagicAuditToken();
        if ($auditToken !== null) {
            try {
                if (function_exists('getDb')) {
                    $db = getDb();
                    $stmt = $db->prepare('SELECT * FROM users WHERE magic_audit_token = :token AND status = "active" LIMIT 1');
                    $stmt->execute([':token' => $auditToken]);
                    $user = $stmt->fetch();
                    if ($user) {
                        unset($user['password_hash']);
                        $user['is_audit_mode'] = true;
                        return $user;
                    }
                }
            } catch (Throwable $e) {
                error_log("Magic audit token resolution error: " . $e->getMessage());
            }
        }
    }

    return null;
}

/**
 * Requires an authenticated user session, Bearer token, or valid Magic Audit token.
 * Terminates with HTTP 401 if unauthenticated.
 *
 * @param bool $allowMagicAudit
 * @return array
 */
function requireAuth(bool $allowMagicAudit = false): array
{
    $user = getCurrentUser($allowMagicAudit);
    if ($user === null) {
        jsonError("Unauthorized: Authentication required", 401);
    }
    return $user;
}

/**
 * Requires an authenticated user with 'admin' role.
 * Terminates with HTTP 403 if unauthorized. Magic Audit tokens are strictly rejected.
 *
 * @return array
 */
function requireAdmin(): array
{
    $user = requireAuth(false);
    if (($user['role'] ?? '') !== 'admin') {
        jsonError("Forbidden: Administrator privileges required", 403);
    }
    return $user;
}

/**
 * Guard preventing mutation operations in Magic Audit mode.
 *
 * @param array|null $user
 * @return void
 */
function requireWritePermission(?array $user = null): void
{
    if ($user !== null && !empty($user['is_audit_mode'])) {
        jsonError("Forbidden: Write operations are disabled in Magic Audit mode", 403);
    }
}

// -----------------------------------------------------------------------------
// 6. Target LLM Catalog, Canonical Model Resolution & Provider Prompt Caching
// -----------------------------------------------------------------------------

/**
 * Returns the default canonical OpenRouter provider namespaces for Chatlytics.
 * Includes `meta` (Muse Spark / Wonder etc.) alongside `meta-llama`.
 *
 * @return array<int, string>
 */
function getDefaultOpenRouterProviders(): array
{
    return [
        'openai',
        'google',
        'anthropic',
        'mistralai',
        'x-ai',
        'deepseek',
        'qwen',
        'xiaomi',
        'z-ai',
        'meta-llama',
        'meta',
        'nvidia',
        'azure',
        'microsoft',
        'perplexity',
        'moonshotai',
        'minimax',
    ];
}

/**
 * Expands canonical OpenRouter provider keys with recognized alias prefixes.
 *
 * @param array<int, string> $providers
 * @return array<int, string>
 */
function expandOpenRouterProviderAliases(array $providers): array
{
    $result = [];
    $seen = [];
    $add = static function (string $key) use (&$result, &$seen): void {
        $normalized = strtolower(trim($key));
        if ($normalized === '' || isset($seen[$normalized])) {
            return;
        }
        $seen[$normalized] = true;
        $result[] = $normalized;
    };

    foreach ($providers as $provider) {
        $p = strtolower(trim((string)$provider));
        if ($p === '') {
            continue;
        }
        $add($p);
        if ($p === 'z-ai') {
            $add('zhipu');
        } elseif ($p === 'moonshotai') {
            $add('moonshot');
        }
    }

    return $result;
}

/**
 * Returns the whitelisted OpenRouter provider namespaces (including canonical alias variants)
 * used to filter live model discovery and catalog administration.
 * Reads admin-configured `is_relevant = 1` providers from `openrouter_providers` when `$db`
 * is provided and seeded, falling back to `getDefaultOpenRouterProviders()`.
 *
 * @return array<int, string>
 */
function getAllowedOpenRouterProviders(?PDO $db = null): array
{
    if ($db !== null) {
        try {
            $totalCount = (int)$db->query("SELECT COUNT(*) FROM openrouter_providers")->fetchColumn();
            if ($totalCount > 0) {
                $stmt = $db->query("SELECT provider_key FROM openrouter_providers WHERE is_relevant = 1 ORDER BY provider_key ASC");
                $rows = $stmt->fetchAll(PDO::FETCH_COLUMN);
                return expandOpenRouterProviderAliases(is_array($rows) ? $rows : []);
            }
        } catch (\Throwable $e) {
            // Fall back to default set if table is missing in partial schemas/tests
        }
    }

    return expandOpenRouterProviderAliases(getDefaultOpenRouterProviders());
}

/**
 * Resolves any bare provider alias, legacy Chatlytics slug, or canonical OpenRouter `provider/model`
 * token into unified OpenRouter routing metadata without prompt caching:
 *   - 'batch_api': Scheduled execution without live web search on batch-capable OpenRouter models
 *   - 'regular':   Immediate execution (`search_enabled = true`, `is_test_run = true`, or no batch support)
 *
 * @param string $rawToken
 * @param string $scheduleInterval
 * @param bool $searchEnabled
 * @param bool $isTestRun
 * @param bool|null $supportsBatchOverride
 * @param bool|null $supportsToolsOverride
 * @return array{id:string,provider:string,model:string,eu_hosted:bool,supports_prompt_caching:bool,supports_batch_api:bool,supports_tools:bool,execution_strategy:string}
 */
function resolveTargetLlmSpec(
    string $rawToken,
    string $scheduleInterval = 'every_120m',
    bool $searchEnabled = false,
    bool $isTestRun = false,
    ?bool $supportsBatchOverride = null,
    ?bool $supportsToolsOverride = null
): array {
    $clean = trim($rawToken);
    if ($clean === '') {
        return [
            'id'                      => '',
            'provider'                => '',
            'model'                   => '',
            'eu_hosted'               => false,
            'supports_prompt_caching' => false,
            'supports_batch_api'      => false,
            'supports_tools'          => false,
            'execution_strategy'      => 'regular',
        ];
    }

    $hasBatchSuffix = false;
    if (str_ends_with(strtolower($clean), ':batch')) {
        $hasBatchSuffix = true;
        $clean = substr($clean, 0, -6);
    } elseif (str_ends_with(strtolower($clean), ':online')) {
        $clean = substr($clean, 0, -7);
    }

    $lower = strtolower($clean);
    $provider = '';
    $model = '';

    if (str_contains($clean, '/')) {
        [$rawProv, $rawModel] = explode('/', $clean, 2);
        $provLower = strtolower(trim($rawProv));
        $modelTrim = trim($rawModel);
        $modelTrimLower = strtolower($modelTrim);

        if ($provLower === 'models' && str_starts_with($modelTrimLower, 'gemini')) {
            $provider = 'google';
            $model = $modelTrim;
        } elseif ($provLower === 'gemini' || $provLower === 'google') {
            $provider = 'google';
            $stripped = str_starts_with($modelTrimLower, 'models/') ? substr($modelTrim, 7) : $modelTrim;
            $model = $stripped !== '' ? $stripped : 'gemini-4-hydrogen';
        } elseif ($provLower === 'openai') {
            $provider = 'openai';
            $model = $modelTrim !== '' ? $modelTrim : 'gpt-6-luna';
        } elseif ($provLower === 'mistral' || $provLower === 'mistralai' || $provLower === 'eu-mistral') {
            if ($modelTrimLower === 'mistral-medium-latest' || $modelTrim === '') {
                $provider = 'mistralai';
                $model = 'mistral-medium-3-5';
            } elseif ($modelTrimLower === 'mistral-large-latest') {
                $provider = 'mistralai';
                $model = 'mistral-large-4-0';
            } elseif ($modelTrimLower === 'zai-glm-5-3') {
                $provider = 'z-ai';
                $model = 'glm-5.3';
            } elseif ($modelTrimLower === 'zai-glm-5-3-flash') {
                $provider = 'z-ai';
                $model = 'glm-5.3-flash';
            } else {
                $provider = 'mistralai';
                $model = $modelTrim;
            }
        } elseif ($provLower === 'glm' || $provLower === 'zai' || $provLower === 'z.ai' || $provLower === 'z-ai') {
            $provider = 'z-ai';
            if ($modelTrim === '' || $modelTrimLower === 'zai-glm-5-3' || $modelTrimLower === 'glm-5-3') {
                $model = 'glm-5.3';
            } elseif ($modelTrimLower === 'zai-glm-5-3-flash' || $modelTrimLower === 'glm-5-3-flash') {
                $model = 'glm-5.3-flash';
            } else {
                $model = $modelTrim;
            }
        } elseif ($provLower === 'anthropic') {
            $provider = 'anthropic';
            if ($modelTrim === '' || $modelTrimLower === 'claude-3-5-sonnet-20241022') {
                $model = 'claude-sonnet-5.5';
            } else {
                $model = $modelTrim;
            }
        } else {
            $provider = $provLower;
            $model = $modelTrim;
        }
    } else {
        if ($lower === 'openai') {
            $provider = 'openai';
            $model = 'gpt-6-luna';
        } elseif (str_starts_with($lower, 'gpt-') || preg_match('/^o[134](-|$)/', $lower) === 1) {
            $provider = 'openai';
            $model = $clean;
        } elseif ($lower === 'gemini' || $lower === 'google') {
            $provider = 'google';
            $model = 'gemini-4-hydrogen';
        } elseif (str_starts_with($lower, 'gemini-')) {
            $provider = 'google';
            $model = $clean;
        } elseif ($lower === 'mistral' || $lower === 'mistralai' || $lower === 'mistral-medium-latest') {
            $provider = 'mistralai';
            $model = 'mistral-medium-3-5';
        } elseif ($lower === 'mistral-large-latest') {
            $provider = 'mistralai';
            $model = 'mistral-large-4-0';
        } elseif (
            str_starts_with($lower, 'mistral-')
            || str_starts_with($lower, 'pixtral-')
            || str_starts_with($lower, 'codestral-')
            || str_starts_with($lower, 'ministral-')
            || str_starts_with($lower, 'devstral-')
        ) {
            $provider = 'mistralai';
            $model = $clean;
        } elseif ($lower === 'glm' || $lower === 'glm-5-3' || $lower === 'zai-glm-5-3') {
            $provider = 'z-ai';
            $model = 'glm-5.3';
        } elseif ($lower === 'glm-5-3-flash' || $lower === 'zai-glm-5-3-flash') {
            $provider = 'z-ai';
            $model = 'glm-5.3-flash';
        } elseif (str_starts_with($lower, 'zai-glm') || str_starts_with($lower, 'glm-')) {
            $provider = 'z-ai';
            $model = str_starts_with($lower, 'zai-') ? substr($clean, 4) : $clean;
        } elseif ($lower === 'anthropic' || $lower === 'claude-3-5-sonnet-20241022') {
            $provider = 'anthropic';
            $model = 'claude-sonnet-5.5';
        } elseif (str_starts_with($lower, 'claude-')) {
            $provider = 'anthropic';
            $model = $clean;
        } elseif (str_starts_with($lower, 'grok-')) {
            $provider = 'x-ai';
            $model = $clean;
        } elseif (str_starts_with($lower, 'deepseek-')) {
            $provider = 'deepseek';
            $model = $clean;
        } elseif (str_starts_with($lower, 'qwen')) {
            $provider = 'qwen';
            $model = $clean;
        } elseif (str_starts_with($lower, 'muse-')) {
            $provider = 'meta';
            $model = $clean;
        } elseif (str_starts_with($lower, 'minimax-')) {
            $provider = 'minimax';
            $model = $clean;
        } elseif (str_starts_with($lower, 'sonar')) {
            $provider = 'perplexity';
            $model = $clean;
        } else {
            $provider = $lower;
            $model = $clean;
        }
    }

    $canonicalId = $model !== '' ? ($provider . '/' . $model) : $provider;
    $modelLower = strtolower($model);
    $canonicalSchedule = normalizeScheduleInterval($scheduleInterval);
    unset($canonicalSchedule);

    if ($supportsBatchOverride !== null) {
        $supportsBatchApi = $supportsBatchOverride;
    } elseif ($hasBatchSuffix) {
        $supportsBatchApi = true;
    } else {
        $knownBatchModels = [
            'google/gemini-4-hydrogen',
            'google/gemini-4-neon',
            'google/gemini-3.5-flash',
            'openai/gpt-6-luna',
            'openai/gpt-6.1-terra',
            'openai/gpt-6.2-sol',
            'anthropic/claude-sonnet-5.5',
            'anthropic/claude-opus-5.5',
            'mistralai/mistral-medium-3-5',
            'z-ai/glm-5.3',
            'z-ai/glm-5.3-flash',
        ];
        $supportsBatchApi = in_array($canonicalId, $knownBatchModels, true)
            || (in_array($provider, ['openai', 'google', 'anthropic'], true)
                && !str_contains($modelLower, 'image')
                && !str_contains($modelLower, 'preview-customtools'));
    }

    $supportsTools = ($supportsToolsOverride !== null)
        ? $supportsToolsOverride
        : ($provider !== 'perplexity');

    $executionStrategy = (!$isTestRun && !$searchEnabled && $supportsBatchApi)
        ? 'batch_api'
        : 'regular';

    return [
        'id'                      => $canonicalId,
        'provider'                => $provider,
        'model'                   => $model,
        'eu_hosted'               => false,
        'supports_prompt_caching' => false,
        'supports_batch_api'      => $supportsBatchApi,
        'supports_tools'          => $supportsTools,
        'execution_strategy'      => $executionStrategy,
    ];
}

/**
 * Input Prompt Caching has been retired; always returns null so no cache keys are created or attached.
 */
function buildPromptCacheKey(int $configId, string $prompt, string $model = ''): ?string
{
    return null;
}

/**
 * Returns non-caching OpenRouter execution metadata for the given model and execution mode.
 *
 * @return array<string, mixed>
 */
function buildProviderCachingConfig(
    string $provider,
    string $model,
    ?string $promptCacheKey = null,
    string $scheduleInterval = 'every_120m',
    bool $searchEnabled = false,
    bool $isTestRun = false,
    ?bool $supportsBatchOverride = null,
    ?bool $supportsToolsOverride = null
): array {
    $spec = resolveTargetLlmSpec(
        $provider . '/' . $model,
        $scheduleInterval,
        $searchEnabled,
        $isTestRun,
        $supportsBatchOverride,
        $supportsToolsOverride
    );

    return [
        'gateway'            => 'openrouter',
        'strategy'           => $spec['execution_strategy'],
        'prompt_cache_key'   => null,
        'supports_batch_api' => $spec['supports_batch_api'],
        'supports_tools'     => $spec['supports_tools'],
        'endpoint'           => $spec['execution_strategy'] === 'batch_api' ? '/api/v1/batches' : '/api/v1/chat/completions',
    ];
}

/**
 * Normalizes a single target_llms token to its canonical provider/model identifier.
 */
function normalizeTargetLlmToken(string $rawToken): string
{
    return resolveTargetLlmSpec($rawToken)['id'];
}

/**
 * Normalizes a mixed string/array target_llms list into unique canonical tokens.
 *
 * @param mixed $rawTargetLlms
 * @param array<int, string> $fallback
 * @return array<int, string>
 */
function normalizeTargetLlmsList($rawTargetLlms, array $fallback = ['google/gemini-4-hydrogen', 'openai/gpt-6-luna']): array
{
    if (is_string($rawTargetLlms)) {
        $rawTargetLlms = explode(',', $rawTargetLlms);
    }
    if (!is_array($rawTargetLlms)) {
        $rawTargetLlms = [];
    }

    $normalized = [];
    foreach ($rawTargetLlms as $entry) {
        if (!is_string($entry) && !is_numeric($entry)) {
            continue;
        }
        $canon = normalizeTargetLlmToken((string)$entry);
        if ($canon !== '') {
            $normalized[] = $canon;
        }
    }

    $normalized = array_values(array_unique($normalized));
    if (empty($normalized)) {
        return array_values(array_unique(array_map('normalizeTargetLlmToken', $fallback)));
    }
    return $normalized;
}

// -----------------------------------------------------------------------------
// 7. Data Mining Accuracy Schedules & Tier Entitlements
// -----------------------------------------------------------------------------

/**
 * Returns the canonical whitelist of persisted tracking_configs.schedule_interval values.
 *
 * - every_120m: Starter   — 12 datasets/day per LLM (every 120 minutes)
 * - every_60m:  Standard  — 24 datasets/day per LLM (every 60 minutes)
 * - every_30m:  High      — 48 datasets/day per LLM (every 30 minutes)
 * - every_15m:  Precision — 96 datasets/day per LLM (every 15 minutes)
 *
 * @return array<int, string>
 */
function getValidScheduleIntervals(): array
{
    return ['every_120m', 'every_60m', 'every_30m', 'every_15m'];
}

/**
 * Normalizes human/API Data Mining Accuracy interval aliases to canonical tokens.
 */
function normalizeScheduleInterval(string $raw): string
{
    $clean = strtolower(trim($raw));
    return match ($clean) {
        'every_120m', '120m', 'every_2h', '2h', '12x', '12x_daily', '12x-daily', 'starter', '12'   => 'every_120m',
        'every_60m', '60m', 'every_1h', '1h', '24x', '24x_daily', '24x-daily', 'standard', '24'   => 'every_60m',
        'every_30m', '30m', '48x', '48x_daily', '48x-daily', 'high', '48'                         => 'every_30m',
        'every_15m', '15m', '96x', '96x_daily', '96x-daily', 'precision', '96'                    => 'every_15m',
        default                                                                                    => $clean,
    };
}

/**
 * Returns true if the Data Mining Accuracy interval is above the Starter (every_120m / 12x) tier.
 */
function isHighFrequencySchedule(string $interval): bool
{
    $canonical = normalizeScheduleInterval($interval);
    return in_array($canonical, ['every_60m', 'every_30m', 'every_15m'], true);
}

/**
 * Checks whether the authenticated user's tier/role permits the requested Data Mining Accuracy tier.
 * When a subscription plan record is provided, validates against its configurable `allowed_intervals`.
 */
function canUserUseScheduleInterval(array $user, string $interval, ?array $plan = null): bool
{
    if (strtolower((string)($user['role'] ?? 'user')) === 'admin') {
        return true;
    }
    $canonical = normalizeScheduleInterval($interval);
    if ($plan !== null && !empty($plan['allowed_intervals']) && is_array($plan['allowed_intervals'])) {
        return in_array($canonical, $plan['allowed_intervals'], true);
    }
    if (!isHighFrequencySchedule($canonical)) {
        return true;
    }
    $tier = strtolower((string)($user['tier'] ?? 'free'));
    return in_array($tier, ['starter', 'growth', 'enterprise_managed'], true);
}

/**
 * Returns the datasets per day per LLM for a given Data Mining Accuracy interval.
 */
function getScheduleRunsPerDay(string $interval): float
{
    $canonical = normalizeScheduleInterval($interval);
    return match ($canonical) {
        'every_120m' => 12.0,
        'every_60m'  => 24.0,
        'every_30m'  => 48.0,
        'every_15m'  => 96.0,
        default      => 0.0,
    };
}
