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
 * Lightweight zero-dependency prompt language detector (36 EU + global languages).
 *
 * @param {string} prompt
 * @returns {string} ISO language code or 'unknown'
 */
function detectPromptLanguage(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'unknown';
  const text = prompt.normalize('NFC').trim();
  if (!text) return 'unknown';

  // Unambiguous non-Latin script detection first
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0370-\u03FF]/.test(text)) return 'el';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  if (/[\u0400-\u04FF]/.test(text)) {
    if (/[\u0404\u0406\u0407\u0454\u0456\u0457\u0490\u0491]/.test(text)) return 'uk';
    if (/\b(?:кои|които|какъв|каква|какво|за|най-добрите|българия)\b/iu.test(text) || /\u044A/i.test(text)) {
      if (!/\b(?:объект|субъект|въезд|подъезд)\b/iu.test(text) && /\b(?:кои|за|най|какви|българия|са|е)\b/iu.test(text)) {
        return 'bg';
      }
    }
    return 'ru';
  }

  const lower = text.toLowerCase();
  if (/[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u1ea1-\u1ef9]/.test(lower) && /[\u0111\u01a1\u01b0\u1ea0-\u1ef9]/.test(lower)) {
    return 'vi';
  }

  const rawWords = lower.match(/[\p{L}']+/gu) || [];
  const words = new Set(rawWords);
  if (words.size === 0) return 'unknown';

  const scores = Object.create(null);
  const addScore = (lang, pts) => {
    scores[lang] = (scores[lang] || 0) + pts;
  };
  const scoreDict = (lang, strongWords, mildWords = []) => {
    for (const w of strongWords) {
      if (words.has(w)) addScore(lang, 2);
    }
    for (const w of mildWords) {
      if (words.has(w)) addScore(lang, 1);
    }
  };

  scoreDict(
    'de',
    [
      'der', 'die', 'das', 'und', 'für', 'mit', 'welche', 'welcher', 'welches',
      'wie', 'beste', 'bester', 'besten', 'ein', 'eine', 'einer', 'einem', 'einen',
      'ist', 'sind', 'oder', 'nicht', 'auf', 'bei', 'aus', 'nach', 'über', 'unter',
      'zum', 'zur', 'anbieter', 'vergleich', 'alternativen', 'lösungen', 'unternehmen',
      'kosten', 'preise', 'deutschland', 'österreich', 'schweiz', 'empfehlen', 'empfehlung'
    ],
    ['in', 'im', 'am', 'von', 'zu', 'was', 'wo', 'man', 'kann']
  );
  if (/[äöüß]/.test(lower)) addScore('de', 3);

  scoreDict(
    'en',
    [
      'the', 'and', 'for', 'with', 'what', 'which', 'who', 'how', 'where', 'why',
      'best', 'top', 'compare', 'comparison', 'between', 'alternatives', 'tools',
      'solutions', 'companies', 'pricing', 'features', 'is', 'are', 'was', 'were',
      'can', 'could', 'should', 'you', 'your', 'this', 'that', 'these', 'those',
      'from', 'into', 'about', 'most', 'recommend', 'recommended', 'or'
    ],
    ['in', 'to', 'of', 'on', 'an']
  );

  scoreDict(
    'fr',
    [
      'le', 'la', 'les', 'des', 'une', 'est', 'sont', 'avec', 'pour', 'dans',
      'sur', 'quel', 'quelle', 'quels', 'quelles', 'meilleur', 'meilleurs',
      'meilleure', 'meilleures', 'logiciel', 'logiciels', 'entreprise', 'entreprises',
      'comparatif', 'comparaison', 'ou', 'et', 'pas', 'chez', 'comment', 'pourquoi',
      'vous', 'votre', 'nous', 'france', 'outils', 'prix'
    ],
    ['de', 'un', 'du', 'au', 'qui', 'quoi']
  );
  if (/[œç]/.test(lower)) addScore('fr', 3);
  else if (/[àâèéêëîïôùûü]/.test(lower)) addScore('fr', 1);

  scoreDict(
    'es',
    [
      'el', 'los', 'las', 'uno', 'una', 'unos', 'unas', 'son', 'con', 'para', 'por',
      'qué', 'cuál', 'cuáles', 'mejor', 'mejores', 'empresa', 'empresas',
      'comparativa', 'entre', 'sobre', 'cómo', 'dónde', 'herramientas', 'soluciones',
      'españa', 'precio', 'precios', 'son'
    ],
    ['la', 'en', 'es', 'y', 'que', 'de']
  );
  if (/[ñ¡¿]/.test(lower)) addScore('es', 3);

  scoreDict(
    'it',
    [
      'il', 'lo', 'gli', 'una', 'sono', 'con', 'per', 'quale', 'quali',
      'migliore', 'migliori', 'aziende', 'azienda', 'confronto', 'come', 'che',
      'del', 'della', 'dei', 'delle', 'degli', 'nel', 'nella', 'italia', 'prezzi',
      'strumenti', 'miglior', 'più'
    ],
    ['la', 'le', 'in', 'di', 'e', 'è']
  );

  scoreDict(
    'nl',
    [
      'het', 'een', 'van', 'voor', 'met', 'zijn', 'welke', 'welk', 'hoe',
      'beste', 'bedrijven', 'bedrijf', 'vergelijking', 'tussen', 'waar', 'over',
      'bij', 'nederland', 'belgië', 'oplossingen', 'prijzen', 'aanbieders'
    ],
    ['de', 'en', 'in', 'op', 'wat', 'is']
  );
  if (/ij/.test(lower)) addScore('nl', 1);

  scoreDict(
    'pt',
    [
      'os', 'as', 'um', 'uma', 'são', 'com', 'para', 'por', 'em', 'nos', 'nas',
      'qual', 'quais', 'melhor', 'melhores', 'empresas', 'comparação', 'como',
      'entre', 'sobre', 'ferramentas', 'brasil', 'portugal', 'preços', 'soluções'
    ],
    ['o', 'a', 'no', 'na', 'é', 'de']
  );
  if (/[ãõ]/.test(lower)) addScore('pt', 3);

  scoreDict(
    'pl',
    [
      'do', 'dla', 'jak', 'jaki', 'jaka', 'jakie', 'najlepsze', 'najlepszy',
      'najlepsza', 'porównanie', 'firmy', 'oprogramowanie', 'jest', 'są', 'lub',
      'oraz', 'który', 'które', 'czy', 'polska', 'narzędzia'
    ],
    ['w', 'na', 'z', 'i']
  );
  if (/[ąćęłńśźż]/.test(lower)) addScore('pl', 3);

  scoreDict(
    'sv',
    [
      'och', 'att', 'det', 'som', 'för', 'med', 'på', 'är', 'vilken', 'vilket',
      'vilka', 'bästa', 'hur', 'företag', 'mellan', 'sverige', 'jämförelse', 'verktyg'
    ],
    ['i', 'av']
  );
  if (/å/.test(lower) && !/[æø]/.test(lower)) addScore('sv', 2);

  scoreDict(
    'da',
    [
      'og', 'at', 'det', 'som', 'for', 'med', 'på', 'er', 'hvilken', 'hvilket',
      'hvilke', 'bedste', 'hvordan', 'virksomheder', 'sammenligning', 'danmark', 'værktøjer'
    ],
    ['i', 'af']
  );
  if (/[æø]/.test(lower)) addScore('da', 3);

  scoreDict(
    'fi',
    [
      'ja', 'on', 'ovat', 'tai', 'että', 'mitkä', 'mikä', 'parhaat', 'paras',
      'kuinka', 'miten', 'yritykset', 'vertailu', 'ohjelmisto', 'varten', 'suomi'
    ],
    []
  );

  scoreDict(
    'cs',
    [
      'pro', 'je', 'jsou', 'jak', 'jaké', 'jaký', 'nejlepší', 'porovnání',
      'firmy', 'srovnání', 'nástroje', 'česko'
    ],
    ['a', 'v', 'na']
  );
  if (/[ěčřžůťďň]/.test(lower)) addScore('cs', 3);

  scoreDict(
    'sk',
    [
      'pre', 'ako', 'aké', 'najlepšie', 'porovnanie', 'spoločnosti', 'slovensko'
    ],
    ['a', 'v', 'na', 'sú']
  );
  if (/[ĺľŕôä]/.test(lower) && words.has('ako')) addScore('sk', 2);

  scoreDict(
    'ro',
    [
      'și', 'în', 'pentru', 'cu', 'este', 'sunt', 'care', 'cum', 'cele',
      'mai', 'bune', 'comparație', 'companii', 'românia'
    ],
    ['si', 'de', 'la']
  );
  if (/[ăîșțşţ]/.test(lower)) addScore('ro', 3);

  scoreDict(
    'hu',
    [
      'és', 'az', 'hogy', 'van', 'vannak', 'melyik', 'legjobb', 'vállalatok',
      'összehasonlítás', 'szoftver', 'magyarország'
    ],
    ['a']
  );
  if (/[őű]/.test(lower)) addScore('hu', 3);

  scoreDict(
    'tr',
    [
      've', 'için', 'ile', 'iyi', 'nasıl', 'hangi', 'şirketler', 'karşılaştırma',
      'yazılım', 'nedir', 'türkiye'
    ],
    ['en']
  );
  if (/[ğıİş]/.test(text)) addScore('tr', 3);

  scoreDict(
    'id',
    [
      'yang', 'dan', 'untuk', 'dengan', 'apa', 'bagaimana', 'terbaik',
      'perusahaan', 'perbandingan', 'perangkat', 'lunak', 'indonesia'
    ],
    ['di']
  );

  scoreDict(
    'hr',
    ['koji', 'koje', 'najbolji', 'najbolje', 'usporedba', 'tvrtke', 'za', 'hrvatska'],
    ['i', 'u', 'na']
  );

  scoreDict(
    'sl',
    ['kateri', 'katera', 'najboljši', 'najboljše', 'primerjava', 'podjetja', 'slovenija'],
    ['in', 'za', 'na']
  );

  scoreDict(
    'et',
    ['parim', 'parimad', 'võrdlus', 'ettevõtted', 'tarkvara', 'kuidas', 'eesti'],
    ['ja', 'on']
  );

  scoreDict(
    'lv',
    ['labākais', 'labākie', 'salīdzinājums', 'uzņēmumi', 'programmatūra', 'latvija'],
    ['un', 'ir']
  );
  if (/[āēīūķļņģ]/.test(lower)) addScore('lv', 3);

  scoreDict(
    'lt',
    ['geriausias', 'geriausi', 'palyginimas', 'įmonės', 'lietuva', 'kaip'],
    ['ir', 'yra']
  );
  if (/[ąčęėįšųūž]/.test(lower)) addScore('lt', 3);

  scoreDict(
    'ga',
    ['is', 'agus', 'fearr', 'na', 'comhlachtaí', 'bogearraí', 'conas', 'éire'],
    []
  );

  scoreDict(
    'mt',
    ['l-aħjar', 'kumpaniji', 'tqabbil', 'softwer', 'malta', 'kif'],
    ['u', 'ta']
  );
  if (/[ċġħż]/.test(lower)) addScore('mt', 3);

  let bestLang = 'unknown';
  let bestScore = 0;
  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      bestLang = lang;
    }
  }

  return bestScore >= 2 ? bestLang : 'unknown';
}

