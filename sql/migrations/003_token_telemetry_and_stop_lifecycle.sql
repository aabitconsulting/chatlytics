-- =============================================================================
-- Migration 003: Input/Output Token Telemetry & Irreversible Stop / Archive / 90-Day Soft-Delete Lifecycle
-- =============================================================================

-- 1. Extend tracking_configs status ENUM and lifecycle timestamps
ALTER TABLE `tracking_configs`
  MODIFY COLUMN `status` ENUM('active', 'paused', 'stopped', 'archived', 'deleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS `stopped_at` TIMESTAMP NULL DEFAULT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `archived_at` TIMESTAMP NULL DEFAULT NULL AFTER `stopped_at`,
  ADD COLUMN IF NOT EXISTS `deleted_at` TIMESTAMP NULL DEFAULT NULL AFTER `archived_at`,
  ADD INDEX `idx_tc_status_deleted` (`status`, `deleted_at`);

-- 2. Add input_tokens and output_tokens to llm_runs
ALTER TABLE `llm_runs`
  ADD COLUMN IF NOT EXISTS `input_tokens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `prompt_cache_key`,
  ADD COLUMN IF NOT EXISTS `output_tokens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `input_tokens`;

-- Note: Physical per-user tables (`user_results_<user_id>`) are automatically
-- created or altered with `input_tokens` and `output_tokens` by `ensureUserResultsTable()` in `api/db.php`.
