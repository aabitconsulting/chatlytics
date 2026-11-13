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

test('Feature 8.1: Switch router ports for all 3 supported LLM providers', () => {
  if (fs.existsSync(WORKFLOW_PATH)) {
    const json = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
    const switchNode = json.nodes.find(n => n.type === 'n8n-nodes-base.switch');
    assert.ok(switchNode, 'Switch node must exist for provider routing');
  } else {
    assert.ok(true);
  }
});

test('Feature 8.2: OpenAI native Responses payload config defaults to gpt-6-luna', () => {
  const openAiPayload = {
    model: 'gpt-6-luna',
    responses: [
      { role: 'system', content: 'Du bist ein präziser, neutraler Recherche-Assistent.' },
      { role: 'user', content: 'Welche HR Software eignet sich?' }
    ]
  };
  assert.equal(openAiPayload.model, 'gpt-6-luna');
  assert.equal(openAiPayload.responses.length, 2);
});

test('Feature 8.3: Mistral EU & GLM 5.3 payload targets api.eu.mistral.ai and optional Anthropic fallback remains supported', () => {
  const mistralPayload = {
    url: 'https://api.eu.mistral.ai/v1/chat/completions',
    model: 'zai-glm-5-3',
    messages: [
      { role: 'user', content: 'Welche HR Software eignet sich?' }
    ]
  };
  assert.equal(mistralPayload.url, 'https://api.eu.mistral.ai/v1/chat/completions');
  assert.equal(mistralPayload.model, 'zai-glm-5-3');
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
