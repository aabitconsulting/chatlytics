/**
 * tests/tier3_combinations/comb_normalizer_to_router.test.js
 * Tier 3: Cross-Feature Combination — Normalizer -> Dynamic Provider Router
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNormalizerShorthand, expandNormalizerTargetLLMs } = require('../helpers/reference_engine');

test('Combination 3.1: Chat shorthand input expands into routed provider items including Mistral EU & GLM', () => {
  const shorthand = `PROMPT: Welche Cloud-ERP Lösung empfiehlt sich für Startups?
BRAND: Xentral
DOMAINS: xentral.com
COMPETITORS: SAP, Weclapp (weclapp.com)
LLMS: openai, gemini, mistral/mistral-medium-latest, mistral/zai-glm-5-3
SEARCH: true`;

  const parsed = parseNormalizerShorthand(shorthand);
  const routedItems = expandNormalizerTargetLLMs(parsed, 'chat');

  assert.equal(routedItems.length, 4);

  // Port 0: OpenAI (Native v2.3)
  const openAiItem = routedItems.find(i => i.provider === 'openai');
  assert.ok(openAiItem);
  assert.equal(openAiItem.model, 'gpt-6-luna');
  assert.equal(openAiItem.eu_hosted, false);
  assert.equal(openAiItem.brand_name, 'Xentral');

  // Port 1: Gemini (Native v1.2)
  const geminiItem = routedItems.find(i => i.provider === 'gemini');
  assert.ok(geminiItem);
  assert.equal(geminiItem.model, 'models/gemini-3.5-flash');
  assert.equal(geminiItem.search_enabled, true);

  // Port 2: Mistral EU (Mistral + Mistral-hosted Z.ai GLM)
  const mistralItems = routedItems.filter(i => i.provider === 'mistral');
  assert.equal(mistralItems.length, 2);
  assert.equal(mistralItems[0].model, 'mistral-medium-latest');
  assert.equal(mistralItems[1].model, 'zai-glm-5-3');
  assert.equal(mistralItems[1].eu_hosted, true);
});

test('Combination 3.2: Webhook JSON body normalization routes to single targeted provider', () => {
  const webhookBody = {
    prompt: 'Beste Software für HR',
    brand_name: 'Personio',
    brand_domains: ['personio.de'],
    competitors: ['Workday'],
    target_llms: ['gemini'],
    search_enabled: true,
    response_mode: 'async'
  };

  const routedItems = expandNormalizerTargetLLMs(webhookBody, 'webhook');
  assert.equal(routedItems.length, 1);
  assert.equal(routedItems[0].provider, 'gemini');
  assert.equal(routedItems[0].response_mode, 'async');
  assert.equal(routedItems[0].trigger_source, 'webhook');
});
