<?php
declare(strict_types=1);

/**
 * Chatlytics.de — Out-of-Webroot Configuration Template
 *
 * Production Path: /var/www/vhosts/chatlytics.de/env.php (strictly above webroot)
 * Local Dev Path:  c:\Users\aranba\Desktop\Antigravity\Chatlytics\env.php
 *
 * IMPORTANT: This file MUST NOT be committed with live production credentials.
 * Deploy as env.php outside the public webroot (httpdocs).
 */

return [
    'app' => [
        'env' => 'production', // 'development' or 'production'
        'debug' => false,
        'base_url' => 'https://chatlytics.de',
        'cors_allowed_origins' => [
            'https://chatlytics.de',
            'https://www.chatlytics.de',
            'http://localhost:8000',
            'http://localhost:3000',
        ],
        'session_name' => 'CHATLYTICS_SESSID',
        'session_lifetime' => 86400 * 7, // 7 days in seconds (604800)
        'work_email_validation' => true,
    ],
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'dbname' => 'chatlytics_db',
        'username' => 'chatlytics_user',
        'password' => 'ChangeThisToSecureSecretPass_2026!',
        'charset' => 'utf8mb4',
    ],
    'n8n' => [
        'webhook_url' => 'https://n8n.chatlytics.de/webhook/chatlytics-run',
        'shared_secret' => 'n8n_sec_99a8b7c6d5e4f3a2b1c0e9f8a7b6c5d4',
        'api_timeout_seconds' => 15,
    ],
    'stripe' => [
        'secret_key' => 'sk_live_YourStripeSecretKeyHere',
        'publishable_key' => 'pk_live_YourStripePublishableKeyHere',
        'webhook_secret' => 'whsec_YourStripeWebhookSecretHere',
        'prices' => [
            'starter' => 'price_starter_monthly_eur149',
            'growth' => 'price_growth_monthly_eur399',
            'credits_100' => 'price_topup_100_credits',
        ],
    ],
    'security' => [
        'jwt_secret' => 'super_secret_64_character_encryption_and_signing_key_chatlytics_2026',
        'rate_limit_per_minute' => 60,
    ],
];
