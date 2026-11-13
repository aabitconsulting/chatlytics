-- =============================================================================
-- Chatlytics.de — Authoritative Database Schema (MySQL 8.0+ / MariaDB 10.11+)
-- Charset: utf8mb4 | Collation: utf8mb4_unicode_ci | Engine: InnoDB
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- Table 1: users
-- Stores user accounts, authentication credentials, roles, credit balances,
-- and subscription billing metadata.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `role` ENUM('user', 'admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `tier` ENUM('free', 'starter', 'growth', 'enterprise_managed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'free',
  `credits_remaining` INT NOT NULL DEFAULT 40,
  `api_key` VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `magic_audit_token` VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `stripe_customer_id` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `stripe_subscription_id` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `status` ENUM('active', 'suspended', 'pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_email` (`email`),
  UNIQUE KEY `idx_users_api_key` (`api_key`),
  UNIQUE KEY `idx_users_magic_audit_token` (`magic_audit_token`),
  KEY `idx_users_stripe_cust` (`stripe_customer_id`),
  KEY `idx_users_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 2: tracking_configs
-- Stores Prompt-Keyword-Brand monitoring configurations created by users.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tracking_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_domains` JSON NOT NULL,
  `keywords_prompts` JSON NOT NULL,
  `competitors` JSON NOT NULL,
  `target_llms` JSON NOT NULL,
  `search_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `schedule_interval` ENUM('every_120m', 'every_60m', 'every_30m', 'every_15m') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'every_120m',
  `datasets_per_day` INT UNSIGNED NOT NULL DEFAULT 12,
  `initial_test_used` TINYINT(1) NOT NULL DEFAULT 0,
  `full_started_at` TIMESTAMP NULL DEFAULT NULL,
  `status` ENUM('active', 'paused', 'archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `last_run_at` TIMESTAMP NULL DEFAULT NULL,
  `next_run_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tc_user_id` (`user_id`),
  KEY `idx_tc_user_status` (`user_id`, `status`),
  KEY `idx_tc_queue_poll` (`status`, `full_started_at`, `schedule_interval`, `next_run_at`),
  CONSTRAINT `fk_tc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 3: llm_runs
-- Stores individual prompt evaluation results across models.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `llm_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
  `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `cached_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_test_run` TINYINT(1) NOT NULL DEFAULT 0,
  `prompt` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` ENUM('pending', 'queued_batch', 'running', 'completed', 'failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  `brand_mentioned` TINYINT(1) NOT NULL DEFAULT 0,
  `brand_prominence_rank` INT NULL DEFAULT NULL,
  `char_earliness` INT NULL DEFAULT NULL,
  `word_earliness` INT NULL DEFAULT NULL,
  `relative_position_pct` DECIMAL(5,2) NULL DEFAULT NULL,
  `total_chars` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_words` INT UNSIGNED NOT NULL DEFAULT 0,
  `mece_category` ENUM('1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC') COLLATE utf8mb4_unicode_ci NOT NULL,
  `geo_quadrant` ENUM('1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NONE',
  `has_citations` TINYINT(1) NOT NULL DEFAULT 0,
  `brand_cited` TINYINT(1) NOT NULL DEFAULT 0,
  `competitor_cited` TINYINT(1) NOT NULL DEFAULT 0,
  `raw_prompt_payload` JSON NULL DEFAULT NULL,
  `raw_response_text` MEDIUMTEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `raw_response_payload` JSON NULL DEFAULT NULL,
  `error_message` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `run_duration_ms` INT UNSIGNED NULL DEFAULT NULL,
  `cost_credits` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_runs_custom_id` (`custom_id`),
  KEY `idx_runs_config_created` (`config_id`, `created_at`),
  KEY `idx_runs_user_created` (`user_id`, `created_at`),
  KEY `idx_runs_user_status` (`user_id`, `status`),
  KEY `idx_runs_mece` (`mece_category`),
  KEY `idx_runs_geo_quadrant` (`geo_quadrant`),
  KEY `idx_runs_provider_model` (`provider`, `model`),
  KEY `idx_runs_brand_mentioned` (`brand_mentioned`),
  CONSTRAINT `fk_runs_config` FOREIGN KEY (`config_id`) REFERENCES `tracking_configs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_runs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 4: run_competitors
-- Stores competitor mentions, prominence ranks, and recommendations per run.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `run_competitors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `competitor_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `competitor_domain` VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `mentioned` TINYINT(1) NOT NULL DEFAULT 1,
  `char_earliness` INT NULL DEFAULT NULL,
  `word_earliness` INT NULL DEFAULT NULL,
  `relative_position_pct` DECIMAL(5,2) NULL DEFAULT NULL,
  `prominence_rank` INT NULL DEFAULT NULL,
  `recommended` TINYINT(1) NOT NULL DEFAULT 0,
  `sentiment` ENUM('positive', 'neutral', 'negative') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'neutral',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rc_run_id` (`run_id`),
  KEY `idx_rc_comp_name` (`competitor_name`),
  KEY `idx_rc_comp_rec` (`competitor_name`, `recommended`),
  CONSTRAINT `fk_rc_run` FOREIGN KEY (`run_id`) REFERENCES `llm_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 5: run_citations
-- Stores extracted grounding citations, source domains, and attribution.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `run_citations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `citation_url` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `citation_domain` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `citation_title` VARCHAR(512) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `is_brand_domain` TINYINT(1) NOT NULL DEFAULT 0,
  `is_competitor_domain` TINYINT(1) NOT NULL DEFAULT 0,
  `citation_index` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cit_run_id` (`run_id`),
  KEY `idx_cit_domain` (`citation_domain`),
  KEY `idx_cit_brand_domain` (`is_brand_domain`),
  KEY `idx_cit_comp_domain` (`is_competitor_domain`),
  CONSTRAINT `fk_cit_run` FOREIGN KEY (`run_id`) REFERENCES `llm_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 6: batch_requests
-- Tracks all dispatched LLM requests across prompt_caching, batch_api, and
-- regular execution strategies using a unique custom_id for deferred matching.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `batch_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
  `provider_batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `run_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `config_id` BIGINT UNSIGNED NOT NULL,
  `prompt` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_domains` JSON NOT NULL,
  `competitors` JSON NOT NULL,
  `search_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_test_run` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('queued', 'submitted', 'completed', 'failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued',
  `scheduled_for` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` TIMESTAMP NULL DEFAULT NULL,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_br_custom_id` (`custom_id`),
  KEY `idx_br_provider_batch` (`provider`, `provider_batch_id`, `status`),
  KEY `idx_br_user_config` (`user_id`, `config_id`, `status`),
  CONSTRAINT `fk_br_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_br_config` FOREIGN KEY (`config_id`) REFERENCES `tracking_configs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Dynamic Per-User Physical Table Template: user_results_<user_id>
-- Provisioned automatically per user via ensureUserResultsTable($db, $userId)
-- in api/db.php on signup, demo seeding, and ingestion.
--
-- CREATE TABLE IF NOT EXISTS `user_results_<user_id>` (
--   `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
--   `run_id` BIGINT UNSIGNED NULL DEFAULT NULL,
--   `config_id` BIGINT UNSIGNED NULL DEFAULT NULL,
--   `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
--   `batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
--   `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching',
--   `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
--   `cached_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
--   `trigger_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch_queue',
--   `is_test_run` TINYINT(1) NOT NULL DEFAULT 0,
--   `prompt` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
--   `llm_answer` MEDIUMTEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
--   `provider` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
--   `model` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
--   `brand_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
--   `status` ENUM('completed', 'failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
--   `brand_mentioned` TINYINT(1) NOT NULL DEFAULT 0,
--   `char_earliness` INT NULL DEFAULT NULL,
--   `word_earliness` INT NULL DEFAULT NULL,
--   `relative_position_pct` DECIMAL(5,2) NULL DEFAULT NULL,
--   `total_chars` INT UNSIGNED NOT NULL DEFAULT 0,
--   `total_words` INT UNSIGNED NOT NULL DEFAULT 0,
--   `mece_category` ENUM('1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '4_GENERIC',
--   `geo_quadrant` ENUM('1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NONE',
--   `brand_cited` TINYINT(1) NOT NULL DEFAULT 0,
--   `competitor_cited` TINYINT(1) NOT NULL DEFAULT 0,
--   `competitors_json` JSON NULL DEFAULT NULL,
--   `citations_json` JSON NULL DEFAULT NULL,
--   `error_message` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
--   `scheduled_at` TIMESTAMP NULL DEFAULT NULL,
--   `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   PRIMARY KEY (`id`),
--   UNIQUE KEY `idx_ur_custom_id` (`custom_id`),
--   KEY `idx_ur_config_created` (`config_id`, `created_at`),
--   KEY `idx_ur_model_created` (`provider`, `model`, `created_at`),
--   KEY `idx_ur_mece` (`mece_category`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- -----------------------------------------------------------------------------

SET FOREIGN_KEY_CHECKS = 1;
