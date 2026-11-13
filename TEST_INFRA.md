# TEST_INFRA.md — Chatlytics.de E2E Testing Infrastructure

## 1. Overview & Testing Philosophy

Chatlytics.de employs an **opaque-box, requirement-driven, multi-tier testing architecture**. The platform guarantees complete behavioral compliance across all generative AI visibility telemetry, deterministic German Unicode metrics, Plesk PHP 8.5 endpoints, MySQL 8.0 schema, and bilingual corporate SaaS interfaces without relying on facades or superficial stubs.

### Key Principles
1. **Opaque-Box Requirement Verification**: Tests evaluate system inputs, observed outputs, state mutations, and contract conformance strictly against specifications documented in `PROJECT.md`, `ORIGINAL_REQUEST.md`, and technical surveys.
2. **Deterministic Output Derivation**: Every test assertion is derived from authoritative specifications (mathematical formulas, truth tables, schema DDL constraints, and RFC compliance).
3. **Progressive Testability & Graceful Hybrid Binding**:
   - Tests execute against production artifacts (`n8n/`, `api/`, `sql/`, `assets/`, `index.html`, etc.) when present.
   - When intermediate milestones are in flight, tests utilize canonical requirement oracles (`tests/helpers/reference_engine.js`) to assert contract compliance without blocking parallel worker pipelines.
4. **Adversarial & Boundary Rigor**: Input encoding, German umlauts (`ä, ö, ü, ß`, `ẞ`, transliterations), zero-credit guards, SQL injection immunity, atomic queue locking, and timeout fail-safes are thoroughly tested.

---

## 2. Directory Layout

```
tests/
├── helpers/
│   ├── reference_engine.js      # Canonical mathematical metric oracle, MECE & GEO logic
│   ├── assertions.js            # Custom domain assertion utilities
│   ├── fixtures.js              # Authoritative enterprise test payloads (Personio, Celonis, DeepL)
│   └── php_runner.js            # PHP CLI execution and syntax checker wrapper
├── tier1_features/              # >=5 test cases per feature (Features 1 through 29)
│   ├── f01_unicode_metric_engine.test.js
│   ├── f02_mece_classifier.test.js
│   ├── f03_geo_diagnostics.test.js
│   ├── f04_metric_unit_test_harness.test.js
│   ├── f05_n8n_workflow_json.test.js
│   ├── f06_triple_triggers.test.js
│   ├── f07_async_queue_response.test.js
│   ├── f08_provider_routing.test.js
│   ├── f09_grounding_extraction.test.js
│   ├── f10_response_formatters.test.js
│   ├── f11_n8n_guide.test.js
│   ├── f12_mysql_schema.test.js
│   ├── f13_env_config.test.js
│   ├── f14_bootstrap_db.test.js
│   ├── f15_freemium_auth.test.js
│   ├── f16_admin_users.test.js
│   ├── f17_configs_crud.test.js
│   ├── f18_trigger_run.test.js
│   ├── f19_queue_poller.test.js
│   ├── f20_ingest_pipeline.test.js
│   ├── f21_pop_analytics.test.js
│   ├── f22_stripe_webhook.test.js
│   ├── f23_css_design_system.test.js
│   ├── f24_i18n_dictionary.test.js
│   ├── f25_landing_page.test.js
│   ├── f26_client_dashboard.test.js
│   ├── f27_magic_audit_mode.test.js
│   ├── f28_owner_cockpit.test.js
│   └── f29_client_js_modules.test.js
├── tier2_boundaries/            # Boundary, stress & corner cases (>=5 tests per feature domain)
│   ├── b01_metric_boundaries.test.js
│   ├── b02_workflow_boundaries.test.js
│   ├── b03_backend_boundaries.test.js
│   └── b04_frontend_boundaries.test.js
├── tier3_combinations/          # Cross-feature pairwise interaction suites
│   ├── comb_normalizer_to_router.test.js
│   ├── comb_router_to_metrics.test.js
│   ├── comb_metrics_to_ingest.test.js
│   ├── comb_ingest_to_reports.test.js
│   ├── comb_reports_to_dashboard.test.js
│   ├── comb_queue_to_worker.test.js
│   └── comb_stripe_to_credits.test.js
├── tier4_scenarios/             # Real-world European enterprise lifecycle scenarios
│   ├── scenario_personio_vs_workday.test.js
│   ├── scenario_celonis_vs_sap.test.js
│   └── scenario_deepl_vs_google.test.js
└── run_all_e2e.js               # Master test runner script
```

---

## 3. Test Tier Definitions

