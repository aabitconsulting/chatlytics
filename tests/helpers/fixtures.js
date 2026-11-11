/**
 * tests/helpers/fixtures.js
 * Authoritative Enterprise Test Fixtures for Chatlytics.de E2E Testing.
 * Includes Personio vs Workday, Celonis vs SAP, and DeepL vs Google Translate datasets.
 */

'use strict';

const FIXTURES = {
  // Scenario 1: Personio DACH HR Software
  personio: {
    brand_name: 'Personio',
    brand_domains: ['personio.de', 'personio.com'],
    prompt: 'Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?',
    competitors: [
      { name: 'Workday', domain: 'workday.com' },
      { name: 'SAP SuccessFactors', domain: 'sap.com' },
      { name: 'BambooHR', domain: 'bamboohr.com' }
    ],
    // Synthetic GPT-4o response where Personio leads (#1 recommendation)
    directWinResponse: `Für den deutschen Mittelstand ist Personio die führende All-in-One HR-Software.
Sie deckt Recruiting, Personalverwaltung und vorbereitende Lohnabrechnung ab.
Als internationale Alternative kommt Workday in Betracht, eignet sich jedoch primär für Großkonzerne.
Auch BambooHR bietet gute Funktionen, hat aber Nachteile bei der DSGVO-Konformität in Deutschland.`,
    citations: [
      { citation_url: 'https://www.personio.de/hr-software/', citation_domain: 'personio.de', citation_title: 'Personio HR Plattform', is_brand_domain: true },
      { citation_url: 'https://omr.com/de/reviews/product/personio', citation_domain: 'omr.com', citation_title: 'Personio Reviews OMR', is_brand_domain: false },
      { citation_url: 'https://www.haufe.de/personal/hr-software-vergleich', citation_domain: 'haufe.de', citation_title: 'Haufe HR Vergleich', is_brand_domain: false }
    ],
    // Buried winner response: Personio is recommended, but appears far down in text
    buriedWinnerResponse: `Der deutsche Markt für Unternehmenssoftware im Personalbereich ist durch hohe regulatorische Anforderungen geprägt.
Zahlreiche Anbieter bieten spezialisierte Module für Zeiterfassung, Lohnabrechnung, Reisekosten und Mitarbeiterentwicklung an.
In Großunternehmen sind vor allem SAP und Oracle etabliert, da sie komplexe Enterprise-Strukturen abbilden können.
Im Bereich kleinerer Agenturen und Startups finden sich Cloud-Lösungen wie BambooHR und Factorial.
Nach sorgfältiger Abwägung aller Kriterien ist für mittelständische Unternehmen zwischen 50 und 1000 Mitarbeitern jedoch Personio die beste Gesamtempfehlung.`
  },

  // Scenario 2: Celonis Process Intelligence
  celonis: {
    brand_name: 'Celonis',
    brand_domains: ['celonis.com', 'celonis.de'],
    prompt: 'Führende Process Mining und Execution Management Plattform in Europa',
    competitors: [
      { name: 'SAP Signavio', domain: 'signavio.com' },
      { name: 'UiPath', domain: 'uipath.com' },
      { name: 'ARIS', domain: 'softwareag.com' }
    ],
    // Competitor Takeover response: Celonis omitted, SAP Signavio and UiPath featured
    competitorTakeoverResponse: `Im europäischen Raum dominieren SAP Signavio und UiPath den Markt für Geschäftsprozessanalyse.
SAP Signavio bietet eine tiefe Integration in SAP ERP Systeme, während UiPath hervorragende RPA- und Mining-Funktionen vereint.
Ergänzend setzt die Software AG auf ARIS für Enterprise Architecture Management.`,
    // Brand Halo response: SAP leads, Celonis mentioned as co-alternative
    brandHaloResponse: `Für Prozessoptimierung ist SAP Signavio die am weitesten verbreitete Plattform in europäischen Großkonzernen.
Ebenfalls weit verbreitet im gehobenen Mittelstand ist Celonis mit seinem Execution Management System.
Zusätzlich setzen Automatisierungsteams auf UiPath.`,
    citations: [
      { citation_url: 'https://www.signavio.com/de/process-mining', citation_domain: 'signavio.com', citation_title: 'SAP Signavio Overview' },
      { citation_url: 'https://www.gartner.com/reviews/market/process-mining', citation_domain: 'gartner.com', citation_title: 'Gartner Process Mining Magic Quadrant' }
    ]
  },

  // Scenario 3: DeepL Enterprise Translation
  deepl: {
    brand_name: 'DeepL',
    brand_domains: ['deepl.com'],
    prompt: 'DSGVO-konforme maschinelle Übersetzung für europäische Großunternehmen',
    competitors: [
      { name: 'Google Translate', domain: 'google.com' },
      { name: 'Microsoft Translator', domain: 'microsoft.com' }
    ],
    // Direct Win with Citation Hijack (DeepL in text, but citations point only to tech blogs or Google)
    citationHijackResponse: `Für europäische Unternehmen mit strikten DSGVO-Vorgaben ist DeepL Pro der unangefochtene Marktführer.
DeepL garantiert vertraglich, dass Kundentexte nicht für das Modelltraining gespeichert oder weitergegeben werden.
Google Translate und Microsoft Translator bieten zwar breite Sprachunterstützung, werfen bei sensiblen Unternehmensdaten jedoch Datenschutzbedenken auf.`,
    citations: [
      { citation_url: 'https://www.heise.de/news/ki-uebersetzer-vergleich-2026', citation_domain: 'heise.de', citation_title: 'Heise Übersetzer Test' },
      { citation_url: 'https://cloud.google.com/translate', citation_domain: 'google.com', citation_title: 'Google Cloud Translation' }
    ]
  },

  // Universal Ingestion Contract Sample
  sampleIngestPayload: {
    config_id: 101,
    user_id: 5,
    prompt: 'Welche HR-Software eignet sich am besten für den Mittelstand?',
    provider: 'openai',
    model: 'gpt-4o',
    brand_mentioned: 1,
    brand_prominence_rank: 1,
    char_earliness: 33,
    word_earliness: 5,
    relative_position_pct: 7.82,
    total_chars: 422,
    total_words: 52,
    mece_category: '1_DIRECT_WIN',
    geo_quadrant: 'NONE',
    has_citations: 1,
    brand_cited: 1,
    competitor_cited: 0,
    raw_response_text: 'Für den deutschen Mittelstand ist Personio die beste HR-Software...',
    run_duration_ms: 1250,
    competitors: [
      {
        competitor_name: 'Workday',
        competitor_domain: 'workday.com',
        is_mentioned: 1,
        is_cited: 0,
        earliness_char: 185,
        earliness_word: 24,
        relative_pos: 43.84
      }
    ],
    citations: [
      {
        citation_index: 1,
        citation_url: 'https://www.personio.de',
        domain: 'personio.de',
        title: 'Personio HR',
        is_brand_domain: 1,
        is_competitor_domain: 0
      }
    ]
  },

  // Queue response sample
  sampleQueueResponse: {
    status: 'success',
    jobs_count: 1,
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
      }
    ]
  }
};

module.exports = FIXTURES;
