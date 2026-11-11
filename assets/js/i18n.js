/**
 * assets/js/i18n.js
 * Chatlytics.de — Bilingual Internationalization Engine & Dictionaries
 * Feature 24 (Milestone 5)
 *
 * Requirements:
 * - Bilingual dictionaries in German (de) and English (en).
 * - Verbatim mission statements in DE and EN.
 * - Complete key-value mappings (nav, hero, MECE, GEO, pricing, tables, buttons, magic audit).
 * - Locale formatting functions: formatCurrency, formatPercent, formatNumber, formatDate.
 * - Fallback mechanism to ensure no missing keys render as undefined.
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
      // 1. Verbatim Mission Statements
      'mission.statement': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics für europäische B2B-Marken.',
      'mission.subtitle': 'Messen und steuern Sie, wie ChatGPT, Claude und Google Gemini Ihre Marke und Wettbewerber wahrnehmen, zitieren und empfehlen. DSGVO-konform, deterministisch und auf Unternehmensebene analysiert.',

      // 2. Navigation
      'nav.brand': 'Chatlytics.de',
      'nav.tagline': 'AI Visibility & Share-of-Model Analytics',
      'nav.features': 'Funktionen',
      'nav.mece': 'MECE-Modell',
      'nav.pricing': 'Preise',
      'nav.audit_demo': 'Live-Audit',
      'nav.dashboard': 'Dashboard',
      'nav.admin': 'Admin Cockpit',
      'nav.login': 'Anmelden',
      'nav.signup': 'Kostenlos starten',
      'nav.logout': 'Abmelden',
      'nav.home': 'Startseite',

      // 3. Hero Section
      'hero.title': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics für europäische B2B-Marken.',
      'hero.subtitle': 'Messen und steuern Sie, wie ChatGPT, Claude und Google Gemini Ihre Marke und Wettbewerber wahrnehmen, zitieren und empfehlen. DSGVO-konform, deterministisch und auf Unternehmensebene analysiert.',
      'hero.cta_free': 'Jetzt 40 Gratis-Audits sichern',
      'hero.cta_demo': 'Interaktive MECE-Demo testen',
      'hero.trust_gdpr': '100% DSGVO-konform (Hosting in Frankfurt am Main)',
      'hero.trust_deterministic': 'Deterministische MECE-Klassifizierung & Unicode-Metrik',
      'hero.trust_multi_llm': 'Multi-LLM Telemetrie: GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro',

      // 4. MECE 4-State Classifier
      '1_DIRECT_WIN': '1_DIRECT_WIN',
      '2_BRAND_HALO': '2_BRAND_HALO',
      '3_COMPETITOR_TAKEOVER': '3_COMPETITOR_TAKEOVER',
      '4_GENERIC': '4_GENERIC',

      'mece.section_title': 'Das Chatlytics MECE-Klassifizierungsmodell',
      'mece.section_desc': 'Jeder KI-Antwortstrom wird mathematisch eindeutig und überschneidungsfrei in einen von vier Zuständen eingeordnet.',
      
      'mece.1_DIRECT_WIN.title': '1_DIRECT_WIN (Direkte Empfehlung)',
      'mece.1_DIRECT_WIN.badge': 'Direkter Gewinn',
      'mece.1_DIRECT_WIN.desc': 'Ihre Marke führt die Modell-Empfehlung an (#1 Position) oder wird als primäre Lösung hervorgehoben.',
      
      'mece.2_BRAND_HALO.title': '2_BRAND_HALO (Windschatten / Ko-Erwähnung)',
      'mece.2_BRAND_HALO.badge': 'Windschatten-Erwähnung',
      'mece.2_BRAND_HALO.desc': 'Ihre Marke wird sekundär hinter einem führenden Wettbewerber genannt.',
      
      'mece.3_COMPETITOR_TAKEOVER.title': '3_COMPETITOR_TAKEOVER (Wettbewerber-Übernahme)',
      'mece.3_COMPETITOR_TAKEOVER.badge': 'Wettbewerber-Übernahme',
      'mece.3_COMPETITOR_TAKEOVER.desc': 'Wettbewerber werden empfohlen, während Ihre Marke im Antwortstrom vollständig ausgelassen wird.',
      
      'mece.4_GENERIC.title': '4_GENERIC (Generische Antwort)',
      'mece.4_GENERIC.badge': 'Generisch',
      'mece.4_GENERIC.desc': 'Weder Ihre Marke noch relevante Wettbewerber werden im generierten Text genannt.',

      // 5. 4-Quadrant GEO Diagnostics
      '1_CITATION_HIJACK': '1_CITATION_HIJACK',
      '2_PARAMETRIC_BLINDSPOT': '2_PARAMETRIC_BLINDSPOT',
      '3_BRAND_HALO_TRAP': '3_BRAND_HALO_TRAP',
      '4_BURIED_WINNER': '4_BURIED_WINNER',
      'NONE': 'NONE',

      'geo.section_title': '4-Quadrant GEO Aktionspanel',
      'geo.section_desc': 'Taktische Handlungsempfehlungen basierend auf der Korrelation von Zitier-Autorität und Modell-Empfehlung.',

      'geo.1_CITATION_HIJACK.title': 'Quadrant 1: Zitations-Übernahme (Citation Hijack)',
      'geo.1_CITATION_HIJACK.condition': 'Marke in Quellen zitiert, aber Wettbewerber im Synthesetext empfohlen.',
      'geo.1_CITATION_HIJACK.prescription': 'Wettbewerber kapert Ihre Quellen. Schema.org Markup aktualisieren.',
      'geo.1_CITATION_HIJACK.action': 'Schema.org Markup aktualisieren, Vergleichsportale korrigieren und Primärquellen stärken.',

      'geo.2_PARAMETRIC_BLINDSPOT.title': 'Quadrant 2: Parametrischer Blindfleck (Parametric Blindspot)',
      'geo.2_PARAMETRIC_BLINDSPOT.condition': 'Domain zitiert, aber Marke im Synthesetext ausgelassen.',
      'geo.2_PARAMETRIC_BLINDSPOT.prescription': 'Domain zitiert, aber Marke im Synthesetext ausgelassen. Entitäts-Kookkurrenzen ausbauen.',
      'geo.2_PARAMETRIC_BLINDSPOT.action': 'Entitäts-Kookkurrenzen ausbauen, Digital-PR initiieren und Wikipedia-Verankerung vertiefen.',

      'geo.3_BRAND_HALO_TRAP.title': 'Quadrant 3: Windschatten-Falle (Brand Halo Trap)',
      'geo.3_BRAND_HALO_TRAP.condition': 'Marke im Windschatten des Wettbewerbers gefangen.',
      'geo.3_BRAND_HALO_TRAP.prescription': 'Marke im Windschatten des Wettbewerbers gefangen. Differenzierende Alleinstellungsmerkmale schärfen.',
      'geo.3_BRAND_HALO_TRAP.action': 'Differenzierende Alleinstellungsmerkmale (USPs) schärfen und Benchmark-Reports publizieren.',

      'geo.4_BURIED_WINNER.title': 'Quadrant 4: Versteckter Gewinner (Buried Winner)',
      'geo.4_BURIED_WINNER.condition': 'Gewinner, aber spät genannt (hoher Token-Offset).',
      'geo.4_BURIED_WINNER.prescription': 'Gewinner, aber spät genannt. Semantische Dichte optimieren.',
      'geo.4_BURIED_WINNER.action': 'Semantische Dichte optimieren, Keyphrase-Frontloading umsetzen und Glossare schärfen.',

      'geo.NONE.title': 'Keine akute GEO-Anomalie',
      'geo.NONE.condition': 'Stabile Markenpräsenz ohne kritische Schieflagen.',
      'geo.NONE.prescription': 'Keine kritischen GEO-Anomalien festgestellt. Sichtbarkeit stabil.',
      'geo.NONE.action': 'Laufendes Monitoring und monatliche Audits beibehalten.',

      // 6. Pricing Tiers
      'pricing.section_title': 'Transparente B2B SaaS-Preise',
      'pricing.billing_monthly': 'Monatliche Abrechnung',
      'pricing.billing_annual': 'Jährliche Abrechnung (-20%)',
      'pricing.popular_badge': 'Beliebteste Wahl',
      
      'pricing.free_name': 'Free / Kostenlos',
      'pricing.free_price': '0 €',
      'pricing.free_cadence': 'Einmalig 40 Credits',
      'pricing.free_target': 'Evaluierung für B2B Marketing- & SEO-Teams',
      'pricing.free_cta': 'Kostenlos starten',
      'pricing.free_feat_1': '1 Tracking-Konfiguration',
      'pricing.free_feat_2': 'GPT-4o Mini & Claude 3.5 Haiku',
      'pricing.free_feat_3': 'Grundlegende MECE-Klassifizierung',
      'pricing.free_feat_4': '7 Tage Historie',
      'pricing.free_feat_5': 'Community Support',

      'pricing.starter_name': 'Starter',
      'pricing.starter_price': '149 €',
      'pricing.starter_cadence': 'pro Monat / 500 Credits',
      'pricing.starter_target': 'Wachsende europäische B2B Startups & Scale-ups',
      'pricing.starter_cta': 'Starter wählen',
      'pricing.starter_feat_1': 'Bis zu 5 Tracking-Konfigurationen',
      'pricing.starter_feat_2': 'Multi-LLM (GPT-4o, Claude 3.5 Sonnet, Gemini)',
      'pricing.starter_feat_3': 'Wöchentliche automatische Runs',
      'pricing.starter_feat_4': 'Grounding Citation Tracking',
      'pricing.starter_feat_5': '30 Tage Historie',
      'pricing.starter_feat_6': 'Standard E-Mail Support',

      'pricing.growth_name': 'Growth',
      'pricing.growth_price': '399 €',
      'pricing.growth_cadence': 'pro Monat / 2.000 Credits',
      'pricing.growth_target': 'Etablierte europäische B2B Marken & Agenturen',
      'pricing.growth_cta': 'Growth wählen',
      'pricing.growth_feat_1': 'Bis zu 20 Tracking-Konfigurationen',
      'pricing.growth_feat_2': 'Alle LLMs inkl. Gemini 1.5 Pro & Search Grounding',
      'pricing.growth_feat_3': 'Tägliche automatische Runs',
      'pricing.growth_feat_4': '4-Quadrant GEO Action Matrix',
      'pricing.growth_feat_5': 'Wettbewerber-Benchmark Leaderboard',
      'pricing.growth_feat_6': 'Unbegrenzte Magic Audit Share Links',
      'pricing.growth_feat_7': 'Prioritäts-Support',

      'pricing.managed_name': 'Managed GEO Retainer',
      'pricing.managed_price': 'Ab 1.950 €',
      'pricing.managed_cadence': 'pro Monat / Individuell',
      'pricing.managed_target': 'Enterprise & Marktführer mit strategischem KI-Sichtbarkeitsbedarf',
      'pricing.managed_cta': 'Beratung anfragen',
      'pricing.managed_feat_1': 'Unbegrenzte Audits & Prompts',
      'pricing.managed_feat_2': 'Maßgeschneiderte Prompt-Architektur',
      'pricing.managed_feat_3': 'Kontinuierliches Citation Engineering',
      'pricing.managed_feat_4': 'Parametrische Digital-PR Begleitung',
      'pricing.managed_feat_5': 'Monatlicher Executive C-Level Report',
      'pricing.managed_feat_6': 'Dedizierter GEO-Stratege',

      // 7. Dashboard & Analytics
      'dashboard.title': 'KI-Sichtbarkeits-Cockpit',
      'dashboard.kpi_som': 'Share of Model (SoM)',
      'dashboard.kpi_visibility': 'Sichtbarkeits-Index',
      'dashboard.kpi_earliness': 'Durchschnittliche Frühzeitigkeit',
      'dashboard.kpi_runs': 'Ausgeführte Audits',
      'dashboard.kpi_citation_share': 'Zitations-Anteil',
      'dashboard.kpi_credits': 'Verbleibende Credits',
      
      'dashboard.period_7d': '7 Tage',
      'dashboard.period_14d': '14 Tage',
      'dashboard.period_30d': '30 Tage',
      'dashboard.period_90d': '90 Tage',
      'dashboard.period_all': 'Alle',
      
      'dashboard.btn_trigger_run': 'Audit jetzt starten',
      'dashboard.btn_running': 'Audit läuft (n8n Engine)...',
      'dashboard.mece_distribution': 'MECE-Kategorieverteilung',
      'dashboard.pop_comparison': 'Vergleich zur Vorperiode (PoP)',
      'dashboard.competitor_leaderboard': 'Wettbewerber-Benchmark Leaderboard',
      'dashboard.citations_table': 'Top Grounding-Zitationen & Referenzquellen',
      'dashboard.empty_title': 'Keine Daten für diesen Zeitraum vorhanden',
      'dashboard.empty_desc': 'Starten Sie einen Sofort-Audit oder wählen Sie eine andere Konfiguration.',

      // 8. Magic Audit Preview Mode
      'audit.banner_notice': '👁️ Sie betrachten ein geteiltes Chatlytics Magic Audit (Schreibgeschützt).',
      'audit.conversion_text': 'Möchten Sie kontinuierliche KI-Sichtbarkeitsanalysen für Ihre eigene Marke durchführen?',
      'audit.conversion_btn': 'Jetzt 40 Gratis-Audits starten',

      // 9. Admin Cockpit
      'admin.title': 'Owner Cockpit — Plattformverwaltung',
      'admin.kpi_users': 'Registrierte Benutzer',
      'admin.kpi_runs': 'Ausgeführte LLM-Runs',
      'admin.kpi_configs': 'Aktive Konfigurationen',
      'admin.kpi_credits_used': 'Verbrauchte Credits',
      'admin.user_directory': 'Benutzerverzeichnis',
      'admin.btn_seed_demo': '🇩🇪 Realistische B2B-Demodaten laden',
      'admin.btn_magic_audit': 'Magic Audit Link erstellen',
      'admin.btn_adjust_credits': 'Credits anpassen',

      // 10. Table Column Headers
      'col.rank': 'Rang',
      'col.brand': 'Marke / Wettbewerber',
      'col.domain': 'Domain',
      'col.mentions': 'Erwähnungen',
      'col.win_rate': 'Win Rate %',
      'col.visibility': 'Sichtbarkeit %',
      'col.earliness': 'Frühzeitigkeit (Wort)',
      'col.recommendations': 'Empfehlungen',
      'col.citations': 'Zitationen',
      'col.source_url': 'Quell-URL',
      'col.authority': 'Autorität',
      'col.id': 'ID',
      'col.email': 'E-Mail',
      'col.company': 'Unternehmen',
      'col.role': 'Rolle',
      'col.tier': 'Tarif',
      'col.credits': 'Credits',
      'col.created_at': 'Registriert am',
      'col.actions': 'Aktionen',

      // 11. Status Badges & Common UI
      'status.active': 'Aktiv',
      'status.pending': 'Ausstehend',
      'status.completed': 'Abgeschlossen',
      'status.queued': 'In Warteschlange',
      'status.failed': 'Fehlgeschlagen',
      
      'common.save': 'Speichern',
      'common.cancel': 'Abbrechen',
      'common.close': 'Schließen',
      'common.delete': 'Löschen',
      'common.edit': 'Bearbeiten',
      'common.loading': 'Wird geladen...',
      'common.success': 'Erfolgreich',
      'common.error': 'Fehler',
      'common.copy': 'Kopieren',
      'common.copied': 'In die Zwischenablage kopiert!',
      'common.vs_previous': 'vs. Vorperiode',
      'common.details': 'Details',

      // === 1. Navigation & Hero Additions ===
      'nav.simulator': 'MECE-Simulator',
      'nav.faq': 'FAQ',
      'nav.billing': 'Abrechnung',
      'nav.settings': 'Einstellungen',
      'hero.badge': 'B2B Generative Engine Optimization (GEO) & SoM',
      'hero.cta_primary': 'Kostenlos starten (40 Runs)',
      'hero.cta_secondary': 'Live MECE Simulator testen',

      // === 2. Interactive MECE Simulator ===
      'simulator.title': 'Interaktiver MECE-Simulator',
      'simulator.subtitle': 'Testen Sie die mathematisch strikte 4-Zustände-MECE-Klassifikation direkt im Browser.',
      'simulator.presets_label': 'Presets laden:',
      'simulator.brand_label': 'Ihre Marke',
      'simulator.competitors_label': 'Wettbewerber (kommagetrennt)',
      'simulator.text_label': 'KI-Antworttext (Synthese)',
      'simulator.result_label': 'Klassifikationsergebnis:',
      'simulator.char_earliness': 'Zeichen-Earliness:',
      'simulator.word_earliness': 'Wort-Earliness:',
      'simulator.rel_pos': 'Relative Position:',
      'simulator.comp_earliness': '1. Wettbewerber:',

      // === 3. 4-Tier Hybrid Pricing Table ===
      'pricing.title': '4-Tier Hybrid Pricing',
      'pricing.subtitle': 'Vom kostenlosen Freemium-Einstieg bis zum maßgeschneiderten Managed GEO Retainer für Marktführer.',
      'pricing.free.name': 'Free',
      'pricing.free.desc': 'Für Evaluierung & Proof-of-Concept',
      'pricing.free.period': 'dauerhaft',
      'pricing.free.cta': 'Kostenlos starten',
      'pricing.starter.name': 'Starter',
      'pricing.starter.desc': 'Für wachsende KMU & Produktteams',
      'pricing.per_month': '/ Monat',
      'pricing.starter.cta': 'Starter wählen',
      'pricing.growth.badge': 'Empfehlung',
      'pricing.growth.name': 'Growth',
      'pricing.growth.desc': 'Für marktführende B2B SaaS Unternehmen',
      'pricing.growth.cta': 'Growth wählen',
      'pricing.managed.name': 'Managed GEO Retainer',
      'pricing.managed.desc': 'Ganzheitliche Generative Engine Optimierung',
      'pricing.managed.cta': 'Enterprise anfragen',

      // Pricing Feature Bullets
      'pricing.free.feat_1': '✔ 40 Runs kostenloses Startguthaben',
      'pricing.free.feat_2': '✔ 1 Tracking-Konfiguration',
      'pricing.free.feat_3': '✔ OpenAI + Google Gemini Routing',
      'pricing.free.feat_4': '✔ 4-State MECE Sofortklassifikation',
      'pricing.free.feat_5': '✔ Community & Doku-Support',
      'pricing.starter.feat_1': '✔ 500 Runs pro Monat inklusive',
      'pricing.starter.feat_2': '✔ 5 Tracking-Konfigurationen',
      'pricing.starter.feat_3': '✔ Tägliche automatische Audit-Jobs',
      'pricing.starter.feat_4': '✔ PoP Periodenvergleich (7d / 30d)',
      'pricing.starter.feat_5': '✔ Grounding Citation Analyse',
      'pricing.starter.feat_6': '✔ E-Mail Support (24h SLA)',
      'pricing.growth.feat_1': '✔ 2.000 Runs pro Monat inklusive',
      'pricing.growth.feat_2': '✔ 25 Tracking-Konfigurationen',
      'pricing.growth.feat_3': '✔ Stündliche Queue-Synchronisation',
      'pricing.growth.feat_4': '✔ Alle LLMs: OpenAI, Anthropic Claude, Gemini',
      'pricing.growth.feat_5': '✔ 4-Quadrant GEO Action Panel Empfehlungen',
      'pricing.growth.feat_6': '✔ Magic Audit Share-Links für Stakeholder',
      'pricing.growth.feat_7': '✔ Priority Support & Onboarding Call',
      'pricing.managed.feat_1': '✔ Individuelles Run-Kontingent nach Bedarf',
      'pricing.managed.feat_2': '✔ Unbegrenzte Tracking-Konfigurationen',
      'pricing.managed.feat_3': '✔ Dedizierter B2B GEO Optimierungsberater',
      'pricing.managed.feat_4': '✔ Reverse Engineering zitierter Quell-Domains',
      'pricing.managed.feat_5': '✔ Custom Schema.org & Knowledge-Graph Blueprint',
      'pricing.managed.feat_6': '✔ Monatlicher C-Level Board Report & SLA',

      // === 4. Freemium & Auth Modal ===
      'auth.tab_signup': 'Registrieren',
      'auth.tab_login': 'Anmelden',
      'auth.signup_sub': 'Erstellen Sie Ihr Konto mit 40 kostenlosen Test-Runs. Nur geschäftliche Firmen-E-Mails.',
      'auth.work_email': 'Firmen-E-Mail-Adresse',
      'auth.email_hint': 'Keine privaten Freemail-Adressen (Gmail, Web.de, etc.)',
      'auth.password': 'Passwort',
      'auth.company': 'Unternehmensname (optional)',
      'auth.btn_signup': 'Konto erstellen & 40 Runs freischalten',
      'auth.login_sub': 'Melden Sie sich mit Ihren Zugangsdaten an.',
      'auth.email': 'E-Mail-Adresse',
      'auth.btn_login': 'Anmelden',
      'auth.logout': 'Abmelden',

      // === 5. Client Dashboard ===
      'audit.banner': 'Sie betrachten ein geteiltes Chatlytics Magic Audit (Schreibgeschützt).',
      'dashboard.new_config': '+ Neue Konfiguration',
      'dashboard.trigger_run': 'Run ausführen',
      'dashboard.share': 'Teilen',
      'kpi.som': 'Share-of-Model (SoM)',
      'kpi.som_sub': 'Anteil der Nennungen an allen LLM-Runs',
      'kpi.visibility': 'Visibility Index',
      'kpi.visibility_sub': 'Markennennung oder Quellenzitat vorhanden',
      'kpi.earliness': 'Average Earliness',
      'kpi.earliness_sub': 'Durchschnittliche relative Position im Text',
      'kpi.total_runs': 'Total Runs',
      'kpi.runs_sub': 'Durchgeführte Multi-Model Evaluierungen',
      'kpi.citation_share': 'Citations Share',
      'kpi.citation_share_sub': 'Eigene Domain in Grounding-Quellen',
      'kpi.credits': 'Credits Remaining',
      'kpi.credits_sub': 'Guthaben für Live- und Queue-Audits',
      'dashboard.mece_trend': 'MECE-Kategorieverteilung',
      'dashboard.mece_sum_hint': '100% lückenlos und überschneidungsfrei',
      'dashboard.competitors': 'Wettbewerber-Leaderboard',
      'table.competitor': 'Wettbewerber',
      'table.domain': 'Domain',
      'table.visibility_pct': 'Sichtbarkeit',
      'table.mentions': 'Nennungen',
      'table.recommendations': 'Empfehlungen',
      'table.avg_pos': 'Ø Position',
      'dashboard.citations': 'Grounding-Zitierungen & Quellen',
      'table.source_domain': 'Quell-Domain',
      'table.domain_type': 'Typ',
      'table.citation_count': 'Zitate',
      'geo.title': '4-Quadrant GEO Action Panel',
      'geo.prescription_label': 'Empfohlene Handlungsanweisung:',
      'geo.matrix_title': 'Diagnose-Matrix:',
      'audit.cta_text': 'Möchten Sie kontinuierliche KI-Sichtbarkeitsanalysen für Ihre eigene Marke durchführen?',
      'audit.cta_btn': 'Jetzt kostenlos registrieren (40 Runs)',

      // === 6. Owner Cockpit ===
      'admin.meta_title': 'Chatlytics.de — Owner Cockpit & Systemverwaltung',
      'admin.badge_owner': 'Owner Cockpit',
      'admin.page_title': 'Owner Cockpit & Systemverwaltung',
      'admin.page_subtitle': 'Zentrale Verwaltung von Mandanten, Guthaben, Magic Audit Links und Demodaten.',
      'admin.kpi_users_label': 'Registrierte Benutzer',
      'admin.kpi_users_sub': 'Aktive Mandantenkonten',
      'admin.kpi_configs_label': 'Tracking-Konfigurationen',
      'admin.kpi_configs_sub': 'Überwachte Prompt-Keywords',
      'admin.kpi_runs_label': 'Ausgeführte Runs',
      'admin.kpi_runs_sub': 'LLM-Audits gesamt',
      'admin.kpi_credits_label': 'Verfügbare Credits',
      'admin.kpi_credits_sub': 'Im Umlauf befindlich',
      'admin.table_title': 'Benutzerverzeichnis',
      'admin.search_label': 'Benutzer suchen',
      'admin.search_placeholder': 'Suche nach E-Mail oder Unternehmen...',
      'admin.col_email': 'E-Mail',
      'admin.col_company': 'Unternehmen',
      'admin.col_tier': 'Tarif',
      'admin.col_credits': 'Credits',
      'admin.col_runs': 'Runs',
      'admin.col_status': 'Status',
      'admin.col_created': 'Registriert',
      'admin.col_actions': 'Aktionen',
      'admin.empty_title': 'Keine Benutzerkonten gefunden',
      'admin.empty_desc': 'Es wurden keine Benutzerkonten gefunden. Passen Sie die Suche an oder generieren Sie realistische Demodaten.',
      'pagination.prev': '← Zurück',
      'pagination.next': 'Weiter →',
      'admin.modal_credit_title': 'Credits anpassen',
      'admin.modal_user_label': 'Benutzer:',
      'admin.modal_current_credits': 'Aktuelles Guthaben:',
      'admin.modal_delta_label': 'Guthaben-Änderung (Delta +/-):',
      'admin.modal_delta_hint': 'Positive Werte addieren Credits, negative Werte ziehen Credits ab (minimaler Endwert: 0).',
      'admin.modal_reason_label': 'Begründung (optional):',
      'admin.modal_credit_save': 'Credits speichern',
      'admin.modal_magic_title': 'Magic Audit Link',
      'admin.modal_magic_desc': 'Dieser sichere Link gewährt schreibgeschützten Zugriff auf das Client-Dashboard dieses Kontos ohne Anmeldedaten:',
      'admin.modal_magic_copy': 'Kopieren',
      'admin.modal_magic_open': 'In neuem Tab öffnen ↗',

      // === 7. Swiss Technical Monolith & Scroll-Craft Additions ===
      'nav.race': '3-Modell-Rennen',
      'nav.menu': 'Menü',
      'hero.index': 'SYS // 01 — DETERMINISTIC AI TELEMETRY',
      'hero.trust_title': 'VERIFIZIERTE REFERENZ-ENTITÄTEN (DACH B2B):',
      'hero.plane_coord': 'KOORDINATEN-RASTER // UTF-8 CASE-FOLDING AKTIV',
      'hero.plane_prompt_label': 'PROMPT_INPUT [DE_B2B]',
      'hero.plane_prompt_val': 'Welche HR-Software eignet sich am besten für den deutschen Mittelstand?',
      'hero.plane_caliper_brand': 'MARKE ERKANNT // CHAR_IDX: 034',
      'hero.plane_caliper_comp': '1. WETTBEWERBER // CHAR_IDX: 105',
      'hero.plane_delta': 'EARLINESS VORSPRUNG: +71 ZEICHEN',

      // Act 2: Scroll-Scrubbed 3-Model Race (Signature Move & Peak)
      'race.index': 'SYS // 02 — MULTI-MODEL TELEMETRY SCRUBBER',
      'race.title': 'Ein Prompt. Drei KI-Modelle. Drei völlig verschiedene Realitäten.',
      'race.subtitle': 'Bewegen Sie das Mausrad oder den Playhead-Regler: Beobachten Sie Zeichen für Zeichen, wie dieselbe Marke in OpenAI gewinnt, in Claude in den Windschatten gerät und in Gemini trotz Domain-Zitat unsichtbar bleibt.',
      'race.prompt_label': 'LIVE BENCHMARK PROMPT',
      'race.prompt_text': '„Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?“',
      'race.scrubber_label': 'TOKEN-STREAM PLAYHEAD',
      'race.scrubber_hint': 'Scrollen oder Regler ziehen zum Durchleuchten des Antwortstroms',
      'race.openai_role': 'Parametrische Synthese',
      'race.claude_role': 'Konservative Enterprise-Gewichtung',
      'race.gemini_role': 'Google Search Grounding aktiv',
      'race.grounding_label': 'GROUNDING QUELLEN:',
      'race.char_offset': 'CHAR_IDX',
      'race.rel_pos': 'REL_POS',
      'race.geo_diag': 'GEO_DIAGNOSE',

      // Act 3: MECE Simulator Workbench Additions
      'simulator.index': 'SYS // 03 — INTERACTIVE MECE WORKBENCH',
      'simulator.caliper_title': 'DETERMINISTISCHE EARLINESS-MESSLEISTE (0–100% TEXTSPANNE)',
      'simulator.xray_title': 'LIVE TOKEN-X-RAY & SUBSTRING-DETEKTION',
      'simulator.preset_1': '01. Direct Win (Personio)',
      'simulator.preset_2': '02. Brand Halo (Celonis)',
      'simulator.preset_3': '03. Takeover (Workday)',
      'simulator.preset_4': '04. Generic (Markt)',

      // Act 4: 4-Quadrant GEO Diagnostic Architecture
      'features.index': 'SYS // 04 — 4-QUADRANT GEO DIAGNOSTIC MATRIX',
      'features.title': 'Warum klassisches SEO für Sprachmodelle blind ist.',
      'features.subtitle': 'Sprachmodelle kombinieren eingefrorenes parametrisches Trainingswissen mit Echtzeit-Suchzitierungen (RAG / Grounding). Unser 4-Quadranten-Motor isoliert exakt die Ursache Ihrer Sichtbarkeitsverluste.',
      'features.axis_y_high': 'HOHE ZITIER-AUTORITÄT (GROUNDING)',
      'features.axis_y_low': 'NIEDRIGE ZITIER-AUTORITÄT',
      'features.axis_x_low': 'SCHWACHE TEXT-PROMINENZ',
      'features.axis_x_high': 'STARKE TEXT-EMPFEHLUNG (#1)',
      'features.q1_title': 'Q1 // CITATION HIJACK',
      'features.q1_desc': 'Ihre Domain liefert die Fakten im RAG-Abruf, aber der Wettbewerber erntet die Empfehlung im Text.',
      'features.q2_title': 'Q2 // PARAMETRIC BLINDSPOT',
      'features.q2_desc': 'Ihre URL wird als Quelle zitiert, doch das Modell lässt Ihren Markennamen in der Antwort komplett aus.',
      'features.q3_title': 'Q3 // BRAND HALO TRAP',
      'features.q3_desc': 'Ihre Marke erscheint regelmäßig, aber immer nur auf Platz 2 oder 3 hinter dem Marktführer.',
      'features.q4_title': 'Q4 // BURIED WINNER',
      'features.q4_desc': 'Ihre Marke gewinnt den Vergleich, wird aber erst in der unteren Texthälfte (>50% Offset) genannt.',
      'features.spec_unicode_title': 'Deutsche Unicode-Präzision',
      'features.spec_unicode_desc': 'Deterministische Case-Folding-Normalisierung für ä, ö, ü, ß und ẞ sowie mehrteilige B2B-Markennamen.',
      'features.spec_gdpr_title': 'Zero-CDN & Frankfurt Hosting',
      'features.spec_gdpr_desc': 'Keine externen Tracker, keine US-Font-CDNs, volle DSGVO-Konformität auf dedizierter Infrastruktur.',
      'features.spec_audit_title': 'Shareable Magic Audits',
      'features.spec_audit_desc': 'Kryptografisch gesicherte Read-Only-Links für Vorstände, Kunden und Agentur-Pitches mit einem Klick.',

      // Act 5: Pricing & Technical FAQ
      'pricing.index': 'SYS // 05 — TARIFF SPECIFICATION',
      'faq.index': 'SYS // 06 — TECHNISCHE DOKUMENTATION & FAQ',
      'faq.title': 'Häufige Fragen zur Share-of-Model Telemetrie',
      'faq.subtitle': 'Architektur, Methodik und Lizenzierung für europäische B2B-Unternehmen.',
      'faq.q1': 'Wie unterscheidet sich Share-of-Model (SoM) von klassischem SEO-Ranking?',
      'faq.a1': 'Suchmaschinen liefern zehn blaue Links; Sprachmodelle synthetisieren eine einzige Antwort. Chatlytics misst deterministisch, ob Ihre Marke genannt wird, an welchem Zeichen-Offset (Earliness) sie auftritt und ob sie vor oder nach Ihren Wettbewerbern empfohlen wird.',
      'faq.q2': 'Was bedeutet die 4-Zustände-MECE-Klassifikation?',
      'faq.a2': 'MECE steht für Mutually Exclusive & Collectively Exhaustive. Jeder LLM-Run fällt mathematisch eindeutig in genau eine Kategorie: 1_DIRECT_WIN (Marke führt), 2_BRAND_HALO (Marke hinter Wettbewerber), 3_COMPETITOR_TAKEOVER (nur Wettbewerber genannt) oder 4_GENERIC (keine Marken genannt).',
      'faq.q3': 'Wie funktioniert das Google Gemini Search Grounding Tracking?',
      'faq.a3': 'Unsere n8n-Worker-Pipeline extrahiert neben dem Antworttext auch die verifizierten Grounding-Chunks und Quell-Domains. Dadurch erkennen wir sofort, ob Ihre eigene Domain (z.B. personio.de) oder ein Drittportal als Beleg herangezogen wurde.',
      'faq.q4': 'Warum sind bei der kostenlosen Registrierung nur Firmen-E-Mails erlaubt?',
      'faq.a4': 'Da jeder Test-Account 40 echte Multi-LLM-Runs über OpenAI, Anthropic und Google Gemini freischaltet, schützen wir die Plattform-Infrastruktur vor Missbrauch durch automatisierte Freemail- und Wegwerf-Adressen.',

      // Trace Rail
      'trace.hero': '01.SYNTHESE',
      'trace.race': '02.MODELL-RENNEN',
      'trace.sim': '03.MECE-LABOR',
      'trace.geo': '04.GEO-MATRIX',
      'trace.pricing': '05.TARIFE',
      'trace.faq': '06.FAQ',

      // Dashboard 2x2 SVG Matrix Labels
      'geo.svg_title': '2x2 KORRELATIONS-KOORDINATENFELD',
      'geo.svg_y_axis': 'ZITATIONS-AUTORITÄT',
      'geo.svg_x_axis': 'TEXT-FRÜHZEITIGKEIT'
    },

    en: {
      // 1. Verbatim Mission Statements
      'mission.statement': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics for European B2B Brands.',
      'mission.subtitle': 'Measure and optimize how ChatGPT, Claude, and Google Gemini cite, rank, and recommend your brand against competitors. Deterministic, GDPR-compliant GEO telemetry for enterprise leaders.',

      // 2. Navigation
      'nav.brand': 'Chatlytics.de',
      'nav.tagline': 'AI Visibility & Share-of-Model Analytics',
      'nav.features': 'Features',
      'nav.mece': 'MECE Model',
      'nav.pricing': 'Pricing',
      'nav.audit_demo': 'Live Audit',
      'nav.dashboard': 'Dashboard',
      'nav.admin': 'Admin Cockpit',
      'nav.login': 'Log in',
      'nav.signup': 'Get Started Free',
      'nav.logout': 'Log out',
      'nav.home': 'Home',

      // 3. Hero Section
      'hero.title': 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics for European B2B Brands.',
      'hero.subtitle': 'Measure and optimize how ChatGPT, Claude, and Google Gemini cite, rank, and recommend your brand against competitors. Deterministic, GDPR-compliant GEO telemetry for enterprise leaders.',
      'hero.cta_free': 'Claim 40 Free Audits',
      'hero.cta_demo': 'Explore Interactive MECE Demo',
      'hero.trust_gdpr': '100% GDPR-compliant (Frankfurt Hosting)',
      'hero.trust_deterministic': 'Deterministic MECE Classification & Unicode Metrics',
      'hero.trust_multi_llm': 'Multi-LLM Telemetry: GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro',

      // 4. MECE 4-State Classifier
      '1_DIRECT_WIN': '1_DIRECT_WIN',
      '2_BRAND_HALO': '2_BRAND_HALO',
      '3_COMPETITOR_TAKEOVER': '3_COMPETITOR_TAKEOVER',
      '4_GENERIC': '4_GENERIC',

      'mece.section_title': 'The Chatlytics MECE Classification Model',
      'mece.section_desc': 'Every AI response stream is deterministically classified into one of four mutually exclusive, collectively exhaustive states.',

      'mece.1_DIRECT_WIN.title': '1_DIRECT_WIN (Direct Win)',
      'mece.1_DIRECT_WIN.badge': 'Direct Win',
      'mece.1_DIRECT_WIN.desc': 'Your brand leads the model recommendation (#1 position) or is named as the primary solution.',

      'mece.2_BRAND_HALO.title': '2_BRAND_HALO (Brand Halo)',
      'mece.2_BRAND_HALO.badge': 'Brand Halo',
      'mece.2_BRAND_HALO.desc': 'Your brand is mentioned secondarily behind a leading competitor.',

      'mece.3_COMPETITOR_TAKEOVER.title': '3_COMPETITOR_TAKEOVER (Competitor Takeover)',
      'mece.3_COMPETITOR_TAKEOVER.badge': 'Competitor Takeover',
      'mece.3_COMPETITOR_TAKEOVER.desc': 'Competitors are recommended while your brand is entirely omitted from the response stream.',

      'mece.4_GENERIC.title': '4_GENERIC (Generic Response)',
      'mece.4_GENERIC.badge': 'Generic',
      'mece.4_GENERIC.desc': 'Neither your brand nor relevant competitors appear in the response text.',

      // 5. 4-Quadrant GEO Diagnostics
      '1_CITATION_HIJACK': '1_CITATION_HIJACK',
      '2_PARAMETRIC_BLINDSPOT': '2_PARAMETRIC_BLINDSPOT',
      '3_BRAND_HALO_TRAP': '3_BRAND_HALO_TRAP',
      '4_BURIED_WINNER': '4_BURIED_WINNER',
      'NONE': 'NONE',

      'geo.section_title': '4-Quadrant GEO Action Panel',
      'geo.section_desc': 'Tactical prescriptions correlating grounding citation authority with model recommendation.',

      'geo.1_CITATION_HIJACK.title': 'Quadrant 1: Citation Hijack',
      'geo.1_CITATION_HIJACK.condition': 'Brand cited in sources, but competitor recommended in synthesis.',
      'geo.1_CITATION_HIJACK.prescription': 'Competitor is hijacking your citations. Update Schema.org markup.',
      'geo.1_CITATION_HIJACK.action': 'Update Schema.org markup, correct comparison portal entries, and reinforce primary sources.',

      'geo.2_PARAMETRIC_BLINDSPOT.title': 'Quadrant 2: Parametric Blindspot',
      'geo.2_PARAMETRIC_BLINDSPOT.condition': 'Domain cited, but brand omitted from synthesis text.',
      'geo.2_PARAMETRIC_BLINDSPOT.prescription': 'Domain cited, but brand omitted from synthesis text. Expand entity co-occurrences.',
      'geo.2_PARAMETRIC_BLINDSPOT.action': 'Expand entity co-occurrences, launch digital PR, and deepen Wikipedia citation anchoring.',

      'geo.3_BRAND_HALO_TRAP.title': 'Quadrant 3: Brand Halo Trap',
      'geo.3_BRAND_HALO_TRAP.condition': 'Brand trapped in competitor shadow.',
      'geo.3_BRAND_HALO_TRAP.prescription': 'Brand trapped in competitor shadow. Sharpen differentiating USPs.',
      'geo.3_BRAND_HALO_TRAP.action': 'Sharpen differentiating USPs and publish authoritative benchmark comparison reports.',

      'geo.4_BURIED_WINNER.title': 'Quadrant 4: Buried Winner',
      'geo.4_BURIED_WINNER.condition': 'Winner, but cited late (high token offset).',
      'geo.4_BURIED_WINNER.prescription': 'Winner, but cited late. Optimize semantic density.',
      'geo.4_BURIED_WINNER.action': 'Optimize semantic density, implement keyphrase frontloading, and refine technical glossaries.',

      'geo.NONE.title': 'No Acute GEO Anomaly',
      'geo.NONE.condition': 'Stable brand positioning without critical imbalances.',
      'geo.NONE.prescription': 'No critical GEO anomalies detected. Visibility stable.',
      'geo.NONE.action': 'Maintain ongoing telemetry monitoring and monthly audits.',

      // 6. Pricing Tiers
      'pricing.section_title': 'Transparent B2B SaaS Pricing',
      'pricing.billing_monthly': 'Monthly Billing',
      'pricing.billing_annual': 'Annual Billing (-20%)',
      'pricing.popular_badge': 'Most Popular',

      'pricing.free_name': 'Free',
      'pricing.free_price': '€0',
      'pricing.free_cadence': 'One-time 40 Credits',
      'pricing.free_target': 'Evaluation for B2B Marketing & SEO Teams',
      'pricing.free_cta': 'Get Started Free',
      'pricing.free_feat_1': '1 Tracking Configuration',
      'pricing.free_feat_2': 'GPT-4o Mini & Claude 3.5 Haiku',
      'pricing.free_feat_3': 'Basic MECE Classification',
      'pricing.free_feat_4': '7 Days History',
      'pricing.free_feat_5': 'Community Support',

      'pricing.starter_name': 'Starter',
      'pricing.starter_price': '€149',
      'pricing.starter_cadence': 'per month / 500 Credits',
      'pricing.starter_target': 'Growing European B2B Startups & Scale-ups',
      'pricing.starter_cta': 'Select Starter',
      'pricing.starter_feat_1': 'Up to 5 Tracking Configurations',
      'pricing.starter_feat_2': 'Multi-LLM (GPT-4o, Claude 3.5 Sonnet, Gemini)',
      'pricing.starter_feat_3': 'Weekly Automatic Runs',
      'pricing.starter_feat_4': 'Grounding Citation Tracking',
      'pricing.starter_feat_5': '30 Days History',
      'pricing.starter_feat_6': 'Standard Email Support',

      'pricing.growth_name': 'Growth',
      'pricing.growth_price': '€399',
      'pricing.growth_cadence': 'per month / 2,000 Credits',
      'pricing.growth_target': 'Established European B2B Brands & Agencies',
      'pricing.growth_cta': 'Select Growth',
      'pricing.growth_feat_1': 'Up to 20 Tracking Configurations',
      'pricing.growth_feat_2': 'All LLMs incl. Gemini 1.5 Pro & Search Grounding',
      'pricing.growth_feat_3': 'Daily Automatic Runs',
      'pricing.growth_feat_4': '4-Quadrant GEO Action Matrix',
      'pricing.growth_feat_5': 'Competitor Benchmark Leaderboard',
      'pricing.growth_feat_6': 'Unlimited Magic Audit Share Links',
      'pricing.growth_feat_7': 'Priority Support',

      'pricing.managed_name': 'Managed GEO Retainer',
      'pricing.managed_price': 'From €1,950',
      'pricing.managed_cadence': 'per month / Custom Retainer',
      'pricing.managed_target': 'Enterprise & Market Leaders with Strategic AI Visibility Needs',
      'pricing.managed_cta': 'Request Consultation',
      'pricing.managed_feat_1': 'Unlimited Audits & Prompts',
      'pricing.managed_feat_2': 'Custom Prompt Architecture',
      'pricing.managed_feat_3': 'Continuous Citation Engineering',
      'pricing.managed_feat_4': 'Parametric Digital PR Campaigning',
      'pricing.managed_feat_5': 'Monthly Executive C-Level Report',
      'pricing.managed_feat_6': 'Dedicated Senior GEO Strategist',

      // 7. Dashboard & Analytics
      'dashboard.title': 'AI Visibility Cockpit',
      'dashboard.kpi_som': 'Share of Model (SoM)',
      'dashboard.kpi_visibility': 'Visibility Index',
      'dashboard.kpi_earliness': 'Average Earliness',
      'dashboard.kpi_runs': 'Total Audit Runs',
      'dashboard.kpi_citation_share': 'Citation Share',
      'dashboard.kpi_credits': 'Remaining Credits',

      'dashboard.period_7d': '7 Days',
      'dashboard.period_14d': '14 Days',
      'dashboard.period_30d': '30 Days',
      'dashboard.period_90d': '90 Days',
      'dashboard.period_all': 'All',

      'dashboard.btn_trigger_run': 'Run Instant Audit',
      'dashboard.btn_running': 'Audit Running (n8n Engine)...',
      'dashboard.mece_distribution': 'MECE Category Distribution',
      'dashboard.pop_comparison': 'Period-over-Period (PoP) Comparison',
      'dashboard.competitor_leaderboard': 'Competitor Benchmark Leaderboard',
      'dashboard.citations_table': 'Top Grounding Citations & Sources',
      'dashboard.empty_title': 'No data available for this period',
      'dashboard.empty_desc': 'Run an instant audit or select a different configuration.',

      // 8. Magic Audit Preview Mode
      'audit.banner_notice': '👁️ You are viewing a shared Chatlytics Magic Audit (Read-Only).',
      'audit.conversion_text': 'Want continuous AI visibility tracking for your own brand?',
      'audit.conversion_btn': 'Claim 40 Free Audits Now',

      // 9. Admin Cockpit
      'admin.title': 'Owner Cockpit — Platform Administration',
      'admin.kpi_users': 'Registered Users',
      'admin.kpi_runs': 'Total LLM Runs',
      'admin.kpi_configs': 'Active Configurations',
      'admin.kpi_credits_used': 'Credits Consumed',
      'admin.user_directory': 'User Directory',
      'admin.btn_seed_demo': 'Seed German B2B SaaS Demo Data',
      'admin.btn_magic_audit': 'Generate Magic Audit Link',
      'admin.btn_adjust_credits': 'Adjust Credits',

      // 10. Table Column Headers
      'col.rank': 'Rank',
      'col.brand': 'Brand / Competitor',
      'col.domain': 'Domain',
      'col.mentions': 'Mentions',
      'col.win_rate': 'Win Rate %',
      'col.visibility': 'Visibility %',
      'col.earliness': 'Earliness (Word)',
      'col.recommendations': 'Recommendations',
      'col.citations': 'Citations',
      'col.source_url': 'Source URL',
      'col.authority': 'Authority',
      'col.id': 'ID',
      'col.email': 'Email',
      'col.company': 'Company',
      'col.role': 'Role',
      'col.tier': 'Plan',
      'col.credits': 'Credits',
      'col.created_at': 'Created At',
      'col.actions': 'Actions',

      // 11. Status Badges & Common UI
      'status.active': 'Active',
      'status.pending': 'Pending',
      'status.completed': 'Completed',
      'status.queued': 'Queued',
      'status.failed': 'Failed',

      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.loading': 'Loading...',
      'common.success': 'Success',
      'common.error': 'Error',
      'common.copy': 'Copy',
      'common.copied': 'Copied to clipboard!',
      'common.vs_previous': 'vs. previous period',
      'common.details': 'Details',

      // === 1. Navigation & Hero Additions ===
      'nav.simulator': 'MECE Simulator',
      'nav.faq': 'FAQ',
      'nav.billing': 'Billing',
      'nav.settings': 'Settings',
      'hero.badge': 'B2B Generative Engine Optimization (GEO) & SoM',
      'hero.cta_primary': 'Get Started Free (40 Runs)',
      'hero.cta_secondary': 'Try Live MECE Simulator',

      // === 2. Interactive MECE Simulator ===
      'simulator.title': 'Interactive MECE Simulator',
      'simulator.subtitle': 'Test the mathematically strict 4-state MECE classification directly in your browser.',
      'simulator.presets_label': 'Load presets:',
      'simulator.brand_label': 'Your Brand',
      'simulator.competitors_label': 'Competitors (comma-separated)',
      'simulator.text_label': 'AI Response Text (Synthesis)',
      'simulator.result_label': 'Classification Result:',
      'simulator.char_earliness': 'Character Earliness:',
      'simulator.word_earliness': 'Word Earliness:',
      'simulator.rel_pos': 'Relative Position:',
      'simulator.comp_earliness': '1st Competitor:',

      // === 3. 4-Tier Hybrid Pricing Table ===
      'pricing.title': '4-Tier Hybrid Pricing',
      'pricing.subtitle': 'From free freemium onboarding to tailored Managed GEO Retainers for enterprise leaders.',
      'pricing.free.name': 'Free',
      'pricing.free.desc': 'For evaluation & proof-of-concept',
      'pricing.free.period': 'forever',
      'pricing.free.cta': 'Get Started Free',
      'pricing.starter.name': 'Starter',
      'pricing.starter.desc': 'For growing SMBs & product teams',
      'pricing.per_month': '/ month',
      'pricing.starter.cta': 'Select Starter',
      'pricing.growth.badge': 'Recommended',
      'pricing.growth.name': 'Growth',
      'pricing.growth.desc': 'For market-leading B2B SaaS companies',
      'pricing.growth.cta': 'Select Growth',
      'pricing.managed.name': 'Managed GEO Retainer',
      'pricing.managed.desc': 'End-to-end Generative Engine Optimization',
      'pricing.managed.cta': 'Request Consultation',

      // Pricing Feature Bullets
      'pricing.free.feat_1': '✔ 40 Runs free starting balance',
      'pricing.free.feat_2': '✔ 1 Tracking configuration',
      'pricing.free.feat_3': '✔ OpenAI + Google Gemini routing',
      'pricing.free.feat_4': '✔ 4-State MECE instant classification',
      'pricing.free.feat_5': '✔ Community & documentation support',
      'pricing.starter.feat_1': '✔ 500 Runs per month included',
      'pricing.starter.feat_2': '✔ 5 Tracking configurations',
      'pricing.starter.feat_3': '✔ Daily automated audit jobs',
      'pricing.starter.feat_4': '✔ PoP period comparison (7d / 30d)',
      'pricing.starter.feat_5': '✔ Grounding citation analysis',
      'pricing.starter.feat_6': '✔ Email support (24h SLA)',
      'pricing.growth.feat_1': '✔ 2,000 Runs per month included',
      'pricing.growth.feat_2': '✔ 25 Tracking configurations',
      'pricing.growth.feat_3': '✔ Hourly queue synchronization',
      'pricing.growth.feat_4': '✔ All LLMs: OpenAI, Anthropic Claude, Gemini',
      'pricing.growth.feat_5': '✔ 4-Quadrant GEO Action Panel recommendations',
      'pricing.growth.feat_6': '✔ Magic Audit share links for stakeholders',
      'pricing.growth.feat_7': '✔ Priority support & onboarding call',
      'pricing.managed.feat_1': '✔ Custom run volume on demand',
      'pricing.managed.feat_2': '✔ Unlimited tracking configurations',
      'pricing.managed.feat_3': '✔ Dedicated B2B GEO optimization strategist',
      'pricing.managed.feat_4': '✔ Reverse engineering of cited source domains',
      'pricing.managed.feat_5': '✔ Custom Schema.org & Knowledge Graph blueprint',
      'pricing.managed.feat_6': '✔ Monthly C-level board report & SLA',

      // === 4. Freemium & Auth Modal ===
      'auth.tab_signup': 'Sign Up',
      'auth.tab_login': 'Log In',
      'auth.signup_sub': 'Create your account with 40 free test runs. Corporate business emails only.',
      'auth.work_email': 'Work Email Address',
      'auth.email_hint': 'No personal freemail addresses (Gmail, Yahoo, etc.)',
      'auth.password': 'Password',
      'auth.company': 'Company Name (optional)',
      'auth.btn_signup': 'Create Account & Unlock 40 Runs',
      'auth.login_sub': 'Log in with your account credentials.',
      'auth.email': 'Email Address',
      'auth.btn_login': 'Log In',
      'auth.logout': 'Log Out',

      // === 5. Client Dashboard ===
      'audit.banner': 'You are viewing a shared Chatlytics Magic Audit (Read-Only).',
      'dashboard.new_config': '+ New Configuration',
      'dashboard.trigger_run': 'Run Audit',
      'dashboard.share': 'Share',
      'kpi.som': 'Share-of-Model (SoM)',
      'kpi.som_sub': 'Share of mentions across all LLM runs',
      'kpi.visibility': 'Visibility Index',
      'kpi.visibility_sub': 'Brand mention or grounding citation present',
      'kpi.earliness': 'Average Earliness',
      'kpi.earliness_sub': 'Average relative position in text',
      'kpi.total_runs': 'Total Runs',
      'kpi.runs_sub': 'Completed multi-model evaluations',
      'kpi.citation_share': 'Citation Share',
      'kpi.citation_share_sub': 'Brand domain present in grounding sources',
      'kpi.credits': 'Credits Remaining',
      'kpi.credits_sub': 'Balance for live and queue audits',
      'dashboard.mece_trend': 'MECE Category Distribution',
      'dashboard.mece_sum_hint': '100% mutually exclusive & collectively exhaustive',
      'dashboard.competitors': 'Competitor Leaderboard',
      'table.competitor': 'Competitor',
      'table.domain': 'Domain',
      'table.visibility_pct': 'Visibility',
      'table.mentions': 'Mentions',
      'table.recommendations': 'Recommendations',
      'table.avg_pos': 'Avg. Position',
      'dashboard.citations': 'Grounding Citations & Sources',
      'table.source_domain': 'Source Domain',
      'table.domain_type': 'Type',
      'table.citation_count': 'Citations',
      'geo.title': '4-Quadrant GEO Action Panel',
      'geo.prescription_label': 'Recommended Prescription:',
      'geo.matrix_title': 'Diagnostic Matrix:',
      'audit.cta_text': 'Want continuous AI visibility tracking for your own brand?',
      'audit.cta_btn': 'Register free now (40 Runs)',

      // === 6. Owner Cockpit ===
      'admin.meta_title': 'Chatlytics.de — Owner Cockpit & System Administration',
      'admin.badge_owner': 'Owner Cockpit',
      'admin.page_title': 'Owner Cockpit & System Administration',
      'admin.page_subtitle': 'Central administration of tenant accounts, credits, Magic Audit links, and demo data.',
      'admin.kpi_users_label': 'Registered Users',
      'admin.kpi_users_sub': 'Active tenant accounts',
      'admin.kpi_configs_label': 'Tracking Configurations',
      'admin.kpi_configs_sub': 'Monitored prompt keywords',
      'admin.kpi_runs_label': 'Total Runs',
      'admin.kpi_runs_sub': 'Total LLM audits',
      'admin.kpi_credits_label': 'Available Credits',
      'admin.kpi_credits_sub': 'In active circulation',
      'admin.table_title': 'User Directory',
      'admin.search_label': 'Search Users',
      'admin.search_placeholder': 'Search by email or company...',
      'admin.col_email': 'Email',
      'admin.col_company': 'Company',
      'admin.col_tier': 'Plan',
      'admin.col_credits': 'Credits',
      'admin.col_runs': 'Runs',
      'admin.col_status': 'Status',
      'admin.col_created': 'Registered',
      'admin.col_actions': 'Actions',
      'admin.empty_title': 'No user accounts found',
      'admin.empty_desc': 'No user accounts were found. Adjust your search or generate realistic demo data.',
      'pagination.prev': '← Previous',
      'pagination.next': 'Next →',
      'admin.modal_credit_title': 'Adjust Credits',
      'admin.modal_user_label': 'User:',
      'admin.modal_current_credits': 'Current Balance:',
      'admin.modal_delta_label': 'Credit adjustment (Delta +/-):',
      'admin.modal_delta_hint': 'Positive values add credits, negative values deduct credits (minimum resulting value: 0).',
      'admin.modal_reason_label': 'Reason (optional):',
      'admin.modal_credit_save': 'Save Credits',
      'admin.modal_magic_title': 'Magic Audit Link',
      'admin.modal_magic_desc': 'This secure link grants read-only access to this account\'s client dashboard without login credentials:',
      'admin.modal_magic_copy': 'Copy',
      'admin.modal_magic_open': 'Open in new tab ↗',

      // === 7. Swiss Technical Monolith & Scroll-Craft Additions ===
      'nav.race': '3-Model Race',
      'nav.menu': 'Menu',
      'hero.index': 'SYS // 01 — DETERMINISTIC AI TELEMETRY',
      'hero.trust_title': 'VERIFIED REFERENCE ENTITIES (EUROPEAN B2B):',
      'hero.plane_coord': 'COORDINATE GRID // UTF-8 CASE-FOLDING ACTIVE',
      'hero.plane_prompt_label': 'PROMPT_INPUT [DE_B2B]',
      'hero.plane_prompt_val': 'Which HR software is best suited for the German mid-market?',
      'hero.plane_caliper_brand': 'BRAND DETECTED // CHAR_IDX: 034',
      'hero.plane_caliper_comp': '1ST COMPETITOR // CHAR_IDX: 105',
      'hero.plane_delta': 'EARLINESS LEAD: +71 CHARS',

      // Act 2: Scroll-Scrubbed 3-Model Race (Signature Move & Peak)
      'race.index': 'SYS // 02 — MULTI-MODEL TELEMETRY SCRUBBER',
      'race.title': 'One Prompt. Three AI Models. Three Divergent Realities.',
      'race.subtitle': 'Scroll or drag the playhead scrubber: watch character-by-character how the exact same brand wins in OpenAI, falls into Brand Halo in Claude, and suffers a Parametric Blindspot in Gemini despite domain citation.',
      'race.prompt_label': 'LIVE BENCHMARK PROMPT',
      'race.prompt_text': '"Welche HR-Software eignet sich am besten für den Mittelstand in Deutschland?"',
      'race.scrubber_label': 'TOKEN STREAM PLAYHEAD',
      'race.scrubber_hint': 'Scroll or drag slider to X-ray the synthesis stream',
      'race.openai_role': 'Parametric Synthesis',
      'race.claude_role': 'Conservative Enterprise Weighting',
      'race.gemini_role': 'Google Search Grounding Active',
      'race.grounding_label': 'GROUNDING SOURCES:',
      'race.char_offset': 'CHAR_IDX',
      'race.rel_pos': 'REL_POS',
      'race.geo_diag': 'GEO_DIAGNOSIS',

      // Act 3: MECE Simulator Workbench Additions
      'simulator.index': 'SYS // 03 — INTERACTIVE MECE WORKBENCH',
      'simulator.caliper_title': 'DETERMINISTIC EARLINESS CALIPER RULE (0–100% TEXT SPAN)',
      'simulator.xray_title': 'LIVE TOKEN X-RAY & SUBSTRING DETECTION',
      'simulator.preset_1': '01. Direct Win (Personio)',
      'simulator.preset_2': '02. Brand Halo (Celonis)',
      'simulator.preset_3': '03. Takeover (Workday)',
      'simulator.preset_4': '04. Generic (Market)',

      // Act 4: 4-Quadrant GEO Diagnostic Architecture
      'features.index': 'SYS // 04 — 4-QUADRANT GEO DIAGNOSTIC MATRIX',
      'features.title': 'Why Classical SEO Operates Blind Inside Language Models.',
      'features.subtitle': 'Large language models fuse frozen parametric weights with real-time retrieval (RAG / Grounding). Our 4-Quadrant engine isolates the exact structural cause of your visibility loss.',
      'features.axis_y_high': 'HIGH CITATION AUTHORITY (GROUNDING)',
      'features.axis_y_low': 'LOW CITATION AUTHORITY',
      'features.axis_x_low': 'WEAK TEXT PROMINENCE',
      'features.axis_x_high': 'LEADING RECOMMENDATION (#1)',
      'features.q1_title': 'Q1 // CITATION HIJACK',
      'features.q1_desc': 'Your domain supplies the grounded facts in RAG retrieval, yet a competitor captures the synthesis recommendation.',
      'features.q2_title': 'Q2 // PARAMETRIC BLINDSPOT',
      'features.q2_desc': 'Your URL is cited as a source, but the model completely omits your brand entity from the generated text.',
      'features.q3_title': 'Q3 // BRAND HALO TRAP',
      'features.q3_desc': 'Your brand appears consistently, but is perpetually anchored in 2nd or 3rd place behind a dominant rival.',
      'features.q4_title': 'Q4 // BURIED WINNER',
      'features.q4_desc': 'Your brand wins the recommendation, but only surfaces in the bottom half of the response (>50% offset).',
      'features.spec_unicode_title': 'German Unicode Precision',
      'features.spec_unicode_desc': 'Deterministic case-folding normalization for ä, ö, ü, ß, and ẞ plus multi-word European B2B brand entities.',
      'features.spec_gdpr_title': 'Zero-CDN & Frankfurt Hosting',
      'features.spec_gdpr_desc': 'Zero external trackers, zero US font CDNs, and full GDPR compliance on dedicated European infrastructure.',
      'features.spec_audit_title': 'Shareable Magic Audits',
      'features.spec_audit_desc': 'Cryptographically scoped read-only dashboard links for executive boards, clients, and agency pitches in one click.',

      // Act 5: Pricing & Technical FAQ
      'pricing.index': 'SYS // 05 — TARIFF SPECIFICATION',
      'faq.index': 'SYS // 06 — TECHNICAL DOCUMENTATION & FAQ',
      'faq.title': 'Frequently Asked Questions on Share-of-Model Telemetry',
      'faq.subtitle': 'Architecture, methodology, and licensing for European B2B enterprises.',
      'faq.q1': 'How does Share-of-Model (SoM) differ from classical SEO rank tracking?',
      'faq.a1': 'Search engines return ten blue links; language models synthesize a single authoritative answer. Chatlytics deterministically measures whether your brand is named, its exact character offset (earliness), and whether it leads or trails your competitors.',
      'faq.q2': 'What is the 4-State MECE Classification model?',
      'faq.a2': 'MECE stands for Mutually Exclusive & Collectively Exhaustive. Every LLM run falls into exactly one mathematical state: 1_DIRECT_WIN (brand leads), 2_BRAND_HALO (brand trails competitor), 3_COMPETITOR_TAKEOVER (only competitors named), or 4_GENERIC (no brands named).',
      'faq.q3': 'How does Google Gemini Search Grounding tracking work?',
      'faq.a3': 'Our n8n worker pipeline extracts both the synthesized text and verified grounding chunks/source domains, revealing whether your own domain (e.g., personio.de) or a third-party directory anchored the model response.',
      'faq.q4': 'Why are only corporate work emails accepted for free signup?',
      'faq.a4': 'Because every trial account unlocks 40 live multi-LLM runs across OpenAI, Anthropic, and Google Gemini, work-email verification protects platform infrastructure against automated disposable-mail abuse.',

      // Trace Rail
      'trace.hero': '01.SYNTHESIS',
      'trace.race': '02.MODEL_RACE',
      'trace.sim': '03.MECE_LAB',
      'trace.geo': '04.GEO_MATRIX',
      'trace.pricing': '05.TARIFFS',
      'trace.faq': '06.FAQ',

      // Dashboard 2x2 SVG Matrix Labels
      'geo.svg_title': '2x2 CORRELATION COORDINATE FIELD',
      'geo.svg_y_axis': 'CITATION AUTHORITY',
      'geo.svg_x_axis': 'TEXT EARLINESS'
    }
  };

  let activeLang = DEFAULT_LANG;

  // Initialize language from localStorage if available
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'de' || stored === 'en') {
        activeLang = stored;
      }
    }
  } catch (e) {
    // LocalStorage access restricted / private mode
  }

  /**
   * Translates a key with fallback mechanism.
   * Conforms to Boundary 4.1: i18n translation engine handles missing keys with fallback.
   * 
   * @param {string} key - Dictionary key (e.g. 'nav.home', '1_DIRECT_WIN')
   * @param {string} [fallback=''] - Optional fallback string if key is missing
   * @param {string} [lang=null] - Optional override language ('de' or 'en')
   * @returns {string} Translated string, fallback, or key
   */
  function t(key, fallback = '', lang = null) {
    if (!key) return fallback || '';
    const targetLang = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const dict = dictionaries[targetLang] || dictionaries[DEFAULT_LANG];

    // Direct lookup
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
      return dict[key];
    }

    // Secondary language fallback
    const altLang = targetLang === 'de' ? 'en' : 'de';
    if (dictionaries[altLang] && Object.prototype.hasOwnProperty.call(dictionaries[altLang], key)) {
      return dictionaries[altLang][key];
    }

    // Fallback or raw key
    return fallback || key;
  }

  /**
   * Sets the active language, updates localStorage and re-translates the page.
   * 
   * @param {string} lang - 'de' or 'en'
   */
  function setLanguage(lang) {
    if (lang !== 'de' && lang !== 'en') {
      lang = DEFAULT_LANG;
    }
    activeLang = lang;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, lang);
      }
    } catch (e) {
      // Storage unavailable
    }

    if (typeof document !== 'undefined') {
      if (document.documentElement) {
        document.documentElement.lang = lang;
      }
      updateLanguageSwitcherUI();
      translatePage();

      // Dispatch custom event for reactive UI components
      try {
        const event = new CustomEvent('languageChanged', { detail: { lang } });
        window.dispatchEvent(event);
      } catch (e) {
        // Fallback for older browsers
      }
    }
  }

  /**
   * Returns the current active language ('de' or 'en').
   */
  function getLanguage() {
    return activeLang;
  }

  /**
   * Updates visual active states and labels on all language switcher controls.
   */
  function updateLanguageSwitcherUI() {
    if (typeof document === 'undefined') return;

    // 1. Multi-button switchers (e.g. admin.html .lang-switch button, #btn-lang-de, #btn-lang-en)
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

    // 2. Single toggle button (index.html & dashboard.html #btn-lang-toggle)
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
        // Displays target language to switch to: 'EN' when German, 'DE' when English
        label.textContent = targetLang.toUpperCase();
      }
    });
  }

  /**
   * Binds click event listeners to all language switcher buttons across all pages.
   * Safe to call multiple times (idempotent via _langListenerAttached).
   */
  function initLanguageSwitchers() {
    if (typeof document === 'undefined') return;

    // 1. Single toggle buttons (#btn-lang-toggle, [data-lang-toggle])
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

    // 2. Explicit language buttons (.lang-switch button, [data-lang-btn], #btn-lang-de, #btn-lang-en)
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

  /**
   * Initializes the i18n subsystem, binds switchers, and translates DOM.
   */
  function init() {
    initLanguageSwitchers();
    updateLanguageSwitcherUI();
    translatePage();
  }

  /**
   * Scans the DOM and translates elements with data-i18n attributes.
   */
  function translatePage() {
    if (typeof document === 'undefined') return;

    // Text content
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key, el.textContent);
      }
    });

    // Placeholders
    const placeholderEls = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderEls.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = t(key, el.placeholder);
      }
    });

    // Titles
    const titleEls = document.querySelectorAll('[data-i18n-title]');
    titleEls.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = t(key, el.title);
      }
    });

    // Aria Labels
    const ariaEls = document.querySelectorAll('[data-i18n-aria]');
    ariaEls.forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) {
        el.setAttribute('aria-label', t(key, el.getAttribute('aria-label')));
      }
    });
  }

  /**
   * Locale-aware Currency Formatter.
   * Conforms to Feature 24.5:
   * formatCurrency(149, 'de') === '149 €'
   * formatCurrency(149, 'en') === '€149'
   * 
   * @param {number|string} val - Amount
   * @param {string} [lang=null] - 'de' or 'en'
   * @returns {string} Formatted currency
   */
  function formatCurrency(val, lang = null) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const cleanVal = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9.-]+/g, '')) || 0;
    return l === 'de' ? `${cleanVal} €` : `€${cleanVal}`;
  }

  /**
   * Locale-aware Percentage Formatter.
   * Conforms to Feature 24.5:
   * formatPercent(74.2, 'de') === '74,2 %'
   * formatPercent(74.2, 'en') === '74.2%'
   * 
   * @param {number|string} val - Percent value
   * @param {string} [lang=null] - 'de' or 'en'
   * @param {number} [decimals=1] - Decimal precision
   * @returns {string} Formatted percentage
   */
  function formatPercent(val, lang = null, decimals = 1) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const num = Number(val);
    if (isNaN(num)) return l === 'de' ? '0,0 %' : '0.0%';
    const fixed = num.toFixed(decimals);
    return l === 'de' ? `${fixed.replace('.', ',')} %` : `${fixed}%`;
  }

  /**
   * Locale-aware Number Formatter.
   * DE: 1.234,56
   * EN: 1,234.56
   * 
   * @param {number|string} val - Number value
   * @param {string} [lang=null] - 'de' or 'en'
   * @param {number} [decimals=0] - Fractional digits
   * @returns {string} Formatted number
   */
  function formatNumber(val, lang = null, decimals = 0) {
    const l = (lang === 'de' || lang === 'en') ? lang : activeLang;
    const num = Number(val);
    if (isNaN(num)) return '0';
    return num.toLocaleString(l === 'de' ? 'de-DE' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * Locale-aware Date Formatter.
   * DE: 08.11.2026
   * EN: 2026-11-08 or Nov 8, 2026
   */
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

  // Automatic DOM initialization on load if in browser
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

// ESM Exports for ES Module scripts
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