### Tier 1: Feature Coverage (Features 1–29)
- **Target**: >= 5 rigorous test cases for every individual feature in `PROJECT.md` Feature Inventory (Features 1 through 29).
- **Scope**:
  - Algorithm accuracy (earliness, position percentages, word/char counts).
  - Complete MECE truth table coverage (`1_DIRECT_WIN`, `2_BRAND_HALO`, `3_COMPETITOR_TAKEOVER`, `4_GENERIC`).
  - All 4 GEO quadrants (`1_CITATION_HIJACK`, `2_PARAMETRIC_BLINDSPOT`, `3_BRAND_HALO_TRAP`, `4_BURIED_WINNER`).
  - n8n workflow JSON structure, 16 nodes, switch ports, dynamic search tools.
  - MySQL DDL syntax, foreign keys, indexes, cascades.
  - PHP 8.5 bootstrap, PDO singleton, work-email validator, Argon2id auth, configs CRUD.
  - Atomic queue poller, memory-safe SQL PoP analytics, pure PHP Stripe HMAC verification.
  - Design tokens, WCAG AA contrast, bilingual dictionary, landing page, dashboard, admin cockpit.

### Tier 2: Boundary & Corner Cases
- **Target**: >= 5 edge-case tests per feature domain.
- **Scope**:
  - Empty string prompts, 1-character texts, extreme token lengths (>32k characters).
  - German uppercase sharp S (`ẞ`), mixed umlaut transliterations (`Muenchen` vs `München`), accented variations.
  - Negative and zero credit balance protections, race conditions during credit reservation.
  - Disposable email domains (`mailinator.com`, `tempmail.com`), unverified work emails.
  - Malformed Stripe webhook signatures, replay timestamp skew (>300 seconds).
  - Deadlocks, missing database configuration, out-of-bounds period filters (`400d`).
  - Zero-data dashboard states, empty competitor arrays, null grounding chunks.

### Tier 3: Cross-Feature Combinations
- **Target**: Pairwise integration verification between interconnected subsystems.
- **Scope**:
  - Normalizer ➔ Dynamic Provider Router (shorthand and JSON input expanding into provider items).
  - Provider response ➔ Secondary Extractor ➔ Unicode Metric Engine.
  - Metric Engine ➔ Ingest Webhook contract payload.
  - Ingest transactional writes ➔ Reports PoP SQL analytics.
  - Reports API JSON ➔ Dashboard metric rendering & 4-Quadrant GEO panel.
  - Schedule Poller queue claim ➔ Workflow execution ➔ Ingestion.
  - Stripe checkout event ➔ User credit balance upgrade ➔ Trigger Run authorization.

### Tier 4: Real-World Application Scenarios
- **Target**: Full-lifecycle European B2B enterprise simulations.
- **Scope**:
  - **Personio vs. Workday**: HR Mittelstand query lifecycle — work-email registration, config setup, LLM query dispatch, grounding citation parsing (`haufe.de`, `omr.com`), `1_DIRECT_WIN` classification, PoP trend generation, and read-only Magic Audit share link generation.
  - **Celonis vs. SAP Signavio**: Process Intelligence query lifecycle — competitive takeover detection, late-earliness `4_BURIED_WINNER` diagnostic triggering, and tactical recommendation generation.
  - **DeepL vs. Google Translate**: Enterprise translation query lifecycle — GDPR / data sovereignty query, Unicode case-folding verification, `1_CITATION_HIJACK` diagnostic resolution, and Stripe subscription upgrade.

---

## 4. Execution Commands

### Running the Full Master E2E Suite
```bash
node tests/run_all_e2e.js
```
The master runner executes all test suites sequentially, aggregates results across all 4 tiers, outputs structured summaries with timing, and exits with code 0 on passing tests.

### Running Individual Test Tiers via Native Node.js Test Runner
```bash
# Tier 1: Feature Coverage
node --test tests/tier1_features/*.test.js

# Tier 2: Boundary & Corner Cases
node --test tests/tier2_boundaries/*.test.js

# Tier 3: Cross-Feature Combinations
node --test tests/tier3_combinations/*.test.js

# Tier 4: Real-World Scenarios
node --test tests/tier4_scenarios/*.test.js
```

### Running Backend PHP Syntax Verification
```bash
php -l env.example.php
php -l api/bootstrap.php
php -l api/db.php
php -l api/auth.php
php -l api/admin_users.php
php -l api/configs.php
php -l api/trigger_run.php
php -l api/n8n_queue.php
php -l api/ingest.php
php -l api/reports.php
php -l api/stripe_webhook.php
```

---

## 5. Non-Deterministic Output Matching Strategy
- **Timestamps & ISO Dates**: Matched using regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$`.
- **Run IDs & Magic Audit Tokens**: Matched using regex `^(?:run_[a-z0-9_]+|[0-9a-f]{32,64})$`.
- **Float Rounding & Relative Percentages**: Verified with precision bounds (`Math.abs(actual - expected) < 0.05`).
