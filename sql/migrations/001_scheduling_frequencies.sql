-- =============================================================================
-- Migration 001: High-Frequency Data Mining Accuracy Schedules
-- =============================================================================
-- Defines tracking_configs.schedule_interval ENUM with 4 Data Mining Accuracy presets:
--   every_120m (12 datasets/day per LLM — Starter default)
--   every_60m  (24 datasets/day per LLM — Standard)
--   every_30m  (48 datasets/day per LLM — High)
--   every_15m  (96 datasets/day per LLM — Precision)
-- =============================================================================

ALTER TABLE `tracking_configs`
  MODIFY COLUMN `schedule_interval`
  ENUM('every_120m', 'every_60m', 'every_30m', 'every_15m')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'every_120m';
