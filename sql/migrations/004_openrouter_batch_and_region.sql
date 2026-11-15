-- =============================================================================
-- Migration 004: OpenRouter Unified Gateway, Async Batch API,
-- Zero Prompt Caching, Market/Region Setting & Geographic Evaluation
-- =============================================================================

SET NAMES utf8mb4;

-- 1. Add optional market_region to tracking_configs
ALTER TABLE `tracking_configs`
  ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `keywords_prompts`;

-- 2. Extend llm_models for OpenRouter capabilities & disable prompt caching defaults
ALTER TABLE `llm_models`
  ADD COLUMN `supports_batch_api` TINYINT(1) NOT NULL DEFAULT 0 AFTER `supports_web_search`,
  ADD COLUMN `supports_tools` TINYINT(1) NOT NULL DEFAULT 1 AFTER `supports_batch_api`,
  MODIFY COLUMN `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch_api';

UPDATE `llm_models`
SET `eu_hosted` = 0,
    `execution_strategy` = CASE WHEN `supports_batch_api` = 1 THEN 'batch_api' ELSE 'regular' END
WHERE `execution_strategy` = 'prompt_caching' OR `eu_hosted` = 1;

-- 3. Extend batch_requests with market_region, supports_tools & batch polling audit fields
ALTER TABLE `batch_requests`
  MODIFY COLUMN `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
  ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt`,
  ADD COLUMN `supports_tools` TINYINT(1) NOT NULL DEFAULT 1 AFTER `search_enabled`,
  ADD COLUMN `last_polled_at` TIMESTAMP NULL DEFAULT NULL AFTER `submitted_at`,
  ADD COLUMN `batch_error_detail` TEXT COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `last_polled_at`;

-- 4. Extend llm_runs with geographic evaluation & regional citation telemetry
--    (keeps historical 'prompt_caching' ENUM value & columns for legacy read compatibility)
ALTER TABLE `llm_runs`
  MODIFY COLUMN `execution_strategy` ENUM('prompt_caching', 'batch_api', 'regular')
    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
  ADD COLUMN `market_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt`,
  ADD COLUMN `prompt_language` VARCHAR(16) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `market_region`,
  ADD COLUMN `effective_region` VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `prompt_language`,
  ADD COLUMN `region_source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `effective_region`,
  ADD COLUMN `regional_citation_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `competitor_cited`,
  ADD COLUMN `regional_citation_ratio` DECIMAL(5,2) NULL DEFAULT NULL AFTER `regional_citation_count`;

-- 5. Extend run_citations with regional TLD fit indicator
ALTER TABLE `run_citations`
  ADD COLUMN `is_regional_tld` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_competitor_domain`;
