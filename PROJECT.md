# Project: Chatlytics.de — AI Visibility & Share-of-Model (SoM) Platform

## Architecture
Chatlytics.de is an enterprise-grade AI Visibility and Share-of-Model (SoM) analytics platform architected for European B2B enterprises. The platform evaluates brand visibility, competitor recommendations, and citation authority across major generative AI models (OpenAI, Anthropic Claude, Google Gemini with Search grounding).

The architecture spans two tightly integrated execution environments:
1. **Workflow Execution Engine (Phase 1 / n8n 2.44.5)**:
   - Triggers: Universal API Webhook (`POST /webhook/chatlytics-run` with sync and <200ms async queue response), Interactive Chat Trigger (`@n8n/n8n-nodes-langchain.chatTrigger`), and Schedule Poller Trigger (polling `/api/n8n_queue.php`).
   - Universal Normalizer Code Node: Normalizes inputs across chat, webhook, and cron queue modes into uniform execution items.
   - Dynamic LLM Provider Router: Dispatches items across OpenAI (`chat/completions`), Anthropic Claude (`messages`), and Google Gemini (`generateContent` with dynamic `googleSearch` grounding).
   - Secondary Extractor Code Node: Parses raw LLM text into competitor entity mentions and extracted citation domains.
   - Deterministic Unicode Metric Engine Code Node: Computes character/word counts, 0-based character & 1-based word earliness, relative position %, Unicode-aware German case-folding (`ä, ö, ü, ß`, `ẞ`, transliterations), strict MECE classification (`1_DIRECT_WIN`, `2_BRAND_HALO`, `3_COMPETITOR_TAKEOVER`, `4_GENERIC`), and 4-Quadrant GEO diagnostics (`1_CITATION_HIJACK`, `2_PARAMETRIC_BLINDSPOT`, `3_BRAND_HALO_TRAP`, `4_BURIED_WINNER`).
   - Formatters: Renders user-friendly markdown for interactive chat sessions and JSON payloads for webhook responses and backend database ingestion (`POST /api/ingest.php`).

2. **Plesk PHP 8.5 Backend & MySQL 8.0 Database (Phase 2)**:
   - Out-of-webroot configuration (`env.example.php`) resolving securely outside Plesk `httpdocs/`.
   - MySQL 8.0+ Schema (`sql/schema.sql`): `users`, `tracking_configs`, `llm_runs`, `run_competitors`, `run_citations` with `utf8mb4_unicode_ci`, foreign keys `ON DELETE CASCADE`, composite indexes, and JSON payload columns.
   - Core Services: `api/bootstrap.php` (strict PHP 8.5 error handling, JSON response helper, CORS, Magic Audit token resolution) and `api/db.php` (PDO singleton, emulated prepares disabled).
   - Authentication & User Management: `api/auth.php` (Freemium work-email validation, 40 free credits default, Argon2id password hashing) and `api/admin_users.php` (admin checks, credit adjustments, Magic Audit link generator, 1-click realistic German B2B demo data seeder).
   - Tracking & Execution: `api/configs.php` (CRUD for tracking configs) and `api/trigger_run.php` (webhook dispatcher with timeout handling).
   - Queue & Ingestion: `api/n8n_queue.php` (atomic queue poller with `SELECT ... FOR UPDATE` and credit deduction math) and `api/ingest.php` (transactional ingestion of n8n output payload into `llm_runs`, `run_competitors`, `run_citations`).
   - Analytics & Webhooks: `api/reports.php` (memory-safe <128MB SQL Period-over-Period analytics and 4-Quadrant GEO diagnostic engine calculation) and `api/stripe_webhook.php` (HMAC-SHA256 signature verification & credit/tier upgrades).

3. **Bilingual (DE/EN) SaaS Frontend**:
   - Zero-dependency modern corporate UI/UX: Pure semantic HTML5 + vanilla ES6 modules + custom CSS property design system in `assets/css/app.css` (0 npm build steps, sub-50ms cold loads, 100% GDPR/DSGVO compliant, zero external CDNs/fonts, WCAG AA/AAA contrast).
   - Landing Page (`index.html`): Hero with verbatim German/English mission statement, interactive MECE preview simulator, 4-tier hybrid pricing table (Free €0 with 40 credits, Starter €149, Growth €399, Managed GEO Retainer €1,950+), and freemium work-email signup modal.
   - Client Dashboard (`dashboard.html`): Period filter (7d, 30d, 90d, All), 6-card KPI bar, MECE distribution progress bar, Period-over-Period trend, Competitor leaderboard, Grounding citations table, 4-Quadrant GEO Action Panel with diagnostic guidance, tracking config manager, instant run trigger button, and Magic Audit shareable read-only preview mode (`?audit_token=...`).
   - Owner Cockpit (`admin.html`): Admin KPI overview, user management table with credit adjustment modal, Magic Audit token generator, and 1-click realistic German B2B demo data seeder.
   - Modular Client-Side JavaScript (`assets/js/`): `i18n.js` (declarative DOM translation & dictionary), `api-client.js` (Bearer + audit token handling), `auth.js` (route guards), `dashboard.js`, `configs.js`, `admin.js`.

