# Chatlytics.de — n8n Universal Worker Setup & PoC Guide

**Target Workflow**: `n8n/chatlytics_universal_worker.json`  
**n8n Version Compatibility**: 2.44.5 or later (Node.js 20+ runtime)  
**Backend API Target**: PHP 8.3+ Backend (`api/ingest.php`, `api/n8n_queue.php`, `api/admin_users.php`)  
**LLM Gateway**: Unified OpenRouter API (`https://openrouter.ai/api/v1`) via `openRouterApi` Credential (`tjmYBMIQa9Fo3kYL`)  
**Platform**: Chatlytics AI Visibility & Share-of-Model (SoM) Analytics Engine

---

## 1. System Overview & Prerequisites

The Chatlytics Universal Worker (`chatlytics_universal_worker.json`) is an n8n workflow consisting of **31 interconnected nodes** arranged across 7 execution stages. It unifies three simultaneous trigger mechanisms (Webhook POST, Interactive Canvas Chat, and 1-minute Schedule Poller), routes **all** LLM executions and live model discovery through a unified **OpenRouter Gateway**, sends **only clean user prompts** (zero system prompts, zero input prompt caching), automatically applies the **36-language localized region extension** when a user configures `market_region`, batches non-search scheduled runs via **OpenRouter Batches** (`/api/v1/batches`), extracts grounding citations and competitor mentions, computes deterministic Unicode metrics with prompt-language/region awareness and strict 4-state MECE classifications, and dispatches evaluation results to the database backend.

### 1.1 Prerequisites Table

| Component | Minimum Version | Purpose |
|---|---|---|
| **n8n Community / Enterprise** | `>= 2.44.5` | Workflow canvas and orchestration engine |
| **Node.js** | `>= 20.15.0` (or Docker) | Execution runtime for embedded JavaScript Code nodes |
| **OpenRouter API Credential (`openRouterApi`)** | ID `tjmYBMIQa9Fo3kYL` (`OpenRouter - Chatlytics - Chatlytics-dev-1`) | Single credential powering live Chat Completions (`/api/v1/chat/completions`), Async Batches (`/api/v1/batches`), and Live Model Discovery (`/api/v1/models`) |
| **Chatlytics Backend Secret (`httpHeaderAuth`)** | 32+ character string | Single `httpHeaderAuth` credential sending `X-N8N-Secret` (matches `n8n.shared_secret` in `env.php`) |
| **Local vs Prod Base URL** | Concrete URL + `api_base_url` | Schedule Poller hits `https://chatlytics.de/api/n8n_queue.php?action=poll` & `action=open_batches`; `Dispatch Ingest API`, `Register OpenRouter Batch`, and `Fail OpenRouter Batch` route dynamically via `$json.api_base_url` |

---

## 2. Canvas Import Instructions

The workflow can be deployed either via the n8n graphical canvas interface or through the headless n8n CLI.

### 2.1 Method A: Visual Canvas Copy/Paste Import (Recommended)

1. **Open n8n Web UI**: Navigate to your running n8n instance (e.g. `http://localhost:5678` or `https://n8n.yourdomain.de`).
2. **Create / Update Workflow**: Click **Workflows** in the left sidebar navigation and open or create `Chatlytics Universal Worker`.
3. **Copy JSON Content**:
   - Open `n8n/chatlytics_universal_worker.json`.
   - Select the entire file content (`Ctrl + A` or `Cmd + A`) and copy it (`Ctrl + C` or `Cmd + C`).
4. **Paste to Canvas**:
   - Click anywhere on the n8n canvas background and press `Ctrl + V` / `Cmd + V`.
   - n8n automatically imports all **31 nodes** with exact coordinates and connection lines intact.
