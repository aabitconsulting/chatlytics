/**
 * tests/helpers/assertions.js
 * Domain-specific assertions and contract validators for Chatlytics.de.
 */

'use strict';

const assert = require('node:assert/strict');

const VALID_MECE_STATES = [
  '1_DIRECT_WIN',
  '2_BRAND_HALO',
  '3_COMPETITOR_TAKEOVER',
  '4_GENERIC'
];

const VALID_GEO_QUADRANTS = [
  '1_CITATION_HIJACK',
  '2_PARAMETRIC_BLINDSPOT',
  '3_BRAND_HALO_TRAP',
  '4_BURIED_WINNER',
  'NONE'
];

function assertValidMECE(category, msg = 'Invalid MECE category') {
  assert.ok(
    VALID_MECE_STATES.includes(category),
    `${msg}: Received "${category}", expected one of ${JSON.stringify(VALID_MECE_STATES)}`
  );
}

function assertValidGEODiagnostic(quadrant, msg = 'Invalid GEO quadrant') {
  assert.ok(
    VALID_GEO_QUADRANTS.includes(quadrant),
    `${msg}: Received "${quadrant}", expected one of ${JSON.stringify(VALID_GEO_QUADRANTS)}`
  );
}

function assertValidIngestPayload(payload) {
  assert.ok(payload && typeof payload === 'object', 'Payload must be an object');
  assert.ok(payload.config_id !== undefined, 'config_id is required');
  assert.ok(typeof payload.prompt === 'string' && payload.prompt.length > 0, 'prompt must be non-empty string');
  assert.ok(typeof payload.provider === 'string', 'provider must be a string');
  assert.ok(typeof payload.model === 'string', 'model must be a string');
  assert.ok(typeof payload.total_chars === 'number' && payload.total_chars >= 0, 'total_chars must be non-negative number');
  assert.ok(typeof payload.total_words === 'number' && payload.total_words >= 0, 'total_words must be non-negative number');

  assertValidMECE(payload.mece_category);
  assertValidGEODiagnostic(payload.geo_quadrant);

  assert.ok(Array.isArray(payload.competitors), 'competitors must be an array');
  assert.ok(Array.isArray(payload.citations), 'citations must be an array');

  for (const comp of payload.competitors) {
    assert.ok(comp.competitor_name || comp.name, 'competitor must have a name');
    assert.ok(comp.mentioned !== undefined || comp.is_mentioned !== undefined, 'competitor mention status required');
  }

  for (const cit of payload.citations) {
    assert.ok(cit.domain || cit.citation_domain, 'citation domain is required');
  }
}

function assertValidQueueResponse(res) {
  assert.ok(res && typeof res === 'object', 'Queue response must be an object');
  assert.equal(res.status, 'success', 'Queue response status must be success');
  assert.ok(Array.isArray(res.jobs), 'Queue response must contain jobs array');
  for (const job of res.jobs) {
    assert.ok(job.config_id, 'Job must have config_id');
    assert.ok(job.brand_name, 'Job must have brand_name');
    assert.ok(job.prompt, 'Job must have prompt');
    assert.ok(Array.isArray(job.competitors), 'Job competitors must be array');
    assert.ok(Array.isArray(job.target_llms), 'Job target_llms must be array');
  }
}

function assertNumericBounds(val, min, max, label = 'Value') {
  assert.ok(typeof val === 'number', `${label} must be a number`);
  assert.ok(val >= min && val <= max, `${label} ${val} out of bounds [${min}, ${max}]`);
}

function assertValidISODate(dateStr, label = 'Date') {
  assert.ok(typeof dateStr === 'string', `${label} must be a string`);
  const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/;
  assert.ok(regex.test(dateStr), `${label} "${dateStr}" is not a valid ISO 8601 timestamp`);
}

module.exports = {
  VALID_MECE_STATES,
  VALID_GEO_QUADRANTS,
  assertValidMECE,
  assertValidGEODiagnostic,
  assertValidIngestPayload,
  assertValidQueueResponse,
  assertNumericBounds,
  assertValidISODate
};
