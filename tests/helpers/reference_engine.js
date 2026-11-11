/**
 * tests/helpers/reference_engine.js
 * Authoritative Canonical Reference Engine & Specification Oracle for Chatlytics.de.
 * Implements the mathematical formulas, Unicode case-folding, MECE state machine,
 * 4-Quadrant GEO diagnostics, normalizer, and contract validators.
 */

'use strict';

/**
 * Normalizes text to Unicode NFC and folds German characters.
 * Tier 1: de-DE locale lowercasing.
 * Tier 2: Transliteration folding (ä->ae, ö->oe, ü->ue, ß->ss, ẞ->ss).
 */
function foldGerman(str) {
  if (!str) return '';
  return str.normalize('NFC')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\u1e9e/g, 'ss');
}

/**
 * Character count matching UTF-16 code units (and MySQL CHAR_LENGTH).
 */
function calculateCharacterCount(text) {
  return typeof text === 'string' ? text.length : 0;
}

/**
 * Word count divided by Unicode whitespace.
 */
function calculateWordCount(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Searches for a brand or entity in text with German Unicode case-folding.
 * Returns 0-based character earliness, 1-based word earliness, relative position %,
 * and match metadata.
 */
function findBrandUnicode(text, brand) {
  if (!text || !brand || typeof text !== 'string' || typeof brand !== 'string') {
    return {
      found: false,
      charIndex: null,
      wordIndex: null,
      relativePosPct: null,
      matchType: 'none'
    };
  }

  const normText = text.normalize('NFC');
  const normBrand = brand.normalize('NFC');

  // Tier 1: Direct case-insensitive search in German locale
  const lowerText = normText.toLocaleLowerCase('de-DE');
  const lowerBrand = normBrand.toLocaleLowerCase('de-DE');
  let charIdx = lowerText.indexOf(lowerBrand);
  let matchType = 'unicode_case_fold';

  // Tier 2: Transliteration search if not found directly
  if (charIdx === -1) {
    const foldedText = foldGerman(normText);
    const foldedBrand = foldGerman(normBrand);
    const foldedIdx = foldedText.indexOf(foldedBrand);
    if (foldedIdx !== -1) {
      charIdx = foldedIdx;
      matchType = 'german_transliterated';
    }
  }

  if (charIdx === -1) {
    return {
      found: false,
      charIndex: null,
      wordIndex: null,
      relativePosPct: null,
      matchType: 'none'
    };
  }

  // 1-based word earliness
  const prefix = normText.substring(0, charIdx).trim();
  const wordIdx = prefix === '' ? 1 : prefix.split(/\s+/).length + 1;

  // Relative position percentage
  const totalChars = calculateCharacterCount(normText);
  const relativePosPct = totalChars > 0
    ? Number(((charIdx / totalChars) * 100).toFixed(2))
    : 0.00;

  return {
    found: true,
    charIndex: charIdx,
    wordIndex: wordIdx,
    relativePosPct,
    matchType
  };
}

/**
 * Classifies model response into strict MECE partition.
 * 1_DIRECT_WIN: Brand recommended (#1 / leads or sole mention).
 * 2_BRAND_HALO: Brand mentioned secondarily alongside leading competitor.
 * 3_COMPETITOR_TAKEOVER: Competitor present, brand omitted.
 * 4_GENERIC: Neither brand nor competitor present.
 */
function classifyMECE(hasBrand, hasCompetitors, brandEarliness, minCompetitorEarliness) {
  if (!hasBrand && !hasCompetitors) {
    return '4_GENERIC';
  }
  if (!hasBrand && hasCompetitors) {
    return '3_COMPETITOR_TAKEOVER';
  }
  if (hasBrand && !hasCompetitors) {
    return '1_DIRECT_WIN';
  }
  if (hasBrand && hasCompetitors) {
    if (brandEarliness !== null && minCompetitorEarliness !== null) {
      if (brandEarliness <= minCompetitorEarliness) {
        return '1_DIRECT_WIN';
      }
    }
    return '2_BRAND_HALO';
  }
  return '4_GENERIC';
}

/**
 * Evaluates the 4-Quadrant GEO Diagnostics.
 * 1_CITATION_HIJACK: Brand in text, not cited in grounding, but citations exist or competitor cited.
 * 2_PARAMETRIC_BLINDSPOT: Brand cited in grounding, but brand omitted from synthesis text.
 * 3_BRAND_HALO_TRAP: Brand and competitor in text, brand in halo position (not #1).
 * 4_BURIED_WINNER: Brand in text, brand cited, but relative position > 50%.
 * NONE: Clean win or generic.
 */
function evaluateGEODiagnostic(params) {
  const {
    brandInText = false,
    brandDomainCited = false,
    competitorInText = false,
    competitorDomainCited = false,
    meceCategory = '4_GENERIC',
    brandRelativePos = null,
    minCompetitorPos = null,
    citationsCount = 0
  } = params;

  // 1. Citation Hijack
  if (brandInText && !brandDomainCited && (citationsCount > 0 || competitorDomainCited)) {
    return '1_CITATION_HIJACK';
  }

  // 2. Parametric Blindspot
  if (brandDomainCited && !brandInText) {
    return '2_PARAMETRIC_BLINDSPOT';
  }

  // 4. Buried Winner (Brand wins text and citations, but appears past 50%)
  if (brandInText && brandDomainCited && brandRelativePos !== null && brandRelativePos > 50.0) {
    return '4_BURIED_WINNER';
  }

  // 3. Brand Halo Trap (Brand is present but trapped behind competitor)
  if (brandInText && competitorInText) {
    if (meceCategory === '2_BRAND_HALO' || (brandRelativePos !== null && minCompetitorPos !== null && brandRelativePos > minCompetitorPos)) {
      return '3_BRAND_HALO_TRAP';
    }
  }

  return 'NONE';
}

/**
 * Complete metrics calculation engine.
 */
function calculateMetrics(text, brandName, brandDomains = [], competitors = [], citations = []) {
  const safeBrandDomains = Array.isArray(brandDomains) ? brandDomains : [];
  const safeCompetitors = Array.isArray(competitors) ? competitors : [];
  const safeCitations = Array.isArray(citations) ? citations : [];

  const totalChars = calculateCharacterCount(text);
  const totalWords = calculateWordCount(text);

  const brandMatch = findBrandUnicode(text, brandName);

  // Check if brand domain is cited
  const normBrandDomains = safeBrandDomains.map(d => (d || '').toLowerCase());
  const brandDomainCited = safeCitations.some(c => {
    const domain = (c.citation_domain || c.domain || '').toLowerCase();
    return normBrandDomains.some(bd => domain === bd || domain.endsWith('.' + bd));
  });

  // Evaluate competitors
  let minCompCharEarliness = null;
  let minCompWordEarliness = null;
  let minCompRelativePos = null;
  let anyCompetitorMentioned = false;
  let anyCompetitorCited = false;

  const competitorResults = safeCompetitors.map(comp => {
    const name = typeof comp === 'string' ? comp : comp.name;
    const domain = (typeof comp === 'object' && comp.domain ? comp.domain : '').toLowerCase();
    const match = findBrandUnicode(text, name);

    const isCited = safeCitations.some(c => {
      const cDomain = (c.citation_domain || c.domain || '').toLowerCase();
      return domain && (cDomain === domain || cDomain.endsWith('.' + domain) || domain.endsWith('.' + cDomain));
    });

    if (match.found) {
      anyCompetitorMentioned = true;
      if (minCompCharEarliness === null || match.charIndex < minCompCharEarliness) {
        minCompCharEarliness = match.charIndex;
        minCompWordEarliness = match.wordIndex;
        minCompRelativePos = match.relativePosPct;
      }
    }
    if (isCited) anyCompetitorCited = true;

    return {
      competitor_name: name,
      competitor_domain: domain,
      mentioned: match.found ? 1 : 0,
      is_mentioned: match.found ? 1 : 0,
      char_earliness: match.charIndex,
      word_earliness: match.wordIndex,
      relative_position_pct: match.relativePosPct,
      is_cited: isCited ? 1 : 0
    };
  });

  const meceCategory = classifyMECE(
    brandMatch.found,
    anyCompetitorMentioned,
    brandMatch.charIndex,
    minCompCharEarliness
  );

  const geoQuadrant = evaluateGEODiagnostic({
    brandInText: brandMatch.found,
    brandDomainCited,
    competitorInText: anyCompetitorMentioned,
    competitorDomainCited: anyCompetitorCited,
    meceCategory,
    brandRelativePos: brandMatch.relativePosPct,
    minCompetitorPos: minCompRelativePos,
    citationsCount: citations.length
  });

  return {
    character_count: totalChars,
    word_count: totalWords,
    total_chars: totalChars,
    total_words: totalWords,
    brand_mentioned: brandMatch.found ? 1 : 0,
    brand_earliness_char: brandMatch.charIndex,
    brand_earliness_word: brandMatch.wordIndex,
    brand_relative_pos: brandMatch.relativePosPct,
    char_earliness: brandMatch.charIndex,
    word_earliness: brandMatch.wordIndex,
    relative_position_pct: brandMatch.relativePosPct,
    brand_domain_cited: brandDomainCited ? 1 : 0,
    brand_cited: brandDomainCited ? 1 : 0,
    has_citations: citations.length > 0 ? 1 : 0,
    competitor_cited: anyCompetitorCited ? 1 : 0,
    mece_category: meceCategory,
    geo_quadrant: geoQuadrant,
    competitors: competitorResults,
    citations: safeCitations.map((c, idx) => {
      const cDomain = (c.citation_domain || c.domain || '').toLowerCase();
      const isBrand = normBrandDomains.some(bd => cDomain === bd || cDomain.endsWith('.' + bd));
      return {
        citation_index: idx + 1,
        citation_url: c.citation_url || c.url || '',
        citation_domain: c.citation_domain || c.domain || '',
        domain: c.citation_domain || c.domain || '',
        citation_title: c.citation_title || c.title || '',
        title: c.citation_title || c.title || '',
        is_brand_domain: isBrand ? 1 : 0
      };
    })
  };
}

/**
 * Universal Normalizer Shorthand Parser
 */
function parseNormalizerShorthand(text) {
  const result = {
    prompt: '',
    brand_name: '',
    brand_domains: [],
    competitors: [],
    target_llms: ['openai', 'gemini'],
    search_enabled: true
  };
  if (!text || typeof text !== 'string') return result;

  const lines = text.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      if (!result.prompt && line.trim()) result.prompt = line.trim();
      continue;
    }
    const key = line.slice(0, colonIdx).trim().toUpperCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key === 'PROMPT') result.prompt = val;
    else if (key === 'BRAND') result.brand_name = val;
    else if (key === 'DOMAINS') result.brand_domains = val.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    else if (key === 'COMPETITORS') {
      result.competitors = val.split(',').map(c => {
        const match = c.match(/^(.*?)(?:\s*\((.*?)\))?$/);
        return {
          name: match ? match[1].trim() : c.trim(),
          domain: match && match[2] ? match[2].trim().toLowerCase() : ''
        };
      }).filter(c => c.name);
    } else if (key === 'LLMS') {
      result.target_llms = val.split(',').map(l => l.trim().toLowerCase()).filter(Boolean);
    } else if (key === 'SEARCH') {
      result.search_enabled = val.toLowerCase() === 'true' || val === '1';
    }
  }
  return result;
}

