/**
 * tests/tier3_combinations/comb_queue_to_worker.test.js
 * Tier 3: Cross-Feature Combination — Queue Poller -> Worker Pipeline -> Ingestion
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expandNormalizerTargetLLMs, calculateMetrics } = require('../helpers/reference_engine');
const { assertValidIngestPayload } = require('../helpers/assertions');

test('Combination 3.8: Polled queue batch feeds worker expansion and yields valid ingestion items', () => {
  // 1. Simulated response from GET /api/n8n_queue.php
  const queueBatch = {
    status: 'success',
    jobs_count: 2,
    jobs: [
      {
        config_id: 101,
        user_id: 5,
        brand_name: 'Personio',
        brand_domains: ['personio.de'],
        prompt: 'Beste HR Software im Mittelstand',
        competitors: ['Workday', 'SAP'],
        target_llms: ['openai', 'gemini'],
        search_enabled: true
      },
      {
        config_id: 102,
        user_id: 6,
        brand_name: 'Celonis',
        brand_domains: ['celonis.com'],
        prompt: 'Führende Process Mining Tools',
        competitors: ['UiPath'],
        target_llms: ['gemini'],
        search_enabled: true
      }
    ]
  };

  // 2. Worker expands each job into provider tasks
  const allTasks = [];
  for (const job of queueBatch.jobs) {
    const items = expandNormalizerTargetLLMs(job, 'schedule_queue');
    allTasks.push(...items);
  }

  // Job 1 has 2 LLMs (openai, gemini), Job 2 has 1 LLM (gemini) = 3 total tasks
  assert.equal(allTasks.length, 3);
  assert.equal(allTasks[0].trigger_source, 'schedule_queue');
  assert.equal(allTasks[0].brand_name, 'Personio');

  // 3. Worker executes task and generates ingestion payload
  const task = allTasks[0];
  const responseText = 'Für HR im Mittelstand ist Personio die beste Wahl.';
  const metrics = calculateMetrics(responseText, task.brand_name, task.brand_domains, task.competitors);

  const ingestPayload = {
    config_id: task.config_id,
    user_id: 5,
    prompt: task.prompt,
    provider: task.provider,
    model: task.model,
    brand_mentioned: metrics.brand_mentioned,
    brand_prominence_rank: 1,
    char_earliness: metrics.brand_earliness_char,
    word_earliness: metrics.brand_earliness_word,
    relative_position_pct: metrics.brand_relative_pos,
    total_chars: metrics.character_count,
    total_words: metrics.word_count,
    mece_category: metrics.mece_category,
    geo_quadrant: metrics.geo_quadrant,
    has_citations: 0,
    brand_cited: 0,
    competitor_cited: 0,
    raw_response_text: responseText,
    run_duration_ms: 1100,
    competitors: metrics.competitors,
    citations: []
  };

  assertValidIngestPayload(ingestPayload);
  assert.equal(ingestPayload.mece_category, '1_DIRECT_WIN');
});