5. **Verify Node Topology (31 Nodes)**:
   - **Stage 1 (Triggers)**: `Universal API Webhook`, `Interactive Chat Trigger`, `Schedule Poller Trigger`
   - **Stage 2 (Webhook Action & Async Routing)**: `Route Discover Models`, `Discover OpenRouter Models`, `Filter & Normalize OpenRouter Models`, `Respond Live Models`, `Check Async Mode`, `Fast Async Response`
   - **Stage 3 (Queue & Batch Polling)**: `Poll Backend Queue`, `Poll Open Batches`, `Deduplicate OpenRouter Batches`, `Fetch OpenRouter Batch Status`, `Correlate OpenRouter Batch Results`, `Route Batch Outcome`
   - **Stage 4 (Normalization & 36-Language Market Extension)**: `Universal Normalizer`, `Market & Region Language Templates` (`Set` node with 24 EU + 12 global templates), `Apply Localized Market Extension`
   - **Stage 5 (OpenRouter Strategy Execution)**: `Execution Strategy Router`, `Call OpenRouter Chat` (user message only + dynamic `openrouter:web_search` tool / `web` plugin), `Prepare OpenRouter Batches`, `Submit OpenRouter Batch`, `Normalize Batch Registration`, `Check Batch Submit Success`, `Register OpenRouter Batch`, `Fail OpenRouter Batch`
   - **Stage 6 (Analytics & Extraction)**: `Secondary Extractor`, `Metric & MECE Calculator` (with language detection & regional ccTLD fit)
   - **Stage 7 (Persistence & Formatters)**: `Dispatch Ingest API`, `Format Chat Response`, `Respond Webhook Sync`
6. **Save & Activate Workflow**:
   - Click **Save** (`Ctrl + S`).
   - Open Workflow Settings (gear icon) and verify **Execution Order**: `v1` and **Save manual executions**: `true`.

### 2.2 Method B: Headless n8n CLI Import (Production & Docker)

```bash
# Bare-metal Node.js n8n installation
n8n import:workflow --input=./n8n/chatlytics_universal_worker.json

# Docker containerized n8n deployment
docker cp ./n8n/chatlytics_universal_worker.json n8n_container:/tmp/chatlytics_universal_worker.json
docker exec -u node n8n_container n8n import:workflow --input=/tmp/chatlytics_universal_worker.json

# Activate the imported workflow via CLI
docker exec -u node n8n_container n8n update:workflow --id=chatlytics_universal_worker --active=true
```

---

## 3. Credential Setup in n8n

