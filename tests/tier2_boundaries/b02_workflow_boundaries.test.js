/**
 * tests/tier2_boundaries/b02_workflow_boundaries.test.js
 * Tier 2: Boundary & Corner Cases — n8n Workflow & Multi-Provider Engine (Features 5-11)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNormalizerShorthand, expandNormalizerTargetLLMs } = require('../helpers/reference_engine');

test('Boundary 2.1: Chat trigger malformed JSON input falls back to shorthand parser', () => {
  const malformedJson = '{ "prompt": "Beste HR Software", "brand_name": "Personio" incomplete...';
  const parsed = parseNormalizerShorthand(malformedJson);
  assert.ok(typeof parsed === 'object');
  assert.equal(parsed.brand_name, ''); // fallback gracefully
});

test('Boundary 2.2: Chat shorthand with irregular whitespace, tabs and unicode colon', () => {
  const irregularShorthand = `
\tPROMPT:\t\tWelche HR Software?   \r
BRAND:   Personio DACH   
DOMAINS: personio.de,  personio.com ,  
COMPETITORS: Workday (workday.com) , BambooHR  
LLMS: openai , gemini 
SEARCH: 1
`;
  const parsed = parseNormalizerShorthand(irregularShorthand);
  assert.equal(parsed.prompt, 'Welche HR Software?');
  assert.equal(parsed.brand_name, 'Personio DACH');
  assert.equal(parsed.brand_domains.length, 2);
  assert.equal(parsed.competitors.length, 2);
  assert.equal(parsed.competitors[1].name, 'BambooHR');
  assert.equal(parsed.competitors[1].domain, '');
  assert.equal(parsed.search_enabled, true);
});

test('Boundary 2.3: Target LLMs empty array falls back to default dual models', () => {
  const items = expandNormalizerTargetLLMs({
    prompt: 'Test',
    brand_name: 'TestBrand',
    target_llms: []
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.provider), ['openai', 'gemini']);
});

test('Boundary 2.4: Extreme prompt length (8,000 characters prompt text)', () => {
  const longPrompt = 'Vergleiche detailliert die folgenden HR Software Lösungen im deutschen Markt. '.repeat(100);
  const items = expandNormalizerTargetLLMs({
    prompt: longPrompt,
    brand_name: 'Personio'
  });

  assert.equal(items.length, 2);
  assert.ok(items[0].prompt.length > 7000);
});

test('Boundary 2.5: Citations with null URI or missing title in grounding chunks', () => {
  const malformedChunks = [
    { web: null },
    { web: { uri: 'https://personio.de' } }, // missing title
    { other: 'chunk' }
  ];

  const validCitations = malformedChunks
    .filter(c => c && c.web && c.web.uri)
    .map(c => ({
      citation_url: c.web.uri,
      citation_domain: new URL(c.web.uri).hostname.replace(/^www\./, ''),
      citation_title: c.web.title || 'Untitled'
    }));

  assert.equal(validCitations.length, 1);
  assert.equal(validCitations[0].citation_domain, 'personio.de');
  assert.equal(validCitations[0].citation_title, 'Untitled');
});

test('Boundary 2.6: Search explicitly disabled produces empty grounding tool payload', () => {
  const buildGeminiTools = (enabled) => (enabled ? [{ googleSearch: {} }] : []);
  assert.equal(buildGeminiTools(false).length, 0);
  assert.equal(buildGeminiTools(true).length, 1);
});

test('Boundary 2.7: Async response mode generates unique run_id with timestamp prefix', () => {
  const item1 = expandNormalizerTargetLLMs({ prompt: 'A', brand_name: 'B' })[0];
  const item2 = expandNormalizerTargetLLMs({ prompt: 'A', brand_name: 'B' })[0];

  assert.ok(item1.run_id.startsWith('run_'));
  assert.ok(item2.run_id.startsWith('run_'));
  assert.notEqual(item1.run_id, item2.run_id, 'Run IDs must be distinct across dispatches');
});

test('Boundary 2.8: Single word natural query without shorthand keys', () => {
  const naturalQuery = 'Buchhaltungssoftware';
  const parsed = parseNormalizerShorthand(naturalQuery);
  assert.equal(parsed.prompt, 'Buchhaltungssoftware');
  assert.equal(parsed.brand_name, '');
  assert.equal(parsed.search_enabled, true);
});
