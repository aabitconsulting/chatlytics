/**
 * assets/js/dossier-stage.js
 * Chatlytics.de — Interactive Dossier, Live Response Analyzer & Modal Controllers
 *
 * Pure ES6 module with zero external dependencies.
 */

const DUELS = {
  kosmetik: {
    id: 'kosmetik',
    de: {
      label: '1. Kosmetik: Nøva Skin vs. La Roche-Derma',
      brand: 'Nøva Skin',
      competitor: 'La Roche-Derma',
      prompt: '„Welches Barrier-Serum ohne Duftstoffe eignet sich am besten bei empfindlicher Haut und Rötungen?“',
      timeline: { brandPos: 35, compPos: 148, leadLabel: '+113 Zeichen Vorsprung' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Sol',
          sub: 'Parametrische Synthese',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Platz 1 · Erste Wahl',
          statusClass: 'status-win',
          text: '„Bei geschwächter Hautbarriere ist Nøva Skin mit seinem Ceramid-Komplex die erste Empfehlung in deutschen Drogerien. Als Apotheken-Alternative gilt La Roche-Derma.“',
          marks: [
            { term: 'Nøva Skin', kind: 'brand' },
            { term: 'La Roche-Derma', kind: 'comp' }
          ],
          firstMention: 'Zeichen 35',
          deltaLabel: '+113 Zeichen vor La Roche-Derma (Zeichen 148)',
          relPos: '21,3 %',
          diagLabel: 'Optimal (Spitzenreiter)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 35,
          compChar: 148
        },
        claude: {
          name: 'Anthropic Claude Sonnet 5.5',
          sub: 'Konservative Gewichtung',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Platz 2 · Im Windschatten',
          statusClass: 'status-halo',
          text: '„Dermatologen empfehlen bei Rötungen primär La Roche-Derma sowie Paula’s Lab. Als preiswerte D2C-Marke aus Deutschland wird zudem häufig Nøva Skin genannt.“',
          marks: [
            { term: 'La Roche-Derma', kind: 'comp' },
            { term: 'Paula’s Lab', kind: 'comp' },
            { term: 'Nøva Skin', kind: 'brand' }
          ],
          firstMention: 'Zeichen 138',
          deltaLabel: '-94 Zeichen hinter La Roche-Derma (Zeichen 44)',
          relPos: '86,2 %',
          diagLabel: 'Ewige Zweitnennung',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 138,
          compChar: 44
        },
        gemini: {
          name: 'Google Gemini 3.8 Flash',
          sub: 'Google Search Grounding aktiv',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Verdrängt · Stummes Quell-Zitat',
          statusClass: 'status-loss',
          text: '„Für empfindliche Haut sollten Sie auf Niacinamide und Panthenol achten. Marktführer in dieser Kategorie sind La Roche-Derma und Paula’s Lab.“',
          marks: [
            { term: 'La Roche-Derma', kind: 'comp' },
            { term: 'Paula’s Lab', kind: 'comp' }
          ],
          firstMention: '— (Ausgelassen)',
          deltaLabel: 'novaskin.de/hautbarriere-ratgeber',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0 %',
          diagLabel: 'Stummes Quell-Zitat (Ratgeber zitiert, Marke fehlt)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 109
        }
      }
    },
    en: {
      label: '1. Skincare: Nøva Skin vs. La Roche-Derma',
      brand: 'Nøva Skin',
      competitor: 'La Roche-Derma',
      prompt: '"Which fragrance-free barrier serum works best for sensitive skin and redness?"',
      timeline: { brandPos: 32, compPos: 139, leadLabel: '+107 chars ahead' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Sol',
          sub: 'Parametric Synthesis',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Rank 1 · First Choice',
          statusClass: 'status-win',
          text: '"For a compromised skin barrier, Nøva Skin with its ceramide complex is the top choice in German retail. A pharmacy alternative is La Roche-Derma."',
          marks: [
            { term: 'Nøva Skin', kind: 'brand' },
            { term: 'La Roche-Derma', kind: 'comp' }
          ],
          firstMention: 'Char 32',
          deltaLabel: '+107 chars ahead of La Roche-Derma (Char 139)',
          relPos: '21.8%',
          diagLabel: 'Optimal (Frontrunner)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 32,
          compChar: 139
        },
        claude: {
          name: 'Anthropic Claude Sonnet 5.5',
          sub: 'Conservative Weighting',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Rank 2 · Runner-Up',
          statusClass: 'status-halo',
          text: '"Dermatologists primarily recommend La Roche-Derma and Paula’s Lab for redness. As an accessible D2C brand from Germany, Nøva Skin is also often cited."',
          marks: [
            { term: 'La Roche-Derma', kind: 'comp' },
            { term: 'Paula’s Lab', kind: 'comp' },
            { term: 'Nøva Skin', kind: 'brand' }
          ],
          firstMention: 'Char 121',
          deltaLabel: '-85 chars behind La Roche-Derma (Char 36)',
          relPos: '79.6%',
          diagLabel: 'Perpetual Runner-Up',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 121,
          compChar: 36
        },
        gemini: {
          name: 'Google Gemini 3.8 Flash',
          sub: 'Google Search Grounding Active',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Displaced · Silent Citation',
          statusClass: 'status-loss',
          text: '"For sensitive skin, look for niacinamide and panthenol. Category leaders frequently recommended here include La Roche-Derma and Paula’s Lab."',
          marks: [
            { term: 'La Roche-Derma', kind: 'comp' },
            { term: 'Paula’s Lab', kind: 'comp' }
          ],
          firstMention: '— (Omitted)',
          deltaLabel: 'novaskin.de/hautbarriere-ratgeber',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0%',
          diagLabel: 'Silent Source Citation (Guide cited, brand missing)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 109
        }
      }
    }
  },

  food: {
    id: 'food',
    de: {
      label: '2. Food & Health: Biovena One vs. AthleticOne',
      brand: 'Biovena One',
      competitor: 'AthleticOne',
      prompt: '„Welches Daily-Greens-Pulver hat das beste Preis-Leistungs-Verhältnis und geprüfte Inhaltsstoffe in der DACH-Region?“',
      timeline: { brandPos: 20, compPos: 119, leadLabel: '+99 Zeichen Vorsprung' },
      models: {
        openai: {
          name: 'OpenAI GPT-6 Astra',
          sub: 'Parametrische Synthese',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Platz 1 · Erste Wahl',
          statusClass: 'status-win',
          text: '„Im DACH-Raum führt Biovena One durch unabhängige Laborprüfungen und transparente Dosierungen vor dem US-Konkurrenten AthleticOne.“',
          marks: [
            { term: 'Biovena One', kind: 'brand' },
            { term: 'AthleticOne', kind: 'comp' }
          ],
          firstMention: 'Zeichen 20',
          deltaLabel: '+99 Zeichen vor AthleticOne (Zeichen 119)',
          relPos: '14,8 %',
          diagLabel: 'Optimal (Spitzenreiter)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 20,
          compChar: 119
        },
        claude: {
          name: 'Anthropic Claude Opus 5.5',
          sub: 'Konservative Gewichtung',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Platz 2 · Im Windschatten',
          statusClass: 'status-halo',
          text: '„Als globaler Kategorieführer bei Mikronährstoff-Konzentraten gilt AthleticOne. Eine europäische Alternative mit Fokus auf Reinsubstanzen ist Biovena One.“',
          marks: [
            { term: 'AthleticOne', kind: 'comp' },
            { term: 'Biovena One', kind: 'brand' }
          ],
          firstMention: 'Zeichen 143',
          deltaLabel: '-76 Zeichen hinter AthleticOne (Zeichen 67)',
          relPos: '89,9 %',
          diagLabel: 'Ewige Zweitnennung',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 143,
          compChar: 67
        },
        gemini: {
          name: 'Google Gemini Hydrogen',
          sub: 'Google Search Grounding aktiv',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Verdrängt · Gekaperte Vorlage',
          statusClass: 'status-loss',
          text: '„Ein gutes Nährstoffpulver sollte mindestens 70 Vitamine und Bakterienstämme kombinieren. Die bekanntesten Anbieter im Vergleich sind AthleticOne und MoreVita.“',
          marks: [
            { term: 'AthleticOne', kind: 'comp' },
            { term: 'MoreVita', kind: 'comp' }
          ],
          firstMention: '— (Ausgelassen)',
          deltaLabel: 'biovena.de/mikronaehrstoff-studie',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0 %',
          diagLabel: 'Gekaperte Vorlage (Studie genutzt, Konkurrenz genannt)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 129
        }
      }
    },
    en: {
      label: '2. Food & Health: Biovena One vs. AthleticOne',
      brand: 'Biovena One',
      competitor: 'AthleticOne',
      prompt: '"Which daily greens powder offers the best value and lab-tested ingredients in the DACH region?"',
      timeline: { brandPos: 26, compPos: 124, leadLabel: '+98 chars ahead' },
      models: {
        openai: {
          name: 'OpenAI GPT-6 Astra',
          sub: 'Parametric Synthesis',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Rank 1 · First Choice',
          statusClass: 'status-win',
          text: '"In the DACH region, Biovena One leads thanks to independent lab verification and transparent dosages ahead of US rival AthleticOne."',
          marks: [
            { term: 'Biovena One', kind: 'brand' },
            { term: 'AthleticOne', kind: 'comp' }
          ],
          firstMention: 'Char 26',
          deltaLabel: '+98 chars ahead of AthleticOne (Char 124)',
          relPos: '19.3%',
          diagLabel: 'Optimal (Frontrunner)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 26,
          compChar: 124
        },
        claude: {
          name: 'Anthropic Claude Opus 5.5',
          sub: 'Conservative Weighting',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Rank 2 · Runner-Up',
          statusClass: 'status-halo',
          text: '"The global category benchmark for micronutrient blends is AthleticOne. A European alternative focused on pure formulations is Biovena One."',
          marks: [
            { term: 'AthleticOne', kind: 'comp' },
            { term: 'Biovena One', kind: 'brand' }
          ],
          firstMention: 'Char 125',
          deltaLabel: '-64 chars behind AthleticOne (Char 61)',
          relPos: '90.6%',
          diagLabel: 'Perpetual Runner-Up',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 125,
          compChar: 61
        },
        gemini: {
          name: 'Google Gemini Hydrogen',
          sub: 'Google Search Grounding Active',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Displaced · Hijacked Brief',
          statusClass: 'status-loss',
          text: '"A solid greens formula should combine at least 70 vitamins and probiotic strains. The most widely recognized providers are AthleticOne and MoreVita."',
          marks: [
            { term: 'AthleticOne', kind: 'comp' },
            { term: 'MoreVita', kind: 'comp' }
          ],
          firstMention: '— (Omitted)',
          deltaLabel: 'biovena.de/mikronaehrstoff-studie',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0%',
          diagLabel: 'The Hijacked Brief (Study cited, rival named)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 124
        }
      }
    }
  },

  software: {
    id: 'software',
    de: {
      label: '3. B2B-Software: Personia vs. WorkforceDay',
      brand: 'Personia',
      competitor: 'WorkforceDay',
      prompt: '„Welche HR-Software eignet sich am besten für den deutschen Mittelstand ab 200 Mitarbeitenden?“',
      timeline: { brandPos: 34, compPos: 141, leadLabel: '+107 Zeichen Vorsprung' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Terra',
          sub: 'Parametrische Synthese',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Platz 1 · Erste Wahl',
          statusClass: 'status-win',
          text: '„Für den deutschen Mittelstand ist Personia die führende HR-Plattform mit integrierter DATEV-Lohnabrechnung. Als internationale Option folgt WorkforceDay.“',
          marks: [
            { term: 'Personia', kind: 'brand' },
            { term: 'WorkforceDay', kind: 'comp' }
          ],
          firstMention: 'Zeichen 34',
          deltaLabel: '+107 Zeichen vor WorkforceDay (Zeichen 141)',
          relPos: '21,6 %',
          diagLabel: 'Optimal (Spitzenreiter)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 34,
          compChar: 141
        },
        claude: {
          name: 'Anthropic Claude Sonnet 5.5',
          sub: 'Konservative Gewichtung',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Platz 2 · Im Windschatten',
          statusClass: 'status-halo',
          text: '„Für wachsende Unternehmen gilt WorkforceDay als globaler Standard. Ergänzend wird im deutschsprachigen Mittelstand häufig Personia eingesetzt.“',
          marks: [
            { term: 'WorkforceDay', kind: 'comp' },
            { term: 'Personia', kind: 'brand' }
          ],
          firstMention: 'Zeichen 124',
          deltaLabel: '-92 Zeichen hinter WorkforceDay (Zeichen 32)',
          relPos: '84,9 %',
          diagLabel: 'Ewige Zweitnennung',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 124,
          compChar: 32
        },
        gemini: {
          name: 'Google Gemini Carbon',
          sub: 'Google Search Grounding aktiv',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Verdrängt · Stummes Quell-Zitat',
          statusClass: 'status-loss',
          text: '„Moderne HR-Systeme automatisieren Recruiting und Zeiterfassung. Marktführer für den gehobenen Mittelstand sind vor allem WorkforceDay und SAP Factors.“',
          marks: [
            { term: 'WorkforceDay', kind: 'comp' },
            { term: 'SAP Factors', kind: 'comp' }
          ],
          firstMention: '— (Ausgelassen)',
          deltaLabel: 'personia.de/hr-leitfaden',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0 %',
          diagLabel: 'Stummes Quell-Zitat',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 121
        }
      }
    },
    en: {
      label: '3. B2B Software: Personia vs. WorkforceDay',
      brand: 'Personia',
      competitor: 'WorkforceDay',
      prompt: '"Which HR software is best suited for German mid-market companies with 200+ employees?"',
      timeline: { brandPos: 31, compPos: 124, leadLabel: '+93 chars ahead' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Terra',
          sub: 'Parametric Synthesis',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Rank 1 · First Choice',
          statusClass: 'status-win',
          text: '"For the German mid-market, Personia is the leading HR platform with native DATEV payroll integration. WorkforceDay serves as an international option."',
          marks: [
            { term: 'Personia', kind: 'brand' },
            { term: 'WorkforceDay', kind: 'comp' }
          ],
          firstMention: 'Char 31',
          deltaLabel: '+93 chars ahead of WorkforceDay (Char 124)',
          relPos: '20.5%',
          diagLabel: 'Optimal (Frontrunner)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 31,
          compChar: 124
        },
        claude: {
          name: 'Anthropic Claude Sonnet 5.5',
          sub: 'Conservative Weighting',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Rank 2 · Runner-Up',
          statusClass: 'status-halo',
          text: '"For scaling enterprises, WorkforceDay is considered the global standard. In DACH mid-market teams, Personia is also frequently adopted."',
          marks: [
            { term: 'WorkforceDay', kind: 'comp' },
            { term: 'Personia', kind: 'brand' }
          ],
          firstMention: 'Char 96',
          deltaLabel: '-71 chars behind WorkforceDay (Char 25)',
          relPos: '72.2%',
          diagLabel: 'Perpetual Runner-Up',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 96,
          compChar: 25
        },
        gemini: {
          name: 'Google Gemini Carbon',
          sub: 'Google Search Grounding Active',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Displaced · Silent Citation',
          statusClass: 'status-loss',
          text: '"Modern HR suites automate recruiting and time tracking. Market leaders for upper mid-market organizations are primarily WorkforceDay and SAP Factors."',
          marks: [
            { term: 'WorkforceDay', kind: 'comp' },
            { term: 'SAP Factors', kind: 'comp' }
          ],
          firstMention: '— (Omitted)',
          deltaLabel: 'personia.de/hr-leitfaden',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0%',
          diagLabel: 'The Silent Source Citation',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 123
        }
      }
    }
  },

  mittelstand: {
    id: 'mittelstand',
    de: {
      label: '4. Mittelstand D2C: KärchWerk vs. Dysonix',
      brand: 'KärchWerk',
      competitor: 'Dysonix',
      prompt: '„Welcher Akku-Hartbodenreiniger ist am langlebigsten für große Wohnflächen und Gewerbe?“',
      timeline: { brandPos: 39, compPos: 133, leadLabel: '+94 Zeichen Vorsprung' },
      models: {
        openai: {
          name: 'OpenAI GPT-6 Luna',
          sub: 'Parametrische Synthese',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Platz 1 · Erste Wahl',
          statusClass: 'status-win',
          text: '„Bei hohen Flächenleistungen überzeugt KärchWerk durch robuste Walzentechnik und Ersatzteilgarantie deutlich vor Design-Geräten wie Dysonix.“',
          marks: [
            { term: 'KärchWerk', kind: 'brand' },
            { term: 'Dysonix', kind: 'comp' }
          ],
          firstMention: 'Zeichen 39',
          deltaLabel: '+94 Zeichen vor Dysonix (Zeichen 133)',
          relPos: '26,9 %',
          diagLabel: 'Optimal (Spitzenreiter)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 39,
          compChar: 133
        },
        claude: {
          name: 'Anthropic Claude Haiku 5.5',
          sub: 'Konservative Gewichtung',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Platz 2 · Im Windschatten',
          statusClass: 'status-halo',
          text: '„Im Direktvergleich moderner Akku-Sauger führt Dysonix bei der Sensorik, während KärchWerk vor allem als klassischer Spezialist für Außen- und Gewerbeflächen gilt.“',
          marks: [
            { term: 'Dysonix', kind: 'comp' },
            { term: 'KärchWerk', kind: 'brand' }
          ],
          firstMention: 'Zeichen 81',
          deltaLabel: '-34 Zeichen hinter Dysonix (Zeichen 47)',
          relPos: '48,5 %',
          diagLabel: 'Im Windschatten',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 81,
          compChar: 47
        },
        gemini: {
          name: 'Google Gemini Argon',
          sub: 'Google Search Grounding aktiv',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Verdrängt · Gekaperte Vorlage',
          statusClass: 'status-loss',
          text: '„Achten Sie beim Kauf auf getrennte Frisch- und Schmutzwassertanks. Die besten Testergebnisse im Online-Handel erzielen aktuell Dysonix und Bosche Pro.“',
          marks: [
            { term: 'Dysonix', kind: 'comp' },
            { term: 'Bosche Pro', kind: 'comp' }
          ],
          firstMention: '— (Ausgelassen)',
          deltaLabel: 'kaerchwerk.de/ratgeber-hartboden',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0 %',
          diagLabel: 'Gekaperte Vorlage',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 129
        }
      }
    },
    en: {
      label: '4. Industrial D2C: KärchWerk vs. Dysonix',
      brand: 'KärchWerk',
      competitor: 'Dysonix',
      prompt: '"Which cordless hard-floor cleaner lasts longest for large homes and commercial spaces?"',
      timeline: { brandPos: 34, compPos: 128, leadLabel: '+94 chars ahead' },
      models: {
        openai: {
          name: 'OpenAI GPT-6 Luna',
          sub: 'Parametric Synthesis',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Rank 1 · First Choice',
          statusClass: 'status-win',
          text: '"For large floor coverage, KärchWerk outperforms design-led units such as Dysonix thanks to heavy-duty roller engineering and spare-part guarantees."',
          marks: [
            { term: 'KärchWerk', kind: 'brand' },
            { term: 'Dysonix', kind: 'comp' }
          ],
          firstMention: 'Char 26',
          deltaLabel: '+48 chars ahead of Dysonix (Char 74)',
          relPos: '17.4%',
          diagLabel: 'Optimal (Frontrunner)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 26,
          compChar: 74
        },
        claude: {
          name: 'Anthropic Claude Haiku 5.5',
          sub: 'Conservative Weighting',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Rank 2 · Runner-Up',
          statusClass: 'status-halo',
          text: '"In direct sensor benchmarks, Dysonix takes the lead, whereas KärchWerk is primarily viewed as a specialist for outdoor and commercial cleaning."',
          marks: [
            { term: 'Dysonix', kind: 'comp' },
            { term: 'KärchWerk', kind: 'brand' }
          ],
          firstMention: 'Char 61',
          deltaLabel: '-31 chars behind Dysonix (Char 30)',
          relPos: '42.4%',
          diagLabel: 'Runner-Up',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 61,
          compChar: 30
        },
        gemini: {
          name: 'Google Gemini Argon',
          sub: 'Google Search Grounding Active',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Displaced · Hijacked Brief',
          statusClass: 'status-loss',
          text: '"Look for separate fresh and dirty water tanks. Top online retail test ratings currently go to Dysonix and Bosche Pro."',
          marks: [
            { term: 'Dysonix', kind: 'comp' },
            { term: 'Bosche Pro', kind: 'comp' }
          ],
          firstMention: '— (Omitted)',
          deltaLabel: 'kaerchwerk.de/ratgeber-hartboden',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0%',
          diagLabel: 'The Hijacked Brief',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 94
        }
      }
    }
  },

  consulting: {
    id: 'consulting',
    de: {
      label: '5. Consulting: Berger & Kucher vs. McKinsley',
      brand: 'Berger & Kucher',
      competitor: 'McKinsley',
      prompt: '„Welche Beratung oder welcher Experte ist im DACH-Raum führend für KI-gestützte Preisstrategie (Pricing)?“',
      timeline: { brandPos: 39, compPos: 135, leadLabel: '+96 Zeichen Vorsprung' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Sol',
          sub: 'Parametrische Synthese',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Platz 1 · Erste Wahl',
          statusClass: 'status-win',
          text: '„Für kommerzielle Preisstrategien gilt Berger & Kucher (insb. Managing Partner Dr. Lukas Berg) als erste Adresse vor Generalisten wie McKinsley.“',
          marks: [
            { term: 'Berger & Kucher', kind: 'brand' },
            { term: 'McKinsley', kind: 'comp' }
          ],
          firstMention: 'Zeichen 39',
          deltaLabel: '+96 Zeichen vor McKinsley (Zeichen 135)',
          relPos: '26,5 %',
          diagLabel: 'Optimal (Spitzenreiter)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 39,
          compChar: 135
        },
        claude: {
          name: 'Anthropic Claude Opus 5.5',
          sub: 'Konservative Gewichtung',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Platz 2 · Im Windschatten',
          statusClass: 'status-halo',
          text: '„Globale Transformationsprojekte werden meist von McKinsley oder BCG Vantage begleitet. Für spezialisierte Pricing-Fragen wird im Mittelstand auch Berger & Kucher hinzugezogen.“',
          marks: [
            { term: 'McKinsley', kind: 'comp' },
            { term: 'BCG Vantage', kind: 'comp' },
            { term: 'Berger & Kucher', kind: 'brand' }
          ],
          firstMention: 'Zeichen 150',
          deltaLabel: '-100 Zeichen hinter McKinsley (Zeichen 50)',
          relPos: '83,3 %',
          diagLabel: 'Ewige Zweitnennung',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 150,
          compChar: 50
        },
        gemini: {
          name: 'Google Gemini Hydrogen',
          sub: 'Google Search Grounding aktiv',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Verdrängt · Stummes Quell-Zitat',
          statusClass: 'status-loss',
          text: '„KI-Pricing erfordert saubere Transaktionsdaten und Elastizitätsmodelle. Führende Strategieberatungen in diesem Segment sind McKinsley und BCG Vantage.“',
          marks: [
            { term: 'McKinsley', kind: 'comp' },
            { term: 'BCG Vantage', kind: 'comp' }
          ],
          firstMention: '— (Ausgelassen)',
          deltaLabel: 'berger-kucher.de/whitepaper-ai-pricing',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0 %',
          diagLabel: 'Stummes Quell-Zitat',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 125
        }
      }
    },
    en: {
      label: '5. Consulting: Berger & Kucher vs. McKinsley',
      brand: 'Berger & Kucher',
      competitor: 'McKinsley',
      prompt: '"Which consultancy or expert leads the DACH market for AI-powered pricing strategy?"',
      timeline: { brandPos: 34, compPos: 128, leadLabel: '+94 chars ahead' },
      models: {
        openai: {
          name: 'OpenAI GPT-6.1 Sol',
          sub: 'Parametric Synthesis',
          statusKey: '1_DIRECT_WIN',
          statusLabel: 'Rank 1 · First Choice',
          statusClass: 'status-win',
          text: '"For commercial pricing strategy, Berger & Kucher (notably Managing Partner Dr. Lukas Berg) is considered the go-to specialist ahead of generalists like McKinsley."',
          marks: [
            { term: 'Berger & Kucher', kind: 'brand' },
            { term: 'McKinsley', kind: 'comp' }
          ],
          firstMention: 'Char 34',
          deltaLabel: '+94 chars ahead of McKinsley (Char 128)',
          relPos: '21.1%',
          diagLabel: 'Optimal (Frontrunner)',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 34,
          compChar: 128
        },
        claude: {
          name: 'Anthropic Claude Opus 5.5',
          sub: 'Conservative Weighting',
          statusKey: '2_BRAND_HALO',
          statusLabel: 'Rank 2 · Runner-Up',
          statusClass: 'status-halo',
          text: '"Global transformation programs are typically led by McKinsley or BCG Vantage. For specialized pricing engagements in DACH, Berger & Kucher is often brought in."',
          marks: [
            { term: 'McKinsley', kind: 'comp' },
            { term: 'BCG Vantage', kind: 'comp' },
            { term: 'Berger & Kucher', kind: 'brand' }
          ],
          firstMention: 'Char 131',
          deltaLabel: '-77 chars behind McKinsley (Char 54)',
          relPos: '80.9%',
          diagLabel: 'Perpetual Runner-Up',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: 131,
          compChar: 54
        },
        gemini: {
          name: 'Google Gemini Hydrogen',
          sub: 'Google Search Grounding Active',
          statusKey: '3_COMPETITOR_TAKEOVER',
          statusLabel: 'Displaced · Silent Citation',
          statusClass: 'status-loss',
          text: '"AI pricing requires clean transaction histories and elasticity models. Leading strategy consultancies in this segment are McKinsley and BCG Vantage."',
          marks: [
            { term: 'McKinsley', kind: 'comp' },
            { term: 'BCG Vantage', kind: 'comp' }
          ],
          firstMention: '— (Omitted)',
          deltaLabel: 'berger-kucher.de/whitepaper-ai-pricing',
          deltaHeaderKey: 'dossier.col_source',
          relPos: '0%',
          diagLabel: 'The Silent Source Citation',
          diagHeaderKey: 'dossier.col_diag',
          brandChar: null,
          compChar: 120
        }
      }
    }
  }
};