const LANGUAGE_REGION_MAP = {
  de: 'DACH',
  en: 'GLOBAL_EN',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  nl: 'NL',
  pt: 'PT',
  pl: 'PL',
  sv: 'SE',
  da: 'DK',
  fi: 'FI',
  cs: 'CZ',
  ro: 'RO',
  el: 'GR',
  hu: 'HU',
  bg: 'BG',
  hr: 'HR',
  sk: 'SK',
  sl: 'SI',
  et: 'EE',
  lv: 'LV',
  lt: 'LT',
  ga: 'IE',
  mt: 'MT',
  zh: 'CN',
  hi: 'IN',
  ar: 'MENA',
  bn: 'BD',
  ru: 'RU',
  ja: 'JP',
  ko: 'KR',
  tr: 'TR',
  vi: 'VN',
  id: 'ID',
  th: 'TH',
  uk: 'UA'
};

/**
 * Infers a default geographic region code from a detected prompt language.
 *
 * @param {string} lang
 * @returns {string}
 */
function inferRegionFromLanguage(lang) {
  if (!lang || typeof lang !== 'string') return 'GLOBAL';
  const key = lang.trim().toLowerCase();
  return LANGUAGE_REGION_MAP[key] || 'GLOBAL';
}

const REGION_ALIASES = {
  DEUTSCHLAND: 'DE',
  GERMANY: 'DE',
  OESTERREICH: 'AT',
  AUSTRIA: 'AT',
  SCHWEIZ: 'CH',
  SWITZERLAND: 'CH',
  SUISSE: 'CH',
  SVIZZERA: 'CH',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED KINGDOM': 'UK',
  GREATBRITAIN: 'UK',
  GB: 'UK',
  ENGLAND: 'UK',
  FRANKREICH: 'FR',
  FRANCE: 'FR',
  SPANIEN: 'ES',
  SPAIN: 'ES',
  ITALIEN: 'IT',
  ITALY: 'IT',
  NIEDERLANDE: 'NL',
  NETHERLANDS: 'NL',
  EUROPA: 'EU',
  EUROPE: 'EU'
};