---

## Code Layout
```
c:\Users\aranba\Desktop\Antigravity\Chatlytics\
├── n8n/
│   ├── chatlytics_universal_worker.json     # Copy/paste-ready n8n 2.44.5 workflow JSON
│   ├── N8N_SETUP_AND_POC_GUIDE.md           # Step-by-step import, credentials, test prompts, cURL/Postman
│   └── lib/
│       └── metrics_engine.js                # Canonical JavaScript calculation engine embedded in n8n code nodes
├── sql/
│   └── schema.sql                           # MySQL 8.0+ schema DDL (users, tracking_configs, llm_runs, etc.)
├── env.example.php                          # Out-of-webroot configuration template
├── api/
│   ├── bootstrap.php                        # Error handling, JSON helpers, CORS, Magic Audit token resolution
│   ├── db.php                               # PDO singleton with UTF-8 and strict error mode
│   ├── auth.php                             # Freemium work-email registration, login, logout
│   ├── admin_users.php                      # Admin user management, Magic Audit generator, demo seeder
│   ├── configs.php                          # CRUD for prompt-keyword-brand tracking configs
│   ├── trigger_run.php                      # Webhook dispatcher triggering n8n workflow
│   ├── n8n_queue.php                        # Atomic queue poller for n8n schedule trigger
│   ├── ingest.php                           # Ingestion webhook storing n8n run results
│   ├── reports.php                          # Memory-safe (<128MB) SQL PoP analytics & 4-Quadrant engine
│   └── stripe_webhook.php                   # Stripe payment webhook with HMAC-SHA256 signature verification
├── index.html                               # Bilingual landing page with interactive MECE simulator & pricing
├── dashboard.html                           # Client dashboard with 4-Quadrant GEO panel & Magic Audit mode
├── admin.html                               # Owner cockpit with user mgmt, demo seeder & audit generator
├── assets/
│   ├── css/
│   │   └── app.css                          # Minimalist corporate SaaS design system
│   └── js/
│       ├── i18n.js                          # Bilingual dictionary (DE/EN) & DOM translation engine
│       ├── api-client.js                    # Fetch wrapper for PHP API (Bearer token & audit token)
│       ├── auth.js                          # Authentication state & route guards
│       ├── dashboard.js                     # Dashboard KPI rendering, MECE charts, 4-Quadrant actions
│       ├── configs.js                       # Tracking configuration manager
│       └── admin.js                         # Admin cockpit, demo seeder & audit token actions
└── tests/
    ├── unit/
    │   ├── metrics.test.js                  # Node.js automated unit tests for metric engine & MECE logic
    │   └── workflow.test.js                 # Validation tests for n8n workflow JSON structure & embedded JS
    └── integration/
        ├── schema_syntax.test.js            # SQL schema DDL validation test
        ├── php_syntax.test.js               # PHP syntax (php -l) batch validation test
        └── ingest_contract.test.js          # Ingest payload compatibility test matching n8n to ingest.php
```

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Deterministic Unicode Metric Engine | Accurate char/word counts, 0-based char & 1-based word earliness, relative pos %, German umlaut/ß case-folding | M1 | Survey 1 (R1) |
| 2 | MECE 4-State Classifier | Deterministic classification: 1_DIRECT_WIN, 2_BRAND_HALO, 3_COMPETITOR_TAKEOVER, 4_GENERIC | M1 | Survey 1 (R1) |
| 3 | 4-Quadrant GEO Diagnostics | Diagnostic matrix: 1_CITATION_HIJACK, 2_PARAMETRIC_BLINDSPOT, 3_BRAND_HALO_TRAP, 4_BURIED_WINNER | M1 | Survey 1 (R1) |
| 4 | Metric Engine Automated Unit Tests | Node.js unit tests asserting Unicode folding, earliness, MECE states, and GEO quadrants | M1 | Survey 1 (R1) |
| 5 | Copy/Paste n8n 2.44.5 Workflow Canvas JSON | Valid top-level workflow JSON ready to import onto n8n canvas with 16 interconnected nodes | M2 | Survey 1 (R1) |
| 6 | Triple Simultaneous Workflow Triggers | Webhook (`POST /webhook/chatlytics-run`), Chat Trigger, and Schedule Poller Trigger | M2 | Survey 1 (R1) |
| 7 | Webhook Fast Async Queue Response | Immediate `<200ms` `200 OK {"status": "queued"}` acknowledgment while continuing pipeline | M2 | Survey 1 (R1) |
| 8 | Multi-LLM Provider Dynamic Routing | Switch routing to OpenAI, Anthropic Claude, and Google Gemini with dynamic Google Search grounding | M2 | Survey 1 (R1) |
| 9 | Grounding Citations & Secondary Extraction | Extraction of grounding citation chunks and regex/text extraction for competitor brand mentions | M2 | Survey 1 (R1) |
| 10 | Workflow Response Formatters | Chat markdown formatter and API ingestion webhook dispatcher posting to `/api/ingest.php` | M2 | Survey 1 (R1) |
| 11 | n8n Setup and PoC Guide | Comprehensive guide covering canvas import, credentials, test prompts, and cURL / Postman payloads | M2 | Survey 1 (R2) |
| 12 | MySQL 8.0+ Relational Schema | DDL for `users`, `tracking_configs`, `llm_runs`, `run_competitors`, `run_citations` with indexes/FKs | M3 | Survey 2 (R3) |
| 13 | Out-of-Webroot Config Template | `env.example.php` template resolving database, API keys, webhook secrets outside webroot | M3 | Survey 2 (R3) |
| 14 | Core PDO Singleton & Bootstrap | `bootstrap.php` and `db.php` with error reporting, JSON helper, CORS, and Magic Audit resolver | M3 | Survey 2 (R3) |
| 15 | Freemium Work-Email Authentication | Signup with corporate email validation (blocking disposable/free mail), 40 credits default, Argon2id | M3 | Survey 2 (R3) |
| 16 | Admin Cockpit Backend & Magic Audit Links | Admin user listing, credit adjustments, Magic Audit link generator, and 1-click realistic demo seeder | M3 | Survey 2 (R3) |
| 17 | Tracking Configuration CRUD | `api/configs.php` endpoints for managing prompt-keyword-brand configurations | M3 | Survey 2 (R3) |
| 18 | Execution Dispatcher with Timeout Handling | `api/trigger_run.php` triggering n8n webhook with timeout handling and queue fallback | M4 | Survey 2 (R3) |
| 19 | Atomic Queue Poller & Credit Math | `api/n8n_queue.php` with `SELECT ... FOR UPDATE` atomic job claiming and credit deduction math | M4 | Survey 2 (R3) |
| 20 | Ingestion Pipeline | `api/ingest.php` validating payload and transactionally inserting runs, competitors, and citations | M4 | Survey 2 (R3) |
| 21 | Memory-Safe (<128MB) PoP Analytics | SQL aggregation queries in `api/reports.php` computing SoM, Visibility, Earliness, MECE distribution | M4 | Survey 2 (R3) |
| 22 | Stripe Webhook Processing | Native PHP HMAC-SHA256 signature verification in `api/stripe_webhook.php` for payment events | M4 | Survey 2 (R3) |
| 23 | Minimalist Corporate SaaS CSS Design System | Responsive, accessible (WCAG AA/AAA) design system in `assets/css/app.css` (0 external dependencies) | M5 | Survey 3 (R4) |
| 24 | Bilingual Dictionary & Instant Translation | `assets/js/i18n.js` providing German and English key-value mappings with instant DOM switching | M5 | Survey 3 (R4) |
| 25 | Bilingual Landing Page with MECE Simulator | `index.html` featuring DE/EN mission, interactive MECE simulator, and 4-tier hybrid pricing table | M5 | Survey 3 (R4) |
| 26 | Client Dashboard & 4-Quadrant GEO Action Panel | `dashboard.html` with period filter, KPI bar, MECE trend, citations, and 4-Quadrant GEO Action Panel | M5 | Survey 3 (R4) |
| 27 | Magic Audit Shareable Preview Mode | `dashboard.html?audit_token=...` mode with read-only view and persistent CTA banner | M5 | Survey 3 (R4) |
| 28 | Owner Cockpit Frontend & 1-Click Demo Seeder | `admin.html` with user management, credit adjustment modal, audit generator, and 1-click demo seeder | M5 | Survey 3 (R4) |
| 29 | Modular Client-Side JavaScript Suite | `assets/js/api-client.js`, `auth.js`, `dashboard.js`, `configs.js`, `admin.js` | M5 | Survey 3 (R4) |
| 30 | Full E2E Test Suite (Tiers 1-4) & Coverage Hardening | Requirement-driven opaque-box E2E test suite passing 100% across all 4 tiers, plus Tier 5 hardening | M6 | E2E Testing |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Metric Engine & Unit Tests | Metric engine, German Unicode case-folding, MECE classifier, 4-Quadrant GEO diagnostics, Node.js unit test suite | none | DONE |
| M2 | n8n 2.44.5 Workflow & PoC Guide | `chatlytics_universal_worker.json`, 3 triggers, multi-LLM routing, grounding extraction, `N8N_SETUP_AND_POC_GUIDE.md`, workflow test | M1 | DONE |
| M3 | MySQL 8.0 Schema, PDO & Core Services | `schema.sql`, `env.example.php`, `bootstrap.php`, `db.php`, `auth.php`, `admin_users.php`, `configs.php` | none | DONE |
| M4 | Dispatcher, Queue, Ingest & Analytics | `trigger_run.php`, `n8n_queue.php`, `ingest.php`, `reports.php`, `stripe_webhook.php`, ingest test | M2, M3 | DONE |
| M5 | Bilingual SaaS Frontend & Dashboards | `index.html`, `dashboard.html`, `admin.html`, `app.css`, `i18n.js`, modular client JS | M3, M4 | DONE |
| M6 | Full E2E Test Pass & Coverage Hardening | 100% pass on Tiers 1-4 E2E test suite, followed by Tier 5 adversarial coverage hardening | M1-M5 | DONE |

