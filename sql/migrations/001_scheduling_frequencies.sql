-- =============================================================================
-- Migration 001: High-Frequency Tracking Schedules (12x daily to 1x weekly)
-- =============================================================================
-- Extends tracking_configs.schedule_interval ENUM with sub-daily presets:
--   every_2h  (12x daily)
--   every_4h  (6x daily)
--   every_6h  (4x daily)
--   every_12h (2x daily)
-- Preserves all existing values: manual, daily, weekly, biweekly, monthly.
-- =============================================================================

ALTER TABLE `tracking_configs`
  MODIFY COLUMN `schedule_interval`
  ENUM('manual', 'every_2h', 'every_4h', 'every_6h', 'every_12h', 'daily', 'weekly', 'biweekly', 'monthly')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'daily';
