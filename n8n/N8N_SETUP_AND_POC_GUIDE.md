# Chatlytics.de — n8n Universal Worker Setup & PoC Guide

**Target Workflow**: `n8n/chatlytics_universal_worker.json`  
**n8n Version Compatibility**: 2.44.5 or later (Node.js 20+ runtime)  
**Backend API Target**: PHP 8.5 Plesk Backend (`api/ingest.php`, `api/n8n_queue.php`)  
**Platform**: Chatlytics AI Visibility & Share-of-Model (SoM) Analytics Engine  

---

## 1. System Overview & Prerequisites

The Chatlytics Universal Worker (`chatlytics_universal_worker.json`) is an enterprise-grade n8n workflow consisting of **21 interconnected nodes** arranged across 6 execution stages. It unifies three simultaneous trigger mechanisms (Webhook POST, Interactive Canvas Chat, and 1-minute Schedule Poller), evaluates target brand visibility across active native and EU-hosted LLM providers (native OpenAI `gpt-6-luna` via `@n8n/n8n-nodes-langchain.openAi` v2.3, native Google Gemini `models/gemini-3.5-flash` via `@n8n/n8n-nodes-langchain.googleGemini` v1.2, and EU-hosted Mistral `mistral-medium-latest` / `mistral-large-latest` plus Mistral-hosted Z.ai GLM `zai-glm-5-3` / `zai-glm-5-3-flash` via `https://api.eu.mistral.ai/v1/chat/completions`, with an optional disabled Anthropic fallback route), extracts grounding citations and competitor mentions, computes deterministic German Unicode metrics and strict 4-state MECE classifications, and dispatches evaluation results to the MySQL backend and client responses.

### 1.1 Prerequisites Table

| Component | Minimum Version | Purpose |
|---|---|---|
| **n8n Community / Enterprise** | `>= 2.44.5` | Workflow canvas and orchestration engine |
| **Node.js** | `>= 20.15.0` (or Docker) | Execution runtime for embedded JavaScript Code nodes |
| **OpenAI API Key** | Active Tier 1+ account | Native `@n8n/n8n-nodes-langchain.openAi` (`gpt-6-luna`, Responses API + optional Web Search) |
| **Google Gemini API Key** | Google AI Studio key | Native `@n8n/n8n-nodes-langchain.googleGemini` (`models/gemini-3.5-flash` + optional Google Search grounding) |
| **Mistral AI API Key (EU-Hosted)** | Active Mistral La Plateforme account | `mistralCloudApi` via `https://api.eu.mistral.ai/v1/chat/completions` (`mistral-medium-latest`, `mistral-large-latest`, `zai-glm-5-3`, `zai-glm-5-3-flash`) |
| **Anthropic API Key (Optional)** | Active account | Optional disabled fallback node (`claude-3-5-sonnet-20241022`) |
| **Chatlytics Backend Secret** | 32+ character string | Single `httpHeaderAuth` credential sending `X-N8N-Secret` (matches `n8n.shared_secret` in `env.php`) |
| **Local vs Prod Base URL** | Concrete URL + `api_base_url` | `Poll Backend Queue` polls `https://chatlytics.de/api/n8n_queue.php?action=poll`; `Dispatch Ingest API` routes dynamically via `$json.api_base_url` |

---

## 2. Canvas Import Instructions

The workflow can be deployed either via the n8n graphical canvas interface or through the headless n8n CLI.

### 2.1 Method A: Visual Canvas Copy/Paste Import (Recommended)

1. **Open n8n Web UI**: Navigate to your running n8n instance (e.g. `http://localhost:5678` or `https://n8n.yourdomain.de`).
2. **Create New Workflow**: Click **Workflows** in the left sidebar navigation and click **Add Workflow** (`+` button).
3. **Copy JSON Content**:
   - Open `n8n/chatlytics_universal_worker.json` in your code editor or terminal.
   - Select the entire file content (`Ctrl + A` or `Cmd + A`) and copy it (`Ctrl + C` or `Cmd + C`).
4. **Paste to Canvas**:
   - Click anywhere on the empty checkered n8n canvas background.
   - Press `Ctrl + V` (Windows/Linux) or `Cmd + V` (macOS).
   - n8n automatically deserializes all 21 nodes and positions them on the 2D coordinate grid with predefined connection lines intact.
