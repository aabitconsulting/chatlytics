/**
 * Chatlytics.de — Deterministic Unicode Metric & Classification Engine
 * File: n8n/lib/metrics_engine.js
 * 
 * Pure, deterministic JavaScript for execution in n8n 2.44.5 Code Nodes (V8 isolate)
 * and Node.js (CommonJS / ES) unit tests. Zero external dependencies.
 */

/**
 * Escapes special regex characters in a string.
 * 
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  if (!str) return '';
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes text to Unicode NFC and extracts whitespace-separated words.
 * Returns empty array for empty or whitespace-only strings (no ['']).
 * 
 * @param {string} text
 * @returns {string[]}
 */
function getWords(text) {
  if (text === null || text === undefined || typeof text !== 'string') {
    return [];
  }
  const trimmed = text.normalize('NFC').trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/);
}

/**
 * Counts total words in text.
 * 
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return getWords(text).length;
}

/**
 * Counts total UTF-16 characters in normalized NFC text.
 * 
 * @param {string} text
 * @returns {number}
 */
function countChars(text) {
  if (text === null || text === undefined) return 0;
  const str = typeof text === 'string' ? text : String(text);
  return str.normalize('NFC').length;
}

/**
 * Performs German Unicode lowercase normalization and transliteration (DIN 5007-2).
 * Maps umlauts to ASCII digraphs and sharp S to double-s.
 * 
 * @param {string} str
 * @returns {string}
 */
function normalizeGermanText(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFC')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\u1E9E/g, 'ss');
}

/**
 * Normalizes a URL or domain string into a clean root/hostname string.
 * Strips protocols, www prefixes, ports, and sub-paths.
 * 
 * @param {string} urlOrDomain
 * @returns {string}
 */
