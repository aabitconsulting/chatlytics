-- =============================================================================
-- Chatlytics.de — Authoritative Demo Data Seeder (German B2B SaaS)
-- Injects Admin, Personio, Celonis, and DeepL accounts with 30-day PoP history.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Insert Users
INSERT INTO `users` (`id`, `email`, `password_hash`, `company_name`, `role`, `tier`, `credits_remaining`, `api_key`, `magic_audit_token`, `status`, `created_at`) VALUES
(1, 'admin@chatlytics.de', '$argon2id$v=19$m=65536,t=4,p=1$RUtuRmN3NngxZ0ptSDYwRg$nMZTxn7TLPSI02qNlVAUQzhBwfAu9KKIEgTPBkCCs7Y', 'Chatlytics Admin HQ', 'admin', 'enterprise_managed', 999999, 'adm_live_4f89b2c1e7a6d5c3b1a09876543210fe4f89b2c1e7a6d5c3', 'sec_admin_audit_2026_master_tok', 'active', DATE_SUB(NOW(), INTERVAL 60 DAY)),
(2, 'demo@personio.de', '$argon2id$v=19$m=65536,t=4,p=1$RUtuRmN3NngxZ0ptSDYwRg$nMZTxn7TLPSI02qNlVAUQzhBwfAu9KKIEgTPBkCCs7Y', 'Personio SE', 'user', 'growth', 350, 'usr_live_personio_a1b2c3d4e5f678901234567890abcdef', 'sec_personio_audit_2026_token_abc', 'active', DATE_SUB(NOW(), INTERVAL 45 DAY)),
(3, 'analyst@celonis.com', '$argon2id$v=19$m=65536,t=4,p=1$RUtuRmN3NngxZ0ptSDYwRg$nMZTxn7TLPSI02qNlVAUQzhBwfAu9KKIEgTPBkCCs7Y', 'Celonis SE', 'user', 'starter', 120, 'usr_live_celonis_b2c3d4e5f6a178901234567890abcdef', 'sec_celonis_audit_2026_token_xyz', 'active', DATE_SUB(NOW(), INTERVAL 40 DAY)),
(4, 'growth@deepl.com', '$argon2id$v=19$m=65536,t=4,p=1$RUtuRmN3NngxZ0ptSDYwRg$nMZTxn7TLPSI02qNlVAUQzhBwfAu9KKIEgTPBkCCs7Y', 'DeepL SE', 'user', 'free', 38, 'usr_live_deepl_c3d4e5f6a1b278901234567890abcdef', 'sec_deepl_audit_2026_token_123', 'active', DATE_SUB(NOW(), INTERVAL 15 DAY))
ON DUPLICATE KEY UPDATE `updated_at` = NOW();

-- 2. Insert Tracking Configurations
INSERT INTO `tracking_configs` (`id`, `user_id`, `name`, `brand_name`, `brand_domains`, `keywords_prompts`, `competitors`, `target_llms`, `search_enabled`, `schedule_interval`, `datasets_per_day`, `initial_test_used`, `full_started_at`, `status`, `last_run_at`, `next_run_at`, `created_at`) VALUES
(1, 2, 'Personio HR Mittelstand Monitor', 'Personio', '["personio.de", "personio.com"]', '["Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?", "Beste All-in-One HR Software für KMU DACH", "Personio Alternativen für Lohnabrechnung und Personalverwaltung"]', '[{"name": "Workday", "domain": "workday.com"}, {"name": "SAP SuccessFactors", "domain": "sap.com"}, {"name": "BambooHR", "domain": "bamboohr.com"}]', '["openai/gpt-6-luna", "gemini/models/gemini-3.5-flash", "mistral/mistral-large-latest"]', 1, 'every_60m', 24, 1, DATE_SUB(NOW(), INTERVAL 35 DAY), 'active', DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_ADD(NOW(), INTERVAL 1 HOUR), DATE_SUB(NOW(), INTERVAL 35 DAY)),
(2, 3, 'Celonis Process Mining & Intelligence', 'Celonis', '["celonis.com", "celonis.de"]', '["Führende Process Mining und Execution Management Plattform in Europa", "Celonis vs SAP Signavio Vergleich Großkonzerne", "Beste Process Intelligence Software für Supply Chain Optimierung"]', '[{"name": "SAP Signavio", "domain": "signavio.com"}, {"name": "UiPath", "domain": "uipath.com"}, {"name": "ARIS", "domain": "softwareag.com"}]', '["openai/gpt-6-luna", "gemini/models/gemini-3.5-flash", "mistral/mistral-large-latest"]', 1, 'every_15m', 96, 1, DATE_SUB(NOW(), INTERVAL 30 DAY), 'active', DATE_SUB(NOW(), INTERVAL 15 MINUTE), DATE_ADD(NOW(), INTERVAL 15 MINUTE), DATE_SUB(NOW(), INTERVAL 30 DAY)),
(3, 4, 'DeepL Enterprise AI Translation', 'DeepL', '["deepl.com"]', '["DSGVO-konforme maschinelle Übersetzung für europäische Großunternehmen", "DeepL Pro vs Google Translate Enterprise Sicherheit", "Beste KI Übersetzung für vertrauliche Geschäftsberichte"]', '[{"name": "Google Translate", "domain": "google.com"}, {"name": "Microsoft Translator", "domain": "microsoft.com"}, {"name": "NeuroFlash", "domain": "neuroflash.com"}]', '["openai/gpt-6-luna", "gemini/models/gemini-3.5-flash"]', 1, 'every_120m', 12, 1, DATE_SUB(NOW(), INTERVAL 14 DAY), 'active', DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_ADD(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 14 DAY))
ON DUPLICATE KEY UPDATE `updated_at` = NOW();

