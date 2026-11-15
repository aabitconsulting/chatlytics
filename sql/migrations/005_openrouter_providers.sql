-- =============================================================================
-- Migration 005: OpenRouter Provider Registry & Default Relevant Set (incl. meta)
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `openrouter_providers` (
  `provider_key` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_relevant` TINYINT(1) NOT NULL DEFAULT 0,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `discovered_model_count` INT NOT NULL DEFAULT 0,
  `sample_models` JSON NULL,
  `last_discovered_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`provider_key`),
  KEY `idx_op_relevant` (`is_relevant`, `provider_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `openrouter_providers` (`provider_key`, `display_name`, `is_relevant`, `is_default`, `discovered_model_count`, `sample_models`) VALUES
  ('openai', 'OpenAI', 1, 1, 0, '[]'),
  ('google', 'Google', 1, 1, 0, '[]'),
  ('anthropic', 'Anthropic', 1, 1, 0, '[]'),
  ('mistralai', 'Mistral AI', 1, 1, 0, '[]'),
  ('x-ai', 'xAI (Grok)', 1, 1, 0, '[]'),
  ('deepseek', 'DeepSeek', 1, 1, 0, '[]'),
  ('qwen', 'Qwen', 1, 1, 0, '[]'),
  ('xiaomi', 'Xiaomi', 1, 1, 0, '[]'),
  ('z-ai', 'Z.ai (GLM)', 1, 1, 0, '[]'),
  ('meta-llama', 'Meta Llama', 1, 1, 0, '[]'),
  ('meta', 'Meta (Muse Spark / Wonder)', 1, 1, 0, '[]'),
  ('nvidia', 'NVIDIA', 1, 1, 0, '[]'),
  ('azure', 'Azure OpenAI', 1, 1, 0, '[]'),
  ('microsoft', 'Microsoft', 1, 1, 0, '[]'),
  ('perplexity', 'Perplexity', 1, 1, 0, '[]'),
  ('moonshotai', 'Moonshot AI (Kimi)', 1, 1, 0, '[]'),
  ('minimax', 'MiniMax', 1, 1, 0, '[]');
