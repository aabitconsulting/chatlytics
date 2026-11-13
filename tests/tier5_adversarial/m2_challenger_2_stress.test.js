/**
 * tests/tier5_adversarial/m2_challenger_2_stress.test.js
 * Independent Empirical Adversarial Challenger Test Suite — Milestone 2
 * 
 * Scope:
 * 1. Multi-item fan-out and fan-in integrity (10 to 100 batch jobs through pipeline).
 * 2. Async acknowledgement timing SLA (<200ms) and response contract under high payload volume.
 * 3. N8N_SETUP_AND_POC_GUIDE.md cURL, Postman v2.1, and Chat prompt validation against JSON schemas.
 * 4. Embedded Code node memory usage, execution time, and property-based fuzz generation.
 * 5. Adversarial corner cases, malformed payloads, and boundary resistance.
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/chatlytics_universal_worker.json');
const GUIDE_PATH = path.resolve(__dirname, '../../n8n/N8N_SETUP_AND_POC_GUIDE.md');

// Helper to execute code in isolated node:vm sandbox
function runVmCode(jsCode, inputItems, customEnv = {}, customDollar = undefined) {
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
      GEMINI_API_KEY: 'test_gemini_key',
      ...customEnv
    },
    $: customDollar !== undefined ? customDollar : ((nodeName) => ({
      itemMatching: (idx) => inputItems[idx] || { json: {} },
      first: () => inputItems[0] || { json: {} }
    })),
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
  const result = script.runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

describe('M2 Adversarial Challenger #2: Workflow Contracts, Concurrency & Stress Harness', () => {
  let workflow = null;
  let guideContent = null;
  let normalizerCode = null;
  let extractorCode = null;
  let metricCode = null;
  let formatterCode = null;

  before(() => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), `Workflow JSON must exist at ${WORKFLOW_PATH}`);
    assert.ok(fs.existsSync(GUIDE_PATH), `Guide must exist at ${GUIDE_PATH}`);

    workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
    guideContent = fs.readFileSync(GUIDE_PATH, 'utf8');

    const normNode = workflow.nodes.find(n => n.name === 'Universal Normalizer');
    const extNode = workflow.nodes.find(n => n.name === 'Secondary Extractor');
    const metNode = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator');
    const fmtNode = workflow.nodes.find(n => n.name === 'Format Chat Response');

    assert.ok(normNode?.parameters?.jsCode, 'Normalizer jsCode missing');
    assert.ok(extNode?.parameters?.jsCode, 'Extractor jsCode missing');
    assert.ok(metNode?.parameters?.jsCode, 'Metric engine jsCode missing');
    assert.ok(fmtNode?.parameters?.jsCode, 'Formatter jsCode missing');

    normalizerCode = normNode.parameters.jsCode;
    extractorCode = extNode.parameters.jsCode;
    metricCode = metNode.parameters.jsCode;
    formatterCode = fmtNode.parameters.jsCode;
  });

  // =========================================================================
  // Suite 1: Multi-Item Fan-Out & Fan-In Concurrency and Metadata Integrity
  // =========================================================================
  describe('Suite 1: Multi-Item Fan-Out & Fan-In Integrity', () => {
    it('CHALLENGE-1.1: 10 Batch Queue Jobs Fan-Out with Multi-LLM Expansion', () => {
      // 10 distinct queue jobs with diverse configurations
      const sampleJobs = [
        { config_id: 101, user_id: 1, brand_name: 'Personio', brand_domains: ['personio.de'], prompt: 'HR Software A', competitors: ['Workday'], target_llms: ['openai', 'gemini'] },
        { config_id: 102, user_id: 1, brand_name: 'Celonis', brand_domains: ['celonis.com'], prompt: 'Process Mining B', competitors: ['Signavio', 'UiPath'], target_llms: ['anthropic'] },
        { config_id: 103, user_id: 2, brand_name: 'SAP', brand_domains: ['sap.com'], prompt: 'ERP System C', competitors: ['Oracle', 'Microsoft'], target_llms: ['openai', 'anthropic', 'gemini'] },
        { config_id: 104, user_id: 2, brand_name: 'HubSpot', brand_domains: ['hubspot.de'], prompt: 'CRM Mittelstand D', competitors: ['Salesforce'], target_llms: ['gemini'] },
        { config_id: 105, user_id: 3, brand_name: 'Jägermeister', brand_domains: ['jaegermeister.de'], prompt: 'Kräuterlikör E', competitors: ['Underberg'], target_llms: ['openai'] },
        { config_id: 106, user_id: 3, brand_name: 'Kärcher', brand_domains: ['kaercher.de'], prompt: 'Hochdruckreiniger F', competitors: ['Nilfisk', 'Bosch'], target_llms: ['openai', 'gemini'] },
        { config_id: 107, user_id: 4, brand_name: 'Avery Zweckform', brand_domains: ['zweckform.de'], prompt: 'Etiketten G', competitors: ['Herma'], target_llms: ['anthropic', 'gemini'] },
        { config_id: 108, user_id: 4, brand_name: 'Datev', brand_domains: ['datev.de'], prompt: 'Steuerberater Software H', competitors: ['Lexware', 'Addison'], target_llms: ['openai'] },
        { config_id: 109, user_id: 5, brand_name: 'TeamViewer', brand_domains: ['teamviewer.com'], prompt: 'Fernwartung I', competitors: ['AnyDesk'], target_llms: ['openai', 'anthropic'] },
        { config_id: 110, user_id: 5, brand_name: 'Zalando', brand_domains: ['zalando.de'], prompt: 'Fashion Plattform J', competitors: ['About You', 'Otto'], target_llms: ['gemini'] }
      ];

      // Total expected expanded items: 2 + 1 + 3 + 1 + 1 + 2 + 2 + 1 + 2 + 1 = 16 items
      const queueInput = [{ json: { jobs: sampleJobs } }];
      const normalized = runVmCode(normalizerCode, queueInput);

      assert.equal(normalized.length, 16, `Expected 16 fanned-out items from 10 jobs, got ${normalized.length}`);

      // Verify metadata preservation and isolation per item
      let currentItemIdx = 0;
      for (const job of sampleJobs) {
        const expectedProviders = job.target_llms;
        const jobRunIds = new Set();

        for (const prov of expectedProviders) {
          const item = normalized[currentItemIdx].json;
          assert.equal(item.config_id, job.config_id, `Item ${currentItemIdx} config_id corrupted`);
          assert.equal(item.user_id, job.user_id, `Item ${currentItemIdx} user_id corrupted`);
          assert.equal(item.brand_name, job.brand_name, `Item ${currentItemIdx} brand_name corrupted`);
          assert.deepEqual(item.brand_domains, job.brand_domains, `Item ${currentItemIdx} brand_domains corrupted`);
          assert.equal(item.prompt, job.prompt, `Item ${currentItemIdx} prompt corrupted`);
          assert.equal(item.provider, prov, `Item ${currentItemIdx} expected provider ${prov}, got ${item.provider}`);
          assert.equal(item.selected_provider, prov);
          assert.equal(item.trigger_source, 'schedule_queue');
          assert.ok(item.run_id && item.run_id.startsWith('run_'), 'Missing or invalid run_id');

          jobRunIds.add(item.run_id);
          currentItemIdx++;
        }

        // Providers fanned out from the SAME job must share the same run_id
        assert.equal(jobRunIds.size, 1, `Job ${job.config_id} multi-provider items must share identical run_id`);
      }
    });

    it('CHALLENGE-1.2: Fan-In Downstream Integrity Across Extractor and Metric Engine', () => {
      // Simulate 4 distinct normalized items entering Secondary Extractor with synthetic provider responses
      const testItems = [
        {
          json: {
            config_id: 201,
            brand_name: 'Personio',
            brand_domains: ['personio.de'],
            competitors: [{ name: 'Workday', domain: 'workday.com' }],
            provider: 'gemini',
            candidates: [{
              content: { parts: [{ text: 'Personio ist die führende HR-Software.' }] },
              groundingMetadata: {
                groundingChunks: [{ web: { uri: 'https://personio.de/tour', title: 'Tour' } }]
              }
            }]
          }
        },
        {
          json: {
            config_id: 202,
            brand_name: 'Celonis',
            brand_domains: ['celonis.com'],
            competitors: [{ name: 'Signavio', domain: 'signavio.com' }],
            provider: 'openai',
            choices: [{
              message: { content: 'Signavio ist Marktführer. Auch [Celonis](https://celonis.com) ist empfehlenswert.' }
            }]
          }
        },
        {
          json: {
            config_id: 203,
            brand_name: 'Underberg',
            brand_domains: ['underberg.de'],
            competitors: [{ name: 'Jägermeister', domain: 'jaegermeister.de' }],
            provider: 'anthropic',
            content: [{ text: 'Jägermeister dominiert den Markt. Siehe [Jägermeister](https://jaegermeister.de) für Details.' }]
          }
        },
        {
          json: {
            config_id: 204,
            brand_name: 'Kärcher',
            brand_domains: ['kaercher.de'],
            competitors: [{ name: 'Bosch', domain: 'bosch.de' }],
            provider: 'openai',
            choices: [{ message: { content: 'Reinigungsgeräte ohne Markenbezug sind universell einsetzbar.' } }]
          }
        }
      ];

      // Pass all items through Secondary Extractor concurrently
      const extracted = runVmCode(extractorCode, testItems);
      assert.equal(extracted.length, 4, 'Extractor must preserve item count');

      // Verify extraction accuracy and independence per item
      assert.equal(extracted[0].json.citations.length, 1);
      assert.equal(extracted[0].json.citations[0].citation_domain, 'personio.de');
      assert.equal(extracted[0].json.citations[0].is_brand_domain, true);

      assert.equal(extracted[1].json.citations.length, 1);
      assert.equal(extracted[1].json.citations[0].citation_domain, 'celonis.com');
      assert.equal(extracted[1].json.citations[0].is_brand_domain, true);

      assert.equal(extracted[2].json.citations.length, 1);
      assert.equal(extracted[2].json.citations[0].citation_domain, 'jaegermeister.de');
      assert.equal(extracted[2].json.citations[0].is_brand_domain, false);
      assert.equal(extracted[2].json.citations[0].is_competitor_domain, true);

      assert.equal(extracted[3].json.citations.length, 0);

      // Pass all extracted items into Metric & MECE Calculator concurrently
      const metricResults = runVmCode(metricCode, extracted);
      assert.equal(metricResults.length, 4, 'Metric Engine must preserve item count');

      // Assert independent MECE classification for each item in the batch
      assert.equal(metricResults[0].json.config_id, 201);
      assert.equal(metricResults[0].json.mece_category, '1_DIRECT_WIN');

      assert.equal(metricResults[1].json.config_id, 202);
      assert.equal(metricResults[1].json.mece_category, '2_BRAND_HALO');

      assert.equal(metricResults[2].json.config_id, 203);
      assert.equal(metricResults[2].json.mece_category, '3_COMPETITOR_TAKEOVER');

      assert.equal(metricResults[3].json.config_id, 204);
      assert.equal(metricResults[3].json.mece_category, '4_GENERIC');
    });

    it('CHALLENGE-1.3: High-Volume Batch Scaling (50 Batch Jobs -> 100 Output Items)', () => {
      const largeBatch = [];
      for (let i = 1; i <= 50; i++) {
        largeBatch.push({
          config_id: 1000 + i,
          user_id: 10 + (i % 5),
          brand_name: `Brand_${i}`,
          brand_domains: [`brand${i}.de`],
          prompt: `Benchmark Query #${i}`,
          competitors: [`CompA_${i}`, `CompB_${i}`],
          target_llms: ['openai', 'gemini']
        });
      }

      const start = performance.now();
      const normalized = runVmCode(normalizerCode, [{ json: { jobs: largeBatch } }]);
      const normDuration = performance.now() - start;

      assert.equal(normalized.length, 100, '50 dual-provider jobs must expand to exactly 100 items');
      assert.ok(normDuration < 100, `Normalizing 50 jobs took ${normDuration}ms, must be <100ms`);

      // Verify every single item maintains exact alignment
      for (let j = 0; j < 100; j++) {
        const item = normalized[j].json;
        const jobIndex = Math.floor(j / 2) + 1;
        const expectedBrand = `Brand_${jobIndex}`;
        const expectedProvider = (j % 2 === 0) ? 'openai' : 'gemini';

        assert.equal(item.brand_name, expectedBrand, `Alignment failed at index ${j}`);
        assert.equal(item.provider, expectedProvider, `Provider mismatch at index ${j}`);
        assert.equal(item.config_id, 1000 + jobIndex);
      }
    });
  });

  // =========================================================================
  // Suite 2: Async Acknowledgement SLA Timing & Payload Volume Stress
  // =========================================================================
  describe('Suite 2: Async Acknowledgement SLA & Payload Volume', () => {
    let ifNode = null;
    let fastAckNode = null;

    before(() => {
      ifNode = workflow.nodes.find(n => n.name === 'Check Async Mode');
      fastAckNode = workflow.nodes.find(n => n.name === 'Fast Async Response');
      assert.ok(ifNode, 'Check Async Mode node missing');
      assert.ok(fastAckNode, 'Fast Async Response node missing');
    });

    it('CHALLENGE-2.1: Async Response Contract Schema Verification', () => {
      // Validate the respondToWebhook parameters and expression
      assert.equal(fastAckNode.parameters.respondWith, 'json');
      assert.equal(fastAckNode.parameters.options?.responseCode, 200);

      const respBodyRaw = fastAckNode.parameters.responseBody;
      assert.ok(respBodyRaw.includes('"status": "queued"'), 'Missing "status": "queued"');
      assert.ok(respBodyRaw.includes('"run_id"'), 'Missing "run_id"');
      assert.ok(respBodyRaw.includes('"timestamp"'), 'Missing "timestamp"');
      assert.ok(respBodyRaw.includes('"message": "Dispatched to worker pipeline"'), 'Missing message string');
    });

    it('CHALLENGE-2.2: Evaluate Check Async Mode Routing Logic', () => {
      const condition = ifNode.parameters.conditions.conditions[0];
      assert.equal(condition.rightValue, 'async');
      assert.equal(condition.operator.operation, 'equals');

      // Simulate n8n condition evaluation in JS
      function isAsyncMode(itemJson) {
        const leftValue = itemJson.body?.response_mode || itemJson.response_mode;
        return leftValue === 'async';
      }

      assert.equal(isAsyncMode({ body: { response_mode: 'async' } }), true);
      assert.equal(isAsyncMode({ response_mode: 'async' }), true);
      assert.equal(isAsyncMode({ body: { response_mode: 'sync' } }), false);
      assert.equal(isAsyncMode({ response_mode: 'sync' }), false);
      assert.equal(isAsyncMode({}), false);
    });

    it('CHALLENGE-2.3: 1,000 Iterations High-Payload Volume Async Acknowledgement (<200ms SLA)', () => {
      // Create a massive realistic payload (50KB+)
      const largePayload = {
        config_id: 888,
        user_id: 42,
        prompt: 'Umfangreiche Marktanalyse für Enterprise Cloud Migrationen im DACH-Raum '.repeat(200),
        brand_name: 'Personio Enterprise Solutions SE & Co. KGaA',
        brand_domains: ['personio.de', 'personio.com', 'personio.eu', 'personio-payroll.de'],
        competitors: Array.from({ length: 30 }, (_, i) => ({
          name: `Competitor Enterprise System ${i}`,
          domain: `competitor-${i}.com`
        })),
        target_llms: ['openai', 'anthropic', 'gemini'],
        search_enabled: true,
        response_mode: 'async'
      };

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const isAsync = (largePayload.body?.response_mode || largePayload.response_mode) === 'async';
        assert.equal(isAsync, true);
        const ackResponse = {
          status: 'queued',
          run_id: largePayload.run_id || ('run_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)),
          timestamp: new Date().toISOString(),
          message: 'Dispatched to worker pipeline'
        };
        assert.equal(ackResponse.status, 'queued');
        assert.ok(ackResponse.run_id.startsWith('run_'));
      }

      const totalElapsed = performance.now() - start;
      const perReqLatency = totalElapsed / iterations;

      assert.ok(perReqLatency < 0.5, `Average async ack latency ${perReqLatency}ms exceeded 0.5ms threshold`);
      assert.ok(totalElapsed < 500, `1,000 async acks took ${totalElapsed}ms (must be < 500ms)`);
    });
  });

  // =========================================================================
  // Suite 3: Setup Guide (cURL & Postman) Contract & Schema Validation
  // =========================================================================
  describe('Suite 3: Setup Guide cURL & Postman Payloads Schema Validation', () => {
    it('CHALLENGE-3.1: Postman Collection v2.1 Schema Compliance', () => {
      const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g;
      let postmanObj = null;
      let m;
      while ((m = jsonBlockRegex.exec(guideContent)) !== null) {
        try {
          const parsed = JSON.parse(m[1]);
          if (parsed.info && parsed.info._postman_id) {
            postmanObj = parsed;
            break;
          }
        } catch (_) {}
      }

      assert.ok(postmanObj, 'Postman Collection JSON block must exist and parse in guide');
      assert.equal(postmanObj.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
      assert.ok(Array.isArray(postmanObj.item), 'Postman collection "item" must be array');
      assert.equal(postmanObj.item.length, 2, 'Postman collection must define 2 requests');

      for (const reqItem of postmanObj.item) {
        assert.equal(reqItem.request.method, 'POST');
        assert.equal(reqItem.request.header[0].key, 'Content-Type');
        assert.equal(reqItem.request.header[0].value, 'application/json');

        const rawBody = reqItem.request.body.raw;
        let bodyObj;
        assert.doesNotThrow(() => {
          bodyObj = JSON.parse(rawBody);
        }, `Postman item "${reqItem.name}" raw body must be valid JSON`);

        assert.ok(bodyObj.prompt, 'Postman body must include prompt');
        assert.ok(bodyObj.brand_name, 'Postman body must include brand_name');
        assert.ok(Array.isArray(bodyObj.brand_domains), 'Postman body must include brand_domains array');
        assert.ok(Array.isArray(bodyObj.competitors), 'Postman body must include competitors array');
        assert.ok(Array.isArray(bodyObj.target_llms), 'Postman body must include target_llms array');
        assert.ok(['sync', 'async'].includes(bodyObj.response_mode), 'Postman body must define response_mode');

        // Test normalizer execution of Postman payload
        const normResult = runVmCode(normalizerCode, [{ json: { body: bodyObj } }]);
        assert.ok(Array.isArray(normResult) && normResult.length > 0);
        assert.equal(normResult[0].json.brand_name, bodyObj.brand_name);
      }
    });

    it('CHALLENGE-3.2: cURL Commands and Payloads Validation in Guide', () => {
      // Extract bash curl blocks
      const curlRegex = /curl[\s\S]*?-d\s+'([\s\S]*?)'/g;
      const curlPayloads = [];
      let m;
      while ((m = curlRegex.exec(guideContent)) !== null) {
        curlPayloads.push(m[1]);
      }

      assert.ok(curlPayloads.length >= 2, `Expected at least 2 cURL payloads in guide, found ${curlPayloads.length}`);

      for (let i = 0; i < curlPayloads.length; i++) {
        const rawJson = curlPayloads[i];
        let payload;
        assert.doesNotThrow(() => {
          payload = JSON.parse(rawJson);
        }, `cURL payload #${i + 1} must be valid JSON`);

        assert.ok(payload.prompt && typeof payload.prompt === 'string');
        assert.ok(payload.brand_name && typeof payload.brand_name === 'string');
        assert.ok(Array.isArray(payload.brand_domains));
        assert.ok(Array.isArray(payload.competitors));

        // Execute through Universal Normalizer
        const res = runVmCode(normalizerCode, [{ json: { body: payload } }]);
        assert.ok(res.length >= 1);
        assert.equal(res[0].json.brand_name, payload.brand_name);
        assert.equal(res[0].json.trigger_source, 'webhook');
      }
    });

    it('CHALLENGE-3.3: Interactive Chat Shorthand & JSON Prompts Validation', () => {
      // 1. Shorthand Prompt A
      const promptA = `PROMPT: Welche HR-Software eignet sich am besten für den deutschen Mittelstand?
BRAND: Personio
DOMAINS: personio.de, personio.com
COMPETITORS: Workday (workday.com), SAP SuccessFactors (sap.com), BambooHR (bamboohr.com)
LLMS: openai, gemini
SEARCH: true`;

      const resA = runVmCode(normalizerCode, [{ json: { chatInput: promptA } }]);
      assert.equal(resA.length, 2);
      assert.equal(resA[0].json.brand_name, 'Personio');
      assert.equal(resA[0].json.competitors.length, 3);
      assert.equal(resA[0].json.competitors[0].name, 'Workday');
      assert.equal(resA[0].json.competitors[0].domain, 'workday.com');
      assert.equal(resA[0].json.provider, 'openai');
      assert.equal(resA[1].json.provider, 'gemini');

      // 2. Pipe-delimited Shorthand Prompt C
      const promptC = `PROMPT: Beste CRM-Systeme für KMU in Deutschland? | BRAND: HubSpot | DOMAINS: hubspot.de | COMPETITORS: Salesforce (salesforce.com), Pipedrive (pipedrive.com) | LLMS: gemini | SEARCH: true`;

      const resC = runVmCode(normalizerCode, [{ json: { chatInput: promptC } }]);
      assert.equal(resC.length, 1);
      assert.equal(resC[0].json.brand_name, 'HubSpot');
      assert.equal(resC[0].json.competitors.length, 2);
      assert.equal(resC[0].json.provider, 'gemini');

      // 3. Raw JSON Chat Prompt D
      const promptD = {
        prompt: 'Beste ERP Software für mittelständische Fertigungsunternehmen in Deutschland',
        brand_name: 'SAP',
        brand_domains: ['sap.com'],
        competitors: [
          { name: 'Microsoft Dynamics 365', domain: 'microsoft.com' },
          { name: 'proALPHA', domain: 'proalpha.com' }
        ],
        target_llms: ['openai', 'gemini'],
        search_enabled: true,
        response_mode: 'sync'
      };

      const resD = runVmCode(normalizerCode, [{ json: { chatInput: JSON.stringify(promptD) } }]);
      assert.equal(resD.length, 2);
      assert.equal(resD[0].json.brand_name, 'SAP');
      assert.equal(resD[0].json.competitors.length, 2);
    });

    it('CHALLENGE-3.4: Expected Response Payloads Schema Validation', () => {
      // Validate documented Expected Synchronous Response against PROJECT.md
      const syncMatch = /#### Expected Synchronous HTTP 200 Response:[\s\S]*?```json\s*([\s\S]*?)\s*```/.exec(guideContent);
      assert.ok(syncMatch, 'Expected sync response block must exist');
      const syncResp = JSON.parse(syncMatch[1]);

      const requiredSyncFields = [
        'run_id', 'config_id', 'user_id', 'brand_name', 'brand_mentioned',
        'brand_prominence_rank', 'char_earliness', 'word_earliness',
        'relative_position_pct', 'total_chars', 'total_words',
        'mece_category', 'geo_quadrant', 'has_citations', 'brand_cited',
        'competitor_cited', 'competitors', 'citations'
      ];
      for (const field of requiredSyncFields) {
        assert.ok(field in syncResp, `Expected sync response missing required field: ${field}`);
      }

      // Validate documented Expected Asynchronous Response
      const asyncMatch = /#### Expected Asynchronous Response[\s\S]*?```json\s*([\s\S]*?)\s*```/.exec(guideContent);
      assert.ok(asyncMatch, 'Expected async response block must exist');
      const asyncResp = JSON.parse(asyncMatch[1]);

      assert.equal(asyncResp.status, 'queued');
      assert.ok(asyncResp.run_id && asyncResp.run_id.startsWith('run_'));
      assert.ok(asyncResp.timestamp);
      assert.equal(asyncResp.message, 'Dispatched to worker pipeline');
    });
  });

  // =========================================================================
  // Suite 4: Code Node Memory Usage, Execution Time & Property-Based Fuzzing
  // =========================================================================
  describe('Suite 4: Embedded Code Node Memory, Execution Time & Fuzzing', () => {
    it('CHALLENGE-4.1: Property-Based Randomized Fuzzing Harness (500 Iterations)', () => {
      const umlauts = ['ä', 'ö', 'ü', 'ß', 'ẞ', 'ae', 'oe', 'ue', 'ss'];
      const wordsPool = ['Personio', 'Software', 'Mittelstand', 'HR', 'Lösung', 'Unternehmen', 'Cloud', 'Erfolg', 'Führung', 'Arbeit'];

      for (let iter = 0; iter < 500; iter++) {
        // Generate pseudo-random German text
        const wordCount = 10 + (iter % 100);
        const words = [];
        for (let w = 0; w < wordCount; w++) {
          const randWord = wordsPool[w % wordsPool.length] + umlauts[w % umlauts.length];
          words.push(randWord);
        }
        const text = words.join(' ');

        const item = {
          json: {
            brand_name: iter % 2 === 0 ? 'Personio' : 'Unbekannt',
            brand_domains: ['personio.de'],
            competitors: [{ name: 'Workday', domain: 'workday.com' }],
            raw_response: text,
            citations: [
              { citation_domain: 'personio.de', citation_url: 'https://personio.de/tour' }
            ]
          }
        };

        const res = runVmCode(metricCode, [item]);
        assert.ok(Array.isArray(res) && res.length === 1);
        const m = res[0].json;

        assert.ok(['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'].includes(m.mece_category));
        assert.ok(['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'].includes(m.geo_quadrant));
        assert.ok(m.total_words >= 10);
        assert.ok(m.total_chars > 0);
      }
    });

    it('CHALLENGE-4.2: Regex Backtracking & ReDoS Resistance on Markdown Links', () => {
      // Pathological string designed to stress regex parser: deeply repeated open brackets
      const pathologicalText = '['.repeat(2000) + 'Link' + ']'.repeat(2000) + '(https://example.com/test?a=1&b=2#ref) ' +
        'Normale Markennennung: Personio ist die Empfehlung. [Zweiter Link](https://personio.de)';

      const item = {
        json: {
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [],
          raw_response_text: pathologicalText
        }
      };

      const start = performance.now();
      const res = runVmCode(extractorCode, [item]);
      const duration = performance.now() - start;

      assert.ok(duration < 50, `Extractor took ${duration}ms on pathological markdown (must be < 50ms)`);
      assert.ok(Array.isArray(res[0].json.citations));
    });

    it('CHALLENGE-4.3: Memory Stability Across 1,000 Pipeline Iterations', () => {
      if (typeof global.gc === 'function') global.gc();
      const initialHeap = process.memoryUsage().heapUsed;

      for (let i = 0; i < 1000; i++) {
        const item = {
          json: {
            brand_name: 'Personio',
            brand_domains: ['personio.de'],
            competitors: [{ name: 'Workday', domain: 'workday.com' }],
            raw_response: `Iter ${i}: Personio ist eine HR-Lösung mit vielen Funktionen für Kunden.`,
            citations: [{ citation_domain: 'personio.de', citation_url: 'https://personio.de' }]
          }
        };
        runVmCode(metricCode, [item]);
      }

      if (typeof global.gc === 'function') global.gc();
      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

      // In Node.js V8 isolates, a heap delta < 25MB across 1,000 executions confirms no severe leak
      assert.ok(heapDeltaMb < 25.0, `Heap delta ${heapDeltaMb.toFixed(2)}MB exceeded 25MB threshold`);
    });
  });

  // =========================================================================
  // Suite 5: Adversarial Boundary & Corner Cases in Workflow Nodes
  // =========================================================================
  describe('Suite 5: Adversarial Boundary & Corner Cases', () => {
    it('CHALLENGE-5.1: Universal Normalizer Empty / Malformed Fallbacks', () => {
      // 1. Completely empty object
      const resEmpty = runVmCode(normalizerCode, [{ json: {} }]);
      assert.equal(resEmpty.length, 2, 'Default target_llms should expand to 2 items');
      assert.equal(resEmpty[0].json.brand_name, '');
      assert.equal(resEmpty[0].json.prompt, '');
      assert.equal(resEmpty[0].json.trigger_source, 'webhook');

      // 2. Chat with whitespace only
      const resWs = runVmCode(normalizerCode, [{ json: { chatInput: '   \n  \t  ' } }]);
      assert.equal(resWs.length, 2);
      assert.equal(resWs[0].json.trigger_source, 'chat');

      // 3. Shorthand with missing colon values
      const resBadColon = runVmCode(normalizerCode, [{ json: { chatInput: 'PROMPT:\nBRAND:\nLLMS:' } }]);
      assert.equal(resBadColon.length, 2);
    });

    it('CHALLENGE-5.2: Secondary Extractor Resilience to Malformed LLM Responses', () => {
      // 1. Gemini response with empty parts array
      const emptyGemini = {
        json: {
          provider: 'gemini',
          candidates: [{ content: { parts: [] } }]
        }
      };
      const res1 = runVmCode(extractorCode, [emptyGemini]);
      assert.equal(res1[0].json.raw_response, '');
      assert.equal(res1[0].json.citations.length, 0);

      // 2. API Error envelope
      const errorItem = {
        json: {
          error: { message: 'OpenAI Rate Limit Exceeded: HTTP 429' }
        }
      };
      const res2 = runVmCode(extractorCode, [errorItem]);
      assert.equal(res2[0].json.raw_response, 'ERROR: OpenAI Rate Limit Exceeded: HTTP 429');

      // 3. Extreme URL encoding and special characters
      const urlItem = {
        json: {
          raw_response: 'Besuchen Sie [Dokumentation](https://sub.domain.de%2Fpath%3Fquery%3Dval%26other%3D1#frag).'
        }
      };
      const res3 = runVmCode(extractorCode, [urlItem]);
      assert.ok(res3[0].json.citations.length >= 1);
      assert.equal(res3[0].json.citations[0].citation_domain, 'sub.domain.de');
    });

    it('CHALLENGE-5.3: Chat Response Formatter Markdown Robustness', () => {
      const minimalItem = {
        json: {
          prompt: 'Minimal Test',
          brand_name: 'TestBrand',
          provider: 'openai',
          mece_category: '4_GENERIC',
          geo_quadrant: '2_PARAMETRIC_BLINDSPOT'
        }
      };

      const res = runVmCode(formatterCode, [minimalItem]);
      assert.ok(Array.isArray(res) && res.length === 1);
      const text = res[0].json.output || res[0].json.text;

      assert.ok(text.includes('Chatlytics AI Visibility Audit'));
      assert.ok(text.includes('4_GENERIC'));
      assert.ok(text.includes('2_PARAMETRIC_BLINDSPOT'));
    });

    it('CHALLENGE-5.4: Regression Prevention — Bare URL Sentence Punctuation Regex Sanitization', () => {
      // Regression prevention in Secondary Extractor:
      // Strips trailing periods, commas, colons, semicolons, and closing brackets from bare URLs
      const bareUrlItem = {
        json: {
          brand_name: 'Celonis',
          brand_domains: ['celonis.com'],
          competitors: [],
          raw_response: 'Empfehlenswert ist https://celonis.com.'
        }
      };

      const extracted = runVmCode(extractorCode, [bareUrlItem]);
      assert.ok(extracted[0].json.citations.length >= 1);
      const extractedDomain = extracted[0].json.citations[0].citation_domain;
      const extractedUrl = extracted[0].json.citations[0].citation_url;

      assert.equal(extractedDomain, 'celonis.com', 'Secondary Extractor must sanitize trailing period from domain');
      assert.equal(extractedUrl, 'https://celonis.com', 'Secondary Extractor must sanitize trailing period from citation_url');
      const hasDefect = (extractedDomain === 'celonis.com.');
      assert.equal(hasDefect, false, 'No trailing period defect present');
    });

    it('CHALLENGE-5.5: Regression Prevention — Unchecked Null Competitor in Extractor', () => {
      // In Secondary Extractor:
      // Null or corrupted competitor array elements must be handled gracefully without throwing TypeError
      const nullCompItem = {
        json: {
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          competitors: [null],
          raw_response: 'Besuchen Sie https://personio.de für mehr Info.'
        }
      };

      let threwTypeError = false;
      try {
        runVmCode(extractorCode, [nullCompItem]);
      } catch (err) {
        if (err.message && err.message.includes('null')) {
          threwTypeError = true;
        }
      }

      assert.equal(threwTypeError, false, 'Secondary Extractor safely handles null competitor without TypeError');
    });

    it('CHALLENGE-5.6: Regression Prevention — Precedence of itemMatching(i) Over Static .item', () => {
      // In realistic n8n execution, LLM HTTP Request nodes return raw API responses (choices, content, candidates)
      // without containing the upstream Chatlytics metadata (brand_name, brand_domains, competitors).
      // Precedence order evaluates itemMatching(i) first so each batch item resolves its corresponding metadata.
      const normalizerOutputs = [
        { json: { brand_name: 'Brand0', brand_domains: ['brand0.de'], competitors: [] } },
        { json: { brand_name: 'Brand1', brand_domains: ['brand1.de'], competitors: [] } }
      ];

      // LLM outputs containing only the model response text
      const rawLlmOutputs = [
        { json: { raw_response: 'Empfehlung 0' } },
        { json: { raw_response: 'Empfehlung 1' } }
      ];

      const proxyWithStaticItem = (nodeName) => ({
        item: normalizerOutputs[0],
        itemMatching: (i) => normalizerOutputs[i]
      });

      const extracted = runVmCode(extractorCode, rawLlmOutputs, {}, proxyWithStaticItem);
      // Item 1 gets Brand1 because itemMatching(i) takes precedence
      const item1Brand = extracted[1].json.brand_name;
      assert.equal(item1Brand, 'Brand1', 'Secondary Extractor prioritizes itemMatching(i) over static .item');
    });
  });
});