5. **Verify Node Topology (21 Nodes)**:
   - **Stage 1 (Triggers)**: `Universal API Webhook`, `Interactive Chat Trigger`, `Schedule Poller Trigger`
   - **Stage 2 (Queue & Async Handshake)**: `Poll Backend Queue`, `Check Async Mode`, `Fast Async Response`
   - **Stage 3 (Normalization & Routing)**: `Universal Normalizer`, `Provider Router` (Switch), `OpenAI Search Router`, `Gemini Search Router`
   - **Stage 4 (Multi-LLM Execution)**: `Call OpenAI (Search Enabled)`, `Call OpenAI (No Search)`, `Call Google Gemini (Search Enabled)`, `Call Google Gemini (No Search)`, `Call Mistral EU (Mistral & GLM)`, `Call Anthropic Claude (Optional Fallback)` (disabled by default)
   - **Stage 5 (Analytics & Extraction)**: `Secondary Extractor` (includes failed-run detection & Responses API / Gemini grounding citation extraction), `Metric & MECE Calculator`
   - **Stage 6 (Persistence & Formatters)**: `Dispatch Ingest API`, `Format Chat Response`, `Respond Webhook Sync`
6. **Save Workflow**:
   - Click **Save** in the top right corner (or press `Ctrl + S`).
   - Name the workflow: `Chatlytics Universal Worker`.
7. **Configure Workflow Settings**:
   - Open the workflow settings dialog (gear icon in top right).
   - Verify **Execution Order**: `v1` (mandatory for sequential stability).
   - Verify **Save manual executions**: `true`.

### 2.2 Method B: Headless n8n CLI Import (Production & Docker)

For automated server deployments, Docker Compose setups, or CI/CD pipelines:

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