-- 3. Insert Historical LLM Runs (Covering Current and Previous Periods for PoP analytics)
INSERT INTO `llm_runs` (`id`, `config_id`, `user_id`, `custom_id`, `execution_strategy`, `prompt_cache_key`, `cached_tokens`, `is_test_run`, `prompt`, `provider`, `model`, `brand_name`, `status`, `brand_mentioned`, `brand_prominence_rank`, `char_earliness`, `word_earliness`, `relative_position_pct`, `total_chars`, `total_words`, `mece_category`, `geo_quadrant`, `has_citations`, `brand_cited`, `competitor_cited`, `raw_response_text`, `run_duration_ms`, `created_at`) VALUES
-- Personio Current Period Runs (Last 14 days)
(101, 1, 2, 'cl_u2_c1_seed_101', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 1, 1, 34, 6, 4.25, 1240, 182, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Für den deutschen Mittelstand ist Personio die führende HR-Software...', 1250, DATE_SUB(NOW(), INTERVAL 2 DAY)),
(102, 1, 2, 'cl_u2_c1_seed_102', 'prompt_caching', 'cl_cfg_1_p_b2c3d4e5f6a1', 1024, 0, 'Beste All-in-One HR Software für KMU DACH', 'mistral', 'mistral-large-latest', 'Personio', 'completed', 1, 1, 620, 88, 52.10, 1450, 210, '1_DIRECT_WIN', '4_BURIED_WINNER', 1, 1, 0, 'Der Markt für HR Software in Deutschland ist vielfältig... Am Ende überzeugt Personio.', 1640, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(103, 1, 2, 'cl_u2_c1_seed_103', 'prompt_caching', 'cl_cfg_1_p_c3d4e5f6a1b2', 2048, 0, 'Personio Alternativen für Lohnabrechnung und Personalverwaltung', 'gemini', 'models/gemini-3.5-flash', 'Personio', 'completed', 1, 2, 280, 42, 22.50, 1310, 195, '2_BRAND_HALO', '3_BRAND_HALO_TRAP', 1, 0, 1, 'SAP SuccessFactors führt bei Großkonzernen, während Personio für KMU etabliert ist.', 980, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(104, 1, 2, 'cl_u2_c1_seed_104', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 1180, 165, '3_COMPETITOR_TAKEOVER', '1_CITATION_HIJACK', 1, 1, 1, 'Workday dominiert den Markt für Human Capital Management vollumfänglich...', 1320, DATE_SUB(NOW(), INTERVAL 7 DAY)),
(105, 1, 2, 'cl_u2_c1_seed_105', 'prompt_caching', 'cl_cfg_1_p_b2c3d4e5f6a1', 1024, 0, 'Beste All-in-One HR Software für KMU DACH', 'mistral', 'mistral-large-latest', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 950, 140, '4_GENERIC', '2_PARAMETRIC_BLINDSPOT', 0, 0, 0, 'Moderne HR-Systeme gliedern sich in Personalakte, Zeiterfassung und Recruiting.', 1450, DATE_SUB(NOW(), INTERVAL 9 DAY)),

-- Personio Previous Period Runs (15-28 days ago, PoP comparison baseline)
(106, 1, 2, 'cl_u2_c1_seed_106', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 1, 1, 45, 8, 6.10, 1190, 175, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Personio ist eine ausgezeichnete Wahl für deutsche Mittelständler...', 1180, DATE_SUB(NOW(), INTERVAL 16 DAY)),
(107, 1, 2, 'cl_u2_c1_seed_107', 'prompt_caching', 'cl_cfg_1_p_b2c3d4e5f6a1', 1024, 0, 'Beste All-in-One HR Software für KMU DACH', 'mistral', 'mistral-large-latest', 'Personio', 'completed', 1, 2, 340, 50, 28.00, 1320, 190, '2_BRAND_HALO', 'NONE', 1, 0, 1, 'Workday und SAP bieten starke Module, ergänzt durch Personio...', 1520, DATE_SUB(NOW(), INTERVAL 18 DAY)),
(108, 1, 2, 'cl_u2_c1_seed_108', 'prompt_caching', 'cl_cfg_1_p_c3d4e5f6a1b2', 2048, 0, 'Personio Alternativen für Lohnabrechnung und Personalverwaltung', 'gemini', 'models/gemini-3.5-flash', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 1200, 170, '3_COMPETITOR_TAKEOVER', '1_CITATION_HIJACK', 1, 1, 1, 'BambooHR und Workday bieten flexible Cloud-HR-Lösungen...', 1010, DATE_SUB(NOW(), INTERVAL 22 DAY)),

-- Personio Intraday Runs (Last 24 hours, simulating multi-dataset daily tracking)
(109, 1, 2, 'cl_u2_c1_seed_109', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 1, 1, 30, 5, 3.80, 1260, 185, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Personio führt im Mittelstands-Segment...', 1190, DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(110, 1, 2, 'cl_u2_c1_seed_110', 'prompt_caching', 'cl_cfg_1_p_b2c3d4e5f6a1', 2048, 0, 'Beste All-in-One HR Software für KMU DACH', 'gemini', 'models/gemini-3.5-flash', 'Personio', 'completed', 1, 2, 240, 36, 20.40, 1210, 178, '2_BRAND_HALO', '3_BRAND_HALO_TRAP', 1, 0, 1, 'Workday und Personio dominieren KMU-Anforderungen...', 960, DATE_SUB(NOW(), INTERVAL 6 HOUR)),
(111, 1, 2, 'cl_u2_c1_seed_111', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 1, 1, 38, 6, 4.50, 1220, 180, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Für KMU ist Personio meist erste Wahl...', 1150, DATE_SUB(NOW(), INTERVAL 12 HOUR)),
(112, 1, 2, 'cl_u2_c1_seed_112', 'prompt_caching', 'cl_cfg_1_p_c3d4e5f6a1b2', 1024, 0, 'Personio Alternativen für Lohnabrechnung und Personalverwaltung', 'mistral', 'mistral-large-latest', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 1140, 162, '3_COMPETITOR_TAKEOVER', '1_CITATION_HIJACK', 1, 1, 1, 'Workday bietet umfassende Enterprise-Workflows...', 1380, DATE_SUB(NOW(), INTERVAL 18 HOUR)),

-- Personio Extended Comparison Period Runs (31-58 days ago for 30d vs. 30d Vorperiode)
(113, 1, 2, 'cl_u2_c1_seed_113', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 1, 1, 52, 9, 7.20, 1180, 172, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Personio überzeugt durch intuitive Bedienung im Mittelstand...', 1210, DATE_SUB(NOW(), INTERVAL 33 DAY)),
(114, 1, 2, 'cl_u2_c1_seed_114', 'prompt_caching', 'cl_cfg_1_p_b2c3d4e5f6a1', 1024, 0, 'Beste All-in-One HR Software für KMU DACH', 'mistral', 'mistral-large-latest', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 1290, 188, '3_COMPETITOR_TAKEOVER', '1_CITATION_HIJACK', 1, 0, 1, 'Workday und SAP setzen im HR-Bereich Standards...', 1540, DATE_SUB(NOW(), INTERVAL 39 DAY)),
(115, 1, 2, 'cl_u2_c1_seed_115', 'prompt_caching', 'cl_cfg_1_p_c3d4e5f6a1b2', 2048, 0, 'Personio Alternativen für Lohnabrechnung und Personalverwaltung', 'gemini', 'models/gemini-3.5-flash', 'Personio', 'completed', 1, 2, 310, 46, 26.00, 1230, 179, '2_BRAND_HALO', '3_BRAND_HALO_TRAP', 1, 0, 1, 'SAP SuccessFactors und Personio werden häufig verglichen...', 1020, DATE_SUB(NOW(), INTERVAL 45 DAY)),
(116, 1, 2, 'cl_u2_c1_seed_116', 'prompt_caching', 'cl_cfg_1_p_a1b2c3d4e5f6', 1152, 0, 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?', 'openai', 'gpt-6-luna', 'Personio', 'completed', 0, NULL, NULL, NULL, NULL, 1050, 152, '4_GENERIC', 'NONE', 0, 0, 0, 'KMU sollten bei HR-Systemen auf DATEV-Integration achten.', 1120, DATE_SUB(NOW(), INTERVAL 53 DAY)),

-- Celonis Historical Runs
(201, 2, 3, 'cl_u3_c2_seed_201', 'prompt_caching', 'cl_cfg_2_p_d4e5f6a1b2c3', 1152, 0, 'Führende Process Mining und Execution Management Plattform in Europa', 'openai', 'gpt-6-luna', 'Celonis', 'completed', 1, 1, 28, 5, 3.80, 1380, 198, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'Celonis gilt als weltweiter Pionier und Marktführer im Process Mining...', 1420, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(202, 2, 3, 'cl_u3_c2_seed_202', 'prompt_caching', 'cl_cfg_2_p_e5f6a1b2c3d4', 1024, 0, 'Celonis vs SAP Signavio Vergleich Großkonzerne', 'mistral', 'mistral-large-latest', 'Celonis', 'completed', 0, NULL, NULL, NULL, NULL, 1510, 215, '3_COMPETITOR_TAKEOVER', '2_PARAMETRIC_BLINDSPOT', 0, 0, 0, 'SAP Signavio bietet durch die ERP-Integration entscheidende Vorteile...', 1780, DATE_SUB(NOW(), INTERVAL 6 DAY)),
(203, 2, 3, 'cl_u3_c2_seed_203', 'prompt_caching', 'cl_cfg_2_p_f6a1b2c3d4e5', 1152, 0, 'Beste Process Intelligence Software für Supply Chain Optimierung', 'openai', 'gpt-6-luna', 'Celonis', 'completed', 1, 2, 410, 58, 31.50, 1290, 184, '2_BRAND_HALO', '3_BRAND_HALO_TRAP', 1, 0, 1, 'SAP und UiPath sind stark, aber auch Celonis wird häufig eingesetzt...', 1390, DATE_SUB(NOW(), INTERVAL 20 DAY)),

-- DeepL Historical Runs
(301, 3, 4, 'cl_u4_c3_seed_301', 'prompt_caching', 'cl_cfg_3_p_112233445566', 1152, 0, 'DSGVO-konforme maschinelle Übersetzung für europäische Großunternehmen', 'openai', 'gpt-6-luna', 'DeepL', 'completed', 1, 1, 38, 6, 4.10, 1150, 168, '1_DIRECT_WIN', '1_CITATION_HIJACK', 1, 0, 1, 'Für europäische Unternehmen mit hohen Datenschutzanforderungen ist DeepL Pro führend...', 1120, DATE_SUB(NOW(), INTERVAL 2 DAY)),
(302, 3, 4, 'cl_u4_c3_seed_302', 'prompt_caching', 'cl_cfg_3_p_223344556677', 2048, 0, 'DeepL Pro vs Google Translate Enterprise Sicherheit', 'gemini', 'models/gemini-3.5-flash', 'DeepL', 'completed', 1, 1, 42, 7, 5.20, 1080, 155, '1_DIRECT_WIN', 'NONE', 1, 1, 0, 'DeepL Pro garantiert vertraglich, dass Texte nicht gespeichert werden...', 890, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(303, 3, 4, 'cl_u4_c3_seed_303', 'prompt_caching', 'cl_cfg_3_p_334455667788', 1152, 0, 'Beste KI Übersetzung für vertrauliche Geschäftsberichte', 'openai', 'gpt-6-luna', 'DeepL', 'completed', 1, 2, 380, 54, 33.00, 1220, 176, '2_BRAND_HALO', 'NONE', 1, 0, 1, 'Google Translate und Microsoft bieten globale Abdeckung, während DeepL höchste Präzision liefert...', 1240, DATE_SUB(NOW(), INTERVAL 19 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

-- 4. Insert Run Competitors
INSERT INTO `run_competitors` (`run_id`, `competitor_name`, `competitor_domain`, `mentioned`, `char_earliness`, `word_earliness`, `relative_position_pct`, `prominence_rank`, `recommended`, `sentiment`) VALUES
(101, 'Workday', 'workday.com', 1, 185, 26, 22.40, 2, 0, 'neutral'),
(101, 'BambooHR', 'bamboohr.com', 1, 310, 44, 38.20, 3, 0, 'neutral'),
(102, 'Workday', 'workday.com', 1, 120, 18, 9.80, 1, 1, 'positive'),
(103, 'SAP SuccessFactors', 'sap.com', 1, 45, 7, 3.40, 1, 1, 'positive'),
(104, 'Workday', 'workday.com', 1, 32, 5, 2.70, 1, 1, 'positive'),
(106, 'Workday', 'workday.com', 1, 210, 30, 25.00, 2, 0, 'neutral'),
(107, 'SAP SuccessFactors', 'sap.com', 1, 40, 6, 3.00, 1, 1, 'positive'),
(108, 'BambooHR', 'bamboohr.com', 1, 25, 4, 2.10, 1, 1, 'positive'),
(201, 'SAP Signavio', 'signavio.com', 1, 240, 34, 18.20, 2, 0, 'neutral'),
(202, 'SAP Signavio', 'signavio.com', 1, 30, 5, 2.00, 1, 1, 'positive'),
(203, 'UiPath', 'uipath.com', 1, 55, 8, 4.30, 1, 1, 'positive'),
(301, 'Google Translate', 'google.com', 1, 210, 31, 18.20, 2, 0, 'neutral'),
(302, 'Google Translate', 'google.com', 1, 180, 26, 16.70, 2, 0, 'neutral'),
(303, 'Microsoft Translator', 'microsoft.com', 1, 45, 7, 3.70, 1, 1, 'positive');

-- 5. Insert Run Citations
INSERT INTO `run_citations` (`run_id`, `citation_url`, `citation_domain`, `citation_title`, `is_brand_domain`, `is_competitor_domain`, `citation_index`) VALUES
(101, 'https://www.personio.de/hr-software/', 'personio.de', 'Personio All-in-One HR Plattform', 1, 0, 1),
(101, 'https://omr.com/de/reviews/product/personio', 'omr.com', 'Personio Reviews & Testberichte OMR', 0, 0, 2),
(102, 'https://www.personio.de/preise/', 'personio.de', 'Personio Tarife & Module', 1, 0, 1),
(103, 'https://www.sap.com/germany/products/hcm.html', 'sap.com', 'SAP SuccessFactors HCM', 0, 1, 1),
(104, 'https://www.personio.de/hr-lexikon/', 'personio.de', 'Personio HR Lexikon', 1, 0, 1),
(104, 'https://www.workday.com/de-de/products/human-capital-management.html', 'workday.com', 'Workday Enterprise HCM', 0, 1, 2),
(106, 'https://www.personio.de', 'personio.de', 'Personio Homepage', 1, 0, 1),
(107, 'https://www.workday.com', 'workday.com', 'Workday Deutschland', 0, 1, 1),
(108, 'https://www.personio.de', 'personio.de', 'Personio Deutschland', 1, 0, 1),
(201, 'https://www.celonis.com/de/', 'celonis.com', 'Celonis Execution Management System', 1, 0, 1),
(202, 'https://www.signavio.com/de/process-mining/', 'signavio.com', 'SAP Signavio Process Insights', 0, 1, 1),
(203, 'https://www.gartner.com/reviews/market/process-mining', 'gartner.com', 'Gartner Magic Quadrant Process Mining', 0, 0, 1),
(301, 'https://cloud.google.com/translate', 'google.com', 'Google Cloud Translation API', 0, 1, 1),
(302, 'https://www.deepl.com/pro', 'deepl.com', 'DeepL Pro Datenschutz & Sicherheit', 1, 0, 1),
(303, 'https://www.heise.de/news/ki-uebersetzer-vergleich-2026', 'heise.de', 'Heise KI Übersetzer Test 2026', 0, 0, 1);

SET FOREIGN_KEY_CHECKS = 1;