function extractDomainFromUrl(urlOrDomain) {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') return '';
  let clean = urlOrDomain.trim();

  // Decode percent-encoded components (%2F -> '/', %3A -> ':', etc.)
  try {
    clean = decodeURIComponent(clean);
  } catch (_) {
    // Resilient fallback for malformed URI byte sequences
    clean = clean
      .replace(/%2f/gi, '/')
      .replace(/%3a/gi, ':')
      .replace(/%40/gi, '@')
      .replace(/%3f/gi, '?')
      .replace(/%23/gi, '#');
  }

  clean = clean.toLowerCase();
  clean = clean.replace(/^https?:\/\//i, '');

  // Strip userinfo (e.g. user:pass@host)
  const atIdx = clean.indexOf('@');
  const firstSlash = clean.indexOf('/');
  if (atIdx !== -1 && (firstSlash === -1 || atIdx < firstSlash)) {
    clean = clean.slice(atIdx + 1);
  }

  clean = clean.replace(/^www\./i, '');

  const slashIdx = clean.indexOf('/');
  if (slashIdx !== -1) clean = clean.slice(0, slashIdx);

  const colonIdx = clean.indexOf(':');
  if (colonIdx !== -1) clean = clean.slice(0, colonIdx);

  const queryIdx = clean.indexOf('?');
  if (queryIdx !== -1) clean = clean.slice(0, queryIdx);

  const hashIdx = clean.indexOf('#');
  if (hashIdx !== -1) clean = clean.slice(0, hashIdx);

  return clean.trim();
}

/**
 * Checks whether a candidate domain matches any registered domain (including subdomains).
 * 
 * @param {string} candidateDomain
 * @param {string[]|string} registeredDomains
 * @returns {boolean}
 */
function matchesDomain(candidateDomain, registeredDomains) {
  if (!candidateDomain || !registeredDomains) return false;
  const regList = Array.isArray(registeredDomains) ? registeredDomains : [registeredDomains];
  if (regList.length === 0) return false;

  const cleanCandidate = extractDomainFromUrl(String(candidateDomain));
  if (!cleanCandidate) return false;

  return regList.some(reg => {
    if (!reg) return false;
    const cleanReg = extractDomainFromUrl(String(reg));
    if (!cleanReg) return false;
    return cleanCandidate === cleanReg || cleanCandidate.endsWith('.' + cleanReg);
  });
}

/**
 * Compiles a Unicode-aware regular expression with German transliteration alternations
 * and Unicode letter/number lookaround boundaries.
 * 
 * This prevents whole-text index shifting and accurately matches German umlauts,
 * capital sharp S (ẞ / U+1E9E), standard sharp S (ß), and ASCII digraphs (ae, oe, ue, ss).
 * 
 * @param {string} entityName
 * @returns {RegExp|null}
 */
function buildGermanRegex(entityName) {
  if (!entityName || typeof entityName !== 'string') return null;
  const norm = entityName.normalize('NFC').trim();
  if (!norm) return null;

  const wordTokens = norm.split(/\s+/);
  const wordPatterns = wordTokens.map(w => {
    const tokenized = w
      .replace(/ae|ä/gi, '@@AE@@')
      .replace(/oe|ö/gi, '@@OE@@')
      .replace(/ue|ü/gi, '@@UE@@')
      .replace(/ss|ß|\u1E9E/gi, '@@SS@@');

    const escaped = escapeRegex(tokenized);
    return escaped
      .replace(/@@AE@@/g, '(?:[äÄ]|ae)')
      .replace(/@@OE@@/g, '(?:[öÖ]|oe)')
      .replace(/@@UE@@/g, '(?:[üÜ]|ue)')
      .replace(/@@SS@@/g, '(?:[ß\u1E9E]|ss)');
  });

  const fullPattern = wordPatterns.join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${fullPattern}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Locates an entity within text using tiered resolution:
 * Tier 1: German Unicode transliteration regex with lookaround boundaries.
 * Tier 2: Domain text fallback if registered domains are provided.
 * 
 * @param {string} text
 * @param {string} entityName
 * @param {string[]} [domains=[]]
 * @returns {{ found: boolean, charIndex: number|null, wordIndex: number|null, matchType: string, matchedText: string|null }}
 */
function findBrandUnicode(text, entityName, domains = []) {
  if (text === null || text === undefined || !entityName) {
    return { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  }

  const rawText = typeof text === 'string' ? text : String(text);
  const normText = rawText.normalize('NFC');
  const target = typeof entityName === 'string' ? entityName.normalize('NFC').trim() : String(entityName).trim();
  if (!target) {
    return { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  }

  const regex = buildGermanRegex(target);
  if (regex) {
    const match = regex.exec(normText);
    if (match) {
      const charIndex = match.index;
      const prefix = normText.slice(0, charIndex);
      const endsWithWhitespace = /\s$/.test(prefix);
      const wordIndex = (!prefix || endsWithWhitespace)
        ? getWords(prefix).length + 1
        : Math.max(1, getWords(prefix).length);
      const matchedText = match[0];
      const isExact = matchedText.normalize('NFC').toLocaleLowerCase('de-DE') === target.toLocaleLowerCase('de-DE');
      return {
        found: true,
        charIndex,
        wordIndex,
        matchType: isExact ? 'unicode_exact' : 'german_transliterated',
        matchedText
      };
    }
  }

  // Tier 2: Domain mention fallback in text
  const domList = Array.isArray(domains) ? domains : (domains ? [domains] : []);
  for (const d of domList) {
    if (!d) continue;
    const cleanDom = extractDomainFromUrl(String(d));
    if (!cleanDom) continue;
    const domRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(cleanDom)}(?![\\p{L}\\p{N}])`, 'iu');
    const dm = domRegex.exec(normText);
    if (dm) {
      const charIndex = dm.index;
      const prefix = normText.slice(0, charIndex);
      const endsWithWhitespace = /\s$/.test(prefix);
      const wordIndex = (!prefix || endsWithWhitespace)
        ? getWords(prefix).length + 1
        : Math.max(1, getWords(prefix).length);
      return {
        found: true,
        charIndex,
        wordIndex,
        matchType: 'domain_mention',
        matchedText: dm[0]
      };
    }
  }

  return { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
}

/**
 * Classifies evaluation results into strict 4-state MECE categories.
 * 
 * Supports both positional invocation:
 *   classifyMECE(brandMentioned, competitorsMentioned, brandEarliness, minCompetitorEarliness, brandSentiment)
 * and single options object:
 *   classifyMECE({ brandMentioned, competitorsMentioned, brandEarliness, minCompetitorEarliness, brandSentiment })
 * 
 * @param {boolean|object} arg1
 * @param {boolean} [argCompetitorsMentioned]
 * @param {number|null} [argBrandEarliness]
 * @param {number|null} [argMinCompetitorEarliness]
 * @param {string} [argBrandSentiment='neutral']
 * @returns {'1_DIRECT_WIN'|'2_BRAND_HALO'|'3_COMPETITOR_TAKEOVER'|'4_GENERIC'}
 */
function classifyMECE(arg1, argCompetitorsMentioned, argBrandEarliness, argMinCompetitorEarliness, argBrandSentiment) {
  let brandMentioned = false;
  let competitorsMentioned = false;
  let brandEarliness = null;
  let minCompetitorEarliness = null;
  let brandSentiment = 'neutral';

  if (arg1 && typeof arg1 === 'object') {
    brandMentioned = Boolean(arg1.brandMentioned || arg1.brand_mentioned);
    competitorsMentioned = Boolean(arg1.competitorsMentioned || arg1.competitorFound || arg1.competitors_mentioned);
    brandEarliness = arg1.brandEarliness !== undefined ? arg1.brandEarliness : (arg1.brand_earliness !== undefined ? arg1.brand_earliness : null);
    minCompetitorEarliness = arg1.minCompetitorEarliness !== undefined ? arg1.minCompetitorEarliness : (arg1.min_competitor_earliness !== undefined ? arg1.min_competitor_earliness : null);
    brandSentiment = arg1.brandSentiment || arg1.brand_sentiment || 'neutral';
  } else {
    brandMentioned = Boolean(arg1);
    competitorsMentioned = Boolean(argCompetitorsMentioned);
    brandEarliness = argBrandEarliness !== undefined ? argBrandEarliness : null;
    minCompetitorEarliness = argMinCompetitorEarliness !== undefined ? argMinCompetitorEarliness : null;
    brandSentiment = argBrandSentiment || 'neutral';
  }

  const isNegative = String(brandSentiment).toLowerCase() === 'negative';

  // Branch 1: Neither brand nor competitor present
  if (!brandMentioned && !competitorsMentioned) {
    return '4_GENERIC';
  }

  // Branch 2: Competitor present, brand omitted
  if (!brandMentioned && competitorsMentioned) {
    return '3_COMPETITOR_TAKEOVER';
  }

  // Branch 3: Brand present, no competitors present
  if (brandMentioned && !competitorsMentioned) {
    if (isNegative) return '4_GENERIC';
    return '1_DIRECT_WIN';
  }

  // Branch 4: Both brand and at least one competitor present
  if (isNegative) {
    return '3_COMPETITOR_TAKEOVER';
  }

  if (
    brandEarliness !== null &&
    minCompetitorEarliness !== null &&
    brandEarliness <= minCompetitorEarliness
  ) {
    return '1_DIRECT_WIN';
  }

  return '2_BRAND_HALO';
}

/**
 * Diagnoses Generative Engine Optimization (GEO) 4-Quadrant state.
 * 
 * States:
 * - 1_CITATION_HIJACK: Brand mentioned in text but not cited, while citations exist; or brand cited but competitor recommended.
 * - 2_PARAMETRIC_BLINDSPOT: Brand domain cited but brand omitted from text; or competitor recommended with zero citations.
 * - 3_BRAND_HALO_TRAP: Brand mentioned in secondary halo position behind competitor without citation dominance.
 * - 4_BURIED_WINNER: Brand recommended #1, but buried late (>50% relative position or word earliness > 50).
 * - NONE: Clean direct win with early mention and citation authority, or generic overview.
 * 
 * @param {object} params
 * @returns {'1_CITATION_HIJACK'|'2_PARAMETRIC_BLINDSPOT'|'3_BRAND_HALO_TRAP'|'4_BURIED_WINNER'|'NONE'}
 */
function evaluateGeoQuadrant({
  brandMentioned,
  brandInText,
  brandRecommended,
  competitorRecommended,
  competitorInText,
  brandDomainCited,
  brandCited,
  competitorCited,
  competitorDomainCited,
  citationsCount,
  hasCitations,
  relativePositionPct,
  brandRelativePos,
  wordEarliness,
  brandEarlinessWord,
  minCompetitorPos,
  meceCategory
} = {}) {
  const isBrandMentioned = Boolean(brandMentioned ?? brandInText);
  const isBrandRecommended = Boolean(brandRecommended || meceCategory === '1_DIRECT_WIN');
  const isCompetitorRecommended = Boolean(competitorRecommended || meceCategory === '3_COMPETITOR_TAKEOVER');
  const isBrandCited = Boolean(brandDomainCited ?? brandCited);
  const totalCitations = typeof citationsCount === 'number' ? citationsCount : (hasCitations ? 1 : 0);
  const anyCitations = totalCitations > 0;
  const relPos = relativePositionPct !== undefined ? relativePositionPct : (brandRelativePos !== undefined ? brandRelativePos : null);
  const wordEarly = wordEarliness !== undefined ? wordEarliness : (brandEarlinessWord !== undefined ? brandEarlinessWord : null);

  // Quadrant 4: Buried Winner (Brand won, but appears in bottom half / late)
  if (isBrandRecommended && ((relPos !== null && relPos > 50.0) || (wordEarly !== null && wordEarly > 50))) {
    return '4_BURIED_WINNER';
  }

  // Quadrant 1: Citation Hijack
  // Case A: Brand domain cited in grounding, but competitor is recommended in text
  if (isBrandCited && isCompetitorRecommended && !isBrandRecommended) {
    return '1_CITATION_HIJACK';
  }

  // Quadrant 3: Brand Halo Trap
  // Brand trapped behind competitor in halo position (2_BRAND_HALO)
  // Evaluated BEFORE Citation Hijack Case B and Parametric Blindspot Case B so that Brand Halo
  // evaluates consistently regardless of whether grounding citations exist.
  if (isBrandMentioned && (meceCategory === '2_BRAND_HALO' || (minCompetitorPos !== null && relPos !== null && relPos > minCompetitorPos))) {
    return '3_BRAND_HALO_TRAP';
  }

  // Quadrant 1: Citation Hijack
  // Case B: Brand mentioned in text, but brand domain not cited while external citations exist
  if (isBrandMentioned && !isBrandCited && anyCitations) {
    return '1_CITATION_HIJACK';
  }

  // Quadrant 2: Parametric Blindspot
  // Case A: Brand domain cited in grounding, but brand completely omitted from synthesized text
  if (isBrandCited && !isBrandMentioned) {
    return '2_PARAMETRIC_BLINDSPOT';
  }

  // Case B: Competitor recommended without any grounding citations when brand is omitted from text
  if (isCompetitorRecommended && !isBrandMentioned && !anyCitations) {
    return '2_PARAMETRIC_BLINDSPOT';
  }

  return 'NONE';
}

/**
 * Master calculation engine: processes LLM response text, brand config,
 * competitors, and grounding citations to produce standardized metrics.
 * 
 * Supports both positional parameters:
 *   calculateMetrics(text, brandName, brandDomains, competitors, citations, options)
 * and single options object:
 *   calculateMetrics({ text, brandName, brandDomains, competitors, citations, options })
 * 
 * @param {string|object} arg1 - Raw text or options object
 * @param {string} [argBrandName]
 * @param {string[]} [argBrandDomains]
 * @param {Array<string|object>} [argCompetitors]
 * @param {Array<string|object>} [argCitations]
 * @param {object} [argOptions]
 * @returns {object} Standardized Chatlytics metrics payload
 */
function calculateMetrics(arg1, argBrandName, argBrandDomains, argCompetitors, argCitations, argOptions) {
  let text = '';
  let brandName = '';
  let brandDomains = [];
  let competitors = [];
  let citations = [];
  let runOptions = {};

  if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
    text = arg1.text || arg1.raw_response || arg1.response_text || '';
    brandName = arg1.brandName || arg1.brand_name || '';
    brandDomains = arg1.brandDomains || arg1.brand_domains || [];
    competitors = arg1.competitors || [];
    citations = arg1.citations || [];
    runOptions = arg1.options || {};
  } else {
    text = arg1 != null ? (typeof arg1 === 'string' ? arg1 : String(arg1)) : '';
    brandName = argBrandName || '';
    brandDomains = argBrandDomains || [];
    competitors = argCompetitors || [];
    citations = argCitations || [];
    runOptions = argOptions || {};
  }

  const rawText = text != null ? (typeof text === 'string' ? text : String(text)) : '';
  const normText = rawText.normalize('NFC');
  const totalChars = normText.length;
  const words = getWords(normText);
  const totalWords = words.length;

  const targetBrand = brandName != null && typeof brandName === 'string' ? brandName.normalize('NFC').trim() : (brandName ? String(brandName).trim() : '');

  const normBrandDomains = (Array.isArray(brandDomains) ? brandDomains : (brandDomains ? [brandDomains] : []))
    .map(d => extractDomainFromUrl(String(d)))
    .filter(d => d.length > 0);

  // Normalize competitors
  const normCompetitors = (Array.isArray(competitors) ? competitors : []).map(c => {
    if (typeof c === 'string') {
      return { name: c.trim(), domains: [] };
    }
    if (c && typeof c === 'object') {
      const name = (c.name || c.competitor_name || '').trim();
      const doms = [];
      if (c.domain || c.competitor_domain) doms.push(extractDomainFromUrl(c.domain || c.competitor_domain));
      if (Array.isArray(c.domains)) doms.push(...c.domains.map(extractDomainFromUrl));
      return { name, domains: doms.filter(d => d.length > 0) };
    }
    return { name: '', domains: [] };
  }).filter(c => c.name.length > 0);

  // Normalize citations (with null guard and percent-decoding resilience)
  let brandDomainCited = false;
  let competitorDomainCited = false;

  const rawCitationsList = Array.isArray(citations) ? citations : (citations && typeof citations === 'object' ? [citations] : []);
  const safeCitations = rawCitationsList.filter(cit => cit !== null && cit !== undefined && (typeof cit === 'string' || typeof cit === 'object'));

  const normCitations = safeCitations.map((cit, idx) => {
    const isString = typeof cit === 'string';
    const isObj = cit !== null && typeof cit === 'object';
    const rawUrl = isString ? cit : (isObj ? (cit.citation_url || cit.url || '') : '');
    let rawDomain = isString
      ? extractDomainFromUrl(cit)
      : (isObj ? (cit.citation_domain || cit.domain || extractDomainFromUrl(rawUrl)) : extractDomainFromUrl(rawUrl));
    rawDomain = extractDomainFromUrl(rawDomain);
    const title = (isObj && (cit.citation_title || cit.title)) ? String(cit.citation_title || cit.title) : '';

    let isBrand = false;
    if (isObj && typeof cit.is_brand_domain === 'boolean') {
      isBrand = cit.is_brand_domain;
    } else {
      isBrand = matchesDomain(rawDomain, normBrandDomains);
    }
    if (isBrand) brandDomainCited = true;

    let isComp = false;
    if (isObj && typeof cit.is_competitor_domain === 'boolean') {
      isComp = cit.is_competitor_domain;
    } else {
      isComp = normCompetitors.some(c => matchesDomain(rawDomain, c.domains));
    }
    if (isComp) competitorDomainCited = true;

    return {
      citation_index: idx + 1,
      url: rawUrl,
      citation_url: rawUrl,
      domain: rawDomain,
      citation_domain: rawDomain,
      title: title,
      citation_title: title,
      is_brand_domain: isBrand,
      is_competitor_domain: isComp
    };
  });

  const hasCitations = normCitations.length > 0;

  // Evaluate brand match
  let brandMatch = { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  if (targetBrand.length > 0 && totalChars > 0) {
    brandMatch = findBrandUnicode(normText, targetBrand, normBrandDomains);
  }

  const brandMentioned = brandMatch.found;
  const brandCharEarliness = brandMatch.charIndex;
  const brandWordEarliness = brandMatch.wordIndex;

  let brandRelPosPct = null;
  if (brandMentioned && brandCharEarliness !== null && totalChars > 0) {
    brandRelPosPct = Math.round((brandCharEarliness / totalChars) * 10000) / 100;
  }

  // Evaluate competitor matches
  let minCompetitorEarliness = null;
  let anyCompFound = false;

  const evaluatedCompetitors = normCompetitors.map(comp => {
    let compMatch = { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
    if (totalChars > 0) {
      compMatch = findBrandUnicode(normText, comp.name, comp.domains);
    }
    let compRelPosPct = null;

    if (compMatch.found && compMatch.charIndex !== null) {
      anyCompFound = true;
      if (minCompetitorEarliness === null || compMatch.charIndex < minCompetitorEarliness) {
        minCompetitorEarliness = compMatch.charIndex;
      }
      compRelPosPct = totalChars > 0 ? Math.round((compMatch.charIndex / totalChars) * 10000) / 100 : 0.0;
    }

    return {
      competitor_name: comp.name,
      competitor_domain: comp.domains[0] || null,
      mentioned: compMatch.found,
      char_earliness: compMatch.charIndex,
      word_earliness: compMatch.wordIndex,
      relative_position_pct: compRelPosPct,
      relative_pos: compRelPosPct,
      match_type: compMatch.matchType,
      recommended: false
    };
  });

  const meceCategory = classifyMECE({
    brandMentioned,
    competitorsMentioned: anyCompFound,
    brandEarliness: brandCharEarliness,
    minCompetitorEarliness,
    brandSentiment: runOptions.brandSentiment || 'neutral'
  });

  const brandRecommended = meceCategory === '1_DIRECT_WIN';
  const competitorRecommended = meceCategory === '3_COMPETITOR_TAKEOVER' || meceCategory === '2_BRAND_HALO';

  // Mark leading competitor(s) recommended if competitor takeover/halo applies
  if (competitorRecommended && anyCompFound && minCompetitorEarliness !== null) {
    for (const comp of evaluatedCompetitors) {
      if (comp.mentioned && comp.char_earliness === minCompetitorEarliness) {
        comp.recommended = true;
      }
    }
  }

  const geoQuadrant = evaluateGeoQuadrant({
    brandMentioned,
    brandRecommended,
    competitorRecommended,
    brandDomainCited,
    competitorCited: competitorDomainCited,
    citationsCount: normCitations.length,
    hasCitations,
    relativePositionPct: brandRelPosPct,
    wordEarliness: brandWordEarliness,
    meceCategory
  });

  return {
    // Lengths
    total_chars: totalChars,
    character_count: totalChars,
    total_words: totalWords,
    word_count: totalWords,

    // Brand Metrics
    brand_name: targetBrand,
    brand_mentioned: brandMentioned,
    brand_recommended: brandRecommended,
    char_earliness: brandCharEarliness,
    brand_earliness_char: brandCharEarliness,
    word_earliness: brandWordEarliness,
    brand_earliness_word: brandWordEarliness,
    relative_position_pct: brandRelPosPct,
    brand_relative_pos: brandRelPosPct,
    brand_match_type: brandMatch.matchType,

    // MECE & GEO
    mece_category: meceCategory,
    geo_quadrant: geoQuadrant,

    // Citations
    has_citations: hasCitations,
    brand_domain_cited: brandDomainCited,
    brand_cited: brandDomainCited,
    competitor_cited: competitorDomainCited,

    // Detailed diagnostics breakdown
    diagnostics: {
      primary_quadrant: geoQuadrant,
      is_citation_hijack: geoQuadrant === '1_CITATION_HIJACK',
      is_parametric_blindspot: geoQuadrant === '2_PARAMETRIC_BLINDSPOT',
      is_brand_halo_trap: geoQuadrant === '3_BRAND_HALO_TRAP',
      is_buried_winner: geoQuadrant === '4_BURIED_WINNER'
    },

    // Collections
    competitors: evaluatedCompetitors,
    citations: normCitations
  };
}

// Universal module export pattern
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateMetrics,
    findBrandUnicode,
    findEntityInText: findBrandUnicode,
    findEntityUnicode: findBrandUnicode,
    normalizeGermanText,
    foldGerman: normalizeGermanText,
    buildGermanRegex,
    getWords,
    countWords,
    countChars,
    extractDomainFromUrl,
    extractHostname: extractDomainFromUrl,
    matchesDomain,
    classifyMECE,
    evaluateGeoQuadrant,
    diagnoseGEO: evaluateGeoQuadrant,
    evaluateDiagnostics: evaluateGeoQuadrant,
    escapeRegex
  };
}