/**
 * Normalizes a region label or ISO/market code to a canonical uppercase key.
 *
 * @param {string|null|undefined} region
 * @returns {string|null}
 */
function normalizeRegionCode(region) {
  if (region === null || region === undefined) return null;
  const trimmed = String(region).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'auto' || lower === 'default' || lower === 'none' || lower === 'null') {
    return null;
  }
  const upper = trimmed
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE');
  return REGION_ALIASES[upper] || trimmed.toUpperCase();
}

/**
 * Resolves geographic evaluation context from user-configured market/region
 * and detected prompt language.
 *
 * @param {string} prompt
 * @param {string|null|undefined} userMarketRegion
 * @returns {{ market_region: string|null, prompt_language: string, inferred_region: string, effective_region: string, region_source: string }}
 */
function resolveGeographicContext(prompt, userMarketRegion) {
  const promptLanguage = detectPromptLanguage(prompt);
  const inferredRegion = inferRegionFromLanguage(promptLanguage);
  const cleanUserRegion = normalizeRegionCode(userMarketRegion);
  const effectiveRegion = cleanUserRegion || inferredRegion;
  const regionSource = cleanUserRegion
    ? 'user_setting'
    : (promptLanguage !== 'unknown' ? 'prompt_language' : 'default_fallback');

  return {
    market_region: cleanUserRegion,
    prompt_language: promptLanguage,
    inferred_region: inferredRegion,
    effective_region: effectiveRegion,
    region_source: regionSource
  };
}