---

## Interface Contracts

### 1. Universal Normalizer ↔ Dynamic Provider Router
- **Normalized Item Structure**:
  ```json
  {
    "run_id": "uuid-v4",
    "config_id": 101,
    "user_id": 5,
    "brand_name": "Personio",
    "brand_domains": ["personio.de", "personio.com"],
    "prompt": "Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?",
    "competitors": ["Workday", "SAP SuccessFactors", "BambooHR"],
    "target_llms": ["openai", "anthropic", "gemini"],
    "search_enabled": true,
    "trigger_source": "webhook" | "chat" | "queue",
    "selected_provider": "openai" | "anthropic" | "gemini"
  }
  ```

### 2. Metric Engine & Secondary Extractor ↔ Ingestion Webhook (`POST /api/ingest.php`)
- **Headers**:
  - `Content-Type: application/json`
  - `X-Chatlytics-Ingest-Key: <SHARED_SECRET>`
- **Payload Schema**:
  ```json
  {
    "config_id": 101,
    "user_id": 5,
    "prompt_text": "Welche HR-Software eignet sich am besten für den Mittelstand?",
    "model_name": "gemini-1.5-flash",
    "provider": "gemini",
    "raw_response": "...",
    "brand_name": "Personio",
    "brand_mentioned": true,
    "brand_recommended": true,
    "char_earliness": 42,
    "word_earliness": 7,
    "relative_position_pct": 12.5,
    "total_chars": 1240,
    "total_words": 182,
    "mece_category": "1_DIRECT_WIN",
    "geo_quadrant": "4_BURIED_WINNER",
    "competitors": [
      {
        "competitor_name": "Workday",
        "mentioned": true,
        "char_earliness": 310,
        "word_earliness": 48
      }
    ],
    "citations": [
      {
        "citation_url": "https://www.personio.de/hr-software",
        "citation_domain": "personio.de",
        "citation_title": "Personio HR Software",
        "is_brand_domain": true
      }
    ]
  }
  ```

### 3. Frontend API Client (`assets/js/api-client.js`) ↔ Backend PHP Endpoints (`api/*.php`)
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <AUTH_TOKEN>` (for authenticated requests)
- **Magic Audit Token Resolution**:
  - Appends `?audit_token=<TOKEN>` to `GET /api/reports.php` when in Magic Audit mode.
- **Uniform API Response Envelope**:
  ```json
  {
    "status": "success" | "error",
    "data": { ... },
    "message": "...",
    "code": 200
  }
  ```

### 4. Queue Poller (`GET /api/n8n_queue.php`) ↔ n8n Schedule Trigger
- **Headers**:
  - `X-Chatlytics-Cron-Key: <SHARED_SECRET>`
- **Response Schema**:
  ```json
  {
    "status": "success",
    "jobs_count": 1,
    "jobs": [
      {
        "config_id": 101,
        "user_id": 5,
        "brand_name": "Personio",
        "brand_domains": ["personio.de"],
        "prompt": "Beste HR Software im Mittelstand",
        "competitors": ["Workday", "SAP"],
        "target_llms": ["openai", "gemini"],
        "search_enabled": true
      }
    ]
  }
  ```