To prevent sensitive secret exposure and maintain full compatibility with hardened n8n `2.44.5+` defaults (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`), the workflow uses zero `$env` expressions in nodes. All external API calls authenticate via native n8n Credential Stores (`openAiApi`, `googlePalmApi`, `mistralCloudApi`, `anthropicApi`, and `httpHeaderAuth`).

### 3.1 OpenAI API Credential
- **n8n Credential Type**: `OpenAI API` (`openAiApi`)
- **Navigation**: Left sidebar -> **Credentials** -> **Add Credential** -> Select **OpenAI API**.
- **Field Value**: Enter your OpenAI secret key (`sk-proj-...`).
- **Node Assignment**: Open `Call OpenAI (Search Enabled)` and `Call OpenAI (No Search)` -> select your `OpenAI API` credential (e.g. `OpenAI - Chatlytics - Chatlytics-dev-1`).

### 3.2 Google Gemini API Credential
- **n8n Credential Type**: `Google PaLM / Gemini API` (`googlePalmApi`)
- **Navigation**: Left sidebar -> **Credentials** -> **Add Credential** -> Select **Google Gemini(PaLM) Api account** (`googlePalmApi`).
- **Field Value**: Enter your Google AI Studio API key (`AIzaSy...`).
- **Node Assignment**: Open `Call Google Gemini (Search Enabled)` and `Call Google Gemini (No Search)` -> select your Google AI Studio credential (e.g. `Google_AI Studio - Chatlytics - Chatlytics-dev-1`).

### 3.3 Mistral Cloud API Credential (EU-Hosted Mistral & Z.ai GLM 5.3)
- **n8n Credential Type**: `Mistral Cloud API` (`mistralCloudApi`)
- **Navigation**: Left sidebar -> **Credentials** -> **Add Credential** -> Select **Mistral Cloud API**.
- **Field Value**: Enter your Mistral La Plateforme API key.
- **Node Assignment**: Open `Call Mistral EU (Mistral & GLM)` -> confirm predefined credential type `mistralCloudApi` points to your credential (e.g. `Mistral - Chatlytics - Chatlytics-dev-1`). The node explicitly posts to `https://api.eu.mistral.ai/v1/chat/completions` to enforce EU-hosted execution across `mistral-medium-latest`, `mistral-large-latest`, `zai-glm-5-3`, and `zai-glm-5-3-flash`.

### 3.4 Anthropic API Credential (Optional Fallback)
- **n8n Credential Type**: `Anthropic API` (`anthropicApi`)
- **Status**: `Call Anthropic Claude (Optional Fallback)` is **disabled by default**. Enable the node and assign your Anthropic API key only if you want to include Claude models outside the standard dashboard UI catalog.

### 3.5 Backend Header Auth Credential (`httpHeaderAuth`) & Runtime Configuration

Because n8n `2.44.5+` blocks node `$env` access by default (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`), this workflow stores secrets in native **n8n Credentials** instead of environment variables:

1. **Create Header Auth Credential**: Left sidebar -> **Credentials** -> **Add Credential** -> **Header Auth** (`httpHeaderAuth`), name it `Chatlytics Backend Secret`:
   - **Name**: `X-N8N-Secret`
   - **Value**: exact `n8n.shared_secret` value configured in production `env.php`
2. **Assign to Nodes**: Attach `Chatlytics Backend Secret` to both `Poll Backend Queue` and `Dispatch Ingest API`.
3. **API Base URL Routing**: `Poll Backend Queue` targets `https://chatlytics.de/api/n8n_queue.php?action=poll` (change to `http://localhost:8000/api/n8n_queue.php?action=poll` only for local testing). `Dispatch Ingest API` automatically uses `$json.api_base_url` emitted by PHP payloads (defaulting to `https://chatlytics.de`).

> **Note (Optional Server Runtime Variables):** Your n8n container `.env` only needs standard n8n host settings below ? `CHATLYTICS_*` env vars are no longer required inside workflow nodes:

```env
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
EXECUTIONS_MODE=regular
WEBHOOK_URL=https://n8n.chatlytics.de/
```

---

## 4. Interactive Chat Trigger Test Prompts

The Interactive Chat Trigger (`@n8n/n8n-nodes-langchain.chatTrigger`) provides an in-canvas testing interface. Click the **Chat** button at the bottom of the canvas to open the execution modal.

### 4.1 Format 1: Structured Shorthand Syntax

The Universal Normalizer code node parses line-by-line key-value pairs (`KEY: Value`) or pipe-delimited tokens (`|`).

#### Sample Prompt A: B2B HR Software (Personio vs Workday / SAP)
```text
PROMPT: Welche HR-Software eignet sich am besten für den deutschen Mittelstand?
BRAND: Personio
DOMAINS: personio.de, personio.com
COMPETITORS: Workday (workday.com), SAP SuccessFactors (sap.com), BambooHR (bamboohr.com)
LLMS: openai, gemini
SEARCH: true
```

#### Sample Prompt B: Office & Supplies Brand (Avery Zweckform vs Herma)
```text
PROMPT: Welche Etiketten sind für Archivordner im Büro am besten geeignet?
BRAND: Avery Zweckform
DOMAINS: avery-zweckform.com, zweckform.de
COMPETITORS: Herma (herma.de), Brother (brother.de)
LLMS: openai, anthropic
SEARCH: false
```

#### Sample Prompt C: Pipe-Delimited Shorthand
```text
PROMPT: Beste CRM-Systeme für KMU in Deutschland? | BRAND: HubSpot | DOMAINS: hubspot.de | COMPETITORS: Salesforce (salesforce.com), Pipedrive (pipedrive.com) | LLMS: gemini | SEARCH: true
```

#### Expected Chat Output (Markdown Table):
The `Format Chat Response` node generates an executive audit summary:

```markdown
### 📊 Chatlytics AI Visibility Audit
| Metric | Value |
|---|---|
| **Query** | *Welche HR-Software eignet sich am besten für den deutschen Mittelstand?* |
| **Brand** | **Personio** |
| **Getrackte Marke** | **Personio** (`personio.de, personio.com`) |
| **Provider** | `gemini` |
| **Modell / Provider** | `gemini` (`models/gemini-3.5-flash`) |
| **Execution Status** | `completed` |
| **MECE Status** | `1_DIRECT_WIN` 🏆 (Direct Win) |
| **GEO Diagnostic** | `NONE` |
| **GEO-Diagnostik** | `NONE` — Clean Visibility |
| **Brand Earliness** | Wort #7 (3.4% im Text, Zeichen #42) |
| **Grounding Citation** | ✅ Offizielle Domain zitiert |
| **Wettbewerber** | Workday (Wort #48), SAP SuccessFactors (Wort #92) |

*Antwortlänge: 182 Wörter (1240 Zeichen) • Ausführungszeit: 1150ms*
```

---

### 4.2 Format 2: Raw JSON Schema in Chat Modal

You can also paste raw JSON directly into the chat modal. The normalizer detects the leading `{` and deserializes the object:

#### Sample Prompt D: DACH Cloud ERP
```json
{
  "prompt": "Beste ERP Software für mittelständische Fertigungsunternehmen in Deutschland",
  "brand_name": "SAP",
  "brand_domains": ["sap.com"],
  "competitors": [
    { "name": "Microsoft Dynamics 365", "domain": "microsoft.com" },
    { "name": "proALPHA", "domain": "proalpha.com" }
  ],
  "target_llms": ["openai", "gemini"],
  "search_enabled": true,
  "response_mode": "sync"
}
```

---

## 5. Webhook API Payloads (cURL & Postman)

The Universal API Webhook is accessible at:
- **Production URL**: `POST http://localhost:5678/webhook/chatlytics-run`
- **Canvas Test URL**: `POST http://localhost:5678/webhook-test/chatlytics-run` (active when "Listen for test event" is clicked in n8n)

### 5.1 Mode 1: Synchronous Webhook (`response_mode: "sync"`)

In synchronous mode, the HTTP connection remains open until the LLMs have finished processing and metrics are computed. It returns HTTP 200 with the full evaluation metrics JSON payload while simultaneously dispatching to `api/ingest.php`.

#### cURL (Bash / macOS / Linux):
```bash
curl -X POST "http://localhost:5678/webhook/chatlytics-run" \
  -H "Content-Type: application/json" \
  -d '{
    "config_id": 101,
    "user_id": 5,
    "prompt": "Welche HR-Software eignet sich am besten für den Mittelstand?",
    "brand_name": "Personio",
    "brand_domains": ["personio.de", "personio.com"],
    "competitors": [
      { "name": "Workday", "domain": "workday.com" },
      { "name": "SAP SuccessFactors", "domain": "sap.com" }
    ],
    "target_llms": ["openai"],
    "search_enabled": false,
    "response_mode": "sync"
  }'
```

#### cURL (Windows PowerShell):
```powershell
$body = @{
    config_id = 101
    user_id = 5
    prompt = "Welche HR-Software eignet sich am besten für den Mittelstand?"
    brand_name = "Personio"
    brand_domains = @("personio.de", "personio.com")
    competitors = @(
        @{ name = "Workday"; domain = "workday.com" },
        @{ name = "SAP SuccessFactors"; domain = "sap.com" }
    )
    target_llms = @("openai")
    search_enabled = $false
    response_mode = "sync"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:5678/webhook/chatlytics-run" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body
```

#### Expected Synchronous HTTP 200 Response:
```json
{
  "run_id": "run_1730902200_a9b1c2d",
  "config_id": 101,
  "user_id": 5,
  "brand_name": "Personio",
  "brand_mentioned": 1,
  "brand_prominence_rank": 1,
  "char_earliness": 42,
  "word_earliness": 7,
  "relative_position_pct": 3.39,
  "total_chars": 1240,
  "total_words": 182,
  "mece_category": "1_DIRECT_WIN",
  "geo_quadrant": "NONE",
  "has_citations": 1,
  "brand_cited": 1,
  "competitor_cited": 0,
  "competitors": [
    {
      "competitor_name": "Workday",
      "competitor_domain": "workday.com",
      "mentioned": 1,
      "char_earliness": 310,
      "word_earliness": 48,
      "relative_position_pct": 25.0
    }
  ],
  "citations": [
    {
      "citation_index": 1,
      "citation_url": "https://www.personio.de/hr-software",
      "citation_domain": "personio.de",
      "citation_title": "Personio HR Software",
      "is_brand_domain": 1
    }
  ]
}
```

---

### 5.2 Mode 2: Asynchronous Fast Queue Mode (`response_mode: "async"`)

In asynchronous mode, the `Check Async Mode` node routes to `Fast Async Response`, which immediately returns HTTP 200 OK `{"status": "queued"}` in `<200ms` (typically `<20ms`), preventing web gateway timeouts. The workflow execution continues downstream, invoking the LLMs and posting results to `/api/ingest.php`.

#### cURL (Bash):
```bash
curl -X POST "http://localhost:5678/webhook/chatlytics-run" \
  -H "Content-Type: application/json" \
  -d '{
    "config_id": 102,
    "user_id": 5,
    "prompt": "Beste Software für Process Mining und Workflow Optimierung",
    "brand_name": "Celonis",
    "brand_domains": ["celonis.com", "celonis.de"],
    "competitors": [
      { "name": "SAP Signavio", "domain": "signavio.com" },
      { "name": "UiPath", "domain": "uipath.com" }
    ],
    "target_llms": ["gemini"],
    "search_enabled": true,
    "response_mode": "async"
  }'
```

#### Expected Asynchronous Response (SLA < 200ms):
```json
{
  "status": "queued",
  "run_id": "run_1730902250_f8e2d1c",
  "timestamp": "2026-11-06T15:30:50.123Z",
  "message": "Dispatched to worker pipeline"
}
```

---

### 5.3 Postman Collection v2.1 Import Specification

Import this JSON specification into Postman (**File -> Import**):

```json
{
  "info": {
    "name": "Chatlytics n8n Webhook Test Collection",
    "_postman_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "description": "Pre-configured requests for Chatlytics n8n Universal Worker API Webhook testing.",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "1. Synchronous Audit Run (Personio)",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"prompt\": \"Welche HR-Software eignet sich am besten für den deutschen Mittelstand?\",\n  \"brand_name\": \"Personio\",\n  \"brand_domains\": [\"personio.de\"],\n  \"competitors\": [{\"name\": \"Workday\", \"domain\": \"workday.com\"}],\n  \"target_llms\": [\"openai\"],\n  \"search_enabled\": false,\n  \"response_mode\": \"sync\"\n}"
        },
        "url": {
          "raw": "http://localhost:5678/webhook/chatlytics-run",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5678",
          "path": ["webhook", "chatlytics-run"]
        }
      }
    },
    {
      "name": "2. Asynchronous Queue Run (<200ms Ack)",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"config_id\": 102,\n  \"prompt\": \"Beste Process Mining Software in DACH\",\n  \"brand_name\": \"Celonis\",\n  \"brand_domains\": [\"celonis.com\"],\n  \"competitors\": [\"SAP Signavio\"],\n  \"target_llms\": [\"gemini\"],\n  \"search_enabled\": true,\n  \"response_mode\": \"async\"\n}"
        },
        "url": {
          "raw": "http://localhost:5678/webhook/chatlytics-run",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5678",
          "path": ["webhook", "chatlytics-run"]
        }
      }
    }
  ]
}
```

---

## 6. Pre-Flight & Post-Deployment Checklist

Before deploying the worker to production or executing scheduled batches, verify each item:

| # | Check Item | Action | Expected Output | Status |
|:---:|---|---|---|:---:|
| **1** | **Canvas Import** | Open n8n UI -> `Ctrl + V` | 21 nodes appear on canvas, zero floating nodes | [ ] |
| **2** | **Workflow Settings** | Open gear icon | Execution Order is strictly set to `v1` | [ ] |
| **3** | **API & Backend Credentials** | Configure OpenAI, Gemini, Mistral & `Chatlytics Backend Secret` (`httpHeaderAuth`) | Green checkmark indicators on all active credentials | [ ] |
| **4** | **Chat Trigger Test** | Send Prompt A in Chat modal | Markdown summary table with MECE status and badges | [ ] |
| **5** | **Webhook Sync Test** | Execute Mode 1 cURL request | HTTP 200 with full evaluation metrics payload | [ ] |
| **6** | **Webhook Async Test** | Execute Mode 2 cURL request | HTTP 200 `{"status": "queued"}` in `<200ms` | [ ] |
| **7** | **Queue Poller Test** | Trigger `Schedule Poller Trigger` | Calls `api/n8n_queue.php?action=poll` successfully | [ ] |
| **8** | **Ingestion Verification** | Check MySQL backend `llm_runs` table | New row inserted with `brand_earliness_char`, MECE state | [ ] |