const GERMAN_TRANSLITERATION_REGIONS = new Set(['DACH', 'DE', 'AT', 'CH', 'LI', 'LU']);

/**
 * Gates DIN 5007-2 umlaut transliteration (ae/oe/ue/ss) to German / DACH
 * geographic contexts, preserving backward-compatible fallback only when both
 * user market_region is unset and prompt_language is unknown.
 *
 * @param {object|null|undefined} geoContext
 * @returns {boolean}
 */
function shouldUseGermanTransliteration(geoContext) {
  if (!geoContext || typeof geoContext !== 'object') return true;
  const effective = normalizeRegionCode(geoContext.effective_region || geoContext.effectiveRegion || geoContext.market_region || geoContext.marketRegion);
  const lang = geoContext.prompt_language || geoContext.promptLanguage || 'unknown';
  const userRegion = normalizeRegionCode(geoContext.market_region || geoContext.marketRegion);

  if (lang === 'de') return true;
  if (effective && GERMAN_TRANSLITERATION_REGIONS.has(effective)) return true;
  if (!userRegion && (!lang || lang === 'unknown') && (!effective || effective === 'GLOBAL')) return true;
  return false;
}

const REGIONAL_TLD_MAP = {
  DACH: ['.de', '.at', '.ch', '.li'],
  DE: ['.de'],
  AT: ['.at'],
  CH: ['.ch'],
  LI: ['.li'],
  LU: ['.lu'],
  FR: ['.fr'],
  ES: ['.es'],
  IT: ['.it'],
  NL: ['.nl'],
  BE: ['.be'],
  BENELUX: ['.nl', '.be', '.lu'],
  PT: ['.pt'],
  PL: ['.pl'],
  SE: ['.se'],
  DK: ['.dk'],
  FI: ['.fi'],
  NO: ['.no'],
  NORDICS: ['.se', '.dk', '.fi', '.no', '.is'],
  CZ: ['.cz'],
  SK: ['.sk'],
  RO: ['.ro'],
  GR: ['.gr'],
  HU: ['.hu'],
  BG: ['.bg'],
  HR: ['.hr'],
  SI: ['.si'],
  EE: ['.ee'],
  LV: ['.lv'],
  LT: ['.lt'],
  IE: ['.ie'],
  MT: ['.mt'],
  EU: [
    '.eu', '.de', '.at', '.fr', '.es', '.it', '.nl', '.be', '.lu', '.pt',
    '.pl', '.se', '.dk', '.fi', '.cz', '.sk', '.ro', '.gr', '.hu', '.bg',
    '.hr', '.si', '.ee', '.lv', '.lt', '.ie', '.mt', '.cy'
  ],
  UK: ['.uk', '.co.uk', '.org.uk', '.ac.uk', '.gov.uk'],
  US: ['.us', '.gov', '.edu', '.mil'],
  CA: ['.ca'],
  AU: ['.au', '.com.au', '.org.au', '.net.au'],
  NZ: ['.nz', '.co.nz'],
  CN: ['.cn', '.com.cn'],
  IN: ['.in', '.co.in'],
  MENA: ['.ae', '.sa', '.eg', '.qa', '.kw', '.bh', '.om', '.jo', '.ma', '.tn', '.lb'],
  BD: ['.bd', '.com.bd'],
  RU: ['.ru', '.su'],
  JP: ['.jp', '.co.jp', '.ne.jp', '.or.jp'],
  KR: ['.kr', '.co.kr', '.or.kr'],
  TR: ['.tr', '.com.tr', '.org.tr'],
  VN: ['.vn', '.com.vn'],
  ID: ['.id', '.co.id'],
  TH: ['.th', '.co.th'],
  UA: ['.ua', '.com.ua'],
  BR: ['.br', '.com.br'],
  MX: ['.mx', '.com.mx'],
  LATAM: ['.mx', '.com.mx', '.br', '.com.br', '.ar', '.com.ar', '.co', '.cl', '.pe', '.uy'],
  GLOBAL_EN: ['.uk', '.co.uk', '.us', '.ca', '.au', '.com.au', '.nz', '.co.nz', '.ie', '.com', '.org', '.io', '.ai']
};