/**
 * Universal Normalizer Item Expander
 */
function expandNormalizerTargetLLMs(input, triggerSource = 'webhook') {
  const prompt = (input.prompt || '').trim();
  const brandName = (input.brand_name || '').trim();
  const brandDomains = Array.isArray(input.brand_domains) ? input.brand_domains : [];
  const competitors = Array.isArray(input.competitors) ? input.competitors : [];
  const searchEnabled = input.search_enabled !== undefined ? Boolean(input.search_enabled) : true;
  const targetLLMs = Array.isArray(input.target_llms) && input.target_llms.length > 0 ? input.target_llms : ['openai', 'gemini'];
  const responseMode = input.response_mode || (triggerSource === 'chat' ? 'sync' : (triggerSource === 'webhook' ? 'sync' : 'async'));
  const configId = input.config_id || null;
  const runId = input.run_id || ('run_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));

  return targetLLMs.map(provider => {
    let model = 'gpt-4o';
    if (provider === 'anthropic') model = 'claude-3-5-sonnet-20241022';
    if (provider === 'gemini') model = 'gemini-1.5-flash';

    return {
      run_id: runId,
      config_id: configId,
      trigger_source: triggerSource,
      response_mode: responseMode,
      prompt,
      brand_name: brandName,
      brand_domains: brandDomains,
      competitors: competitors.map(c => typeof c === 'string' ? { name: c, domain: '' } : c),
      provider,
      model,
      search_enabled: searchEnabled,
      locale: input.locale || 'de-DE',
      created_at: new Date().toISOString()
    };
  });
}

/**
 * Freemium corporate work-email validator
 */
function validateWorkEmail(email) {
  if (!email || typeof email !== 'string') return { valid: false, reason: 'empty' };
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' };
  }
  const domain = parts[1];
  const disallowed = [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com',
    'outlook.com', 'live.com', 'icloud.com', 'gmx.de', 'gmx.net', 'web.de',
    't-online.de', 'freenet.de', 'mail.ru', 'protonmail.com', 'proton.me',
    'yandex.com', '10minutemail.com', 'tempmail.com', 'guerrillamail.com',
    'mailinator.com', 'trashmail.com'
  ];
  if (disallowed.includes(domain)) {
    return { valid: false, reason: 'disallowed_freemail', domain };
  }
  return { valid: true, domain };
}

module.exports = {
  foldGerman,
  calculateCharacterCount,
  calculateWordCount,
  findBrandUnicode,
  classifyMECE,
  evaluateGEODiagnostic,
  calculateMetrics,
  parseNormalizerShorthand,
  expandNormalizerTargetLLMs,
  validateWorkEmail
};
