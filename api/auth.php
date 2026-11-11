<?php
declare(strict_types=1);

/**
 * Chatlytics.de - Freemium Work-Email Authentication Endpoint
 * File: api/auth.php
 *
 * Supported Actions:
 * - POST /api/auth.php?action=signup  (or JSON body: { action: "signup", email, password, company_name })
 * - POST /api/auth.php?action=login   (or JSON body: { action: "login", email, password })
 * - POST /api/auth.php?action=logout  (or GET /api/auth.php?action=logout)
 * - GET  /api/auth.php?action=me      (or GET /api/auth.php)
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';

// Secure Session Initialization
if (session_status() === PHP_SESSION_NONE) {
    $config = getConfig();
    $sessionLifetime = (int)($config['app']['session_lifetime'] ?? 604800);
    $isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';

    session_set_cookie_params([
        'lifetime' => $sessionLifetime,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name((string)($config['app']['session_name'] ?? 'CHATLYTICS_SESSID'));
    session_start();
}

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestData = getRequestData();
$action = (string)($_GET['action'] ?? $requestData['action'] ?? '');

if ($action === '') {
    $action = ($requestMethod === 'GET') ? 'me' : 'login';
}

switch ($action) {
    case 'signup':
        handleSignup($requestData);
        break;

    case 'login':
        handleLogin($requestData);
        break;

    case 'logout':
        handleLogout();
        break;

    case 'me':
        handleMe();
        break;

    default:
        jsonError("Invalid action: {$action}", 400);
        break;
}

/**
 * Handle new user signup with work-email filtering, Argon2id hashing, and 40 credits default.
 */
function handleSignup(array $data): void {
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');
    $companyName = isset($data['company_name']) ? trim((string)$data['company_name']) : null;

    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError("A valid email address is required.", 422);
    }

    // Corporate Work-Email Filtering
    $parts = explode('@', $email);
    if (count($parts) !== 2) {
        jsonError("Invalid email address format.", 422);
    }
    $domain = strtolower(trim($parts[1]));

    $disallowedDomains = [
        'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com',
        'outlook.com', 'live.com', 'icloud.com', 'gmx.de', 'gmx.net', 'web.de',
        't-online.de', 'freenet.de', 'mail.ru', 'protonmail.com', 'proton.me',
        'yandex.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
        'guerrillamail.com', 'mailinator.com', 'trashmail.com'
    ];

    $isDisallowed = false;
    foreach ($disallowedDomains as $disallowed) {
        if ($domain === $disallowed || str_ends_with($domain, '.' . $disallowed)) {
            $isDisallowed = true;
            break;
        }
    }

    if ($isDisallowed) {
        jsonError("Please register with your corporate / work email address.", 422);
    }

    if (strlen($password) < 8) {
        jsonError("Password must be at least 8 characters long.", 422);
    }

    $db = getDb();

    // Check duplicate email
    $checkStmt = $db->prepare("SELECT id FROM users WHERE email = :email LIMIT 1");
    $checkStmt->execute([':email' => $email]);
    if ($checkStmt->fetch()) {
        jsonError("An account with this email already exists.", 409);
    }

    // Password Hashing with Argon2id and fallback
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    $options = defined('PASSWORD_ARGON2ID') ? [
        'memory_cost' => 65536,
        'time_cost'   => 4,
        'threads'     => 1,
    ] : ['cost' => 12];
    $passwordHash = password_hash($password, $algo, $options);

    // Default User Allocation
    $apiKey = bin2hex(random_bytes(32));
    $magicAuditToken = bin2hex(random_bytes(24));
    $creditsDefault = 40;
    $roleDefault = 'user';
    $tierDefault = 'free';
    $statusDefault = 'active';

    $insertSql = "
        INSERT INTO users (
            email, password_hash, company_name, role, tier,
            credits_remaining, api_key, magic_audit_token, status
        ) VALUES (
            :email, :password_hash, :company_name, :role, :tier,
            :credits, :api_key, :magic_audit_token, :status
        )
    ";

    $insertStmt = $db->prepare($insertSql);
    $insertStmt->execute([
        ':email'             => $email,
        ':password_hash'     => $passwordHash,
        ':company_name'      => ($companyName !== '' ? $companyName : null),
        ':role'              => $roleDefault,
        ':tier'              => $tierDefault,
        ':credits'           => $creditsDefault,
        ':api_key'           => $apiKey,
        ':magic_audit_token' => $magicAuditToken,
        ':status'            => $statusDefault,
    ]);

    $newUserId = (int)$db->lastInsertId();
    $_SESSION['user_id'] = $newUserId;

    $userPayload = [
        'id'                => $newUserId,
        'email'             => $email,
        'company_name'      => $companyName,
        'role'              => $roleDefault,
        'tier'              => $tierDefault,
        'credits'           => $creditsDefault,
        'credits_remaining' => $creditsDefault,
        'api_key'           => $apiKey,
        'magic_audit_token' => $magicAuditToken,
        'status'            => $statusDefault,
    ];

    jsonResponse([
        'token'   => $apiKey,
        'user'    => $userPayload,
        'message' => 'Registration successful.',
    ], 201);
}

