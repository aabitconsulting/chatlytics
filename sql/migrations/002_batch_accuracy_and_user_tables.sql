-- =============================================================================
-- Migration 002: Data Mining Accuracy Tiers, Provider Prompt Caching / Batch API
-- Correlation (custom_id) & Per-User Result Tables
-- =============================================================================

SET NAMES utf8mb4;

-- 1. Migrate legacy schedule_interval values to the new 4-tier Data Mining Accuracy presets
UPDATE `tracking_configs`
SET `schedule_interval` = 'every_120m'
WHERE `schedule_interval` NOT IN ('every_120m', 'every_60m', 'every_30m', 'every_15m');

ALTER TABLE `tracking_configs`
  MODIFY COLUMN `schedule_interval`
    ENUM('every_120m', 'every_60m', 'every_30m', 'every_15m')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'every_120m',
  ADD COLUMN `datasets_per_day` INT UNSIGNED NOT NULL DEFAULT 12 AFTER `schedule_interval`,
  ADD COLUMN `initial_test_used` TINYINT(1) NOT NULL DEFAULT 0 AFTER `datasets_per_day`,
  ADD COLUMN `full_started_at` TIMESTAMP NULL DEFAULT NULL AFTER `initial_test_used`;

-- 2. Extend llm_runs with custom_id, batch_id, execution_strategy, prompt_cache_key, cached_tokens, is_test_run
ALTER TABLE `llm_runs`
  ADD COLUMN `custom_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `user_id`,
  ADD COLUMN `batch_id` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `custom_id`,
  ADD COLUMN `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prompt_caching' AFTER `batch_id`,
  ADD COLUMN `prompt_cache_key` VARCHAR(128) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `execution_strategy`,
  ADD COLUMN `cached_tokens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `prompt_cache_key`,
  ADD COLUMN `is_test_run` TINYINT(1) NOT NULL DEFAULT 0 AFTER `cached_tokens`,
  MODIFY COLUMN `status`
    ENUM('pending', 'queued_batch', 'running', 'completed', 'failed')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  ADD UNIQUE KEY `idx_runs_custom_id` (`custom_id`);

-- 3. Create batch_requests table for custom_id request-response correlation
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
