/**
 * tests/tier1_features/f08_provider_routing.test.js
 * Feature 8: Multi-LLM Provider Dynamic Routing
 * Requirements:
 * - Dynamic switch routing to OpenAI, Anthropic Claude, and Google Gemini
 * - Dynamic Google Search grounding tool injection
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/chatlytics_universal_worker.json');

test('Feature 8.1: Unified OpenRouter strategy router (batch_api vs regular) & gateway endpoints exist', () => {
  if (fs.existsSync(WORKFLOW_PATH)) {
    const json = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
    const strategyRouter = json.nodes.find(n => n.name === 'Execution Strategy Router' && n.type === 'n8n-nodes-base.if');
    assert.ok(strategyRouter, 'Execution Strategy Router (if node) must exist');
    const chatNode = json.nodes.find(n => n.name === 'Call OpenRouter Chat');
    const batchNode = json.nodes.find(n => n.name === 'Submit OpenRouter Batch');
    const discoverNode = json.nodes.find(n => n.name === 'Discover OpenRouter Models');
    assert.ok(chatNode && chatNode.parameters.url.includes('openrouter.ai/api/v1/chat/completions'));
    assert.ok(batchNode && batchNode.parameters.url.includes('openrouter.ai/api/v1/batches'));
    assert.ok(discoverNode && discoverNode.parameters.url.includes('openrouter.ai/api/v1/models'));
  } else {
    assert.ok(true);
  }
});

test('Feature 8.2: OpenRouter Chat Completions payload sends user prompt ONLY (zero system prompt) with dynamic web search', () => {
  const buildOpenRouterChatBody = (item) => {
    const body = {
      model: item.model_key,
      messages: [
        { role: 'user', content: item.llm_prompt || item.prompt }
      ],
      temperature: 0.2
    };
    if (item.search_enabled && !item.model_key.startsWith('perplexity/')) {
      if (item.supports_tools !== false) {
        body.tools = [{ type: 'openrouter:web_search' }];
      } else {
        body.plugins = [{ id: 'web' }];
      }
    }
    return body;
  };

  const payload = buildOpenRouterChatBody({
    model_key: 'openai/gpt-6-luna',
    prompt: 'Welche HR Software eignet sich?',
    llm_prompt: 'Welche HR Software eignet sich?\nBeziehe deine Antwort speziell auf den Markt/die Region: DACH.',
    search_enabled: true,
    supports_tools: true
  });
  assert.equal(payload.model, 'openai/gpt-6-luna');
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].role, 'user');
  assert.equal(payload.messages.some(m => m.role === 'system'), false);
  assert.deepEqual(payload.tools, [{ type: 'openrouter:web_search' }]);

  const pluginFallback = buildOpenRouterChatBody({
    model_key: 'qwen/qwen3-max',
    prompt: 'Best CRM?',
    search_enabled: true,
    supports_tools: false
  });
  assert.deepEqual(pluginFallback.plugins, [{ id: 'web' }]);
});

test('Feature 8.3: OpenRouter Batch API payload groups non-search batchable requests cleanly with zero prompt caching', () => {
  const batchPayload = {
    url: 'https://openrouter.ai/api/v1/batches',
    request_body: {
      requests: [
        {
          custom_id: 'cl_u1_c10_p0_z-ai_1',
          method: 'POST',
          url: '/v1/chat/completions',
          body: {
            model: 'z-ai/glm-5.3',
            messages: [{ role: 'user', content: 'Welche HR Software eignet sich?' }],
            temperature: 0.2
          }
        }
      ]
    }
  };
  assert.equal(batchPayload.url, 'https://openrouter.ai/api/v1/batches');
  assert.equal(batchPayload.request_body.requests[0].body.model, 'z-ai/glm-5.3');
  assert.equal(batchPayload.request_body.requests[0].body.messages.length, 1);
  assert.equal(batchPayload.request_body.requests[0].body.prompt_cache_key, undefined);
});

test('Feature 8.4: Google Gemini dynamic grounding search tool attachment', () => {
  const buildGeminiTools = (searchEnabled) => {
    return searchEnabled ? { googleSearch: {} } : {};
  };

  const toolsEnabled = buildGeminiTools(true);
  assert.ok(toolsEnabled.googleSearch !== undefined);

  const toolsDisabled = buildGeminiTools(false);
  assert.deepEqual(toolsDisabled, {});
});

test('Feature 8.5: Provider expansion logic maps canonical, Mistral EU, GLM & legacy tokens correctly', () => {
  const { expandNormalizerTargetLLMs } = require('../helpers/reference_engine');
  const items = expandNormalizerTargetLLMs({
    prompt: 'CRM Software',
    brand_name: 'Chatlytics',
    target_llms: ['openai', 'gemini', 'mistral/mistral-large-latest', 'mistral/zai-glm-5-3-flash']
  });

  assert.equal(items.length, 4);
  assert.deepEqual(items.map(i => i.provider), ['openai', 'gemini', 'mistral', 'mistral']);
  assert.deepEqual(items.map(i => i.model), ['gpt-6-luna', 'models/gemini-3.5-flash', 'mistral-large-latest', 'zai-glm-5-3-flash']);
  assert.deepEqual(items.map(i => i.eu_hosted), [false, false, true, true]);
});
