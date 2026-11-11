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
        'n8n-nodes-base.switch',
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
  function executeNodeJsCode(jsCode, inputItems, customEnv = {}) {
    const sandbox = {
      $input: {
        all: () => inputItems,
        first: () => inputItems[0] || { json: {} },
        item: inputItems[0] || { json: {} }
      },
      $env: {
        CHATLYTICS_API_BASE_URL: 'http://localhost:8000',
        CHATLYTICS_INGEST_KEY: 'test_ingest_key',
        CHATLYTICS_QUEUE_SECRET: 'test_queue_secret',
        ...customEnv
      },
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

      const item2 = result[1].json;
      assert.equal(item2.provider, 'gemini');
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
      assert.equal(result[0].json.provider, 'gemini');
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
        ingestNode.parameters.url?.includes('ingest.php') ||
        ingestNode.parameters.url?.includes('CHATLYTICS_API_BASE_URL'),
        'Ingest node must post to ingest.php'
      );
    });
  });

  // =========================================================================
  // Helper: Sandboxed n8n Parameter Expression Evaluator
  // =========================================================================
  function evaluateN8nExpression(expr, context = {}) {
    if (typeof expr !== 'string') return expr;

    const sandbox = {
      $json: context.$json || context.json || {},
      $env: {
        CHATLYTICS_API_BASE_URL: 'http://localhost:8000',
        CHATLYTICS_INGEST_KEY: 'test_ingest_key_2026_valid',
        CHATLYTICS_QUEUE_SECRET: 'test_queue_secret_valid',
        OPENAI_API_KEY: 'test_openai_key',
        ANTHROPIC_API_KEY: 'test_anthropic_key',
        GEMINI_API_KEY: 'test_gemini_key',
        ...(context.$env || {})
      },
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

    it('should evaluate Dispatch Ingest API headers and URL without stray "=" prefixes', () => {
      const ingestNode = workflow.nodes.find(n => n.name === 'Dispatch Ingest API');
      const evalUrl = evaluateN8nExpression(ingestNode.parameters.url, { json: upstreamMetricItem });

      assert.ok(!evalUrl.startsWith('='), 'URL must not start with stray "="');
      assert.ok(evalUrl.includes('/api/ingest.php'), 'URL must target ingest.php');

      const headers = ingestNode.parameters.headerParameters?.parameters || [];
      const authHeader = headers.find(h => h.name === 'X-Chatlytics-Ingest-Key');
      assert.ok(authHeader, 'X-Chatlytics-Ingest-Key header must exist');

      const evalKey = evaluateN8nExpression(authHeader.value, { json: upstreamMetricItem });
      assert.ok(!evalKey.startsWith('='), 'Ingest key must not start with stray "="');
      assert.ok(evalKey.length >= 16, 'Ingest key must be at least 16 characters long');
    });

    it('should evaluate Call OpenAI parameters and jsonBody with clean Bearer auth and messages array', () => {
      const openAiNode = workflow.nodes.find(n => n.name === 'Call OpenAI');
      assert.ok(openAiNode, 'Call OpenAI node must exist');

      const authParam = openAiNode.parameters.headerParameters?.parameters?.find(p => p.name === 'Authorization');
      assert.ok(authParam, 'Authorization header must exist');
      const authVal = evaluateN8nExpression(authParam.value, { json: { prompt: 'Test' } });
      assert.ok(!authVal.includes('Bearer ='), 'Authorization header must not contain "Bearer =" stray prefix');
      assert.ok(authVal.startsWith('Bearer '), 'Authorization header must begin with "Bearer "');

      const evalBody = evaluateN8nExpression(openAiNode.parameters.jsonBody, { json: { prompt: 'Beste Software', model: 'gpt-4o' } });
      assert.ok(!evalBody.startsWith('='));
      assert.ok(!evalBody.includes('[object Object]'));

      const parsed = JSON.parse(evalBody);
      assert.equal(parsed.model, 'gpt-4o');
      assert.ok(Array.isArray(parsed.messages), 'messages must serialize as genuine array');
      assert.equal(parsed.messages.length, 2);
      assert.equal(parsed.messages[0].role, 'system');
      assert.equal(parsed.messages[1].role, 'user');
      assert.equal(parsed.messages[1].content, 'Beste Software');
    });

    it('should evaluate Call Anthropic Claude and Call Google Gemini parameters cleanly', () => {
      const claudeNode = workflow.nodes.find(n => n.name === 'Call Anthropic Claude');
      assert.ok(claudeNode, 'Call Anthropic Claude node must exist');
      const claudeBody = evaluateN8nExpression(claudeNode.parameters.jsonBody, { json: { prompt: 'Claude Prompt' } });
      const parsedClaude = JSON.parse(claudeBody);
      assert.ok(Array.isArray(parsedClaude.messages));
      assert.equal(parsedClaude.messages[0].content, 'Claude Prompt');
      assert.ok(!claudeBody.includes('[object Object]'));

      const geminiNode = workflow.nodes.find(n => n.name === 'Call Google Gemini');
      assert.ok(geminiNode, 'Call Google Gemini node must exist');

      const rawUrl = geminiNode.parameters.url;
      assert.ok(!rawUrl.startsWith('='), 'Gemini URL parameter must not have leading stray "="');
      const evalGeminiUrl = evaluateN8nExpression(rawUrl, { json: { model: 'gemini-1.5-flash' } });
      assert.ok(!evalGeminiUrl.startsWith('='));
      assert.ok(evalGeminiUrl.includes('generativelanguage.googleapis.com'));

      const evalGeminiSearchTrue = evaluateN8nExpression(geminiNode.parameters.jsonBody, { json: { prompt: 'Gemini Prompt', search_enabled: true } });
      const parsedTrue = JSON.parse(evalGeminiSearchTrue);
      assert.ok(Array.isArray(parsedTrue.tools));
      assert.equal(parsedTrue.tools.length, 1);
      assert.deepEqual(parsedTrue.tools[0], { googleSearch: {} });
      assert.ok(!evalGeminiSearchTrue.includes('[object Object]'));

      const evalGeminiSearchFalse = evaluateN8nExpression(geminiNode.parameters.jsonBody, { json: { prompt: 'Gemini Prompt', search_enabled: false } });
      const parsedFalse = JSON.parse(evalGeminiSearchFalse);
      assert.ok(Array.isArray(parsedFalse.tools));
      assert.equal(parsedFalse.tools.length, 0);
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

    it('should verify Poll Backend Queue and Respond Webhook Sync resilience configurations', () => {
      const queueNode = workflow.nodes.find(n => n.name === 'Poll Backend Queue');
      assert.ok(queueNode, 'Poll Backend Queue node must exist');
      const queueUrl = evaluateN8nExpression(queueNode.parameters.url, {});
      assert.ok(!queueUrl.startsWith('='));
      assert.ok(queueUrl.includes('/api/n8n_queue.php?action=poll'));

      const respondSync = workflow.nodes.find(n => n.name === 'Respond Webhook Sync');
      assert.ok(respondSync, 'Respond Webhook Sync must exist');
      assert.equal(respondSync.continueOnFail, true, 'Respond Webhook Sync must have continueOnFail: true');
      assert.equal(respondSync.onError, 'continueRegularOutput', 'Respond Webhook Sync must configure onError: continueRegularOutput');
    });
  });
});
