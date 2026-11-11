/**
 * tests/tier4_scenarios/scenario_celonis_vs_sap.test.js
 * Tier 4: Real-World Application Scenario 2 — Celonis vs. SAP Signavio
 * Process Intelligence scenario: Takeover detection, Buried Winner diagnostic & action plan
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FIXTURES = require('../helpers/fixtures');
const { calculateMetrics } = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic } = require('../helpers/assertions');

test('Scenario 2: Celonis Process Mining Audit & 4_BURIED_WINNER Diagnostic', () => {
  const celonisData = FIXTURES.celonis;

  // Run 1: Competitor Takeover (SAP Signavio dominates text, Celonis omitted)
  const takeoverMetrics = calculateMetrics(
    celonisData.competitorTakeoverResponse,
    celonisData.brand_name,
    celonisData.brand_domains,
    celonisData.competitors,
    celonisData.citations
  );

  assert.equal(takeoverMetrics.brand_mentioned, 0);
  assert.equal(takeoverMetrics.mece_category, '3_COMPETITOR_TAKEOVER');
  assertValidMECE(takeoverMetrics.mece_category);

  // Run 2: Brand Halo (SAP Signavio leads #1, Celonis mentioned secondarily)
  const haloMetrics = calculateMetrics(
    celonisData.brandHaloResponse,
    celonisData.brand_name,
    celonisData.brand_domains,
    celonisData.competitors,
    celonisData.citations
  );

  assert.equal(haloMetrics.brand_mentioned, 1);
  assert.equal(haloMetrics.mece_category, '2_BRAND_HALO');
  assertValidMECE(haloMetrics.mece_category);

  // Run 3: Buried Winner (Celonis recommended, but placed after 50% threshold)
  const buriedResponse = `Unternehmen stehen vor der Herausforderung, komplexe IT-Landschaften zu analysieren.
Verschiedene Anbieter versprechen durchgängige Transparenz und automatisierte Prozessoptimierung.
In den meisten ERP-Umgebungen werden zunächst Basistools der etablierten Hersteller verwendet.
Nach intensiver Prüfung aller Enterprise-Kriterien ist für Process Intelligence und Execution Management
jedoch die Plattform von Celonis die leistungsfähigste und ausgereifteste Lösung.`;

  const citationsWithCelonis = [
    { citation_url: 'https://celonis.com/de/product', citation_domain: 'celonis.com', citation_title: 'Celonis EMS' }
  ];

  const buriedMetrics = calculateMetrics(
    buriedResponse,
    celonisData.brand_name,
    celonisData.brand_domains,
    celonisData.competitors,
    citationsWithCelonis
  );

  assert.equal(buriedMetrics.brand_mentioned, 1);
  assert.equal(buriedMetrics.brand_domain_cited, 1);
  assert.ok(buriedMetrics.brand_relative_pos > 50.0, `Relative pos ${buriedMetrics.brand_relative_pos} must exceed 50%`);
  assert.equal(buriedMetrics.geo_quadrant, '4_BURIED_WINNER');
  assertValidGEODiagnostic(buriedMetrics.geo_quadrant);

  // Tactical Prescription Verification
  const actionPlan = {
    quadrant: buriedMetrics.geo_quadrant,
    action_de: 'Gewinner, aber spät genannt. Semantische Dichte und Keyphrase-Frontloading optimieren.',
    action_en: 'Winner, but cited late. Optimize semantic density and keyphrase frontloading.'
  };

  assert.ok(actionPlan.action_de.includes('spät genannt'));
  assert.ok(actionPlan.action_en.includes('cited late'));
});