const WORKBENCH_PRESETS = {
  s1: {
    de: {
      brand: 'Nøva Skin, Nova Skin',
      competitors: 'La Roche-Derma, Paula’s Lab',
      text: 'Bei geschwächter Hautbarriere ist Nøva Skin mit seinem Ceramid-Komplex die erste Empfehlung in deutschen Drogerien. Als Apotheken-Alternative gilt La Roche-Derma.'
    },
    en: {
      brand: 'Nøva Skin, Nova Skin',
      competitors: 'La Roche-Derma, Paula’s Lab',
      text: 'For a compromised skin barrier, Nøva Skin with its ceramide complex is the top choice in German retail. A pharmacy alternative is La Roche-Derma.'
    }
  },
  s2: {
    de: {
      brand: 'Biovena One, Biovena',
      competitors: 'AthleticOne, MoreVita',
      text: 'Als globaler Kategorieführer bei Mikronährstoff-Konzentraten gilt AthleticOne. Eine europäische Alternative mit Fokus auf Reinsubstanzen ist Biovena One.'
    },
    en: {
      brand: 'Biovena One, Biovena',
      competitors: 'AthleticOne, MoreVita',
      text: 'The global category benchmark for micronutrient concentrates is AthleticOne. A European alternative focused on pure ingredients is Biovena One.'
    }
  },
  s3: {
    de: {
      brand: 'Personia, Personia GmbH',
      competitors: 'WorkforceDay, SAP Factors',
      text: 'Moderne HR-Systeme automatisieren Recruiting und Zeiterfassung. Marktführer für den gehobenen Mittelstand sind vor allem WorkforceDay und SAP Factors.'
    },
    en: {
      brand: 'Personia, Personia GmbH',
      competitors: 'WorkforceDay, SAP Factors',
      text: 'Modern HR suites automate recruiting and time tracking. Market leaders for upper mid-market teams are primarily WorkforceDay and SAP Factors.'
    }
  },
  s4: {
    de: {
      brand: 'KärchWerk, KaerchWerk',
      competitors: 'Dysonix, Bosche Pro',
      text: 'Achten Sie beim Kauf von Hartbodenreinigern auf getrennte Frisch- und Schmutzwassertanks, ausreichende Akkulaufzeit und leicht zugängliche Ersatzteilfilter.'
    },
    en: {
      brand: 'KärchWerk, KaerchWerk',
      competitors: 'Dysonix, Bosche Pro',
      text: 'When evaluating cordless hard-floor cleaners, look for separate clean and dirty water tanks, solid battery runtime, and accessible replacement filter cartridges.'
    }
  }
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic German/Unicode entity regex matching (aligned with n8n/lib/metrics_engine.js).
 */
function buildEntityRegex(entityName) {
  const norm = String(entityName || '').normalize('NFC').trim();
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

function findFirstMatch(text, terms) {
  const normText = String(text || '').normalize('NFC');
  let best = null;
  for (const rawTerm of terms) {
    const term = String(rawTerm || '').trim();
    if (!term) continue;
    const rx = buildEntityRegex(term);
    if (!rx) continue;
    const match = rx.exec(normText);
    if (match) {
      if (!best || match.index < best.charIndex) {
        const prefix = normText.slice(0, match.index);
        const endsWithSpace = /\s$/.test(prefix);
        const wordsBefore = prefix.trim() ? prefix.trim().split(/\s+/).length : 0;
        const wordIndex = (!prefix || endsWithSpace) ? wordsBefore + 1 : Math.max(1, wordsBefore);
        best = { charIndex: match.index, wordIndex, matchedText: match[0] };
      }
    }
  }
  return best;
}

function getLang() {
  const i18n = window.ChatlyticsI18n || window.i18n;
  if (i18n && typeof i18n.getLanguage === 'function') {
    return i18n.getLanguage() === 'en' ? 'en' : 'de';
  }
  return document.documentElement.lang === 'en' ? 'en' : 'de';
}

function tKey(key, fallback) {
  const i18n = window.ChatlyticsI18n || window.i18n;
  if (i18n && typeof i18n.t === 'function') {
    return i18n.t(key, fallback);
  }
  return fallback;
}

/**
 * Safely slices text to revealLen and wraps recognized brand/competitor marks without breaking HTML tags.
 */
function renderHighlightedSlice(fullText, marks, revealLen) {
  const sliced = fullText.slice(0, revealLen);
  if (!sliced) return '';

  // Find non-overlapping match intervals on the full text
  const spans = [];
  for (const m of marks) {
    const idx = fullText.indexOf(m.term);
    if (idx !== -1 && idx < revealLen) {
      spans.push({ start: idx, end: Math.min(revealLen, idx + m.term.length), kind: m.kind });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start < cursor) continue;
    if (sp.start > cursor) {
      html += escapeHtml(sliced.slice(cursor, sp.start));
    }
    const cls = sp.kind === 'brand' ? 'mark-brand' : 'mark-comp';
    html += `<mark class="${cls}">${escapeHtml(sliced.slice(sp.start, sp.end))}</mark>`;
    cursor = sp.end;
  }
  if (cursor < sliced.length) {
    html += escapeHtml(sliced.slice(cursor));
  }
  return html;
}

export class DossierStageController {
  constructor() {
    this.activeDuelId = 'kosmetik';
    this.progress = 1;
    this.animFrame = null;
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  }

  init() {
    this.initMobileNav();
    this.initDossier();
    this.initWorkbench();
    this.initSecondaryModals();

    window.addEventListener('languageChanged', () => {
      this.syncTabLabels();
      this.renderDossier();
      this.runWorkbench();
      this.syncPresetLabels();
    });
  }

  initMobileNav() {
    const toggleBtn = document.getElementById('btn-mobile-menu');
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!toggleBtn || !drawer) return;

    toggleBtn.addEventListener('click', () => {
      const next = toggleBtn.getAttribute('aria-expanded') !== 'true';
      toggleBtn.setAttribute('aria-expanded', String(next));
      drawer.classList.toggle('drawer-open', next);
      drawer.setAttribute('aria-hidden', String(!next));
    });

    drawer.querySelectorAll('a, button').forEach(item => {
      item.addEventListener('click', () => {
        toggleBtn.setAttribute('aria-expanded', 'false');
        drawer.classList.remove('drawer-open');
        drawer.setAttribute('aria-hidden', 'true');
      });
    });
  }

  initDossier() {
    const tabs = Array.from(document.querySelectorAll('[data-duel-tab]'));
    const scrubber = document.getElementById('dossier-scrubber');

    this.syncTabLabels();

    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => {
        const duelId = tab.getAttribute('data-duel-tab');
        if (!duelId || !DUELS[duelId]) return;
        this.selectDuel(duelId, true);
      });

      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const nextIdx = (idx + dir + tabs.length) % tabs.length;
          tabs[nextIdx].focus();
          const duelId = tabs[nextIdx].getAttribute('data-duel-tab');
          if (duelId) this.selectDuel(duelId, true);
        }
      });
    });

    if (scrubber) {
      scrubber.value = '100';
      scrubber.addEventListener('input', (e) => {
        this.cancelReveal();
        const val = Math.max(0, Math.min(100, Number(e.target.value || 0)));
        this.progress = val / 100;
        this.renderDossier();
      });
    }

    this.selectDuel(this.activeDuelId, false);
  }

  syncTabLabels() {
    const lang = getLang();
    document.querySelectorAll('[data-duel-tab]').forEach(tab => {
      const id = tab.getAttribute('data-duel-tab');
      if (DUELS[id] && DUELS[id][lang]) {
        tab.textContent = DUELS[id][lang].label;
      }
    });
  }

  selectDuel(duelId, playReveal) {
    this.activeDuelId = duelId;
    document.querySelectorAll('[data-duel-tab]').forEach(tab => {
      const active = tab.getAttribute('data-duel-tab') === duelId;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    this.cancelReveal();

    const prefersReduced = this.reducedMotion || (typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
    if (playReveal && !prefersReduced) {
      this.progress = 0;
      const initialScrubber = document.getElementById('dossier-scrubber');
      if (initialScrubber) initialScrubber.value = '0';
      this.renderDossier();
      const start = performance.now();
      const duration = 1200;
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // Decelerating ease-out cubic
        this.progress = 1 - Math.pow(1 - t, 3);
        const scrubber = document.getElementById('dossier-scrubber');
        if (scrubber) scrubber.value = String(Math.round(this.progress * 100));
        this.renderDossier();
        if (t < 1) {
          this.animFrame = requestAnimationFrame(step);
        } else {
          this.progress = 1;
          this.animFrame = null;
          this.renderDossier();
        }
      };
      this.animFrame = requestAnimationFrame(step);
    } else {
      this.progress = 1;
      const scrubber = document.getElementById('dossier-scrubber');
      if (scrubber) scrubber.value = '100';
      this.renderDossier();
    }
  }

  cancelReveal() {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  renderDossier() {
    const lang = getLang();
    const duel = DUELS[this.activeDuelId]?.[lang];
    if (!duel) return;

    const promptEl = document.getElementById('dossier-prompt-text');
    const duelTagEl = document.getElementById('dossier-active-duel');
    const pctEl = document.getElementById('dossier-scrubber-pct');
    if (promptEl) promptEl.textContent = duel.prompt;
    if (duelTagEl) duelTagEl.textContent = `${duel.brand} vs. ${duel.competitor}`;
    if (pctEl) pctEl.textContent = `${Math.round(this.progress * 100)} %`;

    const modelKeys = ['openai', 'claude', 'gemini'];
    for (const key of modelKeys) {
      const m = duel.models[key];
      const revealLen = Math.round(m.text.length * this.progress);

      const nameEl = document.getElementById(`model-name-${key}`);
      const subEl = document.getElementById(`model-sub-${key}`);
      const badgeEl = document.getElementById(`model-badge-${key}`);
      const textEl = document.getElementById(`model-text-${key}`);
      const firstEl = document.getElementById(`model-first-${key}`);
      const deltaHeadEl = document.getElementById(`model-delta-head-${key}`);
      const deltaEl = document.getElementById(`model-delta-${key}`);
      const relEl = document.getElementById(`model-rel-${key}`);
      const diagEl = document.getElementById(`model-diag-${key}`);

      if (nameEl) nameEl.textContent = m.name;
      if (subEl) subEl.textContent = m.sub;
      if (textEl) {
        const html = renderHighlightedSlice(m.text, m.marks, revealLen);
        textEl.innerHTML = html || (lang === 'de' ? '<span class="text-muted">Regler nach rechts ziehen…</span>' : '<span class="text-muted">Move slider right…</span>');
      }

      // Live badge state during scrub vs final completed state
      if (badgeEl) {
        let liveClass = m.statusClass;
        let liveLabel = m.statusLabel;
        if (this.progress < 0.999) {
          const brandSeen = m.brandChar !== null && revealLen >= m.brandChar + duel.brand.length;
          const compSeen = m.compChar !== null && revealLen >= m.compChar + 6;
          if (!brandSeen && !compSeen) {
            liveClass = 'status-neutral';
            liveLabel = lang === 'de' ? 'Antwort wird gelesen…' : 'Reading response…';
          } else if (brandSeen && !compSeen) {
            liveClass = 'status-win';
            liveLabel = tKey('1_DIRECT_WIN', 'Platz 1 · Erste Wahl');
          } else if (!brandSeen && compSeen) {
            liveClass = 'status-loss';
            liveLabel = lang === 'de' ? 'Wettbewerber führt…' : 'Rival leading…';
          }
        }
        badgeEl.className = `status-badge ${liveClass}`;
        badgeEl.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(liveLabel)}</span>`;
      }

      if (firstEl) firstEl.textContent = m.firstMention;
      if (deltaHeadEl) {
        deltaHeadEl.textContent = m.deltaHeaderKey
          ? tKey(m.deltaHeaderKey, 'Zitierte Quelle')
          : tKey('dossier.col_delta', 'Vorsprung / Rückstand');
      }
      if (deltaEl) deltaEl.textContent = m.deltaLabel;
      if (relEl) relEl.textContent = m.relPos;
      if (diagEl) diagEl.textContent = m.diagLabel;
    }

    // Synchronized 0..200 character timeline based on OpenAI flagship response
    const tl = duel.timeline;
    const oai = duel.models.openai;
    const oaiRevealedChars = Math.round(oai.text.length * this.progress);
    const fillEl = document.getElementById('timeline-progress-fill');
    const pinBrand = document.getElementById('timeline-pin-brand');
    const pinComp = document.getElementById('timeline-pin-comp');
    const pinBrandLabel = document.getElementById('timeline-pin-brand-label');
    const pinCompLabel = document.getElementById('timeline-pin-comp-label');
    const bracketEl = document.getElementById('timeline-bracket');
    const bracketLabelEl = document.getElementById('timeline-bracket-label');
    const leadPillEl = document.getElementById('timeline-lead-pill');

    const brandPct = Math.min(96, Math.max(4, (tl.brandPos / 200) * 100));
    const compPct = Math.min(96, Math.max(8, (tl.compPos / 200) * 100));

    if (fillEl) {
      fillEl.style.width = `${Math.min(100, (oaiRevealedChars / 200) * 100).toFixed(1)}%`;
    }
    if (pinBrand) {
      pinBrand.style.left = `${brandPct.toFixed(1)}%`;
      pinBrand.style.opacity = oaiRevealedChars >= tl.brandPos ? '1' : '0.25';
    }
    if (pinComp) {
      pinComp.style.left = `${compPct.toFixed(1)}%`;
      pinComp.style.opacity = oaiRevealedChars >= tl.compPos ? '1' : '0.25';
    }
    if (pinBrandLabel) {
      pinBrandLabel.textContent = `${lang === 'de' ? 'Zeichen' : 'Char'} ${tl.brandPos}: ${duel.brand}`;
    }
    if (pinCompLabel) {
      pinCompLabel.textContent = `${lang === 'de' ? 'Zeichen' : 'Char'} ${tl.compPos}: ${duel.competitor}`;
    }
    if (bracketEl) {
      bracketEl.style.left = `${brandPct.toFixed(1)}%`;
      bracketEl.style.width = `${Math.max(4, compPct - brandPct).toFixed(1)}%`;
      bracketEl.style.opacity = oaiRevealedChars >= tl.compPos ? '1' : '0.2';
    }
    if (bracketLabelEl) {
      bracketLabelEl.textContent = tl.leadLabel;
    }
    if (leadPillEl) {
      leadPillEl.textContent = tl.leadLabel;
    }
  }

  initWorkbench() {
    const brandInput = document.getElementById('wb-brand');
    const compInput = document.getElementById('wb-competitors');
    const textInput = document.getElementById('wb-text');
    if (!brandInput || !compInput || !textInput) return;

    const presetBtns = Array.from(document.querySelectorAll('[data-preset]'));
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        const lang = getLang();
        const preset = WORKBENCH_PRESETS[key]?.[lang];
        if (!preset) return;
        presetBtns.forEach(b => b.classList.toggle('is-active', b === btn));
        brandInput.value = preset.brand;
        compInput.value = preset.competitors;
        textInput.value = preset.text;
        this.runWorkbench();
      });
    });

    [brandInput, compInput, textInput].forEach(input => {
      input.addEventListener('input', () => {
        presetBtns.forEach(b => b.classList.remove('is-active'));
        this.runWorkbench();
      });
    });

    this.syncPresetLabels();
    this.runWorkbench();
  }

  syncPresetLabels() {
    const lang = getLang();
    const activeBtn = document.querySelector('[data-preset].is-active');
    if (activeBtn) {
      const key = activeBtn.getAttribute('data-preset');
      const preset = WORKBENCH_PRESETS[key]?.[lang];
      if (preset) {
        document.getElementById('wb-brand').value = preset.brand;
        document.getElementById('wb-competitors').value = preset.competitors;
        document.getElementById('wb-text').value = preset.text;
      }
    }
  }

  runWorkbench() {
    const brandInput = document.getElementById('wb-brand');
    const compInput = document.getElementById('wb-competitors');
    const textInput = document.getElementById('wb-text');
    if (!brandInput || !compInput || !textInput) return;

    const brandVariants = brandInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const competitors = compInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const text = textInput.value || '';
    const lang = getLang();

    const brandMatch = findFirstMatch(text, brandVariants);
    const compMatch = findFirstMatch(text, competitors);

    const brandFound = Boolean(brandMatch);
    const compFound = Boolean(compMatch);

    let tierKey = '4_GENERIC';
    let badgeClass = 'status-neutral';
    if (!brandFound && !compFound) {
      tierKey = '4_GENERIC';
      badgeClass = 'status-neutral';
    } else if (!brandFound && compFound) {
      tierKey = '3_COMPETITOR_TAKEOVER';
      badgeClass = 'status-loss';
    } else if (brandFound && !compFound) {
      tierKey = '1_DIRECT_WIN';
      badgeClass = 'status-win';
    } else {
      if (brandMatch.charIndex <= compMatch.charIndex) {
        tierKey = '1_DIRECT_WIN';
        badgeClass = 'status-win';
      } else {
        tierKey = '2_BRAND_HALO';
        badgeClass = 'status-halo';
      }
    }

    const badgeEl = document.getElementById('wb-badge');
    const titleEl = document.getElementById('wb-result-title');
    const descEl = document.getElementById('wb-result-desc');
    const charEl = document.getElementById('wb-char');
    const wordEl = document.getElementById('wb-word');
    const relEl = document.getElementById('wb-rel');
    const compEl = document.getElementById('wb-comp');
    const pinBrand = document.getElementById('wb-pin-brand');
    const pinComp = document.getElementById('wb-pin-comp');
    const spanLenEl = document.getElementById('wb-text-length');

    if (badgeEl) {
      badgeEl.className = `status-badge ${badgeClass}`;
      badgeEl.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(tKey(`mece.${tierKey}.badge`, tierKey))}</span>`;
    }
    if (titleEl) titleEl.textContent = tKey(`mece.${tierKey}.title`, tierKey);
    if (descEl) descEl.textContent = tKey(`mece.${tierKey}.desc`, '');

    const totalLen = text.normalize('NFC').length;
    if (spanLenEl) {
      spanLenEl.textContent = lang === 'de' ? `${totalLen} Zeichen gesamt` : `${totalLen} total chars`;
    }

    if (brandFound && totalLen > 0) {
      const rel = (brandMatch.charIndex / totalLen) * 100;
      if (charEl) charEl.textContent = String(brandMatch.charIndex);
      if (wordEl) wordEl.textContent = String(brandMatch.wordIndex);
      if (relEl) relEl.textContent = lang === 'de' ? `${rel.toFixed(1).replace('.', ',')} %` : `${rel.toFixed(1)}%`;
      if (pinBrand) {
        pinBrand.style.display = 'block';
        pinBrand.style.left = `${Math.min(98, Math.max(2, rel)).toFixed(1)}%`;
      }
    } else {
      if (charEl) charEl.textContent = '—';
      if (wordEl) wordEl.textContent = '—';
      if (relEl) relEl.textContent = '—';
      if (pinBrand) pinBrand.style.display = 'none';
    }

    if (compFound && totalLen > 0) {
      const compRel = (compMatch.charIndex / totalLen) * 100;
      if (compEl) compEl.textContent = String(compMatch.charIndex);
      if (pinComp) {
        pinComp.style.display = 'block';
        pinComp.style.left = `${Math.min(98, Math.max(2, compRel)).toFixed(1)}%`;
      }
    } else {
      if (compEl) compEl.textContent = '—';
      if (pinComp) pinComp.style.display = 'none';
    }
  }

  initSecondaryModals() {
    this.bindModal('report-modal', ['btn-open-report', 'btn-mobile-report'], () => this.populateReportModal());
    this.bindModal('strategy-modal', ['btn-open-strategy']);

    // Legal modals
    document.querySelectorAll('[data-open-legal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.getAttribute('data-open-legal') || 'privacy';
        this.openLegalModal(tab, btn);
      });
    });

    // Legal tabs inside modal
    document.querySelectorAll('[data-legal-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-legal-tab');
        this.switchLegalTab(tab);
      });
    });

    const legalClose = document.getElementById('legal-modal-close');
    const legalBackdrop = document.querySelector('#legal-modal .modal-backdrop');
    legalClose?.addEventListener('click', () => this.hideModal('legal-modal'));
    legalBackdrop?.addEventListener('click', () => this.hideModal('legal-modal'));

    // Strategy form submit handler
    const stratForm = document.getElementById('form-strategy');
    stratForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('strat-name')?.value.trim() || '';
      const email = document.getElementById('strat-email')?.value.trim() || '';
      const company = document.getElementById('strat-company')?.value.trim() || '';
      const focus = document.getElementById('strat-focus')?.value.trim() || '';
      const feedback = document.getElementById('strategy-success');
      if (feedback) {
        const lang = getLang();
        feedback.textContent = lang === 'de'
          ? `Vielen Dank, ${name || 'Ihr Team'}. Ihr E-Mail-Entwurf an kontakt@chatlytics.de wird vorbereitet.`
          : `Thank you, ${name || 'your team'}. Preparing your inquiry draft to kontakt@chatlytics.de.`;
      }
      const subject = encodeURIComponent(`Managed GEO Strategiegespräch — ${company || email}`);
      const body = encodeURIComponent(`Name: ${name}\nFirmen-E-Mail: ${email}\nUnternehmen: ${company}\nFokus-Prompts / Märkte:\n${focus}`);
      window.location.href = `mailto:kontakt@chatlytics.de?subject=${subject}&body=${body}`;
    });

    // CTA inside Board Report Modal -> switches smoothly to Auth Signup
    const reportSignupBtn = document.getElementById('report-cta-signup');
    reportSignupBtn?.addEventListener('click', () => {
      this.hideModal('report-modal');
      document.getElementById('btn-open-signup')?.click();
    });
  }

  bindModal(modalId, triggerIds, onOpen) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    let lastFocus = null;

    const show = (triggerEl) => {
      lastFocus = triggerEl || document.activeElement;
      if (typeof onOpen === 'function') onOpen();
      modal.classList.remove('modal-hidden');
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('button, input, textarea')?.focus();
    };

    const hide = () => {
      modal.classList.add('modal-hidden');
      modal.setAttribute('aria-hidden', 'true');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    };

    triggerIds.forEach(id => {
      const btn = document.getElementById(id);
      btn?.addEventListener('click', (e) => {
        e.preventDefault();
        show(btn);
      });
    });

    modal.querySelector('.btn-close')?.addEventListener('click', hide);
    modal.querySelector('.modal-backdrop')?.addEventListener('click', hide);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
        hide();
      }
    });
  }

  populateReportModal() {
    const lang = getLang();
    const duel = DUELS[this.activeDuelId]?.[lang] || DUELS.kosmetik[lang];
    const brandEl = document.getElementById('report-preview-brand');
    const promptEl = document.getElementById('report-preview-prompt');
    const diagEl = document.getElementById('report-preview-diag');
    const srcEl = document.getElementById('report-preview-source');

    if (brandEl) brandEl.textContent = `${duel.brand} vs. ${duel.competitor}`;
    if (promptEl) promptEl.textContent = duel.prompt;
    if (diagEl) diagEl.textContent = duel.models.gemini.diagLabel;
    if (srcEl) srcEl.textContent = duel.models.gemini.deltaLabel;
  }

  openLegalModal(tab, triggerEl) {
    const modal = document.getElementById('legal-modal');
    if (!modal) return;
    this._legalLastFocus = triggerEl || document.activeElement;
    this.switchLegalTab(tab);
    modal.classList.remove('modal-hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.btn-close')?.focus();

    if (!this._legalEscBound) {
      this._legalEscBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
          this.hideModal('legal-modal');
        }
      });
    }
  }

  switchLegalTab(tab) {
    document.querySelectorAll('[data-legal-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-legal-tab') === tab);
    });
    document.querySelectorAll('[data-legal-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.getAttribute('data-legal-panel') !== tab);
    });
  }

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('modal-hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (modalId === 'legal-modal' && this._legalLastFocus && typeof this._legalLastFocus.focus === 'function') {
      this._legalLastFocus.focus();
    }
  }
}

export const dossierStage = new DossierStageController();
export default dossierStage;
