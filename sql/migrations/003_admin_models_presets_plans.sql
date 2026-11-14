-- =============================================================================
-- Migration 003: Admin Model Management, Analyse-Sets (Model Presets),
-- Subscription Plan Configuration & Stripe Product/Price Mapping
-- =============================================================================

SET NAMES utf8mb4;

-- 1. Add optional preset_id to tracking_configs
ALTER TABLE `tracking_configs`
  ADD COLUMN `preset_id` VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL AFTER `competitors`;

-- 2. Table: llm_models (Managed LLM catalog & live n8n discovery state)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Table: model_presets (Pre-defined "Analyse-Sets" / "Model Presets")
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Table: subscription_plans (Plan entitlements & Stripe product/price mapping)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
