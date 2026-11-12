/**
 * assets/js/i18n.js
 * Chatlytics.de — Bilingual Internationalization Engine & Dictionaries
 *
 * Requirements:
 * - Bilingual dictionaries in German (de) and English (en).
 * - Full Obsidian Dossier copy & Terminology Replacement Matrix (zero internal enums/jargon in UI).
 * - Locale formatting functions: formatCurrency, formatPercent, formatNumber, formatDate.
 * - Zero external dependencies, isomorphic (Browser ES6 module + Node.js CommonJS).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatlyticsI18n = factory();
    root.i18n = root.ChatlyticsI18n;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'chatlytics_lang';
  const DEFAULT_LANG = 'de';

  const dictionaries = {
    de: {
      // 1. Canonical Brand Statements
      'mission.statement': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics für europäische B2B-Marken.',
      'mission.subtitle': 'Messen und steuern Sie, wie ChatGPT, Claude und Google Gemini Ihre Marke und Wettbewerber wahrnehmen, zitieren und empfehlen. DSGVO-konform, deterministisch und auf Unternehmensebene analysiert.',

      // 2. Navigation (Landing & Shared)
      'nav.brand': 'Chatlytics.de',
      'nav.tagline': 'Share-of-Model & GEO Analytics',
      'nav.dossier': 'Modell-Vergleich',
      'nav.workbench': 'Antwort-Prüfstand',
      'nav.matrix': 'Ursachen-Matrix',
      'nav.pricing': 'Preise',
      'nav.faq': 'FAQ',
      'nav.features': 'Ursachen-Matrix',
      'nav.mece': 'Empfehlungs-Stufen',
      'nav.audit_demo': 'Vorstandsreport',
      'nav.dashboard': 'Dashboard',
      'nav.admin': 'Admin Cockpit',
      'nav.login': 'Login',
      'nav.signup': 'Kostenloses Audit starten',
      'nav.logout': 'Abmelden',
      'nav.home': 'Startseite',
      'nav.menu': 'Menü',
      'nav.billing': 'Abrechnung',
      'nav.settings': 'Einstellungen',

      // 3. Hero Stage (Obsidian)
      'hero.eyebrow': 'SHARE-OF-MODEL & GEO ANALYTICS FÜR MARKEN, MITTELSTAND & BERATUNGEN',
      'hero.title': 'Wen empfiehlt die KI, wenn Ihre Kunden nach dem Marktführer fragen?',
      'hero.subtitle': 'Zehn blaue Google-Links gehören der Vergangenheit an. Ob Hautpflege-Routine, Handwerkstechnik, B2B-Software oder Strategieberatung: Kunden treffen ihre Vorauswahl heute direkt in ChatGPT, Claude und Gemini. Chatlytics misst Zeichen für Zeichen, ob Ihre Marke als Spitzenreiter empfohlen wird, im Windschatten der Konkurrenz landet oder trotz eigener Ratgeber-Artikel komplett verschwiegen wird.',
      'hero.cta_primary': 'Eigene Marke kostenlos prüfen (40 Live-Abfragen)',
      'hero.cta_secondary': 'Beispiel-Vorstandsreport ansehen →',
      'hero.switcher_label': 'Live-Markenduell wählen:',
      'hero.switcher_note': 'Live-Markenduelle (Beispieldaten)',

      // 4. Section 2: Das interaktive Marken-Dossier
      'dossier.eyebrow': 'DER MODELL-VERGLEICH',
      'dossier.title': 'Eine Einkäufer-Frage. Drei Sprachmodelle. Drei völlig andere Marktführer.',
      'dossier.prompt_label': 'Einkäufer-Frage (Prompt)',
      'dossier.scrubber_label': 'Lesefortschritt Zeichen für Zeichen',
      'dossier.scrubber_hint': 'Regler bewegen, um den Antwortaufbau Zeichen für Zeichen nachzuvollziehen.',
      'dossier.openai_sub': 'Parametrische Synthese',
      'dossier.claude_sub': 'Konservative Gewichtung',
      'dossier.gemini_sub': 'Google Search Grounding aktiv',
      'dossier.col_first': 'Erstnennung',
      'dossier.col_delta': 'Vorsprung / Rückstand',
      'dossier.col_rel': 'Position im Text',
      'dossier.col_diag': 'Zitierte Quelle / Diagnose',
      'dossier.col_source': 'Zitierte Quelle',
      'dossier.timeline_title': 'Synchrone Zeichen-Zeitleiste (OpenAI GPT-4o, Skala Zeichen 0 bis 200)',

      // 5. Empfehlungs-Stufen (Mapped from internal enum keys without exposing raw identifiers)
      '1_DIRECT_WIN': 'Platz 1 · Erste Wahl',
      '2_BRAND_HALO': 'Platz 2 · Im Windschatten',
      '3_COMPETITOR_TAKEOVER': 'Verdrängt · Wettbewerbs-Übernahme',
      '4_GENERIC': 'Markenfreie Antwort',

      'mece.section_title': 'Die 4 Empfehlungs-Stufen',
      'mece.section_desc': 'Jede KI-Antwort fällt mathematisch reproduzierbar in genau eine von vier Stufen.',

      'mece.1_DIRECT_WIN.title': 'Spitzenreiter · Erste Wahl',
      'mece.1_DIRECT_WIN.badge': 'Platz 1 · Erste Wahl',
      'mece.1_DIRECT_WIN.desc': 'Ihre Marke fällt als erste Empfehlung im Text und schlägt jeden Wettbewerber in der Lesereihenfolge. Kommerzieller Effekt: Maximale Shortlist-Konvertierung.',

      'mece.2_BRAND_HALO.title': 'Verfolgerplatz · Im Windschatten',
      'mece.2_BRAND_HALO.badge': 'Platz 2 · Im Windschatten',
      'mece.2_BRAND_HALO.desc': 'Ihre Marke wird genannt, erscheint aber erst als nachgelagerte Alternative hinter dem Marktführer. Kommerzieller Effekt: Preis- und Rechtfertigungsdruck.',

      'mece.3_COMPETITOR_TAKEOVER.title': 'Verdrängt · Wettbewerbs-Übernahme',
      'mece.3_COMPETITOR_TAKEOVER.badge': 'Verdrängt · Wettbewerbs-Übernahme',
      'mece.3_COMPETITOR_TAKEOVER.desc': 'Das Modell empfiehlt ausschließlich Ihre Konkurrenten; Ihre Marke fehlt in der Antwort vollständig. Kommerzieller Effekt: Direkter Pipeline- und Warenkorb-Verlust.',

      'mece.4_GENERIC.title': 'Markenfreie Antwort',
      'mece.4_GENERIC.badge': 'Markenfreie Antwort',
      'mece.4_GENERIC.desc': 'Das Modell beantwortet die Fachfrage allgemein, ohne konkrete Anbieter oder Produkte zu nennen. Kommerzieller Effekt: Offenes Potenzial für gezieltes GEO-Content-Seeding.',

      // 6. Ursachen-Matrix (Terminology Replacement Matrix)
      '1_CITATION_HIJACK': 'Die gekaperte Vorlage',
      '2_PARAMETRIC_BLINDSPOT': 'Das stumme Quell-Zitat',
      '3_BRAND_HALO_TRAP': 'Die ewige Zweitnennung',
      '4_BURIED_WINNER': 'Der versteckte Gewinner',
      'NONE': 'Optimal · Spitzenreiter',

      'geo.section_title': 'Ursachen-Diagnose',
      'geo.section_desc': 'Zusammenhang zwischen Quellen-Autorität und Marken-Prominenz im Antworttext.',

      'geo.1_CITATION_HIJACK.title': 'Die gekaperte Vorlage',
      'geo.1_CITATION_HIJACK.condition': 'Fremde/Eigene Vorlage · Wettbewerb erntet Platz 1',
      'geo.1_CITATION_HIJACK.prescription': 'Ihre Fachartikel liefern die Sachfakten im Hintergrund, doch die KI empfiehlt im ersten Satz Ihren Wettbewerber. Strukturierte Vergleichstabellen und klare Positionierungs-Statements direkt in rankende Ratgeber-Seiten einbauen.',
      'geo.1_CITATION_HIJACK.action': 'Strukturierte Vergleichstabellen, objektive Auswahlkriterien und klare Positionierungs-Statements direkt in rankende Ratgeber-Seiten einbauen.',

      'geo.2_PARAMETRIC_BLINDSPOT.title': 'Das stumme Quell-Zitat',
      'geo.2_PARAMETRIC_BLINDSPOT.condition': 'Eigene Quelle zitiert · Marke fehlt im Text',
      'geo.2_PARAMETRIC_BLINDSPOT.prescription': 'Ihre URL wird als Quell-Fußnote geladen, aber im sichtbaren Antworttext fehlt Ihr Markenname komplett. Marken-Entität, Autorenschaft und Produktkategorie im ersten Abschnitt und Schema.org-Markup direkt koppeln.',
      'geo.2_PARAMETRIC_BLINDSPOT.action': 'Marken-Entität, Autorenschaft und Produktkategorie im ersten Abschnitt der zitierten Seite und im Schema.org-Markup direkt koppeln.',

      'geo.3_BRAND_HALO_TRAP.title': 'Die ewige Zweitnennung',
      'geo.3_BRAND_HALO_TRAP.condition': 'Reines Trainingswissen · Dauerhaft Platz 2–3',
      'geo.3_BRAND_HALO_TRAP.prescription': 'Das Modell kennt Ihre Marke, ordnet Sie aber gewohnheitsmäßig hinter dem US-Marktführer ein. Spezifische DACH- und Qualitäts-Attribute gezielt in unabhängigen Fachmedien verankern.',
      'geo.3_BRAND_HALO_TRAP.action': 'Spezifische DACH- und Qualitäts-Attribute gezielt in unabhängigen Fachmedien und Verzeichnissen verankern.',

      'geo.4_BURIED_WINNER.title': 'Der versteckte Gewinner',
      'geo.4_BURIED_WINNER.condition': 'Eigene Quelle zitiert · Späte Nennung (>50 % Text-Offset)',
      'geo.4_BURIED_WINNER.prescription': 'Ihre Marke gewinnt zwar den inhaltlichen Vergleich, taucht aber erst im letzten Absatz auf. TL;DR-Zusammenfassungen und prägnante Einstiegs-Definitionen auf Ihren Hauptseiten schärfen.',
      'geo.4_BURIED_WINNER.action': 'TL;DR-Zusammenfassungen und prägnante Einstiegs-Definitionen auf Ihren Hauptseiten schärfen, damit Sprachmodelle Ihre Marke in den ersten Satz ziehen.',

      'geo.NONE.title': 'Optimal · Spitzenreiter',
      'geo.NONE.condition': 'Stabile Spitzenposition ohne kritische Sichtbarkeitslücken.',
      'geo.NONE.prescription': 'Keine kritischen Abweichungen festgestellt. Ihre Marke führt den Empfehlungstext an.',
      'geo.NONE.action': 'Laufendes Monitoring über alle kaufrelevanten Prompts beibehalten.',

      // 7. Section 3: Der Antwort-Prüfstand
      'workbench.eyebrow': 'DER ANTWORT-PRÜFSTAND',
      'workbench.title': 'Vier eindeutige Empfehlungs-Stufen statt vager Sentiment-Kurven.',
      'workbench.subtitle': 'Für belastbare Wachstums- und SEO-Entscheidungen reichen ungenaue Stimmungs-Scores nicht aus. Jede KI-Antwort fällt mathematisch reproduzierbar in eines von vier kommerziellen Szenarien. Testen Sie unsere Positions-Berechnung live im Browser:',
      'workbench.presets_label': 'Schnellwahl-Presets:',
      'workbench.preset_1': 'Szenario 1: Spitzenreiter (Nøva Skin)',
      'workbench.preset_2': 'Szenario 2: Im Windschatten (Biovena One)',
      'workbench.preset_3': 'Szenario 3: Verdrängt (Personia fehlt)',
      'workbench.preset_4': 'Szenario 4: Markenfreie Antwort',
      'workbench.brand_label': 'Ihre Marke (inkl. Varianten)',
      'workbench.competitors_label': 'Wettbewerber (kommagetrennt)',
      'workbench.text_label': 'KI-Antworttext zum Prüfen',
      'workbench.result_label': 'Erkannte Empfehlungs-Stufe',
      'workbench.pos_bar_label': 'Positions-Leiste (0 % bis 100 % der Textlänge)',
      'workbench.legend_brand': 'Ihre Marke',
      'workbench.legend_comp': '1. Wettbewerber',
      'workbench.metric_char': 'Erstnennung (Zeichen)',
      'workbench.metric_word': 'Erstnennung (Wort)',
      'workbench.metric_rel': 'Position im Text (%)',
      'workbench.metric_comp': '1. Wettbewerber (Zeichen)',

      // 8. Section 4: Die Ursachen-Matrix & 3 DACH Trust Pillars
      'matrix.eyebrow': 'DIE URSACHEN-MATRIX',
      'matrix.title': 'Warum klassisches SEO vor Sprachmodellen blind ist.',
      'matrix.subtitle': 'Sprachmodelle kombinieren antrainiertes Basiswissen mit Echtzeit-Websuche (RAG / Grounding). Unser 4-Felder-Modell trennt sauber zwischen Quellen-Autorität (Y-Achse) und Marken-Prominenz im Antworttext (X-Achse) – damit Ihr Team sofort sieht, welcher Hebel fehlt:',
      'matrix.y_title': 'Quellen-Autorität (Search Grounding & Zitate)',
      'matrix.y_high': 'Eigene Domain als Quelle zitiert',
      'matrix.y_low': 'Fremde Quelle oder reines Trainingswissen',
      'matrix.x_title': 'Marken-Prominenz im Antworttext',
      'matrix.x_low': 'Marke fehlt oder verdrängt',
      'matrix.x_high': 'Marke im Text empfohlen',
      'matrix.label_problem': 'Problem',
      'matrix.label_lever': 'Technischer Hebel',

      'matrix.q1_badge': 'Diagnose 01 · Hohe Dringlichkeit',
      'matrix.q1_title': 'Das stumme Quell-Zitat',
      'matrix.q1_problem': 'Ihre URL (z. B. novaskin.de/ratgeber oder berger-kucher.de/whitepaper) wird von Gemini oder ChatGPT als Quell-Fußnote geladen, aber im sichtbaren Antworttext fehlt Ihr Markenname komplett.',
      'matrix.q1_lever': 'Marken-Entität, Autorenschaft und Produktkategorie im ersten Abschnitt der zitierten Seite und im Schema.org-Markup direkt koppeln.',

      'matrix.q2_badge': 'Diagnose 02 · Quick Win',
      'matrix.q2_title': 'Der versteckte Gewinner',
      'matrix.q2_problem': 'Ihre Marke gewinnt zwar den inhaltlichen Vergleich, taucht aber erst im letzten Absatz auf – dort, wo kaum ein Käufer weiterliest.',
      'matrix.q2_lever': 'TL;DR-Zusammenfassungen und prägnante Einstiegs-Definitionen auf Ihren Hauptseiten schärfen, damit Sprachmodelle Ihre Marke in den ersten Satz ziehen.',

      'matrix.q3_badge': 'Diagnose 03 · Pipeline-Verlust',
      'matrix.q3_title': 'Die gekaperte Vorlage',
      'matrix.q3_problem': 'Ihre Fachartikel liefern die Sachfakten im Hintergrund, doch die KI empfiehlt im ersten Satz Ihren Wettbewerber (AthleticOne, Dysonix).',
      'matrix.q3_lever': 'Strukturierte Vergleichstabellen, objektive Auswahlkriterien und klare Positionierungs-Statements direkt in rankende Ratgeber-Seiten einbauen.',

      'matrix.q4_badge': 'Diagnose 04 · Positionierungs-Hebel',
      'matrix.q4_title': 'Die ewige Zweitnennung',
      'matrix.q4_problem': 'Das Modell kennt Ihre Marke aus dem Trainingswissen, ordnet Sie aber gewohnheitsmäßig als „weitere Option“ hinter dem US-Marktführer ein.',
      'matrix.q4_lever': 'Spezifische DACH- und Qualitäts-Attribute („unabhängig laborgeprüft“, „DATEV-Schnittstelle“, „deutscher Mittelstand“) gezielt in unabhängigen Fachmedien und Verzeichnissen verankern.',

      'pillar.1_title': 'DACH-Marken- & Rechtsform-Erkennung',
      'pillar.1_desc': 'Fehlerfreie Entitäts-Auflösung für mehrteilige deutsche Markennamen, GmbH/AG-Firmierungen, Umlaute und branchenspezifische Fachbegriffe.',
      'pillar.2_title': '100 % Frankfurt-Infrastruktur ohne US-Tracker',
      'pillar.2_desc': 'Keine externen Font-CDNs, keine Werbe-Pixel, volle DSGVO-Konformität auf dedizierten Servern in Frankfurt am Main.',
      'pillar.3_title': 'Verifizierte Vorstands- & Pitch-Reports',
      'pillar.3_desc': 'Teilen Sie kryptografisch gesicherte, schreibgeschützte Live-Audits per Klick mit Geschäftsführung, Revenue-Teams oder Agentur-Kunden.',

      // 9. Section 5: Tarife & Kapazitäten
      'pricing.eyebrow': 'TARIFE & KAPAZITÄTEN',
      'pricing.title': 'Vom ersten Sichtbarkeits-Audit bis zur systematischen Marktführerschaft.',
      'pricing.subtitle': 'Starten Sie dauerhaft kostenlos mit 40 echten Live-Abfragen oder sichern Sie sich kontinuierliches Monitoring und aktive Optimierung für Ihre kaufrelevanten Prompts.',
      'pricing.per_month': '/ Monat',

      'pricing.free_name': 'Free',
      'pricing.free_price': '0 €',
      'pricing.free.name': 'Free',
      'pricing.free.desc': 'Für Evaluierung & ersten Statusbericht',
      'pricing.free.period': '/ dauerhaft',
      'pricing.free.cta': 'Kostenlos starten',
      'pricing.free.feat_1': '✔ 40 Live-Abfragen Startguthaben inklusive',
      'pricing.free.feat_2': '✔ 1 Marken- & Wettbewerbs-Profil',
      'pricing.free.feat_3': '✔ OpenAI GPT-4o & Google Gemini Analyse',
      'pricing.free.feat_4': '✔ Auswertung nach den 4 Empfehlungs-Stufen',
      'pricing.free.feat_5': '✔ Dokumentation & Standard-Support',

      'pricing.starter_name': 'Starter',
      'pricing.starter_price': '149 €',
      'pricing.starter.name': 'Starter',
      'pricing.starter.desc': 'Für wachsende Marken & Produkt-Teams',
      'pricing.starter.cta': 'Starter wählen',
      'pricing.starter.feat_1': '✔ 500 Live-Abfragen pro Monat inklusive',
      'pricing.starter.feat_2': '✔ 5 Marken- oder Produktkategorie-Profile',
      'pricing.starter.feat_3': '✔ Tägliche automatische Audit-Läufe',
      'pricing.starter.feat_4': '✔ Zeitreihen-Vergleich (7 Tage / 30 Tage)',
      'pricing.starter.feat_5': '✔ Vollständige Quell-Domain- & Zitat-Analyse',
      'pricing.starter.feat_6': '✔ E-Mail-Support (24h Reaktionszeit)',

      'pricing.growth_name': 'Growth',
      'pricing.growth_price': '399 €',
      'pricing.growth.badge': 'Empfehlung',
      'pricing.growth.name': 'Growth',
      'pricing.growth.desc': 'Für führende Mittelständler, D2C- & SaaS-Marken',
      'pricing.growth.cta': 'Growth starten',
      'pricing.growth.feat_1': '✔ 2.000 Live-Abfragen pro Monat inklusive',
      'pricing.growth.feat_2': '✔ 25 Marken-, Branchen- oder Länder-Profile',
      'pricing.growth.feat_3': '✔ Stündliche Aktualisierung & Monitoring',
      'pricing.growth.feat_4': '✔ Alle Modelle: OpenAI, Anthropic Claude, Google Gemini',
      'pricing.growth.feat_5': '✔ Vollständige 4-Felder-Ursachen-Diagnose & Content-Hebel',
      'pricing.growth.feat_6': '✔ Teilbare Vorstands- & Stakeholder-Report-Links',
      'pricing.growth.feat_7': '✔ Priority-Support & persönliches Onboarding',

      'pricing.managed_name': 'Managed GEO & Pipeline Defense',
      'pricing.managed_price': '1.950 €+',
      'pricing.managed.badge': 'Für Markt- & Kategorieführer',
      'pricing.managed.name': 'Managed GEO & Pipeline Defense',
      'pricing.managed.desc': 'Wir holen Ihre Marke bei kaufentscheidenden Prompts messbar auf Platz 1 zurück.',
      'pricing.managed.cta': 'Strategiegespräch anfragen →',
      'pricing.managed.feat_1': '✔ Individuelles Abfrage-Kontingent über alle Kauf-Prompts',
      'pricing.managed.feat_2': '✔ Unbegrenzte Marken- und Wettbewerbs-Profile',
      'pricing.managed.feat_3': '✔ Reverse-Engineering zitierter Dritt-Domains & Fachmedien',
      'pricing.managed.feat_4': '✔ Technischer GEO- & Schema.org-Blueprint für Ihr Team',
      'pricing.managed.feat_5': '✔ Dedizierter GEO-Stratege & monatlicher Vorstands-Report',

      // 10. Section 6: FAQ & Footer
      'faq.eyebrow': 'METHODIK & ARCHITEKTUR',
      'faq.title': 'Häufige Fragen zur Share-of-Model Analyse.',
      'faq.q1': 'Wie unterscheidet sich Share-of-Model (SoM) von klassischem SEO-Ranking?',
      'faq.a1': 'Suchmaschinen liefern zehn blaue Links; Sprachmodelle verdichten den Markt auf eine einzige Empfehlung. Selbst wenn Ihre Website bei Google auf Platz 1 rankt, kann ChatGPT oder Gemini im Antworttext Ihren Wettbewerber als Marktführer nennen. Chatlytics misst reproduzierbar, ob Ihre Marke genannt wird, an welcher Zeichen-Position sie erscheint und welche Quellen die Antwort speisen.',
      'faq.q2': 'Nach welcher Logik werden die KI-Antworten ausgewertet?',
      'faq.a2': 'Im Gegensatz zu schwammigen Stimmungs-Scores arbeitet Chatlytics rein positions- und faktenbasiert. Jede Antwort wird eindeutig einer von vier Stufen zugeordnet: Spitzenreiter (Ihre Marke fällt vor allen Wettbewerbern), Im Windschatten (ein Wettbewerber wird zuerst genannt), Verdrängt (nur Konkurrenten werden genannt) oder Markenfreie Antwort (keine Anbieter genannt).',
      'faq.q3': 'Wie funktioniert die Quellen-Analyse (Search Grounding) bei Google Gemini und ChatGPT?',
      'faq.a3': 'Unsere dedizierte Multi-LLM-Abruf-Infrastruktur extrahiert neben dem sichtbaren Antworttext auch die im Hintergrund abgerufenen Such-Snippets und zitierten Quell-Domains. So erkennen Ihre SEO- und Content-Teams sofort, ob Ihre eigene Website (z. B. novaskin.de oder personia.de) oder ein Drittportal als Beleg herangezogen wurde.',
      'faq.q4': 'Warum sind bei der kostenlosen Registrierung nur Firmen-E-Mails erlaubt?',
      'faq.a4': 'Da jeder Test-Account 40 echte Live-Abfragen über OpenAI, Anthropic und Google Gemini freischaltet, schützen wir unsere Rechenkapazitäten vor automatisierten Wegwerf-Adressen. Sie können sofort ohne Kreditkarte starten.',

      'footer.copyright': '© 2026 Chatlytics.de — Enterprise AI Visibility & Share-of-Model Analytics',
      'footer.infra': 'Gehostet auf dedizierter Infrastruktur in Frankfurt am Main (100 % DSGVO-konform, ohne US-CDNs)',
      'footer.privacy': 'Datenschutz',
      'footer.imprint': 'Impressum',
      'footer.terms': 'AGB',

      // 11. Auth Modal
      'auth.tab_signup': 'Registrieren',
      'auth.tab_login': 'Login',
      'auth.signup_sub': 'Erstellen Sie Ihr Konto mit 40 kostenlosen Live-Abfragen. Nur geschäftliche Firmen-E-Mails.',
      'auth.work_email': 'Firmen-E-Mail-Adresse',
      'auth.email_hint': 'Keine privaten Freemail-Adressen (Gmail, Web.de, etc.)',
      'auth.password': 'Passwort',
      'auth.company': 'Unternehmensname (optional)',
      'auth.btn_signup': 'Konto erstellen & 40 Abfragen freischalten',
      'auth.login_sub': 'Melden Sie sich mit Ihren Zugangsdaten an.',
      'auth.email': 'E-Mail-Adresse',
      'auth.btn_login': 'Anmelden',
      'auth.logout': 'Abmelden',

      // 12. Dashboard & Analytics
      'audit.banner': 'Sie betrachten einen geteilten Chatlytics-Vorstandsreport (Schreibgeschützt).',
      'dashboard.page_title': 'Share-of-Model & GEO Analyse-Cockpit',
      'dashboard.new_config': '+ Neues Profil',
      'dashboard.trigger_run': 'Abfrage starten',
      'dashboard.btn_running': 'Abfrage läuft...',
      'dashboard.share': 'Report teilen',
      'kpi.som': 'Share-of-Model (SoM)',
      'kpi.som_sub': 'Anteil der Nennungen an allen KI-Abfragen',
      'kpi.visibility': 'Sichtbarkeits-Index',
      'kpi.visibility_sub': 'Markennennung oder Quellenzitat vorhanden',
      'kpi.earliness': 'Position im Text (Ø)',
      'kpi.earliness_sub': 'Durchschnittliche relative Position im Antworttext',
      'kpi.total_runs': 'Abfragen gesamt',
      'kpi.runs_sub': 'Durchgeführte Multi-Modell-Analysen',
      'kpi.citation_share': 'Quellen-Anteil',
      'kpi.citation_share_sub': 'Eigene Domain in Hintergrund-Quellen',
      'kpi.credits': 'Verbleibende Abfragen',
      'kpi.credits_sub': 'Guthaben für Live- und geplante Audits',
      'dashboard.mece_trend': 'Verteilung nach den 4 Empfehlungs-Stufen',
      'dashboard.mece_sum_hint': 'Vollständige Aufteilung über alle ausgewerteten Antworten',
      'dashboard.competitors': 'Wettbewerber-Leaderboard',
      'table.competitor': 'Wettbewerber',
      'table.domain': 'Domain',
      'table.visibility_pct': 'Sichtbarkeit',
      'table.mentions': 'Nennungen',
      'table.recommendations': 'Empfehlungen',
      'table.avg_pos': 'Ø Position',
      'dashboard.citations': 'Zitierte Quell-Domains (Search Grounding)',
      'table.source_domain': 'Quell-Domain',
      'table.domain_type': 'Typ',
      'table.citation_count': 'Zitate',
      'dashboard.empty_title': 'Keine Analysedaten im gewählten Zeitraum',
      'dashboard.empty_desc': 'Für das ausgewählte Profil liegen im Zeitraum noch keine abgeschlossenen Abfragen vor. Starten Sie jetzt Ihre erste Analyse.',
      'geo.title': '4-Felder-Ursachen-Diagnose',
      'geo.prescription_label': 'Empfohlener Hebel:',
      'geo.matrix_title': 'Diagnose-Matrix:',
      'geo.svg_title': 'Quellen-Autorität vs. Marken-Prominenz',
      'audit.cta_text': 'Möchten Sie kontinuierliche KI-Sichtbarkeitsanalysen für Ihre eigene Marke durchführen?',
      'audit.cta_btn': 'Jetzt kostenlos registrieren (40 Abfragen)',

      // 13. Owner Cockpit (Admin)
      'admin.meta_title': 'Chatlytics.de — Owner Cockpit & Systemverwaltung',
      'admin.badge_owner': 'Owner Cockpit',
      'admin.page_title': 'Owner Cockpit & Systemverwaltung',
      'admin.page_subtitle': 'Zentrale Verwaltung von Mandanten, Abfrage-Kontingenten, Vorstandsreport-Links und Beispieldaten.',
      'admin.btn_seed_demo': 'Beispieldaten generieren',
      'admin.kpi_users_label': 'Registrierte Benutzer',
      'admin.kpi_users_sub': 'Aktive Mandantenkonten',
      'admin.kpi_configs_label': 'Marken-Profile',
      'admin.kpi_configs_sub': 'Überwachte Prompt-Profile',
      'admin.kpi_runs_label': 'Ausgeführte Abfragen',
      'admin.kpi_runs_sub': 'KI-Audits gesamt',
      'admin.kpi_credits_label': 'Verfügbare Abfragen',
      'admin.kpi_credits_sub': 'Im Umlauf befindlich',
      'admin.table_title': 'Benutzerverzeichnis',
      'admin.search_label': 'Benutzer suchen',
      'admin.search_placeholder': 'Suche nach E-Mail oder Unternehmen...',
      'admin.col_email': 'E-Mail',
      'admin.col_company': 'Unternehmen',
      'admin.col_tier': 'Tarif',
      'admin.col_credits': 'Abfragen',
      'admin.col_runs': 'Läufe',
      'admin.col_status': 'Status',
      'admin.col_created': 'Registriert',
      'admin.col_actions': 'Aktionen',
      'admin.empty_title': 'Keine Benutzerkonten gefunden',
      'admin.empty_desc': 'Es wurden keine Benutzerkonten gefunden. Passen Sie die Suche an oder generieren Sie Beispieldaten.',
      'pagination.prev': '← Zurück',
      'pagination.next': 'Weiter →',
      'admin.modal_credit_title': 'Kontingent anpassen',
      'admin.modal_user_label': 'Benutzer:',
      'admin.modal_current_credits': 'Aktuelles Guthaben:',
      'admin.modal_delta_label': 'Änderung (Delta +/-):',
      'admin.modal_delta_hint': 'Positive Werte addieren Abfragen, negative Werte ziehen Abfragen ab (Minimum: 0).',
      'admin.modal_reason_label': 'Begründung (optional):',
      'admin.modal_credit_save': 'Kontingent speichern',
      'admin.modal_magic_title': 'Schreibgeschützter Report-Link',
      'admin.modal_magic_desc': 'Dieser sichere Link gewährt schreibgeschützten Zugriff auf das Analyse-Dashboard dieses Kontos ohne Login:',
      'admin.modal_magic_copy': 'Kopieren',
      'admin.modal_magic_open': 'In neuem Tab öffnen ↗',

      // 14. Config Modal & Common
      'config.llms_label': 'Ziel-KI-Modelle (Multi-LLM)',
      'config.llms_hint': 'Wählen Sie mindestens ein Modell. Europäische Endpunkte laufen streng DSGVO-konform.',
      'config.eu_hosted_badge': 'EU-Hosted',
      'config.search_label': 'Live-Websuche / Search Grounding aktivieren',
      'config.search_hint': 'OpenAI und Google Gemini nutzen Live-Suche zur Quellen-Analyse, sofern aktiviert.',
      'common.cancel': 'Abbrechen',
      'common.close': 'Schließen'
    },

    en: {
      // 1. Canonical Brand Statements
      'mission.statement': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics for European B2B Brands.',
      'mission.subtitle': 'Measure and manage how ChatGPT, Claude, and Google Gemini cite, rank, and recommend your brand against competitors with deterministic, GDPR-compliant analytics.',

      // 2. Navigation (Landing & Shared)
      'nav.brand': 'Chatlytics.de',
      'nav.tagline': 'Share-of-Model & GEO Analytics',
      'nav.dossier': 'Model Comparison',
      'nav.workbench': 'Response Analyzer',
      'nav.matrix': 'Root-Cause Matrix',
      'nav.pricing': 'Pricing',
      'nav.faq': 'FAQ',
      'nav.features': 'Root-Cause Matrix',
      'nav.mece': 'Recommendation Tiers',
      'nav.audit_demo': 'Board Report',
      'nav.dashboard': 'Dashboard',
      'nav.admin': 'Admin Cockpit',
      'nav.login': 'Login',
      'nav.signup': 'Start Free Audit',
      'nav.logout': 'Log out',
      'nav.home': 'Home',
      'nav.menu': 'Menu',
      'nav.billing': 'Billing',
      'nav.settings': 'Settings',

      // 3. Hero Stage (Obsidian)
      'hero.eyebrow': 'SHARE-OF-MODEL & GEO ANALYTICS FOR BRANDS, MID-MARKET & CONSULTANCIES',
      'hero.title': 'Who does AI recommend when buyers ask for the market leader?',
      'hero.subtitle': 'Ten blue Google links belong to the past. Whether skincare, industrial equipment, B2B software, or strategy consulting, buyers shortlist vendors directly inside ChatGPT, Claude, and Gemini. Chatlytics measures character by character whether your brand is recommended first, trails a competitor, or disappears despite your own guides being cited.',
      'hero.cta_primary': 'Audit Your Brand Free (40 Live Queries)',
      'hero.cta_secondary': 'View Sample Board Report →',
      'hero.switcher_label': 'Select live brand matchup:',
      'hero.switcher_note': 'Interactive brand matchups (sample data)',

      // 4. Section 2: Interactive Brand Dossier
      'dossier.eyebrow': 'MODEL COMPARISON',
      'dossier.title': 'One buyer question. Three language models. Three completely different leaders.',
      'dossier.prompt_label': 'Buyer Question (Prompt)',
      'dossier.scrubber_label': 'Character-by-character reading progress',
      'dossier.scrubber_hint': 'Drag slider to inspect response construction character by character.',
      'dossier.openai_sub': 'Parametric Synthesis',
      'dossier.claude_sub': 'Conservative Weighting',
      'dossier.gemini_sub': 'Google Search Grounding Active',
      'dossier.col_first': 'First Mention',
      'dossier.col_delta': 'Lead / Deficit',
      'dossier.col_rel': 'Position in Text',
      'dossier.col_diag': 'Cited Source / Diagnosis',
      'dossier.col_source': 'Cited Source',
      'dossier.timeline_title': 'Synchronized Character Timeline (OpenAI GPT-4o, Scale Char 0 to 200)',

      // 5. Recommendation Tiers
      '1_DIRECT_WIN': 'Rank 1 · First Choice',
      '2_BRAND_HALO': 'Rank 2 · Runner-Up',
      '3_COMPETITOR_TAKEOVER': 'Displaced · Rival Takeover',
      '4_GENERIC': 'Brand-Free Response',

      'mece.section_title': 'The 4 Recommendation Tiers',
      'mece.section_desc': 'Every AI response falls reproducibly into one of four commercial visibility outcomes.',

      'mece.1_DIRECT_WIN.title': 'Frontrunner · First Choice',
      'mece.1_DIRECT_WIN.badge': 'Rank 1 · First Choice',
      'mece.1_DIRECT_WIN.desc': 'Your brand appears as the first recommendation in reading order and beats every competitor. Commercial effect: maximum shortlist conversion.',

      'mece.2_BRAND_HALO.title': 'Challenging · Runner-Up',
      'mece.2_BRAND_HALO.badge': 'Rank 2 · Runner-Up',
      'mece.2_BRAND_HALO.desc': 'Your brand is mentioned, but only as a secondary alternative after a competing leader. Commercial effect: price and justification pressure.',

      'mece.3_COMPETITOR_TAKEOVER.title': 'Displaced · Rival Takeover',
      'mece.3_COMPETITOR_TAKEOVER.badge': 'Displaced · Rival Takeover',
      'mece.3_COMPETITOR_TAKEOVER.desc': 'The model recommends competitors only; your brand is completely absent from the answer. Commercial effect: direct pipeline and cart loss.',

      'mece.4_GENERIC.title': 'Brand-Free Response',
      'mece.4_GENERIC.badge': 'Brand-Free Response',
      'mece.4_GENERIC.desc': 'The model answers the topic generally without naming specific vendors or products. Commercial effect: open potential for targeted GEO content seeding.',

      // 6. Root-Cause Diagnostics
      '1_CITATION_HIJACK': 'The Hijacked Brief',
      '2_PARAMETRIC_BLINDSPOT': 'The Silent Source Citation',
      '3_BRAND_HALO_TRAP': 'The Perpetual Runner-Up',
      '4_BURIED_WINNER': 'The Buried Winner',
      'NONE': 'Optimal · Frontrunner',

      'geo.section_title': 'Root-Cause Diagnostics',
      'geo.section_desc': 'Relationship between grounding citation authority and text prominence.',

      'geo.1_CITATION_HIJACK.title': 'The Hijacked Brief',
      'geo.1_CITATION_HIJACK.condition': 'Own or external source · Rival wins Rank 1',
      'geo.1_CITATION_HIJACK.prescription': 'Your expert guides supply the background facts, yet the AI recommends a rival in the opening sentence. Embed structured comparison tables and clear positioning statements.',
      'geo.1_CITATION_HIJACK.action': 'Add structured comparison tables, objective selection criteria, and explicit positioning statements directly into ranking guide pages.',

      'geo.2_PARAMETRIC_BLINDSPOT.title': 'The Silent Source Citation',
      'geo.2_PARAMETRIC_BLINDSPOT.condition': 'Own domain cited · Brand missing in text',
      'geo.2_PARAMETRIC_BLINDSPOT.prescription': 'Your URL is loaded as a footnote source, yet your brand name is absent from the visible answer. Pair brand entity, authorship, and category in the opening section and Schema.org markup.',
      'geo.2_PARAMETRIC_BLINDSPOT.action': 'Couple your brand entity, authorship, and product category directly inside the opening section and Schema.org markup of cited pages.',

      'geo.3_BRAND_HALO_TRAP.title': 'The Perpetual Runner-Up',
      'geo.3_BRAND_HALO_TRAP.condition': 'Parametric training memory · Stuck at Rank 2–3',
      'geo.3_BRAND_HALO_TRAP.prescription': 'The model recognizes your brand from training data, but routinely places it behind US market leaders. Anchor specific DACH and quality attributes across independent trade publications.',
      'geo.3_BRAND_HALO_TRAP.action': 'Anchor specific regional, compliance, and quality differentiators across independent trade publications and directories.',

      'geo.4_BURIED_WINNER.title': 'The Buried Winner',
      'geo.4_BURIED_WINNER.condition': 'Own domain cited · Late mention (>50% offset)',
      'geo.4_BURIED_WINNER.prescription': 'Your brand wins the substantive comparison, but only surfaces in the closing paragraph where buyers rarely read. Sharpen TL;DR summaries and opening definitions.',
      'geo.4_BURIED_WINNER.action': 'Sharpen TL;DR summaries and concise lead definitions on core pages so models pull your brand into the opening sentence.',

      'geo.NONE.title': 'Optimal · Frontrunner',
      'geo.NONE.condition': 'Stable leading visibility without acute gaps.',
      'geo.NONE.prescription': 'No critical visibility gaps detected. Your brand leads the recommendation text.',
      'geo.NONE.action': 'Maintain continuous monitoring across core commercial buyer prompts.',

      // 7. Section 3: Live Response Analyzer
      'workbench.eyebrow': 'RESPONSE ANALYZER',
      'workbench.title': 'Four unambiguous recommendation tiers instead of vague sentiment curves.',
      'workbench.subtitle': 'Reliable growth and SEO decisions require exact placement metrics, not fuzzy sentiment scores. Every AI answer maps reproducibly to one of four commercial scenarios. Test our position calculation live in your browser:',
      'workbench.presets_label': 'Quick presets:',
      'workbench.preset_1': 'Scenario 1: Frontrunner (Nøva Skin)',
      'workbench.preset_2': 'Scenario 2: Runner-Up (Biovena One)',
      'workbench.preset_3': 'Scenario 3: Displaced (Personia missing)',
      'workbench.preset_4': 'Scenario 4: Brand-Free Response',
      'workbench.brand_label': 'Your Brand (incl. variants)',
      'workbench.competitors_label': 'Competitors (comma-separated)',
      'workbench.text_label': 'AI Response Text to Check',
      'workbench.result_label': 'Detected Recommendation Tier',
      'workbench.pos_bar_label': 'Position Bar (0% to 100% of text length)',
      'workbench.legend_brand': 'Your Brand',
      'workbench.legend_comp': '1st Competitor',
      'workbench.metric_char': 'First Mention (Char)',
      'workbench.metric_word': 'First Mention (Word)',
      'workbench.metric_rel': 'Position in Text (%)',
      'workbench.metric_comp': '1st Competitor (Char)',

      // 8. Section 4: Root-Cause Matrix & 3 DACH Trust Pillars
      'matrix.eyebrow': 'ROOT-CAUSE MATRIX',
      'matrix.title': 'Why classic SEO operates blind inside language models.',
      'matrix.subtitle': 'Language models combine pre-trained knowledge with live web search (RAG / Grounding). Our 4-field model separates source authority (Y-axis) from text prominence (X-axis) so your team sees immediately which lever is missing:',
      'matrix.y_title': 'Source Authority (Search Grounding & Citations)',
      'matrix.y_high': 'Own domain cited as source',
      'matrix.y_low': 'External source or training memory only',
      'matrix.x_title': 'Brand Prominence in Response Text',
      'matrix.x_low': 'Brand missing or displaced',
      'matrix.x_high': 'Brand recommended in text',
      'matrix.label_problem': 'Problem',
      'matrix.label_lever': 'Technical Lever',

      'matrix.q1_badge': 'Diagnosis 01 · High Urgency',
      'matrix.q1_title': 'The Silent Source Citation',
      'matrix.q1_problem': 'Your URL (such as novaskin.de/ratgeber or berger-kucher.de/whitepaper) is loaded by Gemini or ChatGPT as a footnote source, yet your brand name is absent from the visible answer.',
      'matrix.q1_lever': 'Bind your brand entity, authorship, and product category directly in the opening section of the cited page and in Schema.org markup.',

      'matrix.q2_badge': 'Diagnosis 02 · Quick Win',
      'matrix.q2_title': 'The Buried Winner',
      'matrix.q2_problem': 'Your brand wins the substantive comparison, but appears only in the final paragraph where buyers rarely keep reading.',
      'matrix.q2_lever': 'Sharpen TL;DR summaries and concise lead definitions on your core pages so language models surface your brand in the opening sentence.',

      'matrix.q3_badge': 'Diagnosis 03 · Pipeline Loss',
      'matrix.q3_title': 'The Hijacked Brief',
      'matrix.q3_problem': 'Your editorial guides supply the background facts, yet the AI recommends your competitor (AthleticOne, Dysonix) in the opening sentence.',
      'matrix.q3_lever': 'Embed structured comparison tables, objective selection criteria, and clear positioning statements directly into ranking guide pages.',

      'matrix.q4_badge': 'Diagnosis 04 · Positioning Lever',
      'matrix.q4_title': 'The Perpetual Runner-Up',
      'matrix.q4_problem': 'The model knows your brand from training data, yet habitually positions you as "another option" behind US incumbents.',
      'matrix.q4_lever': 'Anchor specific regional and quality attributes ("independently lab-tested", "DATEV integration", "German mid-market") in independent trade media and directories.',

      'pillar.1_title': 'DACH Brand & Legal-Entity Recognition',
      'pillar.1_desc': 'Accurate entity resolution for multi-word German brand names, GmbH/AG corporate suffixes, umlauts, and industry terminology.',
      'pillar.2_title': '100% Frankfurt Infrastructure without US Trackers',
      'pillar.2_desc': 'No external font CDNs, no advertising pixels, full GDPR compliance on dedicated servers in Frankfurt am Main.',
      'pillar.3_title': 'Verified Board & Pitch Reports',
      'pillar.3_desc': 'Share cryptographically scoped, read-only live audits in one click with executives, revenue teams, or agency clients.',

      // 9. Section 5: Pricing & Capacities
      'pricing.eyebrow': 'PRICING & CAPACITIES',
      'pricing.title': 'From your first visibility audit to systematic category leadership.',
      'pricing.subtitle': 'Start free forever with 40 real live queries or secure continuous monitoring and active optimization for your buyer-critical prompts.',
      'pricing.per_month': '/ month',

      'pricing.free_name': 'Free',
      'pricing.free_price': '€0',
      'pricing.free.name': 'Free',
      'pricing.free.desc': 'For evaluation & initial status report',
      'pricing.free.period': '/ forever',
      'pricing.free.cta': 'Start Free',
      'pricing.free.feat_1': '✔ 40 live queries starter balance included',
      'pricing.free.feat_2': '✔ 1 brand & competitor profile',
      'pricing.free.feat_3': '✔ OpenAI GPT-4o & Google Gemini analysis',
      'pricing.free.feat_4': '✔ Evaluation across all 4 recommendation tiers',
      'pricing.free.feat_5': '✔ Documentation & standard support',

      'pricing.starter_name': 'Starter',
      'pricing.starter_price': '€149',
      'pricing.starter.name': 'Starter',
      'pricing.starter.desc': 'For growing brands & product teams',
      'pricing.starter.cta': 'Select Starter',
      'pricing.starter.feat_1': '✔ 500 live queries per month included',
      'pricing.starter.feat_2': '✔ 5 brand or product-category profiles',
      'pricing.starter.feat_3': '✔ Daily automated audit runs',
      'pricing.starter.feat_4': '✔ Time-series comparison (7 days / 30 days)',
      'pricing.starter.feat_5': '✔ Full source-domain & citation analysis',
      'pricing.starter.feat_6': '✔ Email support (24h response time)',

      'pricing.growth_name': 'Growth',
      'pricing.growth_price': '€399',
      'pricing.growth.badge': 'Recommended',
      'pricing.growth.name': 'Growth',
      'pricing.growth.desc': 'For leading mid-market, D2C & SaaS brands',
      'pricing.growth.cta': 'Start Growth',
      'pricing.growth.feat_1': '✔ 2,000 live queries per month included',
      'pricing.growth.feat_2': '✔ 25 brand, industry, or country profiles',
      'pricing.growth.feat_3': '✔ Hourly updates & monitoring',
      'pricing.growth.feat_4': '✔ All models: OpenAI, Anthropic Claude, Google Gemini',
      'pricing.growth.feat_5': '✔ Complete 4-field root-cause diagnostics & content levers',
      'pricing.growth.feat_6': '✔ Shareable board & stakeholder report links',
      'pricing.growth.feat_7': '✔ Priority support & personal onboarding',

      'pricing.managed_name': 'Managed GEO & Pipeline Defense',
      'pricing.managed_price': '€1,950+',
      'pricing.managed.badge': 'For Market & Category Leaders',
      'pricing.managed.name': 'Managed GEO & Pipeline Defense',
      'pricing.managed.desc': 'We measurably restore your brand to Rank 1 on purchase-critical prompts.',
      'pricing.managed.cta': 'Request Strategy Call →',
      'pricing.managed.feat_1': '✔ Custom query allocation across all buyer prompts',
      'pricing.managed.feat_2': '✔ Unlimited brand and competitor profiles',
      'pricing.managed.feat_3': '✔ Reverse-engineering of cited third-party domains & trade media',
      'pricing.managed.feat_4': '✔ Technical GEO & Schema.org blueprint for your team',
      'pricing.managed.feat_5': '✔ Dedicated GEO strategist & monthly executive board report',

      // 10. Section 6: FAQ & Footer
      'faq.eyebrow': 'METHODOLOGY & ARCHITECTURE',
      'faq.title': 'Frequently asked questions on Share-of-Model analytics.',
      'faq.q1': 'How does Share-of-Model (SoM) differ from classic SEO rankings?',
      'faq.a1': 'Search engines return ten blue links; language models condense the market into a single recommendation. Even if your site ranks #1 on Google, ChatGPT or Gemini may recommend your competitor in the response text. Chatlytics reproducibly measures whether your brand is named, at which character position it appears, and which sources feed the answer.',
      'faq.q2': 'What logic evaluates the AI responses?',
      'faq.a2': 'Instead of vague sentiment scores, Chatlytics relies strictly on character position and factual mentions. Every response maps unambiguously to one of four tiers: Frontrunner (your brand appears before all rivals), Runner-Up (a competitor is named first), Displaced (only competitors appear), or Brand-Free Response (no vendors named).',
      'faq.q3': 'How does Search Grounding source analysis work for Google Gemini and ChatGPT?',
      'faq.a3': 'Our dedicated multi-LLM retrieval infrastructure extracts both the visible answer text and background search snippets and cited domains. Your SEO and content teams see immediately whether your own website (such as novaskin.de or personia.de) or a third-party directory anchored the answer.',
      'faq.q4': 'Why are only corporate work email addresses permitted for free registration?',
      'faq.a4': 'Because every trial account unlocks 40 real live queries across OpenAI, Anthropic, and Google Gemini, we protect compute capacity from automated disposable email abuse. You can start immediately without a credit card.',

      'footer.copyright': '© 2026 Chatlytics.de — Enterprise AI Visibility & Share-of-Model Analytics',
      'footer.infra': 'Hosted on dedicated infrastructure in Frankfurt am Main (100% GDPR-compliant, no US CDNs)',
      'footer.privacy': 'Privacy',
      'footer.imprint': 'Imprint',
      'footer.terms': 'Terms',

      // 11. Auth Modal
      'auth.tab_signup': 'Sign Up',
      'auth.tab_login': 'Login',
      'auth.signup_sub': 'Create your account with 40 free live queries. Corporate work emails only.',
      'auth.work_email': 'Corporate Email Address',
      'auth.email_hint': 'No personal freemail addresses (Gmail, Yahoo, Web.de, etc.)',
      'auth.password': 'Password',
      'auth.company': 'Company Name (optional)',
      'auth.btn_signup': 'Create Account & Unlock 40 Queries',
      'auth.login_sub': 'Log in with your credentials.',
      'auth.email': 'Email Address',
      'auth.btn_login': 'Log In',
      'auth.logout': 'Log Out',

      // 12. Dashboard & Analytics
      'audit.banner': 'You are viewing a shared Chatlytics Board Report (Read-Only).',
      'dashboard.page_title': 'Share-of-Model & GEO Analytics Cockpit',
      'dashboard.new_config': '+ New Profile',
      'dashboard.trigger_run': 'Run Query',
      'dashboard.btn_running': 'Running query...',
      'dashboard.share': 'Share Report',
      'kpi.som': 'Share-of-Model (SoM)',
      'kpi.som_sub': 'Share of brand mentions across all AI queries',
      'kpi.visibility': 'Visibility Index',
      'kpi.visibility_sub': 'Brand mention or source citation present',
      'kpi.earliness': 'Position in Text (Avg)',
      'kpi.earliness_sub': 'Average relative character position in response',
      'kpi.total_runs': 'Total Queries',
      'kpi.runs_sub': 'Completed multi-model evaluations',
      'kpi.citation_share': 'Source Share',
      'kpi.citation_share_sub': 'Own domain present in background sources',
      'kpi.credits': 'Remaining Queries',
      'kpi.credits_sub': 'Balance for live and scheduled audits',
      'dashboard.mece_trend': 'Distribution across the 4 Recommendation Tiers',
      'dashboard.mece_sum_hint': 'Complete breakdown across all evaluated responses',
      'dashboard.competitors': 'Competitor Leaderboard',
      'table.competitor': 'Competitor',
      'table.domain': 'Domain',
      'table.visibility_pct': 'Visibility',
      'table.mentions': 'Mentions',
      'table.recommendations': 'Recommendations',
      'table.avg_pos': 'Avg. Position',
      'dashboard.citations': 'Cited Source Domains (Search Grounding)',
      'table.source_domain': 'Source Domain',
      'table.domain_type': 'Type',
      'table.citation_count': 'Citations',
      'dashboard.empty_title': 'No analysis data in selected period',
      'dashboard.empty_desc': 'No completed queries exist for the selected profile in this timeframe. Start your first analysis now.',
      'geo.title': '4-Field Root-Cause Diagnostics',
      'geo.prescription_label': 'Recommended Lever:',
      'geo.matrix_title': 'Diagnostic Matrix:',
      'geo.svg_title': 'Source Authority vs. Brand Prominence',
      'audit.cta_text': 'Want continuous AI visibility monitoring for your own brand?',
      'audit.cta_btn': 'Register free now (40 Queries)',

      // 13. Owner Cockpit (Admin)
      'admin.meta_title': 'Chatlytics.de — Owner Cockpit & System Administration',
      'admin.badge_owner': 'Owner Cockpit',
      'admin.page_title': 'Owner Cockpit & System Administration',
      'admin.page_subtitle': 'Central management of tenant accounts, query quotas, board report links, and sample data.',
      'admin.btn_seed_demo': 'Generate Sample Data',
      'admin.kpi_users_label': 'Registered Users',
      'admin.kpi_users_sub': 'Active tenant accounts',
      'admin.kpi_configs_label': 'Brand Profiles',
      'admin.kpi_configs_sub': 'Monitored prompt profiles',
      'admin.kpi_runs_label': 'Executed Queries',
      'admin.kpi_runs_sub': 'Total AI audits',
      'admin.kpi_credits_label': 'Available Queries',
      'admin.kpi_credits_sub': 'In active circulation',
      'admin.table_title': 'User Directory',
      'admin.search_label': 'Search Users',
      'admin.search_placeholder': 'Search by email or company...',
      'admin.col_email': 'Email',
      'admin.col_company': 'Company',
      'admin.col_tier': 'Plan',
      'admin.col_credits': 'Queries',
      'admin.col_runs': 'Runs',
      'admin.col_status': 'Status',
      'admin.col_created': 'Registered',
      'admin.col_actions': 'Actions',
      'admin.empty_title': 'No user accounts found',
      'admin.empty_desc': 'No user accounts matched. Adjust your search or generate sample data.',
      'pagination.prev': '← Previous',
      'pagination.next': 'Next →',
      'admin.modal_credit_title': 'Adjust Quota',
      'admin.modal_user_label': 'User:',
      'admin.modal_current_credits': 'Current Balance:',
      'admin.modal_delta_label': 'Adjustment (Delta +/-):',
      'admin.modal_delta_hint': 'Positive values add queries, negative values deduct queries (minimum: 0).',
      'admin.modal_reason_label': 'Reason (optional):',
      'admin.modal_credit_save': 'Save Quota',
      'admin.modal_magic_title': 'Read-Only Report Link',
      'admin.modal_magic_desc': 'This secure link grants read-only access to this account\'s analytics dashboard without login credentials:',
      'admin.modal_magic_copy': 'Copy',
      'admin.modal_magic_open': 'Open in new tab ↗',

      // 14. Config Modal & Common
      'config.llms_label': 'Target AI Models (Multi-LLM)',
      'config.llms_hint': 'Select at least one model. European endpoints operate strictly GDPR-compliant.',
      'config.eu_hosted_badge': 'EU-Hosted',
      'config.search_label': 'Enable Live Web Search / Search Grounding',
      'config.search_hint': 'OpenAI and Google Gemini run live search for source analysis when enabled.',
      'common.cancel': 'Cancel',
      'common.close': 'Close'
    }
  };

  let activeLang = DEFAULT_LANG;

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'de' || stored === 'en') {
        activeLang = stored;
      }
    }
  } catch (e) {
    // LocalStorage unavailable
  }

  function t(key, fallback = '', lang = null) {
    if (!key) return fallback || '';
    const targetLang = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const dict = dictionaries[targetLang] || dictionaries[DEFAULT_LANG];

    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
      return dict[key];
    }

    const altLang = targetLang === 'de' ? 'en' : 'de';
    if (dictionaries[altLang] && Object.prototype.hasOwnProperty.call(dictionaries[altLang], key)) {
      return dictionaries[altLang][key];
    }

    return fallback || key;
  }

  function setLanguage(lang) {
    if (lang !== 'de' && lang !== 'en') {
      lang = DEFAULT_LANG;
    }
    activeLang = lang;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, lang);
      }
    } catch (e) {}

    if (typeof document !== 'undefined') {
      if (document.documentElement) {
        document.documentElement.lang = lang;
      }
      updateLanguageSwitcherUI();
      translatePage();

      try {
        const event = new CustomEvent('languageChanged', { detail: { lang } });
        window.dispatchEvent(event);
      } catch (e) {}
    }
  }

  function getLanguage() {
    return activeLang;
  }

  function updateLanguageSwitcherUI() {
    if (typeof document === 'undefined') return;

    const buttons = document.querySelectorAll('.lang-switch button, [data-lang-btn], #btn-lang-de, #btn-lang-en');
    buttons.forEach(btn => {
      const btnLang = btn.getAttribute('data-lang') || btn.textContent.trim().toLowerCase();
      if (btnLang === activeLang) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });

    const toggleBtns = document.querySelectorAll('#btn-lang-toggle, [data-lang-toggle]');
    const targetLang = activeLang === 'de' ? 'en' : 'de';
    toggleBtns.forEach(btn => {
      btn.setAttribute('data-active-lang', activeLang);
      btn.setAttribute('data-target-lang', targetLang);
      btn.setAttribute(
        'aria-label',
        activeLang === 'de'
          ? 'Sprache zu Englisch wechseln / Switch to English'
          : 'Sprache zu Deutsch wechseln / Switch to German'
      );
      const label = btn.querySelector('#current-lang-label') || document.getElementById('current-lang-label');
      if (label) {
        label.textContent = targetLang.toUpperCase();
      }
    });
  }

  function initLanguageSwitchers() {
    if (typeof document === 'undefined') return;

    const toggleBtns = document.querySelectorAll('#btn-lang-toggle, [data-lang-toggle]');
    toggleBtns.forEach(btn => {
      if (btn._langListenerAttached) return;
      btn._langListenerAttached = true;
      btn.addEventListener('click', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const nextLang = activeLang === 'de' ? 'en' : 'de';
        setLanguage(nextLang);
      });
    });

    const langBtns = document.querySelectorAll('.lang-switch button, [data-lang-btn], #btn-lang-de, #btn-lang-en');
    langBtns.forEach(btn => {
      if (btn._langListenerAttached) return;
      btn._langListenerAttached = true;
      btn.addEventListener('click', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const targetLang = (btn.getAttribute('data-lang') || btn.textContent.trim()).toLowerCase();
        if (targetLang === 'de' || targetLang === 'en') {
          setLanguage(targetLang);
        }
      });
    });

    updateLanguageSwitcherUI();
  }

  function init() {
    initLanguageSwitchers();
    updateLanguageSwitcherUI();
    translatePage();
  }

  function translatePage() {
    if (typeof document === 'undefined') return;

    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key, el.textContent);
      }
    });

    const placeholderEls = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderEls.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = t(key, el.placeholder);
      }
    });

    const titleEls = document.querySelectorAll('[data-i18n-title]');
    titleEls.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = t(key, el.title);
      }
    });

    const ariaEls = document.querySelectorAll('[data-i18n-aria]');
    ariaEls.forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) {
        el.setAttribute('aria-label', t(key, el.getAttribute('aria-label')));
      }
    });
  }

  function formatCurrency(val, lang = null) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const cleanVal = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9.-]+/g, '')) || 0;
    return l === 'de' ? `${cleanVal} €` : `€${cleanVal}`;
  }

  function formatPercent(val, lang = null, decimals = 1) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const num = Number(val);
    if (isNaN(num)) return l === 'de' ? '0,0 %' : '0.0%';
    const fixed = num.toFixed(decimals);
    return l === 'de' ? `${fixed.replace('.', ',')} %` : `${fixed}%`;
  }

  function formatNumber(val, lang = null, decimals = 0) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const num = Number(val);
    if (isNaN(num)) return '0';
    return num.toLocaleString(l === 'de' ? 'de-DE' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatDate(val, lang = null) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val || '');
    return d.toLocaleDateString(l === 'de' ? 'de-DE' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        init();
      });
    } else {
      init();
    }
  }

  return {
    t,
    setLanguage,
    getLanguage,
    translatePage,
    formatCurrency,
    formatPercent,
    formatNumber,
    formatDate,
    dictionaries,
    init,
    initLanguageSwitchers,
    updateLanguageSwitcherUI
  };
});

const _rootScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
const _chatlyticsI18n = _rootScope.ChatlyticsI18n || _rootScope.i18n || (typeof module !== 'undefined' && module.exports ? module.exports : {});

export const t = _chatlyticsI18n.t;
export const setLanguage = _chatlyticsI18n.setLanguage;
export const getLanguage = _chatlyticsI18n.getLanguage;
export const translatePage = _chatlyticsI18n.translatePage;
export const formatCurrency = _chatlyticsI18n.formatCurrency;
export const formatPercent = _chatlyticsI18n.formatPercent;
export const formatNumber = _chatlyticsI18n.formatNumber;
export const formatDate = _chatlyticsI18n.formatDate;
export const dictionaries = _chatlyticsI18n.dictionaries;
export const init = _chatlyticsI18n.init;
export const initLanguageSwitchers = _chatlyticsI18n.initLanguageSwitchers;
export const updateLanguageSwitcherUI = _chatlyticsI18n.updateLanguageSwitcherUI;
export const i18n = _chatlyticsI18n;
export default _chatlyticsI18n;