Because n8n `2.44.5+` blocks `$env` access in nodes by default (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`), the workflow uses zero `$env` references. Only **two** credentials are required:

### 3.1 Unified OpenRouter Credential (`openRouterApi`)
- **Credential ID**: `tjmYBMIQa9Fo3kYL`
- **Credential Name**: `OpenRouter - Chatlytics - Chatlytics-dev-1`
- **n8n Credential Type**: OpenRouter API (`openRouterApi`)
- **HTTP Request Binding**: Every OpenRouter HTTP Request node (`Discover OpenRouter Models`, `Call OpenRouter Chat`, `Submit OpenRouter Batch`, `Fetch OpenRouter Batch Status`) uses:
  - `"authentication": "predefinedCredentialType"`
  - `"nodeCredentialType": "openRouterApi"`
- **Allowed Catalog Providers**: `openai`, `google`, `anthropic`, `mistralai`, `x-ai`, `deepseek`, `qwen`, `xiaomi`, `z-ai` (`zhipu`), `meta-llama`, `nvidia`, `azure`, `microsoft`, `perplexity`, `moonshotai`, `minimax`. New discovered models default to `is_allowed = false` until explicitly activated in the Admin panel (`?action=discover_models` collapses `:batch` variants onto the base slug with `supports_batch_api = true`).

### 3.2 Backend Header Auth Credential (`httpHeaderAuth`)
1. Left sidebar -> **Credentials** -> **Add Credential** -> **Header Auth** (`httpHeaderAuth`), name it `Chatlytics Backend Secret`:
   - **Name**: `X-N8N-Secret`
   - **Value**: exact `n8n.shared_secret` value configured in `env.php`
2. Attached to: `Poll Backend Queue`, `Poll Open Batches`, `Register OpenRouter Batch`, `Fail OpenRouter Batch`, and `Dispatch Ingest API`.

---

## 4. 36-Language Market/Region Extension (`Set` Node) & Prompt Hygiene

- **No System Prompts**: Chat Completions (`Call OpenRouter Chat`) and Batch Requests (`Prepare OpenRouter Batches`) transmit **only** `{ role: "user", content: $json.llm_prompt || $json.prompt }`.
- **Zero Prompt Caching**: `prompt_cache_key` is always `null` and no `cache_control` directives are sent.
- **No Active `market_region`**: When `market_region` is `null` (`Auto`), `llm_prompt === prompt` (zero prompt modification) and `Metric & MECE Calculator` automatically infers the geographic region (`DACH`, `FR`, `ES`, `GLOBAL_EN`, etc.) from the user prompt language.
- **Active `market_region`**: The editable `Market & Region Language Templates` (`n8n-nodes-base.set` v3.4) node stores **36 native single-sentence templates** (24 official EU + 12 top global languages) with `{region}` placeholder. `Apply Localized Market Extension` resolves the target region's language (falling back to detected prompt language for multilingual regions such as `CH`/`BE`) and appends the localized sentence into `llm_prompt` while preserving the clean raw `prompt` for reports and language detection.

---

## 5. Interactive Chat Trigger & Webhook Payloads

### 5.1 Structured Chat Shorthand Syntax

```text
PROMPT: Welche HR-Software eignet sich am besten für den deutschen Mittelstand?
BRAND: Personio
DOMAINS: personio.de, personio.com
COMPETITORS: Workday (workday.com), SAP SuccessFactors (sap.com), BambooHR (bamboohr.com)
LLMS: openai/gpt-6-luna, google/gemini-3.5-flash
REGION: DACH
SEARCH: true
```

### 5.2 Live OpenRouter Model Discovery (`action: "discover_models"`)

```bash
curl -X POST "http://localhost:5678/webhook/chatlytics-run" \
  -H "Content-Type: application/json" \
  -d '{ "action": "discover_models" }'
```

Returns `{ status: "ok", action: "discover_models", source: "openrouter_live_api", count, provider_credentials: [...], models: [...] }`.

### 5.3 Synchronous / Async Audit Webhook

```bash
curl -X POST "http://localhost:5678/webhook/chatlytics-run" \
  -H "Content-Type: application/json" \
  -d '{
    "config_id": 101,
    "user_id": 5,
    "prompt": "Welche HR-Software eignet sich am besten für den Mittelstand?",
    "market_region": "DACH",
    "brand_name": "Personio",
    "brand_domains": ["personio.de", "personio.com"],
    "competitors": [
      { "name": "Workday", "domain": "workday.com" },
      { "name": "SAP SuccessFactors", "domain": "sap.com" }
    ],
    "target_llms": ["openai/gpt-6-luna"],
    "search_enabled": true,
    "response_mode": "sync"
  }'
```

---

## 6. Pre-Flight Checklist

| # | Check Item | Action | Expected Output | Status |
|:---:|---|---|---|:---:|
| **1** | **Canvas Import** | Import `n8n/chatlytics_universal_worker.json` | 31 connected nodes, `executionOrder: "v1"` | [ ] |
| **2** | **OpenRouter Credential** | Confirm ID `tjmYBMIQa9Fo3kYL` (`OpenRouter - Chatlytics - Chatlytics-dev-1`) | Connected to `Discover`, `Call Chat`, `Submit Batch`, `Fetch Batch` | [ ] |
| **3** | **Backend Header Auth** | Confirm `Chatlytics Backend Secret` (`X-N8N-Secret`) | Attached to Poll / Open Batches / Register / Fail / Ingest nodes | [ ] |
| **4** | **Live Model Sync** | Trigger Admin *"Modelle live aus Worker-Engine abrufen"* | Fetches live OpenRouter text models across 15 provider groups | [ ] |
| **5** | **Batch Collector** | Trigger `Schedule Poller Trigger` with non-search batchable model | Submits `/api/v1/batches`, registers, polls & ingests results | [ ] |