/**
 * Checks whether a cited domain matches the regional ccTLD / regional TLD
 * profile for the active effective_region.
 *
 * @param {string} domain
 * @param {string|null|undefined} effectiveRegion
 * @returns {boolean}
 */
function isRegionalCitationDomain(domain, effectiveRegion) {
  if (!domain || !effectiveRegion) return false;
  const cleanDomain = extractDomainFromUrl(String(domain));
  if (!cleanDomain) return false;

  const regionKey = normalizeRegionCode(effectiveRegion);
  if (!regionKey || regionKey === 'GLOBAL') return false;

  let suffixes = REGIONAL_TLD_MAP[regionKey];
  if (!suffixes && /^[A-Z]{2}$/.test(regionKey)) {
    suffixes = ['.' + regionKey.toLowerCase()];
  }
  if (!Array.isArray(suffixes) || suffixes.length === 0) return false;

  return suffixes.some(sfx => cleanDomain.endsWith(sfx) && cleanDomain.length > sfx.length);
}

const UNICODE_CHAR_FOLD_MAP = {
  a: '[a\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105]',
  c: '[c\u00e7\u0107\u0109\u010b\u010d]',
  d: '[d\u010f\u0111\u00f0]',
  e: '[e\u00e8\u00e9\u00ea\u00eb\u0113\u0115\u0117\u0119\u011b]',
  g: '[g\u011d\u011f\u0121\u0123]',
  h: '[h\u0125\u0127]',
  i: '[i\u00ec\u00ed\u00ee\u00ef\u0129\u012b\u012d\u012f\u0131]',
  j: '[j\u0135]',
  k: '[k\u0137]',
  l: '[l\u013a\u013c\u013e\u0140\u0142]',
  n: '[n\u00f1\u0144\u0146\u0148]',
  o: '[o\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u014d\u014f\u0151]',
  r: '[r\u0155\u0157\u0159]',
  s: '[s\u015b\u015d\u015f\u0161]',
  t: '[t\u0163\u0165\u0167]',
  u: '[u\u00f9\u00fa\u00fb\u00fc\u0169\u016b\u016d\u016f\u0171\u0173]',
  w: '[w\u0175]',
  y: '[y\u00fd\u00ff\u0177]',
  z: '[z\u017a\u017c\u017e]'
};