/**
 * Handle user login with Argon2id password verification and session creation.
 */
function handleLogin(array $data): void {
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');

    if ($email === '' || $password === '') {
        jsonError("Email and password are required.", 422);
    }

    $db = getDb();
    $stmt = $db->prepare("SELECT * FROM users WHERE email = :email LIMIT 1");
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        jsonError("Invalid email or password.", 401);
    }

    if (($user['status'] ?? '') !== 'active') {
        jsonError("Account is inactive or suspended.", 403);
    }

    // Rehash if Argon2id parameters updated
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    $options = defined('PASSWORD_ARGON2ID') ? [
        'memory_cost' => 65536,
        'time_cost'   => 4,
        'threads'     => 1,
    ] : ['cost' => 12];

    if (password_needs_rehash((string)$user['password_hash'], $algo, $options)) {
        $newHash = password_hash($password, $algo, $options);
        $rehashStmt = $db->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
        $rehashStmt->execute([':hash' => $newHash, ':id' => $user['id']]);
    }

    // Ensure API key and magic audit token are present
    $needsUpdate = false;
    $apiKey = $user['api_key'] ?? '';
    $magicToken = $user['magic_audit_token'] ?? '';

    if (empty($apiKey)) {
        $apiKey = bin2hex(random_bytes(32));
        $needsUpdate = true;
    }
    if (empty($magicToken)) {
        $magicToken = bin2hex(random_bytes(24));
        $needsUpdate = true;
    }

    if ($needsUpdate) {
        $tokStmt = $db->prepare("UPDATE users SET api_key = :api_key, magic_audit_token = :token WHERE id = :id");
        $tokStmt->execute([':api_key' => $apiKey, ':token' => $magicToken, ':id' => $user['id']]);
    }

    $_SESSION['user_id'] = (int)$user['id'];

    $userPayload = [
        'id'                => (int)$user['id'],
        'email'             => $user['email'],
        'company_name'      => $user['company_name'] ?? null,
        'role'              => $user['role'],
        'tier'              => $user['tier'],
        'credits'           => (int)$user['credits_remaining'],
        'credits_remaining' => (int)$user['credits_remaining'],
        'api_key'           => $apiKey,
        'magic_audit_token' => $magicToken,
        'status'            => $user['status'],
    ];

    jsonResponse([
        'token'   => $apiKey,
        'user'    => $userPayload,
        'message' => 'Login successful.',
    ], 200);
}

/**
 * Handle user logout and session invalidation.
 */
function handleLogout(): void {
    $_SESSION = [];

    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params["path"],
            $params["domain"],
            $params["secure"],
            $params["httponly"]
        );
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }

    jsonResponse([
        'message' => 'Logged out successfully.'
    ], 200);
}

/**
 * Return currently authenticated user profile.
 */
function handleMe(): void {
    $currentUser = getCurrentUser(false);

    if (!$currentUser) {
        jsonError("Unauthorized.", 401);
    }

    $userPayload = [
        'id'                => (int)$currentUser['id'],
        'email'             => $currentUser['email'],
        'company_name'      => $currentUser['company_name'] ?? null,
        'role'              => $currentUser['role'],
        'tier'              => $currentUser['tier'],
        'credits'           => (int)$currentUser['credits_remaining'],
        'credits_remaining' => (int)$currentUser['credits_remaining'],
        'api_key'           => $currentUser['api_key'],
        'magic_audit_token' => $currentUser['magic_audit_token'],
        'status'            => $currentUser['status'],
        'created_at'        => $currentUser['created_at'],
    ];

    jsonResponse([
        'token' => $currentUser['api_key'],
        'user'  => $userPayload,
    ], 200);
}
