/**
 * tests/tier5_adversarial/m2_challenger_1_stress.test.js
 * Adversarial Stress & Fuzzing Harness for Milestone 2:
 * n8n 2.44.5 Universal Worker Workflow Canvas JSON, PoC Guide & Embedded Code Nodes
 * 
 * Target Artifacts:
 * - n8n/chatlytics_universal_worker.json
 * - n8n/N8N_SETUP_AND_POC_GUIDE.md
 * - tests/unit/workflow.test.js
 * 
 * Verifies:
 * 1. Universal Normalizer Code Node (Node 7) under extreme/malformed inputs:
 *    - null, undefined, non-string chat inputs, nested brackets, 100k char payloads, malformed shorthand
 *    - sparse/null queue jobs, malformed competitors, malformed webhook bodies
 * 2. Secondary Extractor Code Node (Node 12) under boundary & corruption conditions:
 *    - missing/null groundingMetadata, null groundingChunks, malformed markdown links [text](not-a-url)
 *    - null citation arrays, truncated text, bare URLs with trailing punctuation, percent-encoding fallbacks
 *    - LLM provider error envelopes
 * 3. Metric Engine embedded within Node 13 under fuzzing conditions:
 *    - empty text, 100k char corpus, rapid brand repetitions, German special characters (ä, ö, ü, ß, ẞ)
 *    - attached punctuation word-boundary invariant (1 <= word_earliness <= total_words)
 *    - 4 MECE categories and 4 GEO quadrants under boundary fuzzing
 * 4. Graph Topological Sorting & Canvas DAG Analysis:
 *    - Directed Acyclic Graph (DAG) cycle detection (Kahn's algorithm)
 *    - Disconnected components and orphaned node detection
 *    - Connection source/target registry consistency
 * 5. Trigger Multiplexing & Response Node Resilience:
 *    - Verification of continueOnFail and error handling when non-webhook triggers (Chat, Schedule)
 *      or async webhooks reach Respond to Webhook nodes
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/chatlytics_universal_worker.json');
const GUIDE_PATH = path.resolve(__dirname, '../../n8n/N8N_SETUP_AND_POC_GUIDE.md');

// Helper to load workflow JSON
function loadWorkflow() {
  assert.ok(fs.existsSync(WORKFLOW_PATH), `Workflow JSON file missing at ${WORKFLOW_PATH}`);
  const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  return { raw, json: JSON.parse(raw) };
}

// Helper to execute embedded n8n JavaScript code inside an isolated V8 vm sandbox
function executeCodeNode(jsCode, inputItems, customEnv = {}, nodeContext = {}) {
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
    $: (nodeName) => {
      if (nodeContext[nodeName]) {
        return {
          item: nodeContext[nodeName],
          first: () => nodeContext[nodeName],
          itemMatching: (i) => nodeContext[nodeName]
        };
      }
      return null;
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

// ============================================================================
// SUITE 1: Universal Normalizer Code Node (Node 7) Adversarial Fuzzing
// ============================================================================
test('ADV-M2-1.1: Universal Normalizer handles null, undefined, and non-string chat inputs without crashing', () => {
  const { json: workflow } = loadWorkflow();
  const normalizerNode = workflow.nodes.find(n => n.name === 'Universal Normalizer');
  assert.ok(normalizerNode, 'Universal Normalizer node must exist');
  const code = normalizerNode.parameters.jsCode;

  const testCases = [
    { json: { chatInput: null } },
    { json: { chatInput: undefined } },
    { json: { chatInput: 123456 } },
    { json: { chatInput: true } },
    { json: { chatInput: false } },
    { json: { chatInput: { arbitrary: 'object' } } },
    { json: { chatInput: ['array', 'of', 'tokens'] } }
  ];

  for (const item of testCases) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [item]);
    }, `Normalizer crashed on input: ${JSON.stringify(item)}`);

    assert.ok(Array.isArray(result), 'Must return array of items');
    assert.ok(result.length > 0, 'Must produce normalized output items');
    for (const resItem of result) {
      assert.ok(resItem.json.run_id, 'Must assign run_id');
      assert.ok(resItem.json.provider, 'Must assign provider');
      assert.ok(Array.isArray(resItem.json.brand_domains), 'brand_domains must be array');
      assert.ok(Array.isArray(resItem.json.competitors), 'competitors must be array');
    }
  }
});

test('ADV-M2-1.2: Universal Normalizer handles nested brackets and malformed JSON safely', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  const malformedBrackets = [
    '{{malformed nested curly braces}}',
    '{ { "prompt": "nested" } }',
    '{ "prompt": "valid inner { brace }", "brand_name": "Test" }',
    '{}',
    '{{{}}}',
    '{"incomplete": ',
    '{ "prompt": "a", "brand_name": "b", "target_llms": "invalid_not_array" }'
  ];

  for (const inputStr of malformedBrackets) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [{ json: { chatInput: inputStr } }]);
    }, `Normalizer crashed on malformed string: ${inputStr}`);

    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  }
});

test('ADV-M2-1.3: Universal Normalizer survives 100,000 character extreme payload with delimiter flooding', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  const massivePrompt = 'PROMPT: ' + 'Sehr lange Anfrage mit vielen Details. '.repeat(2500) + '\n';
  const massiveShorthand = massivePrompt +
    'BRAND: Personio\n' +
    'DOMAINS: ' + Array.from({ length: 50 }, (_, i) => `domain${i}.de`).join(', ') + '\n' +
    'COMPETITORS: ' + Array.from({ length: 50 }, (_, i) => `Competitor ${i} (comp${i}.com)`).join(', ') + '\n' +
    'LLMS: openai, anthropic, gemini\n' +
    'SEARCH: true\n' +
    '|'.repeat(1000); // delimiter flooding

  assert.ok(massiveShorthand.length > 100000, `Payload must exceed 100k chars (got ${massiveShorthand.length})`);

  const start = performance.now();
  const result = executeCodeNode(code, [{ json: { chatInput: massiveShorthand } }]);
  const duration = performance.now() - start;

  assert.equal(result.length, 3, 'Must expand into 3 providers');
  assert.equal(result[0].json.brand_name, 'Personio');
  assert.equal(result[0].json.brand_domains.length, 50);
  assert.equal(result[0].json.competitors.length, 50);
  assert.ok(duration < 250, `100k char parsing took ${duration}ms, exceeding 250ms SLA`);
});

test('ADV-M2-1.4: Universal Normalizer shorthand parser handles multi-colon URLs and irregular lines', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  const complexShorthand = `
    PROMPT: Suche nach https://www.personio.de:8443/vergleich?kategorie=hr:software&zeit=2026:11:06
    BRAND: Personio Mittelstand
    DOMAINS: personio.de, personio.com, https://sub.personio.de:443/
    COMPETITORS: Workday Enterprise (workday.com), SAP (no_closing_paren, Malformed(), BambooHR (bamboohr.com)
    LLMS: openai, gemini, unknown_provider
    SEARCH: 1
  `;

  const result = executeCodeNode(code, [{ json: { chatInput: complexShorthand } }]);
  assert.equal(result.length, 3);
  const item = result[0].json;

  assert.ok(item.prompt.includes('https://www.personio.de:8443/vergleich'));
  assert.equal(item.brand_name, 'Personio Mittelstand');
  assert.equal(item.search_enabled, true);
  assert.ok(item.competitors.length >= 3);
});

test('ADV-M2-1.5: Universal Normalizer handles valid and empty Queue Poller jobs array', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  const queueItems = [
    { json: { jobs: [] } },
    { json: { jobs: [{ prompt: 'Job 1', brand_name: 'BrandA', target_llms: ['openai'] }] } }
  ];

  for (const inputItem of queueItems) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [inputItem]);
    });
    assert.ok(Array.isArray(result));
  }
});

test('ADV-M2-DEFECT-1: Regression Prevention: Universal Normalizer survives jobs array containing null/undefined without crashing', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  assert.doesNotThrow(
    () => executeCodeNode(code, [{ json: { jobs: [null, undefined, { prompt: 'Valid prompt' }] } }]),
    'Universal Normalizer must not crash when jobs array contains null/undefined'
  );
  const result = executeCodeNode(code, [{ json: { jobs: [null, undefined, { prompt: 'Valid prompt' }] } }]);
  assert.ok(Array.isArray(result) && result.length > 0, 'Must process valid jobs in sparse jobs array');
});

test('ADV-M2-1.6: Universal Normalizer handles corrupted Webhook body inputs', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Universal Normalizer').parameters.jsCode;

  const corruptWebhookItems = [
    { json: { body: null } },
    { json: { body: 'raw_string_payload' } },
    { json: { body: 12345 } },
    { json: { body: { target_llms: null, competitors: [null, 'ValidComp', 42] } } }
  ];

  for (const inputItem of corruptWebhookItems) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [inputItem]);
    }, `Normalizer crashed on webhook item: ${JSON.stringify(inputItem)}`);

    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  }
});

// ============================================================================
// SUITE 2: Secondary Extractor Code Node (Node 12) Adversarial Fuzzing
// ============================================================================
test('ADV-M2-2.1: Secondary Extractor handles Gemini grounding chunks with missing, null, or corrupted objects', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const corruptGeminiInputs = [
    // Missing candidates
    { json: { provider: 'gemini', brand_name: 'Personio' } },
    // Empty candidates
    { json: { provider: 'gemini', brand_name: 'Personio', candidates: [] } },
    // Null candidate element
    { json: { provider: 'gemini', brand_name: 'Personio', candidates: [null] } },
    // Missing groundingMetadata
    { json: { provider: 'gemini', brand_name: 'Personio', candidates: [{ content: { parts: [{ text: 'Antwort' }] } }] } },
    // Null groundingMetadata
    { json: { provider: 'gemini', brand_name: 'Personio', candidates: [{ groundingMetadata: null }] } },
    // Null groundingChunks
    { json: { provider: 'gemini', brand_name: 'Personio', candidates: [{ groundingMetadata: { groundingChunks: null } }] } },
    // Sparse groundingChunks with nulls and missing web objects
    {
      json: {
        provider: 'gemini',
        brand_name: 'Personio',
        brand_domains: ['personio.de'],
        candidates: [{
          content: { parts: [{ text: 'Hier ist Personio: www.personio.de' }] },
          groundingMetadata: {
            groundingChunks: [
              null,
              undefined,
              {},
              { web: null },
              { web: {} }, // missing uri
              { web: { uri: 'https://www.personio.de/preise', title: 'Preise' } },
              { web: { uri: '   ', title: 'Empty URL' } }
            ]
          }
        }]
      }
    }
  ];

  for (const inputItem of corruptGeminiInputs) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [inputItem]);
    }, `Secondary Extractor crashed on Gemini input: ${JSON.stringify(inputItem)}`);

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.ok(Array.isArray(result[0].json.citations));
  }

  // Verify the sparse chunks extracted exactly the 1 valid URI
  const lastRes = executeCodeNode(code, [corruptGeminiInputs[6]]);
  const citations = lastRes[0].json.citations;
  assert.equal(citations.length, 1);
  assert.equal(citations[0].citation_domain, 'personio.de');
  assert.equal(citations[0].is_brand_domain, true);
});

test('ADV-M2-2.2: Secondary Extractor filters malformed markdown links ([text](not-a-url)) and empty brackets', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const textWithMalformedMarkdown = `
    Hier sind verschiedene Links:
    1. [Not a URL](not-a-url)
    2. [Relative Link](/path/to/page)
    3. [Empty Target]()
    4. [](https://www.personio.de/empty-anchor)
    5. [Valid Link](https://www.personio.de/valid)
    6. [FTP Link](ftp://files.personio.de/doc.pdf)
    7. [JavaScript Link](javascript:alert(1))
    8. [Malformed Scheme](httpx://bad.com)
  `;

  const inputItem = {
    json: {
      provider: 'openai',
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      choices: [{ message: { content: textWithMalformedMarkdown } }]
    }
  };

  const result = executeCodeNode(code, [inputItem]);
  assert.equal(result.length, 1);
  const citations = result[0].json.citations;

  // Only the valid https link should be extracted as a markdown_link citation
  const validCitations = citations.filter(c => c.source_type === 'markdown_link');
  assert.ok(validCitations.some(c => c.citation_url === 'https://www.personio.de/valid'));
  assert.ok(!validCitations.some(c => c.citation_url === 'not-a-url'));
  assert.ok(!validCitations.some(c => c.citation_url === '/path/to/page'));
});

test('ADV-M2-DEFECT-2: Regression Prevention: Secondary Extractor strips trailing punctuation from bare citation_url', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const textWithBareUrls = 'Besuchen Sie https://personio.de/features. Oder https://workday.com/de,';

  const inputItem = {
    json: {
      provider: 'anthropic',
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      content: [{ type: 'text', text: textWithBareUrls }]
    }
  };

  const result = executeCodeNode(code, [inputItem]);
  const citations = result[0].json.citations;

  assert.equal(citations[0].citation_url, 'https://personio.de/features', 'Trailing dot must be stripped from citation_url');
  assert.equal(citations[1].citation_url, 'https://workday.com/de', 'Trailing comma must be stripped from citation_url');
  assert.equal(citations[0].citation_domain, 'personio.de');
  assert.equal(citations[1].citation_domain, 'workday.com');
});

test('ADV-M2-2.4: Secondary Extractor handles URL percent-decoding, userinfo, ports, and malformed encoding', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const complexUrlsText = `
    Links:
    - [Encoded Slash](https://www.personio.de%2Fhr-software)
    - [Malformed Encoding](https://personio.de/test%ZZ%GG)
  `;

  const inputItem = {
    json: {
      provider: 'openai',
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      choices: [{ message: { content: complexUrlsText } }]
    }
  };

  let result;
  assert.doesNotThrow(() => {
    result = executeCodeNode(code, [inputItem]);
  }, 'Extractor must not throw URIError on malformed percent encoding');

  const citations = result[0].json.citations;
  assert.ok(citations.length > 0);
  for (const c of citations) {
    assert.equal(c.citation_domain, 'personio.de');
    assert.equal(c.is_brand_domain, true);
  }
});

test('ADV-M2-DEFECT-3: Regression Prevention: Secondary Extractor does not split userinfo URLs into spurious citations', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const text = '[Userinfo Link](https://admin:secret@personio.de:8443/dashboard)';
  const inputItem = {
    json: {
      provider: 'openai',
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      choices: [{ message: { content: text } }]
    }
  };

  const result = executeCodeNode(code, [inputItem]);
  const citations = result[0].json.citations;

  const hasSpuriousAdmin = citations.some(c => c.citation_domain === 'admin');
  assert.equal(
    hasSpuriousAdmin,
    false,
    'Userinfo prefix must not create spurious domain "admin"'
  );
  assert.ok(citations.some(c => c.citation_domain === 'personio.de'), 'Must retain valid domain personio.de');
});

test('ADV-M2-2.5: Secondary Extractor extracts provider error envelopes into raw response gracefully', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Secondary Extractor').parameters.jsCode;

  const errorInputs = [
    { json: { provider: 'openai', error: { message: 'OpenAI quota exceeded', type: 'insufficient_quota', code: 429 } } },
    { json: { provider: 'anthropic', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    { json: { provider: 'gemini', error: { code: 400, message: 'API key not valid' } } }
  ];

  for (const errItem of errorInputs) {
    const result = executeCodeNode(code, [errItem]);
    assert.equal(result.length, 1);
    const raw = result[0].json.raw_response;
    assert.ok(raw.startsWith('ERROR:'), 'Must wrap error message cleanly into raw_response');
    assert.equal(result[0].json.citations.length, 0);
  }
});

// ============================================================================
// SUITE 3: Embedded Metric Engine (Node 13) Stress & Fuzzing
// ============================================================================
test('ADV-M2-3.1: Metric Engine handles empty, null, undefined, and pure whitespace text without division by zero', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const emptyInputs = [
    { json: { brand_name: 'Personio', raw_response: '' }, expectedChars: 0 },
    { json: { brand_name: 'Personio', raw_response: null }, expectedChars: 0 },
    { json: { brand_name: 'Personio', raw_response: undefined }, expectedChars: 0 },
    { json: { brand_name: 'Personio', raw_response: '   \n\t\r  ' }, expectedChars: 8 }
  ];

  for (const item of emptyInputs) {
    let result;
    assert.doesNotThrow(() => {
      result = executeCodeNode(code, [item]);
    }, `Metric Engine crashed on empty text: ${JSON.stringify(item)}`);

    assert.equal(result.length, 1);
    const m = result[0].json;

    assert.equal(m.total_chars, item.expectedChars);
    assert.equal(m.total_words, 0, 'Whitespace-only text must produce 0 words');
    assert.equal(m.brand_mentioned, 0);
    assert.equal(m.brand_earliness_char, null);
    assert.equal(m.brand_earliness_word, null);
    assert.equal(m.relative_position_pct, null, 'relative_position_pct must be null when brand not found');
    assert.equal(m.mece_category, '4_GENERIC');
    assert.equal(m.geo_quadrant, 'NONE');
  }
});

test('ADV-M2-3.2: Metric Engine executes 100,000 character corpus stress test without ReDoS or stack overflow', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const padding = 'In einem tiefen, detailreichen Unternehmensanalysebericht werden viele Aspekte beleuchtet. '.repeat(1000);
  const fullText = padding + 'Schließlich überzeugt Personio als beste Lösung.';
  assert.ok(fullText.length > 90000, `Corpus must be ~90k+ characters (got ${fullText.length})`);

  const inputItem = {
    json: {
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      competitors: [{ name: 'Workday', domain: 'workday.com' }],
      raw_response: fullText,
      citations: [{ citation_domain: 'personio.de', citation_url: 'https://personio.de' }]
    }
  };

  const start = performance.now();
  const result = executeCodeNode(code, [inputItem]);
  const duration = performance.now() - start;

  assert.equal(result.length, 1);
  const m = result[0].json;

  assert.equal(m.brand_mentioned, 1);
  assert.ok(m.brand_earliness_char > 80000);
  assert.ok(m.relative_position_pct > 50.0);
  assert.equal(m.mece_category, '1_DIRECT_WIN');
  assert.equal(m.geo_quadrant, '4_BURIED_WINNER'); // brand won but appears >50% late
  assert.ok(duration < 250, `100k char metric calculation took ${duration}ms, exceeding 250ms SLA`);
});

test('ADV-M2-3.3: Metric Engine handles 1,000 rapid brand repetitions and resolves earliest instance', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const repeatedText = 'Personio '.repeat(1000).trim();
  const inputItem = {
    json: {
      brand_name: 'Personio',
      brand_domains: ['personio.de'],
      raw_response: repeatedText,
      citations: []
    }
  };

  const result = executeCodeNode(code, [inputItem]);
  const m = result[0].json;

  assert.equal(m.brand_mentioned, 1);
  assert.equal(m.brand_earliness_char, 0, 'First occurrence must be index 0');
  assert.equal(m.brand_earliness_word, 1, 'First occurrence must be word 1');
  assert.equal(m.relative_position_pct, 0.0);
  assert.equal(m.mece_category, '1_DIRECT_WIN');
});

test('ADV-M2-3.4: Metric Engine accurately normalizes German special characters (ä, ö, ü, ß, ẞ) and transliterations', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const germanTests = [
    { brand: 'Müller', text: 'MÜLLER Milchprodukte sind bekannt.', expectedMatch: true },
    { brand: 'Müller', text: 'Mueller ist die alternative Schreibweise.', expectedMatch: true },
    { brand: 'Jägermeister', text: 'JAEGERMEISTER Kräuterlikör.', expectedMatch: true },
    { brand: 'Groß', text: 'GROSS & Partner Immobilien.', expectedMatch: true },
    { brand: 'Schröder', text: 'SCHRÖDER Werkzeuge.', expectedMatch: true },
    { brand: 'Weiß', text: 'WEISS GMBH (mit großem ẞ: WEIẞ).', expectedMatch: true }
  ];

  for (const t of germanTests) {
    const inputItem = {
      json: {
        brand_name: t.brand,
        raw_response: t.text,
        citations: []
      }
    };
    const result = executeCodeNode(code, [inputItem]);
    const m = result[0].json;
    assert.equal(m.brand_mentioned, t.expectedMatch ? 1 : 0, `Failed to match German brand ${t.brand} in text: ${t.text}`);
    assert.equal(m.mece_category, '1_DIRECT_WIN');
  }
});

test('ADV-M2-3.5: Metric Engine verifies attached punctuation invariant (1 <= word_earliness <= total_words)', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const punctuationCases = [
    { text: '(Personio)', brand: 'Personio' },
    { text: '„Personio“', brand: 'Personio' },
    { text: '»Personio«', brand: 'Personio' },
    { text: '[Personio]', brand: 'Personio' },
    { text: '{Personio}', brand: 'Personio' },
    { text: 'Personio, ist gut.', brand: 'Personio' },
    { text: 'Empfehlung: (Personio)', brand: 'Personio' }
  ];

  for (const c of punctuationCases) {
    const inputItem = {
      json: {
        brand_name: c.brand,
        raw_response: c.text,
        citations: []
      }
    };
    const result = executeCodeNode(code, [inputItem]);
    const m = result[0].json;

    assert.equal(m.brand_mentioned, 1);
    assert.ok(m.word_earliness >= 1, `word_earliness (${m.word_earliness}) must be >= 1`);
    assert.ok(
      m.word_earliness <= m.total_words,
      `Invariant violation: word_earliness (${m.word_earliness}) > total_words (${m.total_words}) for "${c.text}"`
    );
  }
});

test('ADV-M2-3.6: Metric Engine deterministic partition across all 4 MECE categories', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const scenarios = [
    {
      name: '1_DIRECT_WIN (Brand leads)',
      brand: 'Personio',
      competitors: ['Workday'],
      text: 'Personio ist Marktführer. Workday ist Zweiter.',
      expectedMECE: '1_DIRECT_WIN'
    },
    {
      name: '2_BRAND_HALO (Competitor leads, brand secondary)',
      brand: 'Personio',
      competitors: ['Workday'],
      text: 'Workday ist Marktführer. Auch Personio ist gut.',
      expectedMECE: '2_BRAND_HALO'
    },
    {
      name: '3_COMPETITOR_TAKEOVER (Competitor mentioned, brand omitted)',
      brand: 'Personio',
      competitors: ['Workday'],
      text: 'Workday bietet die beste HR Suite.',
      expectedMECE: '3_COMPETITOR_TAKEOVER'
    },
    {
      name: '4_GENERIC (Neither brand nor competitor mentioned)',
      brand: 'Personio',
      competitors: ['Workday'],
      text: 'Es gibt viele HR Software Lösungen auf dem Markt.',
      expectedMECE: '4_GENERIC'
    }
  ];

  for (const s of scenarios) {
    const inputItem = {
      json: {
        brand_name: s.brand,
        competitors: s.competitors,
        raw_response: s.text,
        citations: []
      }
    };
    const result = executeCodeNode(code, [inputItem]);
    assert.equal(result[0].json.mece_category, s.expectedMECE, `Scenario failed: ${s.name}`);
  }
});

test('ADV-M2-3.7: Metric Engine deterministic partition across all 4 GEO quadrants', () => {
  const { json: workflow } = loadWorkflow();
  const code = workflow.nodes.find(n => n.name === 'Metric & MECE Calculator').parameters.jsCode;

  const geoScenarios = [
    {
      name: '1_CITATION_HIJACK (Brand in text, competitor domain cited)',
      brand: 'Personio',
      domains: ['personio.de'],
      competitors: ['Workday'],
      text: 'Personio ist die führende Lösung.',
      citations: [{ citation_domain: 'omr.com', citation_url: 'https://omr.com' }],
      expectedGEO: '1_CITATION_HIJACK'
    },
    {
      name: '2_PARAMETRIC_BLINDSPOT (Brand domain cited, brand omitted from text)',
      brand: 'Personio',
      domains: ['personio.de'],
      competitors: ['Workday'],
      text: 'HR Lösungen im Mittelstand.',
      citations: [{ citation_domain: 'personio.de', citation_url: 'https://personio.de' }],
      expectedGEO: '2_PARAMETRIC_BLINDSPOT'
    },
    {
      name: '3_BRAND_HALO_TRAP (Brand trapped behind competitor in halo position)',
      brand: 'Personio',
      domains: ['personio.de'],
      competitors: ['Workday'],
      text: 'Workday ist Marktführer. Personio folgt dahinter.',
      citations: [],
      expectedGEO: '3_BRAND_HALO_TRAP'
    },
    {
      name: '4_BURIED_WINNER (Brand recommended #1, but buried late >50% relative position)',
      brand: 'Personio',
      domains: ['personio.de'],
      competitors: [],
      text: 'Viele Erläuterungen und allgemeine Fakten über HR Software. '.repeat(5) + 'Personio ist der Testsieger.',
      citations: [{ citation_domain: 'personio.de', citation_url: 'https://personio.de' }],
      expectedGEO: '4_BURIED_WINNER'
    }
  ];

  for (const g of geoScenarios) {
    const inputItem = {
      json: {
        brand_name: g.brand,
        brand_domains: g.domains,
        competitors: g.competitors,
        raw_response: g.text,
        citations: g.citations
      }
    };
    const result = executeCodeNode(code, [inputItem]);
    assert.equal(result[0].json.geo_quadrant, g.expectedGEO, `GEO test failed: ${g.name}`);
  }
});

// ============================================================================
// SUITE 4: Graph Topological Sorting & Canvas DAG Analysis
// ============================================================================
test('ADV-M2-4.1: Graph Topological Sort (Kahn Algorithm) proves strictly acyclic DAG with 0 cycles', () => {
  const { json: workflow } = loadWorkflow();

  const nodeNames = new Set(workflow.nodes.map(n => n.name));
  const inDegree = new Map();
  const adj = new Map();

  for (const name of nodeNames) {
    inDegree.set(name, 0);
    adj.set(name, []);
  }

  // Populate graph edges
  for (const [sourceName, connections] of Object.entries(workflow.connections)) {
    assert.ok(nodeNames.has(sourceName), `Source ${sourceName} not found in node registry`);
    if (connections.main && Array.isArray(connections.main)) {
      for (const outputPort of connections.main) {
        for (const conn of outputPort) {
          assert.ok(nodeNames.has(conn.node), `Target ${conn.node} not found in node registry`);
          adj.get(sourceName).push(conn.node);
          inDegree.set(conn.node, (inDegree.get(conn.node) || 0) + 1);
        }
      }
    }
  }

  // Kahn's Algorithm
  const queue = [];
  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(node);
  }

  const sortedOrder = [];
  while (queue.length > 0) {
    const curr = queue.shift();
    sortedOrder.push(curr);

    for (const neighbor of adj.get(curr)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  assert.equal(
    sortedOrder.length,
    nodeNames.size,
    `Topological sort failed! Expected ${nodeNames.size} sorted nodes, got ${sortedOrder.length}. Graph has cyclic dependencies.`
  );
});

test('ADV-M2-4.2: Zero Orphaned Nodes: All non-trigger nodes are reachable from at least one trigger', () => {
  const { json: workflow } = loadWorkflow();

  const triggers = new Set([
    'Universal API Webhook',
    'Interactive Chat Trigger',
    'Schedule Poller Trigger'
  ]);

  const adj = new Map();
  for (const node of workflow.nodes) {
    adj.set(node.name, []);
  }

  for (const [source, connections] of Object.entries(workflow.connections)) {
    if (connections.main) {
      for (const port of connections.main) {
        for (const c of port) {
          adj.get(source).push(c.node);
        }
      }
    }
  }

  // BFS from all triggers
  const reachable = new Set();
  const queue = [...triggers];
  for (const t of triggers) reachable.add(t);

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const neighbor of adj.get(curr) || []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const node of workflow.nodes) {
    assert.ok(
      reachable.has(node.name),
      `Orphaned node detected! Node "${node.name}" is unreachable from any trigger.`
    );
  }
});

test('ADV-M2-4.3: Connection integrity: All 16 nodes have valid connection mappings without dead-ends', () => {
  const { json: workflow } = loadWorkflow();

  const terminalNodes = new Set([
    'Dispatch Ingest API',
    'Format Chat Response',
    'Respond Webhook Sync'
  ]);

  for (const node of workflow.nodes) {
    if (terminalNodes.has(node.name)) {
      // Terminal nodes should have 0 outgoing connections
      assert.ok(
        !workflow.connections[node.name] || (workflow.connections[node.name].main && workflow.connections[node.name].main.length === 0),
        `Terminal node "${node.name}" should have no outgoing connections`
      );
    } else {
      // Non-terminal nodes must have outgoing connections
      assert.ok(
        workflow.connections[node.name] && workflow.connections[node.name].main && workflow.connections[node.name].main.length > 0,
        `Intermediate node "${node.name}" is missing outgoing connections`
      );
    }
  }
});

// ============================================================================
// SUITE 5: Trigger Multiplexing & Response Node Resilience (continueOnFail)
// ============================================================================
test('ADV-M2-DEFECT-4: Regression Prevention: Respond Webhook Sync configures continueOnFail: true and onError handling', () => {
  const { json: workflow } = loadWorkflow();
  const respondSyncNode = workflow.nodes.find(n => n.name === 'Respond Webhook Sync');
  assert.ok(respondSyncNode, 'Respond Webhook Sync node must exist');

  const hasContinueOnFail = respondSyncNode.continueOnFail === true;
  const hasOnError = respondSyncNode.onError === 'continueRegularOutput';

  assert.equal(
    hasContinueOnFail,
    true,
    'Respond Webhook Sync must configure continueOnFail: true'
  );
  assert.equal(
    hasOnError,
    true,
    'Respond Webhook Sync must configure onError: continueRegularOutput'
  );
});

test('ADV-M2-5.2: Fast Async Response node branches correctly from Check Async Mode', () => {
  const { json: workflow } = loadWorkflow();
  const checkAsyncNode = workflow.nodes.find(n => n.name === 'Check Async Mode');
  assert.ok(checkAsyncNode, 'Check Async Mode must exist');

  const checkAsyncConn = workflow.connections['Check Async Mode'];
  assert.ok(checkAsyncConn && checkAsyncConn.main, 'Check Async Mode must have connections');
  assert.equal(checkAsyncConn.main.length, 2, 'Check Async Mode must have 2 output ports (true/false)');

  const truePort = checkAsyncConn.main[0];
  const falsePort = checkAsyncConn.main[1];

  assert.ok(truePort.some(c => c.node === 'Fast Async Response'), 'True port must connect to Fast Async Response');
  assert.ok(falsePort.some(c => c.node === 'Universal Normalizer'), 'False port must connect to Universal Normalizer');

  // Verify Fast Async Response also connects to Universal Normalizer to continue pipeline
  const fastAsyncConn = workflow.connections['Fast Async Response'];
  assert.ok(fastAsyncConn && fastAsyncConn.main, 'Fast Async Response must have connections');
  assert.ok(
    fastAsyncConn.main[0].some(c => c.node === 'Universal Normalizer'),
    'Fast Async Response must feed into Universal Normalizer to continue execution'
  );
});

test('ADV-M2-5.3: PoC Guide and Workflow JSON consistency check', () => {
  assert.ok(fs.existsSync(GUIDE_PATH), `PoC Guide missing at ${GUIDE_PATH}`);
  const guideContent = fs.readFileSync(GUIDE_PATH, 'utf8');

  // Verify guide contains essential sections
  assert.ok(guideContent.includes('chatlytics_universal_worker.json'), 'Guide must reference workflow file');
  assert.ok(guideContent.includes('OpenAI API'), 'Guide must cover OpenAI credentials');
  assert.ok(guideContent.includes('Anthropic API'), 'Guide must cover Anthropic credentials');
  assert.ok(guideContent.includes('Google PaLM') || guideContent.includes('Gemini API'), 'Guide must cover Gemini credentials');
  assert.ok(guideContent.includes('PROMPT:'), 'Guide must document shorthand prompts');
  assert.ok(guideContent.includes('/webhook/chatlytics-run'), 'Guide must document webhook endpoint');
  assert.ok(guideContent.includes('Fast Async'), 'Guide must document async queue mode');
});