/**
 * Builds a universal Unicode diacritic-tolerant boundary regex without German
 * ae/oe/ue/ss DIN 5007-2 transliteration.
 *
 * @param {string} entityName
 * @returns {RegExp|null}
 */
function buildUnicodeFoldRegex(entityName) {
  if (!entityName || typeof entityName !== 'string') return null;
  const norm = entityName.normalize('NFC').trim();
  if (!norm) return null;

  const SPECIAL_BASE = {
    '\u00f8': 'o', '\u00d8': 'o',
    '\u0142': 'l', '\u0141': 'l',
    '\u0111': 'd', '\u0110': 'd',
    '\u00f0': 'd', '\u00d0': 'd',
    '\u0131': 'i'
  };

  const wordTokens = norm.split(/\s+/);
  const wordPatterns = wordTokens.map(w => {
    const chars = Array.from(w);
    return chars.map(ch => {
      const mappedSpecial = SPECIAL_BASE[ch];
      const base = (mappedSpecial || ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).toLowerCase();
      if (!base) return '';
      if (UNICODE_CHAR_FOLD_MAP[base]) {
        return `(?:${UNICODE_CHAR_FOLD_MAP[base]}[\u0300-\u036f]*)`;
      }
      return escapeRegex(base);
    }).join('');
  }).filter(p => p.length > 0);

  if (wordPatterns.length === 0) return null;
  const fullPattern = wordPatterns.join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${fullPattern}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Locates an entity within text using tiered resolution:
 * Tier 1: Region-aware Unicode / DIN 5007-2 regex with lookaround boundaries.
 * Tier 2: Domain text fallback if registered domains are provided.
 * 
 * @param {string} text
 * @param {string} entityName
 * @param {string[]} [domains=[]]
 * @param {object} [options={}]
 * @returns {{ found: boolean, charIndex: number|null, wordIndex: number|null, matchType: string, matchedText: string|null }}
 */
function findBrandUnicode(text, entityName, domains = [], options = {}) {
  if (text === null || text === undefined || !entityName) {
    return { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  }

  const rawText = typeof text === 'string' ? text : String(text);
  const normText = rawText.normalize('NFC');
  const target = typeof entityName === 'string' ? entityName.normalize('NFC').trim() : String(entityName).trim();
  if (!target) {
    return { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  }

  let useGerman = true;
  if (options && typeof options === 'object') {
    if (typeof options.useGermanTransliteration === 'boolean') {
      useGerman = options.useGermanTransliteration;
    } else if (options.geoContext || options.promptLanguage || options.marketRegion || options.market_region || options.effectiveRegion || options.effective_region) {
      useGerman = shouldUseGermanTransliteration(options.geoContext || options);
    }
  }

  const regex = useGerman ? buildGermanRegex(target) : buildUnicodeFoldRegex(target);
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
      const locale = useGerman ? 'de-DE' : 'en-US';
      const isExact = matchedText.normalize('NFC').toLocaleLowerCase(locale) === target.toLocaleLowerCase(locale);
      return {
        found: true,
        charIndex,
        wordIndex,
        matchType: isExact ? 'unicode_exact' : (useGerman ? 'german_transliterated' : 'unicode_folded'),
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

  // Resolve geographic context from user market_region & prompt language
  const promptText = runOptions.prompt || runOptions.user_prompt || (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? (arg1.prompt || '') : '');
  const userMarketRegionOpt = runOptions.marketRegion ?? runOptions.market_region ?? (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? (arg1.market_region ?? arg1.marketRegion ?? null) : null);
  const geoContext = resolveGeographicContext(promptText, userMarketRegionOpt);
  const useGerman = shouldUseGermanTransliteration(geoContext);
  const matchOptions = { useGermanTransliteration: useGerman, geoContext };

  // Normalize citations (with null guard and percent-decoding resilience)
  let brandDomainCited = false;
  let competitorDomainCited = false;
  let regionalCitationCount = 0;

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

    let isRegionalTld = false;
    if (isObj && typeof cit.is_regional_tld === 'boolean') {
      isRegionalTld = cit.is_regional_tld;
    } else {
      isRegionalTld = isRegionalCitationDomain(rawDomain, geoContext.effective_region);
    }
    if (isRegionalTld) regionalCitationCount++;

    return {
      citation_index: idx + 1,
      url: rawUrl,
      citation_url: rawUrl,
      domain: rawDomain,
      citation_domain: rawDomain,
      title: title,
      citation_title: title,
      is_brand_domain: isBrand,
      is_competitor_domain: isComp,
      is_regional_tld: isRegionalTld
    };
  });

  const hasCitations = normCitations.length > 0;
  const regionalCitationRatio = hasCitations
    ? Math.round((regionalCitationCount / normCitations.length) * 10000) / 10000
    : null;

  // Evaluate brand match
  let brandMatch = { found: false, charIndex: null, wordIndex: null, matchType: 'none', matchedText: null };
  if (targetBrand.length > 0 && totalChars > 0) {
    brandMatch = findBrandUnicode(normText, targetBrand, normBrandDomains, matchOptions);
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
      compMatch = findBrandUnicode(normText, comp.name, comp.domains, matchOptions);
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
    regional_citation_count: regionalCitationCount,
    regional_citation_ratio: regionalCitationRatio,

    // Geographic Context & Language Inference
    market_region: geoContext.market_region,
    prompt_language: geoContext.prompt_language,
    inferred_region: geoContext.inferred_region,
    effective_region: geoContext.effective_region,
    region_source: geoContext.region_source,
    german_transliteration_used: useGerman,

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
    buildUnicodeFoldRegex,
    detectPromptLanguage,
    inferRegionFromLanguage,
    normalizeRegionCode,
    resolveGeographicContext,
    shouldUseGermanTransliteration,
    isRegionalCitationDomain,
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
