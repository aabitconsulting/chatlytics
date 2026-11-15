/**
 * tests/unit/workflow.test.js
 * Comprehensive Unit Test Suite for n8n Universal Worker Workflow & Embedded JavaScript
 * 
 * Verifies:
 * - Top-level n8n 2.44.5 canvas JSON schema & settings
 * - 16-node inventory and graph connection topology
 * - Triple simultaneous triggers (Webhook, Chat, Schedule Poller)
 * - Extraction and execution of embedded JavaScript code inside isolated node:vm sandboxes:
 *   1. Universal Normalizer Code Node
 *   2. Secondary Extractor Code Node
 *   3. Metric & MECE Engine Code Node
 *   4. Chat Response Formatter Code Node
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/chatlytics_universal_worker.json');

describe('n8n Universal Worker Workflow & Code Node Unit Tests', () => {
  let rawJson = null;
  let workflow = null;

  before(() => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), `Workflow JSON file not found at ${WORKFLOW_PATH}`);
    rawJson = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    assert.doesNotThrow(() => {
      workflow = JSON.parse(rawJson);
    }, 'Workflow file must be valid JSON');
  });

  // =========================================================================
  // Suite 1: Top-Level Workflow Schema & Settings
  // =========================================================================
  describe('Suite 1: Top-Level Schema & Settings', () => {
    it('should have required top-level canvas properties', () => {
      assert.ok(workflow.name, 'Workflow missing "name" property');
      assert.ok(Array.isArray(workflow.nodes), '"nodes" must be an array');
      assert.ok(typeof workflow.connections === 'object' && workflow.connections !== null, '"connections" must be an object');
      assert.ok(typeof workflow.settings === 'object', '"settings" must be an object');
    });

    it('should configure executionOrder as v1 for n8n 2.44.5 compatibility', () => {
      assert.equal(workflow.settings.executionOrder, 'v1', 'executionOrder must be "v1"');
    });

    it('should contain no leaked raw API keys or live secrets in canvas JSON', () => {
      assert.ok(!rawJson.includes('sk-proj-'), 'Detected leaked OpenAI secret key');
      assert.ok(!rawJson.includes('sk-ant-'), 'Detected leaked Anthropic secret key');
      assert.ok(!rawJson.includes('AIzaSy'), 'Detected leaked Gemini secret key');
      assert.ok(!rawJson.includes('$env'), 'Workflow must not reference $env (blocked in n8n 2.44.5 by N8N_BLOCK_ENV_ACCESS_IN_NODE)');
    });
  });

  // =========================================================================
  // Suite 2: 16-Node Inventory & Connection Graph Topology
  // =========================================================================
  describe('Suite 2: 16-Node Inventory & Topology', () => {
    it('should contain all 16 canonical workflow nodes', () => {
      assert.ok(workflow.nodes.length >= 16, `Expected at least 16 nodes, found ${workflow.nodes.length}`);
    });

    it('should include all required n8n node types', () => {
      const nodeTypes = new Set(workflow.nodes.map(n => n.type));
      const requiredTypes = [
        'n8n-nodes-base.webhook',
        'n8n-nodes-base.scheduleTrigger',
        'n8n-nodes-base.if',
        'n8n-nodes-base.set',
        'n8n-nodes-base.httpRequest',
        'n8n-nodes-base.code',
        'n8n-nodes-base.respondToWebhook'
      ];
      for (const reqType of requiredTypes) {
        assert.ok(nodeTypes.has(reqType), `Workflow missing essential node type: ${reqType}`);
      }
      const hasChatTrigger = workflow.nodes.some(n => n.type && n.type.includes('chatTrigger'));
      assert.ok(hasChatTrigger, 'Workflow missing @n8n/n8n-nodes-langchain.chatTrigger');
    });

    it('should maintain unbroken graph connections with all targets existing in node registry', () => {
      const nodeNames = new Set(workflow.nodes.map(n => n.name));
      for (const [sourceName, connections] of Object.entries(workflow.connections)) {
        assert.ok(nodeNames.has(sourceName), `Connection source "${sourceName}" is not registered in nodes`);
        if (connections.main && Array.isArray(connections.main)) {
          for (const outputList of connections.main) {
            for (const conn of outputList) {
              assert.ok(nodeNames.has(conn.node), `Connection target "${conn.node}" does not exist in nodes registry`);
            }
          }
        }
      }
    });
  });

  // =========================================================================
  // Suite 3: Simultaneous Tri-Trigger Handshake
  // =========================================================================
  describe('Suite 3: Simultaneous Tri-Trigger Handshake', () => {
    it('should configure Universal Webhook Trigger node correctly', () => {
      const webhookNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
      assert.ok(webhookNode, 'Webhook Trigger node missing');
      assert.equal(webhookNode.parameters.httpMethod, 'POST');
      assert.equal(webhookNode.parameters.path, 'chatlytics-run');
      assert.equal(webhookNode.parameters.responseMode, 'responseNode');
    });

    it('should configure Interactive Chat Trigger node correctly', () => {
      const chatNode = workflow.nodes.find(n => n.type && n.type.includes('chatTrigger'));
      assert.ok(chatNode, 'Interactive Chat Trigger node missing');
    });

    it('should configure Schedule Poller Trigger node correctly', () => {
      const scheduleNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
      assert.ok(scheduleNode, 'Schedule Poller Trigger node missing');
    });

    it('should converge all entry paths into Universal Normalizer', () => {
      const normalizerNode = workflow.nodes.find(n => n.name.toLowerCase().includes('normalizer'));
      assert.ok(normalizerNode, 'Universal Normalizer node missing');
      
      const allConnTargets = [];
      for (const connections of Object.values(workflow.connections)) {
        if (connections.main) {
          for (const list of connections.main) {
            for (const c of list) allConnTargets.push(c.node);
          }
        }
      }
      assert.ok(allConnTargets.includes(normalizerNode.name), 'Universal Normalizer must be target of upstream nodes');
    });
  });

  // =========================================================================
  // Helper: Sandboxed Execution Runner
  // =========================================================================
  function createBlockedEnvProxy() {
    return new Proxy({}, {
      get(_target, prop) {
        throw new Error(`ExpressionError: access to env vars denied (N8N_BLOCK_ENV_ACCESS_IN_NODE) when reading $env.${String(prop)}`);
      }
    });
  }

  function executeNodeJsCode(jsCode, inputItems, customEnv = null, nodeMocks = null) {
    const sandbox = {
      $input: {
        all: () => inputItems,
        first: () => inputItems[0] || { json: {} },
        item: inputItems[0] || { json: {} }
      },
      $: nodeMocks ? (nodeName) => nodeMocks[nodeName] : undefined,
      $env: customEnv ? customEnv : createBlockedEnvProxy(),
      console,
      Date,
      Math,
      URL,
      RegExp,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map
    };

    const context = vm.createContext(sandbox);
    const wrappedCode = `(() => {\n${jsCode}\n})()`;
    const script = new vm.Script(wrappedCode);
    const rawResult = script.runInContext(context);
    return JSON.parse(JSON.stringify(rawResult));
  }

  // =========================================================================
  // Suite 4: Universal Normalizer Code Node Execution via node:vm
  // =========================================================================
  describe('Suite 4: Universal Normalizer Code Node Sandboxed Execution', () => {
    let normalizerCode = null;

    before(() => {
      const node = workflow.nodes.find(n => n.name.toLowerCase().includes('normalizer'));
      assert.ok(node, 'Universal Normalizer node must exist');
      normalizerCode = node.parameters?.jsCode;
      assert.ok(normalizerCode && normalizerCode.length > 50, 'Universal Normalizer jsCode missing or empty');
    });

    it('should compile jsCode with zero syntax errors', () => {
      assert.doesNotThrow(() => {
        new vm.Script(`(() => {\n${normalizerCode}\n})`);
      });
    });

    it('should parse interactive Chat Trigger shorthand format and expand multi-LLM items', () => {
      const shorthandText = `PROMPT: Welche HR-Software eignet sich für den Mittelstand?
BRAND: Personio
DOMAINS: personio.de, personio.com
COMPETITORS: Workday (workday.com), SAP SuccessFactors (sap.com)
LLMS: openai, gemini
SEARCH: true`;

      const inputItems = [{ json: { chatInput: shorthandText } }];
      const result = executeNodeJsCode(normalizerCode, inputItems);

      assert.ok(Array.isArray(result), 'Normalizer must return array of items');
      assert.equal(result.length, 2, 'Should expand into 2 items (openai, gemini)');

      const item1 = result[0].json;
      assert.equal(item1.trigger_source, 'chat');
      assert.equal(item1.prompt, 'Welche HR-Software eignet sich für den Mittelstand?');
      assert.equal(item1.brand_name, 'Personio');
      assert.deepEqual(item1.brand_domains, ['personio.de', 'personio.com']);
      assert.equal(item1.competitors.length, 2);
      assert.equal(item1.competitors[0].name, 'Workday');
      assert.equal(item1.competitors[0].domain, 'workday.com');
      assert.equal(item1.provider, 'openai');
      assert.equal(item1.search_enabled, true);

      assert.equal(item1.eu_hosted, false);
      assert.equal(item1.prompt_cache_key, null);
      assert.equal(item1.execution_strategy, 'regular');
      const item2 = result[1].json;
      assert.equal(item2.provider, 'google');
      assert.equal(item2.model_key, 'google/gemini-3.5-flash');
    });

    it('should parse raw JSON chat input matching universal normalizer schema', () => {
      const rawPayload = JSON.stringify({
        prompt: 'Beste ERP Software',
        brand_name: 'SAP',
        brand_domains: ['sap.com'],
        competitors: [{ name: 'Oracle', domain: 'oracle.com' }],
        target_llms: ['openai']
      });

      const inputItems = [{ json: { chatInput: rawPayload } }];
      const result = executeNodeJsCode(normalizerCode, inputItems);

      assert.equal(result.length, 1);
      assert.equal(result[0].json.brand_name, 'SAP');
      assert.equal(result[0].json.provider, 'openai');
    });

    it('should parse Webhook POST body input', () => {
      const inputItems = [{
        json: {
          body: {
            prompt: 'Beste CRM Software',
            brand_name: 'HubSpot',
            brand_domains: ['hubspot.de'],
            competitors: ['Salesforce'],
            target_llms: ['gemini'],
            response_mode: 'async'
          }
        }
      }];

      const result = executeNodeJsCode(normalizerCode, inputItems);
      assert.equal(result.length, 1);
      assert.equal(result[0].json.trigger_source, 'webhook');
      assert.equal(result[0].json.brand_name, 'HubSpot');
      assert.equal(result[0].json.response_mode, 'async');
    });

    it('should unpack batch jobs from Schedule Poller queue response', () => {
      const inputItems = [{
        json: {
          jobs: [
            {
              config_id: 101,
              prompt: 'Job 1 Prompt',
              brand_name: 'BrandA',
              target_llms: ['openai']
            },
            {
              config_id: 102,
              prompt: 'Job 2 Prompt',
              brand_name: 'BrandB',
              target_llms: ['anthropic']
            }
          ]
        }
      }];

      const result = executeNodeJsCode(normalizerCode, inputItems);
      assert.equal(result.length, 2);
      assert.equal(result[0].json.brand_name, 'BrandA');
      assert.equal(result[0].json.provider, 'openai');
      assert.equal(result[1].json.brand_name, 'BrandB');
      assert.equal(result[1].json.provider, 'anthropic');
    });

    it('should survive sparse jobs array with null and undefined items', () => {
      const inputItems = [{
        json: {
          jobs: [
            null,
            undefined,
            {
              config_id: 105,
              prompt: 'Sparse Job Prompt',
              brand_name: 'SparseBrand',
              target_llms: ['gemini']
            }
          ]
        }
      }];

      let result;
      assert.doesNotThrow(() => {
        result = executeNodeJsCode(normalizerCode, inputItems);
      }, 'Normalizer must not throw on sparse jobs array');

      assert.equal(result.length, 1);
      assert.equal(result[0].json.brand_name, 'SparseBrand');
      assert.equal(result[0].json.provider, 'google');
      assert.equal(result[0].json.model, 'gemini-3.5-flash');
    });
  });

  // =========================================================================
  // Suite 5: Secondary Extractor Code Node Execution via node:vm
  // =========================================================================
  describe('Suite 5: Secondary Extractor Code Node Sandboxed Execution', () => {
    let extractorCode = null;

    before(() => {
      const node = workflow.nodes.find(n => n.name.toLowerCase().includes('extractor'));
      assert.ok(node, 'Secondary Extractor node must exist');
      extractorCode = node.parameters?.jsCode;
      assert.ok(extractorCode && extractorCode.length > 50, 'Secondary Extractor jsCode missing or empty');
    });

    it('should compile Secondary Extractor jsCode without errors', () => {
      assert.doesNotThrow(() => {
        new vm.Script(`(() => {\n${extractorCode}\n})`);
      });
    });

    it('should extract Google Gemini grounding chunks and web citations', () => {
      const geminiItem = {
        json: {
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [{ name: 'Workday', domain: 'workday.com' }],
          candidates: [
            {
              content: {
                parts: [{ text: 'Personio ist die führende HR-Software im DACH-Raum. Workday ist für Großkonzerne.' }]
              },
              groundingMetadata: {
                webSearchQueries: ['beste hr software mittelstand'],
                groundingChunks: [
                  { web: { uri: 'https://www.personio.de/features', title: 'Personio HR' } },
                  { web: { uri: 'https://omr.com/de/reviews/personio', title: 'OMR Review' } }
                ]
              }
            }
          ]
        }
      };

      const result = executeNodeJsCode(extractorCode, [geminiItem]);
      assert.ok(Array.isArray(result) && result.length > 0);
      const resJson = result[0].json;

      assert.ok(resJson.raw_response.includes('Personio ist die führende'));
      assert.ok(Array.isArray(resJson.citations));
      assert.equal(resJson.citations.length, 2);
      assert.equal(resJson.citations[0].citation_domain, 'personio.de');
      assert.equal(resJson.citations[0].is_brand_domain, true);
      assert.equal(resJson.citations[1].citation_domain, 'omr.com');
      assert.equal(resJson.citations[1].is_brand_domain, false);
    });

    it('should extract Markdown link citations from OpenAI / Claude markdown text', () => {
      const openAiItem = {
        json: {
          provider: 'openai',
          model: 'gpt-4o',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [{ name: 'Workday', domain: 'workday.com' }],
          choices: [
            {
              message: {
                content: 'Empfehlenswert ist [Personio HR](https://www.personio.de) sowie [Workday](https://www.workday.com).'
              }
            }
          ]
        }
      };

      const result = executeNodeJsCode(extractorCode, [openAiItem]);
      const resJson = result[0].json;

      assert.equal(resJson.citations.length, 2);
      assert.equal(resJson.citations[0].citation_domain, 'personio.de');
      assert.equal(resJson.citations[0].is_brand_domain, true);
      assert.equal(resJson.citations[1].citation_domain, 'workday.com');
      assert.equal(resJson.citations[1].is_brand_domain, false);
    });

    it('should strip trailing punctuation from bare URLs and handle null competitors safely', () => {
      const item = {
        json: {
          provider: 'anthropic',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [null, { name: 'Workday', domain: 'workday.com' }],
          content: [{ type: 'text', text: 'Empfehlungen: https://personio.de/pricing. Und https://workday.com/de, sowie [Link](https://personio.de/demo).' }]
        }
      };

      let result;
      assert.doesNotThrow(() => {
        result = executeNodeJsCode(extractorCode, [item]);
      }, 'Secondary Extractor must handle null competitors without throwing');

      const citations = result[0].json.citations;
      assert.ok(citations.length >= 2);
      const personioBare = citations.find(c => c.citation_url.includes('pricing'));
      assert.ok(personioBare, 'Must extract personio pricing bare URL');
      assert.equal(personioBare.citation_url, 'https://personio.de/pricing');
      assert.equal(personioBare.citation_domain, 'personio.de');

      const workdayBare = citations.find(c => c.citation_url.includes('workday.com'));
      assert.ok(workdayBare, 'Must extract workday bare URL');
      assert.equal(workdayBare.citation_url, 'https://workday.com/de');
      assert.equal(workdayBare.citation_domain, 'workday.com');
      assert.equal(workdayBare.is_competitor_domain, true);
    });
  });

  // =========================================================================
  // Suite 6: Metric & MECE Engine Code Node Execution via node:vm
  // =========================================================================
  describe('Suite 6: Metric Engine Code Node Sandboxed Execution', () => {
    let metricCode = null;

    before(() => {
      const node = workflow.nodes.find(n => n.name.toLowerCase().includes('metric'));
      assert.ok(node, 'Metric & MECE Engine node must exist');
      metricCode = node.parameters?.jsCode;
      assert.ok(metricCode && metricCode.length > 50, 'Metric Engine jsCode missing or empty');
    });

    it('should compile Metric Engine jsCode cleanly in node:vm', () => {
      assert.doesNotThrow(() => {
        new vm.Script(`(() => {\n${metricCode}\n})`);
      });
    });

    it('should compute exact German Unicode earliness and MECE 1_DIRECT_WIN', () => {
      const item = {
        json: {
          brand_name: 'Jägermeister',
          brand_domains: ['jaegermeister.de'],
          competitors: [{ name: 'Underberg', domain: 'underberg.de' }],
          raw_response: 'JÄGERMEISTER ist die bekannteste Kräuterlikörmarke Deutschlands. Underberg ist die Alternative.',
          citations: [
            { citation_domain: 'jaegermeister.de', citation_url: 'https://jaegermeister.de' }
          ]
        }
      };

      const result = executeNodeJsCode(metricCode, [item]);
      assert.ok(Array.isArray(result) && result.length > 0);
      const metrics = result[0].json;

      assert.equal(metrics.brand_mentioned, 1);
      assert.equal(metrics.brand_earliness_char, 0);
      assert.equal(metrics.brand_earliness_word, 1);
      assert.equal(metrics.brand_relative_pos, 0.0);
      assert.equal(metrics.brand_domain_cited, 1);
      assert.equal(metrics.mece_category, '1_DIRECT_WIN');
    });

    it('should classify 2_BRAND_HALO when competitor appears ahead of target brand', () => {
      const item = {
        json: {
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [{ name: 'Workday', domain: 'workday.com' }],
          raw_response: 'Workday ist Marktführer. Auch Personio bietet starke Funktionen.',
          citations: []
        }
      };

      const result = executeNodeJsCode(metricCode, [item]);
      const metrics = result[0].json;

      assert.equal(metrics.mece_category, '2_BRAND_HALO');
      assert.equal(metrics.competitors[0].mentioned, 1);
      assert.equal(metrics.competitors[0].word_earliness, 1);
      assert.equal(metrics.brand_earliness_word, 5);
    });

    it('should diagnose 1_CITATION_HIJACK when brand is in text but competitor/aggregator domain is cited', () => {
      const item = {
        json: {
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [{ name: 'Workday', domain: 'workday.com' }],
          raw_response: 'Personio ist eine beliebte Lösung.',
          citations: [
            { citation_domain: 'omr.com', citation_url: 'https://omr.com' }
          ]
        }
      };

      const result = executeNodeJsCode(metricCode, [item]);
      const metrics = result[0].json;

      assert.equal(metrics.brand_mentioned, 1);
      assert.equal(metrics.brand_domain_cited, 0);
      assert.equal(metrics.geo_quadrant, '1_CITATION_HIJACK');
    });

    it('should diagnose 4_BURIED_WINNER when brand wins citations & text but relative position > 50%', () => {
      const padding = 'Ein langer Text mit vielen Erläuterungen und Details über Softwarelösungen. '.repeat(5);
      const fullText = padding + 'Am Ende empfehlen wir Personio für die Verwaltung.';
      const item = {
        json: {
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [],
          raw_response: fullText,
          citations: [
            { citation_domain: 'personio.de', citation_url: 'https://personio.de' }
          ]
        }
      };

      const result = executeNodeJsCode(metricCode, [item]);
      const metrics = result[0].json;

      assert.equal(metrics.brand_mentioned, 1);
      assert.equal(metrics.brand_domain_cited, 1);
      assert.ok(metrics.brand_relative_pos > 50.0);
      assert.equal(metrics.geo_quadrant, '4_BURIED_WINNER');
    });
  });

  // =========================================================================
  // Suite 7: Response Formatter & Ingestion Handshake
  // =========================================================================
  describe('Suite 7: Response Formatter & Ingestion Handshake', () => {
    it('should verify Chat Response Formatter outputs markdown table with badges', () => {
      const formatterNode = workflow.nodes.find(n => n.name.toLowerCase().includes('format'));
      assert.ok(formatterNode, 'Chat Response Formatter node must exist');
      const formatterCode = formatterNode.parameters?.jsCode;
      assert.ok(formatterCode, 'Formatter jsCode missing');

      const item = {
        json: {
          prompt: 'Beste HR Software',
          brand_name: 'Personio',
          provider: 'gemini',
          mece_category: '1_DIRECT_WIN',
          geo_quadrant: 'NONE',
          brand_earliness_word: 7,
          brand_relative_pos: 3.4
        }
      };

      const result = executeNodeJsCode(formatterCode, [item]);
      assert.ok(Array.isArray(result) && result.length > 0);
      const outputText = result[0].json.output || result[0].json.text || result[0].json.message;

      assert.ok(typeof outputText === 'string');
      assert.ok(outputText.includes('Chatlytics AI Visibility'));
      assert.ok(outputText.includes('1_DIRECT_WIN'));
    });

    it('should verify Ingestion HTTP Request node targets POST /api/ingest.php with auth header', () => {
      const ingestNode = workflow.nodes.find(n => n.name.toLowerCase().includes('ingest'));
      assert.ok(ingestNode, 'Ingestion HTTP node must exist');
      assert.equal(ingestNode.parameters.method, 'POST');
      assert.ok(
        ingestNode.parameters.url?.includes('ingest.php'),
        'Ingest node must post to ingest.php'
      );
      assert.equal(ingestNode.parameters.authentication, 'genericCredentialType');
      assert.equal(ingestNode.parameters.genericAuthType, 'httpHeaderAuth');
    });
  });

  // =========================================================================
  // Helper: Sandboxed n8n Parameter Expression Evaluator
  // =========================================================================
  function evaluateN8nExpression(expr, context = {}) {
    if (typeof expr !== 'string') return expr;

    const sandbox = {
      $json: context.$json || context.json || {},
      $env: context.$env || createBlockedEnvProxy(),
      $credentials: {
        openAiApi: { apiKey: 'test_openai_key' },
        anthropicApi: { apiKey: 'test_anthropic_key' },
        googlePalmApi: { apiKey: 'test_gemini_key' },
        ...(context.$credentials || {})
      },
      $now: {
        toISO: () => '2026-11-08T12:00:00.000Z'
      },
      console,
      Date,
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean
    };

    const vmContext = vm.createContext(sandbox);
    const trimmed = expr.trim();

    // Pure expression: ={{ <JS_CODE> }}
    if (trimmed.startsWith('={{') && trimmed.endsWith('}}') && trimmed.indexOf('{{', 3) === -1) {
      const code = trimmed.slice(3, -2).trim();
      return vm.runInContext(code, vmContext);
    }

    // Template string with embedded {{ <JS_CODE> }}
    let result = expr;
    if (result.startsWith('=')) {
      result = result.slice(1);
    }
    return result.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_, code) => {
      try {
        const val = vm.runInContext(code, vmContext);
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return val !== undefined && val !== null ? String(val) : '';
      } catch (_) {
        return '';
      }
    });
  }

  // =========================================================================
  // Suite 8: Sandboxed Execution of HTTP Node Parameter Expressions
  // =========================================================================
  describe('Suite 8: Sandboxed Execution of HTTP Node Parameter Expressions', () => {
    const upstreamMetricItem = {
      config_id: 101,
      user_id: 5,
      prompt: 'Welche HR-Software eignet sich für den Mittelstand?',
      prompt_text: 'Welche HR-Software eignet sich für den Mittelstand?',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      model_name: 'gemini-1.5-flash',
      brand_name: 'Personio',
      brand_mentioned: 1,
      brand_recommended: true,
      brand_prominence_rank: 1,
      char_earliness: 0,
      word_earliness: 1,
      relative_position_pct: 0.0,
      total_chars: 1250,
      total_words: 180,
      mece_category: '1_DIRECT_WIN',
      geo_quadrant: 'NONE',
      has_citations: 1,
      brand_cited: 1,
      competitor_cited: 0,
      raw_response: 'Personio führt im Mittelstand.',
      raw_response_text: 'Personio führt im Mittelstand.',
      run_duration_ms: 850,
      competitors: [
        {
          competitor_name: 'Workday',
          competitor_domain: 'workday.com',
          mentioned: 1,
          is_mentioned: 1,
          char_earliness: 350,
          word_earliness: 52,
          relative_position_pct: 28.0
        }
      ],
      citations: [
        {
          citation_index: 1,
          citation_url: 'https://personio.de/features',
          citation_domain: 'personio.de',
          domain: 'personio.de',
          citation_title: 'Personio Features',
          is_brand_domain: true,
          is_competitor_domain: false
        }
      ]
    };

    it('should evaluate Dispatch Ingest API jsonBody into valid JSON without stray "=" or "[object Object]"', () => {
      const ingestNode = workflow.nodes.find(n => n.name === 'Dispatch Ingest API');
      assert.ok(ingestNode, 'Dispatch Ingest API node must exist');
      assert.ok(ingestNode.parameters?.jsonBody, 'jsonBody parameter must be configured');

      const rawJsonBody = ingestNode.parameters.jsonBody;
      const evaluated = evaluateN8nExpression(rawJsonBody, { json: upstreamMetricItem });

      assert.ok(typeof evaluated === 'string' && evaluated.length > 0, 'Evaluated jsonBody must be non-empty string');
      assert.ok(!evaluated.startsWith('='), 'Evaluated JSON string must not start with stray "=" prefix');
      assert.ok(!evaluated.includes('[object Object]'), 'Evaluated JSON must not contain serialized "[object Object]"');

      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(evaluated);
      }, 'Evaluated jsonBody must parse cleanly as valid JSON');

      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string') {
          assert.ok(!val.startsWith('='), `Field "${key}" contains stray "=" prefix: "${val}"`);
        }
      }

      assert.ok(Array.isArray(parsed.competitors), '"competitors" must serialize as genuine array');
      assert.equal(parsed.competitors.length, 1);
      assert.equal(parsed.competitors[0].competitor_name, 'Workday');

      assert.ok(Array.isArray(parsed.citations), '"citations" must serialize as genuine array');
      assert.equal(parsed.citations.length, 1);
      assert.equal(parsed.citations[0].citation_domain, 'personio.de');

      assert.equal(typeof parsed.config_id, 'number');
      assert.equal(parsed.config_id, 101);
      assert.equal(parsed.total_chars, 1250);
      assert.equal(parsed.total_words, 180);
      assert.equal(parsed.mece_category, '1_DIRECT_WIN');
    });

    it('should evaluate Dispatch Ingest API headers, dynamic api_base_url, and httpHeaderAuth without $env', () => {
      const ingestNode = workflow.nodes.find(n => n.name === 'Dispatch Ingest API');
      const evalUrlFallback = evaluateN8nExpression(ingestNode.parameters.url, { json: upstreamMetricItem });
      assert.equal(evalUrlFallback, 'https://chatlytics.de/api/ingest.php');

      const evalUrlDynamic = evaluateN8nExpression(ingestNode.parameters.url, {
        json: { ...upstreamMetricItem, api_base_url: 'https://staging.chatlytics.de/' }
      });
      assert.equal(evalUrlDynamic, 'https://staging.chatlytics.de/api/ingest.php');

      assert.equal(ingestNode.parameters.authentication, 'genericCredentialType');
      assert.equal(ingestNode.parameters.genericAuthType, 'httpHeaderAuth');
      assert.ok(ingestNode.credentials?.httpHeaderAuth?.name, 'Dispatch Ingest API must reference httpHeaderAuth credential');
      assert.equal(ingestNode.retryOnFail, true, 'Dispatch Ingest API should retry transient failures');
      assert.equal(ingestNode.parameters.options?.timeout, 15000);

      const headers = ingestNode.parameters.headerParameters?.parameters || [];
      const contentTypeHeader = headers.find(h => h.name === 'Content-Type');
      assert.equal(contentTypeHeader?.value, 'application/json');
      assert.ok(!JSON.stringify(ingestNode).includes('$env'), 'Dispatch Ingest API must not reference $env');
    });

    it('should evaluate unified Call OpenRouter Chat HTTP node cleanly (zero system prompts, zero caching, dynamic search tools/plugins)', () => {
      const chatNode = workflow.nodes.find(n => n.name === 'Call OpenRouter Chat');
      assert.ok(chatNode, 'Call OpenRouter Chat node must exist');
      assert.equal(chatNode.type, 'n8n-nodes-base.httpRequest');
      assert.equal(chatNode.parameters.url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(chatNode.parameters.authentication, 'predefinedCredentialType');
      assert.equal(chatNode.parameters.nodeCredentialType, 'openRouterApi');
      assert.equal(chatNode.credentials?.openRouterApi?.id, 'tjmYBMIQa9Fo3kYL');
      assert.equal(chatNode.credentials?.openRouterApi?.name, 'OpenRouter - Chatlytics - Chatlytics-dev-1');
      assert.equal(chatNode.parameters.options?.response?.response?.neverError, true);
      assert.equal(chatNode.onError, 'continueRegularOutput');

      // With search + tools supported -> openrouter:web_search tool & ONLY user prompt
      const bodyWithTools = JSON.parse(evaluateN8nExpression(chatNode.parameters.jsonBody, {
        json: {
          model_key: 'openai/gpt-6-luna',
          prompt: 'Beste Software',
          llm_prompt: 'Beste Software\nBeziehe deine Antwort speziell auf den Markt/die Region: DACH.',
          search_enabled: true,
          supports_tools: true
        }
      }));
      assert.equal(bodyWithTools.model, 'openai/gpt-6-luna');
      assert.equal(bodyWithTools.messages.length, 1);
      assert.equal(bodyWithTools.messages[0].role, 'user');
      assert.ok(bodyWithTools.messages[0].content.includes('DACH'));
      assert.equal(bodyWithTools.messages.some(m => m.role === 'system'), false);
      assert.equal(bodyWithTools.prompt_cache_key, undefined);
      assert.deepEqual(bodyWithTools.tools, [{ type: 'openrouter:web_search' }]);
      assert.equal(bodyWithTools.plugins, undefined);

      // Without tools support + search ON -> plugins: [{ id: 'web' }]
      const bodyWithPlugin = JSON.parse(evaluateN8nExpression(chatNode.parameters.jsonBody, {
        json: { model_key: 'qwen/qwen3-max', prompt: 'Best CRM?', search_enabled: true, supports_tools: false }
      }));
      assert.equal(bodyWithPlugin.tools, undefined);
      assert.deepEqual(bodyWithPlugin.plugins, [{ id: 'web' }]);

      // Perplexity -> native web search without extra tools/plugins
      const bodyPplx = JSON.parse(evaluateN8nExpression(chatNode.parameters.jsonBody, {
        json: { model_key: 'perplexity/sonar-pro', prompt: 'Best ERP?', search_enabled: true, supports_tools: false }
      }));
      assert.equal(bodyPplx.tools, undefined);
      assert.equal(bodyPplx.plugins, undefined);
    });

    it('should evaluate OpenRouter Batch API nodes and Live Model Discovery nodes with tjmYBMIQa9Fo3kYL', () => {
      for (const nodeName of ['Discover OpenRouter Models', 'Submit OpenRouter Batch', 'Fetch OpenRouter Batch Status']) {
        const n = workflow.nodes.find(x => x.name === nodeName);
        assert.ok(n, nodeName + ' node must exist');
        assert.equal(n.type, 'n8n-nodes-base.httpRequest');
        assert.equal(n.parameters.authentication, 'predefinedCredentialType');
        assert.equal(n.parameters.nodeCredentialType, 'openRouterApi');
        assert.equal(n.credentials?.openRouterApi?.id, 'tjmYBMIQa9Fo3kYL');
        assert.ok(!JSON.stringify(n).includes('$env'), nodeName + ' must not reference $env');
      }

      const fetchBatchNode = workflow.nodes.find(n => n.name === 'Fetch OpenRouter Batch Status');
      assert.equal(
        evaluateN8nExpression(fetchBatchNode.parameters.url, { json: { provider_batch_id: 'batch_abc_123' } }),
        'https://openrouter.ai/api/v1/batches/batch_abc_123'
      );

      for (const backendNodeName of ['Poll Open Batches', 'Register OpenRouter Batch', 'Fail OpenRouter Batch']) {
        const bn = workflow.nodes.find(x => x.name === backendNodeName);
        assert.ok(bn, backendNodeName + ' must exist');
        assert.equal(bn.parameters.authentication, 'genericCredentialType');
        assert.equal(bn.parameters.genericAuthType, 'httpHeaderAuth');
        assert.ok(!JSON.stringify(bn).includes('$env'), backendNodeName + ' must not reference $env');
      }
    });

    it('should evaluate Dispatch Ingest API updated payload fields including run_id, status, geo metrics, and cost_credits', () => {
      const ingestNode = workflow.nodes.find(n => n.name === 'Dispatch Ingest API');
      const evalBody = evaluateN8nExpression(ingestNode.parameters.jsonBody, {
        json: {
          run_id: 'run_or_1',
          config_id: 101,
          user_id: 5,
          prompt: 'EU Mistral Test',
          market_region: 'FR',
          prompt_language: 'de',
          inferred_region: 'DACH',
          effective_region: 'FR',
          region_source: 'user_setting',
          regional_citation_count: 1,
          regional_citation_ratio: 100,
          provider: 'mistralai',
          model: 'mistral-medium-3-5',
          execution_strategy: 'batch_api',
          search_enabled: false,
          status: 'failed',
          error_message: 'Model unavailable',
          cost_credits: 0,
          brand_name: 'Personio',
          brand_mentioned: 0,
          mece_category: '4_GENERIC',
          geo_quadrant: 'NONE',
          raw_response_text: 'ERROR: Model unavailable'
        }
      });
      const parsed = JSON.parse(evalBody);
      assert.equal(parsed.run_id, 'run_or_1');
      assert.equal(parsed.provider, 'mistralai');
      assert.equal(parsed.model, 'mistral-medium-3-5');
      assert.equal(parsed.eu_hosted, false);
      assert.equal(parsed.prompt_cache_key, null);
      assert.equal(parsed.execution_strategy, 'batch_api');
      assert.equal(parsed.market_region, 'FR');
      assert.equal(parsed.effective_region, 'FR');
      assert.equal(parsed.region_source, 'user_setting');
      assert.equal(parsed.status, 'failed');
      assert.equal(parsed.error_message, 'Model unavailable');
      assert.equal(parsed.cost_credits, 0);
    });

    it('should normalize legacy Mistral/GLM/Gemini aliases onto OpenRouter slugs and extract Annotations & error states cleanly', () => {
      const normalizer = workflow.nodes.find(n => n.name === 'Universal Normalizer');
      const extractor = workflow.nodes.find(n => n.name === 'Secondary Extractor');
      const calc = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator');
      const formatter = workflow.nodes.find(n => n.name === 'Format Chat Response');

      const normItems = executeNodeJsCode(normalizer.parameters.jsCode, [{
        json: {
          body: {
            run_id: 'run_multi_1',
            config_id: 55,
            prompts: ['Prompt A', 'Prompt B'],
            brand_name: 'Personio',
            target_llms: ['mistral/mistral-medium-latest', 'mistral/zai-glm-5-3', 'glm', 'openai', 'gemini']
          }
        }
      }]);
      // 'glm' resolves to 'z-ai/glm-5.3' and deduplicates against 'mistral/zai-glm-5-3' -> 4 unique models * 2 prompts = 8 items
      assert.equal(normItems.length, 8);
      const glmItems = normItems.filter(it => it.json.model_key === 'z-ai/glm-5.3');
      assert.equal(glmItems.length, 2);
      assert.equal(glmItems[0].json.provider, 'z-ai');
      assert.equal(glmItems[0].json.model, 'glm-5.3');
      assert.equal(glmItems[0].json.eu_hosted, false);
      assert.equal(glmItems[0].json.prompt_cache_key, null);

      // Extract OpenAI Responses / Annotations citation payload cleanly
      const respApiItem = executeNodeJsCode(extractor.parameters.jsCode, [{
        json: {
          output: [
            { type: 'web_search_call', id: 'ws_1' },
            {
              type: 'message',
              content: [{
                type: 'output_text',
                text: 'Personio ist marktführend für KMU HR.',
                annotations: [{ type: 'url_citation', url: 'https://www.personio.de/hr/', title: 'Personio HR' }]
              }]
            }
          ]
        }
      }], {}, {
        'Universal Normalizer': {
          first: () => ({ json: { provider: 'openai', model: 'gpt-6-luna', brand_name: 'Personio', brand_domains: ['personio.de'], eu_hosted: false } }),
          itemMatching: () => ({ json: { provider: 'openai', model: 'gpt-6-luna', brand_name: 'Personio', brand_domains: ['personio.de'], eu_hosted: false } })
        }
      });
      assert.equal(respApiItem[0].json.status, 'completed');
      assert.ok(respApiItem[0].json.raw_response_text.includes('Personio'));
      assert.equal(respApiItem[0].json.citations.length, 1);
      assert.equal(respApiItem[0].json.citations[0].is_brand_domain, true);
      assert.equal(respApiItem[0].json.citations[0].source_type, 'openrouter_web_search');

      // Extract error object -> status: 'failed' -> Calculator preserves failed status & 0 credits
      const failedExt = executeNodeJsCode(extractor.parameters.jsCode, [{
        json: { object: 'error', message: 'Invalid model: zai-glm-unknown', type: 'invalid_request_error' }
      }], {}, {
        'Universal Normalizer': {
          first: () => ({ json: { provider: 'z-ai', model: 'glm-5.3', brand_name: 'Personio', eu_hosted: false } }),
          itemMatching: () => ({ json: { provider: 'z-ai', model: 'glm-5.3', brand_name: 'Personio', eu_hosted: false } })
        }
      });
      assert.equal(failedExt[0].json.status, 'failed');
      assert.equal(failedExt[0].json.error_message, 'Invalid model: zai-glm-unknown');

      const failedCalc = executeNodeJsCode(calc.parameters.jsCode, failedExt);
      assert.equal(failedCalc[0].json.status, 'failed');
      assert.equal(failedCalc[0].json.cost_credits, 0);
      assert.equal(failedCalc[0].json.brand_mentioned, 0);
      assert.equal(failedCalc[0].json.mece_category, '4_GENERIC');

      const formattedFail = executeNodeJsCode(formatter.parameters.jsCode, failedCalc);
      assert.ok(formattedFail[0].json.output.includes('OpenRouter'));
      assert.ok(formattedFail[0].json.output.includes('failed'));
    });

    it('should verify Fast Async Response returns valid JSON string without literal newlines or stray "="', () => {
      const node = workflow.nodes.find(n => n.name === 'Fast Async Response');
      assert.ok(node, 'Fast Async Response node must exist');
      assert.ok(node.parameters.responseBody.includes('JSON.stringify'), 'Fast Async Response responseBody must use JSON.stringify');
      const evaled = evaluateN8nExpression(node.parameters.responseBody, { json: { body: { run_id: 'run_123' } } });
      assert.ok(!evaled.startsWith('='));
      assert.ok(!evaled.includes('[object Object]'));
      const parsed = JSON.parse(evaled);
      assert.equal(parsed.status, 'queued');
      assert.equal(parsed.run_id, 'run_123');
      assert.ok(parsed.timestamp);
    });

    it('should verify Poll Backend Queue, Strategy Routers, Zero $env / Zero System Prompt / Zero Cache Control', () => {
      const queueNode = workflow.nodes.find(n => n.name === 'Poll Backend Queue');
      assert.ok(queueNode, 'Poll Backend Queue node must exist');
      const queueUrl = evaluateN8nExpression(queueNode.parameters.url, {});
      assert.equal(queueUrl, 'https://chatlytics.de/api/n8n_queue.php?action=poll');
      assert.equal(queueNode.parameters.authentication, 'genericCredentialType');
      assert.equal(queueNode.parameters.genericAuthType, 'httpHeaderAuth');
      assert.ok(queueNode.credentials?.httpHeaderAuth?.name, 'Poll Backend Queue must reference httpHeaderAuth credential');
      assert.equal(queueNode.parameters.options?.timeout, 15000);

      for (const ifName of ['Execution Strategy Router', 'Route Batch Outcome', 'Route Discover Models', 'Check Async Mode', 'Check Batch Submit Success']) {
        const ifNode = workflow.nodes.find(n => n.name === ifName);
        assert.ok(ifNode, ifName + ' must exist');
        assert.equal(ifNode.type, 'n8n-nodes-base.if');
      }

      const rawWorkflow = JSON.stringify(workflow);
      assert.equal(rawWorkflow.includes('$env'), false, 'Workflow must never reference $env');
      assert.equal(rawWorkflow.includes('cache_control'), false, 'Workflow must not configure input prompt cache_control');
      assert.equal(rawWorkflow.includes('systemMessage'), false, 'Workflow must not configure systemMessage');

      const respondSync = workflow.nodes.find(n => n.name === 'Respond Webhook Sync');
      assert.ok(respondSync, 'Respond Webhook Sync must exist');
      assert.equal(respondSync.continueOnFail, true, 'Respond Webhook Sync must have continueOnFail: true');
      assert.equal(respondSync.onError, 'continueRegularOutput', 'Respond Webhook Sync must configure onError: continueRegularOutput');
    });
  });

  // =========================================================================
  // Suite 9: Production Hardening ? Queue Domains, Safe Meta Pairing, No 101 Fallback
  // =========================================================================
  describe('Suite 9: Production Hardening & Multi-Tenant Safety', () => {
    it('Universal Normalizer preserves competitor domains arrays, api_base_url, and drops empty-prompt poll noise', () => {
      const normalizerNode = workflow.nodes.find(n => n.name === 'Universal Normalizer');
      const expanded = executeNodeJsCode(normalizerNode.parameters.jsCode, [
        {
          json: {
            status: 'success',
            api_base_url: 'https://staging.chatlytics.de/',
            jobs: [
              {
                config_id: 222,
                user_id: 9,
                brand_name: 'Personio',
                brand_domains: ['personio.de'],
                prompt: 'Beste HR Software',
                competitors: [{ name: 'Workday', domains: ['workday.com', 'workday.de'] }],
                target_llms: ['openai', 'gemini']
              }
            ]
          }
        },
        {
          json: { statusCode: 502, message: 'Bad Gateway' }
        },
        {
          json: { data: '<html>502 Bad Gateway</html>' }
        },
        {
          json: { status: 'error', error: 'Unauthorized' }
        },
        {
          json: { status: 'success', jobs: [{ config_id: 223, prompt: '' }] }
        }
      ]);

      assert.equal(expanded.length, 2, 'Only valid queue job should expand; HTTP 502 & empty prompt must produce zero LLM calls');
      assert.equal(expanded[0].json.api_base_url, 'https://staging.chatlytics.de');
      assert.equal(expanded[0].json.competitors[0].domain, 'workday.com');
      assert.deepEqual(expanded[0].json.competitors[0].domains, ['workday.com', 'workday.de']);
      assert.match(expanded[0].json.run_id, /^run_\d+_[a-f0-9]+$/);
    });

    it('Secondary Extractor survives throwing .item getter, isolates multi-branch provider items, and flags competitor domains array', () => {
      const extractorNode = workflow.nodes.find(n => n.name === 'Secondary Extractor');
      const allNormalizerOutputs = [
        {
          json: {
            run_id: 'run_1_aaaa1111',
            api_base_url: 'https://chatlytics.de',
            config_id: 10,
            user_id: 2,
            provider: 'openai',
            model: 'gpt-6-luna',
            brand_name: 'Personio',
            brand_domains: ['personio.de'],
            competitors: [{ name: 'Workday', domains: ['workday.com', 'workday.de'] }],
            prompt: 'HR Software OpenAI'
          }
        },
        {
          json: {
            run_id: 'run_1_aaaa1111',
            api_base_url: 'https://chatlytics.de',
            config_id: 20,
            user_id: 3,
            provider: 'gemini',
            model: 'models/gemini-3.5-flash',
            brand_name: 'Celonis',
            brand_domains: ['celonis.com'],
            competitors: [{ name: 'Signavio', domains: ['signavio.com'] }],
            prompt: 'Process Mining Gemini'
          }
        }
      ];

      const throwingNormalizerMock = {
        itemMatching: () => undefined,
        all: () => allNormalizerOutputs,
        first: () => allNormalizerOutputs[0]
      };
      Object.defineProperty(throwingNormalizerMock, 'item', {
        get() {
          throw new Error("Can't use .item here in Run Once for All Items mode");
        }
      });

      const geminiBranchPayload = {
        candidates: [
          {
            content: { parts: [{ text: 'Celonis ist stark, siehe Signavio Analyse.' }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://www.signavio.com/guide', title: 'Signavio' } }
              ]
            }
          }
        ]
      };

      const extracted = executeNodeJsCode(
        extractorNode.parameters.jsCode,
        [{ json: geminiBranchPayload }],
        null,
        { 'Universal Normalizer': throwingNormalizerMock }
      );

      assert.equal(extracted.length, 1);
      assert.equal(extracted[0].json.config_id, 20, 'Must match Gemini item (config 20) instead of OpenAI (config 10)');
      assert.equal(extracted[0].json.brand_name, 'Celonis');
      assert.equal(extracted[0].json.provider, 'gemini');
      assert.equal(extracted[0].json.citations[0].is_competitor_domain, true);
    });

    it('Metric & MECE Calculator does not silently default missing config_id/user_id to 101/5', () => {
      const metricNode = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator');
      const ingestNode = workflow.nodes.find(n => n.name === 'Dispatch Ingest API');
      const out = executeNodeJsCode(metricNode.parameters.jsCode, [
        {
          json: {
            run_id: 'run_chat_test_1',
            prompt: 'Test Prompt',
            brand_name: 'Personio',
            brand_domains: ['personio.de'],
            competitors: [],
            citations: [],
            raw_response_text: 'Personio ist top.'
          }
        }
      ]);

      assert.equal(out[0].json.config_id, null);
      assert.equal(out[0].json.user_id, null);

      const evaluatedBody = JSON.parse(evaluateN8nExpression(ingestNode.parameters.jsonBody, { json: out[0].json }));
      assert.equal(evaluatedBody.config_id, null);
      assert.equal(evaluatedBody.user_id, null);
    });
  });

  // =========================================================================
  // Suite 10: OpenRouter Gateway, 36-Language Set Node, Batch Lifecycle & Admin Regression Guards
  // =========================================================================
  describe('Suite 10: 36-Language Set Node, OpenRouter Batches & Admin Regression Guards', () => {
    it('Market & Region Language Templates Set node contains all 36 languages (24 EU + 12 global)', () => {
      const setNode = workflow.nodes.find(n => n.name === 'Market & Region Language Templates');
      assert.ok(setNode, 'Market & Region Language Templates Set node must exist');
      assert.equal(setNode.type, 'n8n-nodes-base.set');
      const assignments = setNode.parameters?.assignments?.assignments || [];
      assert.equal(assignments.length, 36, 'Must contain exactly 36 language template assignments');

      const expectedLangs = [
        'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu',
        'ga', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv',
        'zh', 'hi', 'ar', 'bn', 'ru', 'ja', 'ko', 'tr', 'vi', 'id', 'th', 'uk'
      ];
      const byName = new Map(assignments.map(a => [a.name, a]));
      for (const lang of expectedLangs) {
        const entry = byName.get('tpl_' + lang);
        assert.ok(entry, 'Missing Set assignment tpl_' + lang);
        assert.ok(String(entry.value).includes('{region}'), 'tpl_' + lang + ' must include {region} placeholder');
      }
    });

    it('Apply Localized Market Extension appends localized sentence into llm_prompt without mutating raw prompt', () => {
      const setNode = workflow.nodes.find(n => n.name === 'Market & Region Language Templates');
      const extNode = workflow.nodes.find(n => n.name === 'Apply Localized Market Extension');
      assert.ok(extNode, 'Apply Localized Market Extension Code node must exist');

      const tplObj = {};
      for (const a of (setNode.parameters?.assignments?.assignments || [])) {
        tplObj[a.name] = a.value;
      }

      // 1. market_region = 'FR' on German prompt -> appends French extension
      const withRegion = executeNodeJsCode(extNode.parameters.jsCode, [{
        json: { ...tplObj, prompt: 'Welche HR Software empfiehlst du?', market_region: 'FR', provider: 'openai', model: 'gpt-6-luna' }
      }])[0].json;
      assert.equal(withRegion.prompt, 'Welche HR Software empfiehlst du?');
      assert.ok(withRegion.llm_prompt.startsWith('Welche HR Software empfiehlst du?\n'));
      assert.ok(withRegion.llm_prompt.includes('Adapte ta réponse'));
      assert.ok(withRegion.llm_prompt.includes('FR'));
      assert.equal(withRegion.prompt_language, 'de');
      assert.equal(withRegion.effective_region, 'FR');
      assert.equal(withRegion.region_source, 'user_setting');
      assert.equal(withRegion.extension_language, 'fr');

      // 2. market_region = null on Japanese prompt -> raw prompt untouched, region inferred JP
      const autoJapan = executeNodeJsCode(extNode.parameters.jsCode, [{
        json: { ...tplObj, prompt: '中小企業向けの最適な人事ソフトウェアは何ですか？', market_region: null }
      }])[0].json;
      assert.equal(autoJapan.llm_prompt, autoJapan.prompt);
      assert.equal(autoJapan.prompt_language, 'ja');
      assert.equal(autoJapan.effective_region, 'JP');
      assert.equal(autoJapan.region_source, 'prompt_language');
      assert.equal(autoJapan.extension_language, null);
    });

    it('OpenRouter Batch nodes prepare, deduplicate, and correlate completed & failed batches', () => {
      const prepNode = workflow.nodes.find(n => n.name === 'Prepare OpenRouter Batches');
      const dedupeNode = workflow.nodes.find(n => n.name === 'Deduplicate OpenRouter Batches');
      const corrNode = workflow.nodes.find(n => n.name === 'Correlate OpenRouter Batch Results');

      const prepared = executeNodeJsCode(prepNode.parameters.jsCode, [
        { json: { model_key: 'openai/gpt-6-luna', custom_id: 'cid_1', prompt: 'Q1', llm_prompt: 'Q1\nTailor: US', execution_strategy: 'batch_api' } },
        { json: { model_key: 'openai/gpt-6-luna', custom_id: 'cid_2', prompt: 'Q2', llm_prompt: 'Q2\nTailor: US', execution_strategy: 'batch_api' } },
        { json: { model_key: 'anthropic/claude-sonnet-5.5', custom_id: 'cid_3', prompt: 'Q3', llm_prompt: 'Q3', execution_strategy: 'batch_api' } }
      ]);
      assert.equal(prepared.length, 2, 'Requests must group by OpenRouter model slug');
      assert.equal(prepared[0].json.request_body.endpoint, '/v1/chat/completions');
      assert.equal(prepared[0].json.request_body.model, 'openai/gpt-6-luna');
      const oaiReq = prepared[0].json.request_body.requests;
      assert.equal(oaiReq.length, 2);
      assert.equal(oaiReq[0].custom_id, 'cid_1');
      assert.deepEqual(oaiReq[0].body.messages, [{ role: 'user', content: 'Q1\nTailor: US' }]);

      const deduped = executeNodeJsCode(dedupeNode.parameters.jsCode, [{
        json: {
          open_batches: [
            { provider_batch_id: 'batch_1', custom_id: 'cid_1', api_base_url: 'https://chatlytics.de' },
            { provider_batch_id: 'batch_1', custom_id: 'cid_2', api_base_url: 'https://chatlytics.de' },
            { provider_batch_id: null, custom_id: 'cid_no_id' }
          ]
        }
      }]);
      assert.equal(deduped.length, 1);
      assert.equal(deduped[0].json.pending_items.length, 2);

      const correlated = executeNodeJsCode(corrNode.parameters.jsCode, [{
        json: {
          id: 'batch_1',
          status: 'completed',
          results: [
            { custom_id: 'cid_1', response: { status_code: 200, body: { choices: [{ message: { content: 'Personio leads.' } }] } } }
          ]
        }
      }], null, {
        'Deduplicate OpenRouter Batches': {
          itemMatching: () => ({ json: deduped[0].json }),
          all: () => deduped
        }
      });
      assert.equal(correlated.length, 1);
      assert.equal(correlated[0].json._batch_route, 'completed');
      assert.equal(correlated[0].json.custom_id, 'cid_1');
      assert.equal(correlated[0].json.execution_strategy, 'batch_api');
      assert.equal(correlated[0].json.prompt_cache_key, null);

      const failedCorr = executeNodeJsCode(corrNode.parameters.jsCode, [{
        json: { id: 'batch_1', status: 'expired', error: { message: '24h batch window expired' } }
      }], null, {
        'Deduplicate OpenRouter Batches': {
          itemMatching: () => ({ json: deduped[0].json }),
          all: () => deduped
        }
      });
      assert.equal(failedCorr.length, 1);
      assert.equal(failedCorr[0].json._batch_route, 'failed');
      assert.deepEqual(failedCorr[0].json.custom_ids, ['cid_1', 'cid_2']);
    });

    it('Filter & Normalize OpenRouter Models collapses :batch suffix, includes meta, and returns full providers list + dynamic overrides', () => {
      const filterNode = workflow.nodes.find(n => n.name === 'Filter & Normalize OpenRouter Models');
      const samplePayload = {
        data: [
          { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
          { id: 'openai/gpt-6-luna:batch', name: 'GPT-6 Luna (Batch)', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
          { id: 'meta/muse-wonder', name: 'Meta Muse Wonder', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
          { id: 'openai/gpt-image-1', name: 'Image Model', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
          { id: 'cohere/command-a', name: 'Cohere Model', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }
        ]
      };
      const res = executeNodeJsCode(filterNode.parameters.jsCode, [{ json: samplePayload }]);
      assert.equal(res[0].json.status, 'ok');
      assert.equal(res[0].json.models.length, 2);
      const openaiM = res[0].json.models.find(m => m.id === 'openai/gpt-6-luna');
      const metaM = res[0].json.models.find(m => m.id === 'meta/muse-wonder');
      assert.ok(openaiM);
      assert.ok(metaM);
      assert.equal(openaiM.supports_batch_api, true);
      assert.equal(openaiM.supports_tools, true);
      assert.equal(openaiM.is_allowed, false);
      assert.equal(res[0].json.providers.some(p => p.provider_key === 'cohere' && p.is_relevant === false), true);
      assert.equal(res[0].json.providers.some(p => p.provider_key === 'meta' && p.is_relevant === true), true);

      // Dynamic allowed_providers override via request body
      const customRes = executeNodeJsCode(filterNode.parameters.jsCode, [{
        json: { ...samplePayload, body: { allowed_providers: ['cohere'] } }
      }]);
      assert.equal(customRes[0].json.models.length, 1);
      assert.equal(customRes[0].json.models[0].id, 'cohere/command-a');
      assert.equal(customRes[0].json.providers.find(p => p.provider_key === 'cohere').is_relevant, true);
      assert.equal(customRes[0].json.providers.find(p => p.provider_key === 'openai').is_relevant, false);
    });

    it('Regression guard: assets/js/admin.js has zero bare setButtonLoading(...) calls so live sync never throws ReferenceError', () => {
      const adminJs = fs.readFileSync(path.resolve(__dirname, '../../assets/js/admin.js'), 'utf8');
      const bareCalls = adminJs.match(/(?<![A-Za-z0-9_.])setButtonLoading\s*\(/g) || [];
      assert.equal(bareCalls.length, 0, 'assets/js/admin.js must only invoke setAdminButtonLoading or ChatlyticsNotify?.setButtonLoading');
    });
  });
});
