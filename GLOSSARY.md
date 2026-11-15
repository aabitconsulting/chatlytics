# Chatlytics.de — Finalisiertes Produkt-Glossar & Fundstellen-Matrix (54/54 Entscheidungen)

**Status:** Durch Nutzer im 54-Fragen-Einzelinterview finalisiert (**noch keine Produktcode-Änderungen durchgeführt — bereit für Schritt 2 nach expliziter Freigabe**)  
**Geltungsbereich:** Gesamte Applikation (`index.html`, `dashboard.html`, `admin.html`, `assets/js/*.js`, `api/*.php`, `sql/*.sql`, `n8n/`, `tests/`)  
**Ziel:** Einheitliche, semantisch eindeutige DACH-Markensprache inklusive exakter 1:1-Entsprechung in Englisch (`assets/js/i18n.js`).

---

## 1. Verbindliche Leitprinzipien & Architekturgrenze

### 1.1 Sprach- und Markenstil
1. **Verständliches Deutsch mit etablierten Fachbegriffen:** Deutsche UI- und Marketing-Texte nutzen klare, selbsterklärende deutsche Begriffe (`Analyse-Lauf`, `GEO-Report`, `KI-Empfehlungsanteil`, `Suchregion & Sprache`, `Mess-Frequenz`, `Empfohlene Maßnahme`) und behalten dort englische/kompakte Standards bei, wo sie eindeutig etabliert sind (`Credit`, `Audit`, `Prompt`, `GEO`, `Search Grounding`, `Batch-API`, `Enterprise`, `OpenRouter`).
2. **Strikte 1:1-Zweisprachigkeit:** Jeder kanonische deutsche Begriff besitzt genau **ein** festes englisches Gegenstück in `assets/js/i18n.js`. Englische UI-Reste in der deutschen HTML-Oberfläche (`Visibility Index`, `Average Earliness`, `Total Runs`, `Citations Share`, `Credits Remaining`, `Client Analytics Dashboard`) sowie zweisprachige Klammerzusätze (`Analyse-Set (Model Preset)` bzw. `Model Presets (Analyse-Sets)`) werden vollständig bereinigt.
3. **Keine Synonym-Kollisionen:** Insbesondere werden vier Kernkonzepte strikt getrennt:
   - **`Credit`** = Abrechnungs- und Kontingenteinheit (`1 Credit = 1 Analyse-Lauf`). Nie als `Abfrage`/`Abfragen` oder `Queries` bezeichnen.
   - **`Analyse-Lauf`** (`EN: Analysis Run`) = atomare Einzelausführung von `1 Prompt × 1 KI-Modell` (ersetzt `Abfrage`/`Abfragen`/`Läufe`/`Datensätze`/`Queries`/`Runs` in Zählern, Frequenzen und Tarifen).
   - **`Prompt`** = vom Kunden hinterlegte Such-/Einkäufer-Frage (im Marketing-Fließtext optional `Einkäufer-Frage (Prompt)`).
   - **`Audit` / `Audit-Lauf`** (`EN: Audit / Audit Run`) = übergeordnete Sichtbarkeitsprüfung einer Marke über mehrere Prompts und Modelle.

### 1.2 Abwärtskompatibilitäts-Grenze (Code- vs. Text-Schicht)
Bei der Umsetzung in **Schritt 2** bleiben **Datenbank-Tabellen & -Spalten, Enum-Werte, URL-Parameter, DOM-IDs und interne API-Feldnamen** unverändert, damit Migrationen, Worker-Payloads (`n8n`), Stripe-Webhooks und bestehende Tests kompatibel bleiben:

| Geschützte Schicht | Unveränderliche Bezeichner (NICHT umbenennen) |
| :--- | :--- |
| **DB-Tabellen & -Spalten** | `tracking_configs`, `user_results_<user_id>`, `batch_requests`, `model_presets`, `llm_models`, `subscription_plans`, `config_id`, `magic_audit_token`, `full_started_at`, `initial_test_used`, `datasets_per_day`, `credits_remaining`, `eu_hosted` |
| **DB-/API-Enums** | `mece_category`: `1_DIRECT_WIN`, `2_BRAND_HALO`, `3_COMPETITOR_TAKEOVER`, `4_GENERIC` · `geo_quadrant`: `1_CITATION_HIJACK`, `2_PARAMETRIC_BLINDSPOT`, `3_BRAND_HALO_TRAP`, `4_BURIED_WINNER`, `NONE` · `schedule_interval`: `every_120m`, `every_60m`, `every_30m`, `every_15m` · `tier`: `free`, `starter`, `growth`, `enterprise_managed` · `status`: `active`, `paused`, `stopped`, `archived`, `deleted` |
| **API-Actions & URL-Params** | `?audit_token=...`, `action=full_start`, `action=seed_demo_data`, `preset_id`, `custom_models_mode`, `batch_api`, `regular` |
| **CSS-/DOM-/Test-Selektoren** | Alle `id="..."`, `.class`, `data-i18n="..."` Schlüsselnamen (`data-i18n="matrix.q1_title"` bleibt als Key erhalten — korrigiert werden die **Werte** und HTML-Fallbacks). Hinweis für Schritt 2: `tests/tier1_features/f32_run_feedback_ux.test.js:187` referenziert exemplarisch `'Abfrage starten'` in einem Mock-Button. |

---

## 2. Das kanonische Chatlytics-Glossar (54/54 verbindliche Festlegungen)

### 2.1 Kern-Einheiten & Abrechnung
| Kategorie / ID | Kanonisch (DE) | Kanonisch (EN) | Abgelöste Synonyme / Konflikte | Definition & Verwendungsregel |
| :--- | :--- | :--- | :--- | :--- |
| `unit.credit` | **Credit** / **Credits** | **Credit** / **Credits** | `Abfrage`, `Abfragen`, `Abfrage-Credits`, `Queries`, `Kontingent` (bei Zähler-Werten) | Abrechnungseinheit (`1 Credit = 1 Analyse-Lauf`). Einheitlich in Tarifkarten, Header-Badge, Kostenvorschau und Admin-Modals. |
| `unit.run` | **Analyse-Lauf** / **Analyse-Läufe** | **Analysis Run** / **Analysis Runs** | `Abfrage`, `Abfragen`, `Einzelabfrage`, `Läufe`, `Datensätze`, `Queries`, `Durchlauf`, `Run`/`Runs` | Atomare Einzelausführung von `1 Prompt × 1 KI-Modell` in Tarifen, Mess-Frequenzen und Zählern. |
| `unit.audit` | **Audit** / **Audit-Lauf** | **Audit** / **Audit Run** | *Mix aus Audit / Abfrage / Audit-Run* | Übergeordneter Sichtbarkeits-Prüfvorgang über mehrere Prompts und Modelle (`Kostenloses Audit starten`, `Audit-Lauf gestartet`). |
| `unit.prompt` | **Prompt** / **Prompts** *(Marketing optional: `Einkäufer-Frage (Prompt)`)* | **Prompt** / **Prompts** *(Marketing: `Buyer Question (Prompt)`)* | `Prompt-Keyword`, `Suchanfrage`, `Keyword` | Vom Kunden hinterlegte Kaufberatungs-/Suchfrage, die ohne System-Prompt an die LLMs gesendet wird. |
| `unit.run_matrix` | **Ausführungs-Umfang** | **Execution Scope** | `Abfrage-Matrix`, `Query Matrix`, `Run-Matrix` | Kreuzprodukt `Prompts × KI-Modelle` eines einzelnen Auslösungsvorgangs (verhindert Verwechslung mit `GEO Ursachen-Matrix`). |

### 2.2 Oberflächen, Rollen & geteilte Berichte
| Kategorie / ID | Kanonisch (DE) | Kanonisch (EN) | Abgelöste Synonyme / Konflikte | Definition & Verwendungsregel |
| :--- | :--- | :--- | :--- | :--- |
| `surface.cockpit` | **GEO Analyse-Cockpit** *(kurz: **Cockpit**)* | **GEO Analytics Cockpit** *(short: **Cockpit**)* | `Sichtbarkeits-Workspace`, `Client Analytics Dashboard` | Hauptoberfläche für Kunden in `dashboard.html` (`<title>` und `<h1>`). |
| `surface.admin` | **Admin-Cockpit** | **Admin Cockpit** | `Owner Cockpit`, `Owner Cockpit & Systemverwaltung`, `Administration` | Betreiberkonsole in `admin.html` inkl. Header-Navigationslink im Cockpit (`dashboard.html:101`). |
| `surface.board_report` | **GEO-Report** · **Report-Link** · **Report teilen** | **GEO Report** · **Report Link** · **Share Report** | `Vorstandsreport`, `Vorstandsreport-Link`, `Vorstands-Link`, `Teilen`, `Schreibgeschützter Report-Link` | Schreibgeschützte Freigabe-Ansicht über `?audit_token=...` auf Landingpage, im Cockpit-Share-Button/-Modal und im Admin (`admin.js:450`). |
| `role.tenant` | **Mandant** / **Mandanten** *(Liste: **Mandantenverzeichnis**)* | **Client** / **Clients** *(List: **Client Directory**)* | `Benutzer`, `Benutzerkonten`, `Mandantenkonten`, `User` | Im Admin-Cockpit für Kundenorganisationen (`admin.html`, `admin.js`, `i18n.js`). Login-/Passwort-Texte behalten `E-Mail`/`Konto`. |

### 2.3 Tracking-Profil & Flow-B-Lebenszyklus
| Kategorie / ID | Kanonisch (DE) | Kanonisch (EN) | Abgelöste Synonyme / Konflikte | Definition & Verwendungsregel |
| :--- | :--- | :--- | :--- | :--- |
| `obj.profile` | **Tracking-Profil** *(kurz: **Profil**)* | **Tracking Profile** *(short: **Profile**)* | `Tracking-Konfiguration`, `Konfiguration`, `Marken-Profil`, `Prompt-Profil`, `Kundenkonfig`, `Brand Profile` | Zentrales Monitoring-Setup mit Marke, Domains, Prompts, Wettbewerbern, LLMs und Mess-Frequenz (`+ Neues Tracking-Profil`, `Alle Tracking-Profile`, `Profilname`). |
| `field.market_region` | **Suchregion & Sprache** | **Search Region & Language** | `Ziel-Markt / Region`, `Target Market / Region` | Optionale Markt-/Ländervorgabe im Tracking-Profil (leer = Auto-Erkennung aus Prompt-Sprache); nach Aktivierung gesperrt. |
| `field.search_grounding` | **Live-Websuche (Search Grounding)** *(kurz: **Live-Websuche**)* | **Live Web Search (Search Grounding)** | `Search Grounding aktivieren`, `Live-Websuche / Search Grounding`, `Websuche-Steuerung` | Steuert das OpenRouter Web-Search-Plugin (Aktiv = Live-Quellen & `Standard-Lauf`, Inaktiv = Trainingswissen & `Batch-API`). |
| `flowb.test_run_cta` | **Test-Lauf starten** *(ladend: **Test-Lauf läuft…**)* | **Start Test Run** *(loading: **Running test…**)* | `Abfrage starten`, `Run Query`, `Ersten Audit-Run starten`, `Abfrage läuft...` | Einmaliger manueller Vorab-Test vor Aktivierung des Zeitplans (`initial_test_used = 0`). |
| `flowb.test_run_badge` | **Test-Lauf** | **Test Run** | `Test-Abfrage`, `Test Query`, `Pre-start test run` | Ausführungs-Badge im Einzel-Läufe-Archiv und Wortlaut in Hinweisen / `api/trigger_run.php`. |
| `flowb.activate_cta` | **Monitoring aktivieren** | **Activate Monitoring** | `Full Start aktivieren`, `Full Start`, `Full Data Mining`, `Activate Full Start` | Unwiderrufliche Aktivierung des kontinuierlichen Zeitplans (`action = 'full_start'`); sperrt Prompts und `Suchregion & Sprache`. |
| `flowb.exec_regular` | **Standard-Lauf** | **Standard Run** | `Standard-Abfrage`, `Standard Request` | Synchrone Einzelausführung über OpenRouter im Archiv-Badge. |
| `flowb.exec_batch` | **Batch-API** *(Altbestand: `Prompt-Caching (Legacy)`)* | **Batch API** *(Legacy: `Prompt Caching (Legacy)`)* | *einheitliches Badge; historische Alt-Datensätze bleiben erkennbar* | Asynchrone Sammelverarbeitung über OpenRouter Batch-API bei deaktivierter Live-Websuche. |
| `flowb.lifecycle` | **Aktiv · Pausiert · Gestoppt · Archiviert** | **Active · Paused · Stopped · Archived** | *Formulierungen „Konfiguration gestoppt/archiviert“ → „Tracking-Profil …“* | Die 4 Flow-B-Zustände in Status-Badges, Aktionsleiste und Bestätigungs-Dialogen. |

### 2.4 Mess-Frequenzen (`schedule_interval`)
Das Dropdown-Feld und Plan-Editor-Feld heißt einheitlich **`Mess-Frequenz (Analyse-Läufe / Tag pro LLM)`** bzw. EN **`Measurement Frequency (Analysis Runs / day per LLM)`**:

| DB-/API-Wert | Kanonisch (DE) | Kanonisch (EN) | Abgelöst |
| :--- | :--- | :--- | :--- |
| *(Feld-Label)* | **Mess-Frequenz (Analyse-Läufe / Tag pro LLM)** | **Measurement Frequency (Analysis Runs / day per LLM)** | `Data-Mining-Genauigkeit`, `Audit-Intervall`, `Datenabruf-Frequenzen`, `Data-Mining-Frequenzen` |
| `every_120m` | **Basis · 12 Analyse-Läufe / Tag pro LLM (alle 120 Min.)** | **Basic · 12 Analysis Runs / day per LLM (every 120 min)** | `Starter · 12 Datensätze / Tag...`, `Starter ? 12 datasets...` *(behebt Tarif-Kollision)* |
| `every_60m` | **Standard · 24 Analyse-Läufe / Tag pro LLM (alle 60 Min.)** | **Standard · 24 Analysis Runs / day per LLM (every 60 min)** | `Standard · 24 Datensätze...`, `Standard ? 24 datasets...` |
| `every_30m` | **Hoch · 48 Analyse-Läufe / Tag pro LLM (alle 30 Min.)** | **High · 48 Analysis Runs / day per LLM (every 30 min)** | `High · 48 Datensätze...`, `High ? 48 datasets...` |
| `every_15m` | **Präzision · 96 Analyse-Läufe / Tag pro LLM (alle 15 Min.)** | **Precision · 96 Analysis Runs / day per LLM (every 15 min)** | `Precision · 96 Datensätze...`, `Precision ? 96 datasets...` |
| *(Alt-Keys)* | *(Entfernen)* | *(Remove)* | `interval.every_2h` bis `interval.manual` in `i18n.js` |

### 2.5 Kuratierte Analyse-Sets (`model_presets`)
Einsprachig pro UI-Sprache: **`Analyse-Set` / `Analyse-Sets`** (DE) bzw. **`Model Preset` / `Model Presets`** (EN) — ohne gemischte Klammerzusätze:

| Seed-ID | Kanonisch (DE) | Kanonisch (EN) | Badge DE / EN | Hinweise |
| :--- | :--- | :--- | :--- | :--- |
| *(Konzept)* | **Analyse-Set** / **Analyse-Sets** | **Model Preset** / **Model Presets** | — | Ohne `(Model Preset)` im DE und ohne `(Analyse-Sets)` im EN; auch englische API-Meldungen (`configs.php`, `admin_users.php`) nutzen `Model Preset`. |
| `dach_core_baseline` | **Basis-Radar (Live-Suche)** | **Core Radar (Live Search)** | `Standard` / `Default` | `db.php` & `configs.js` auf identischen Namen und Badge `Standard` / `Default` ziehen. |
| `parametric_brand_memory` | **Trainingswissen-Radar (Batch-API)** | **Pre-Trained Knowledge Radar (Batch API)** | `Batch-API` / `Batch API` | Rein aus Trainingswissen ohne Live-Websuche über asynchrone Batch-API. |
| `eu_sovereign_dsgvo` | **Europäisches Modell-Radar** | **European Model Radar** | `Mistral & GLM` / `Mistral & GLM` | Ersetzt `EU-Souveränitäts`-/`EU-Hosted`-Versprechen (`eu_hosted = 0`, keine EU-Hosting-Zusage für LLMs). |
| `executive_full_spectrum` | **360°-Radar (Alle Kernmodelle + Suche)** | **360° Radar (All Core Models + Search)** | `Vollabdeckung` / `Full Coverage` | Harmonisiert die `…-Radar`-Reihe ohne `Vorstand`. |

### 2.6 Tarife, Kontingente & Mandate (`subscription_plans`)
**Quota-Entscheidung (Frage 53):** `Free` = **1 Tracking-Profil**, `Starter` = **3 Tracking-Profile** — `api/db.php` (`max_configs`) wird in Schritt 2 verbindlich an `index.html` angepasst!

| DB-Slug | Kanonisch (DE) | Kanonisch (EN) | Abgelöste Synonyme / Hinweise |
| :--- | :--- | :--- | :--- |
| `free` | **Free** (`0 € einmalig`) · **40 Live-Analyse-Läufe (40 Gratis-Credits)** · **1 Tracking-Profil** | **Free** (`€0 one-time`) · **40 Live Analysis Runs (40 Free Credits)** · **1 Tracking Profile** | Ersetzt `40 Live-Abfragen` / `40 Abfrage-Credits`; DB `max_configs` von `3` auf `1` angleichen. |
| `starter` | **Starter** (`149 € / Monat`) · **500 Live-Analyse-Läufe / Monat · inkl. 40 Gratis-Credits vorab** · **3 Tracking-Profile** | **Starter** (`€149 / month`) · **500 Live Analysis Runs / month · incl. 40 Free Credits upfront** · **3 Tracking Profiles** | Ersetzt `500 Live-Abfragen pro Monat` & `40 Test-Abfragen vorab`; DB `max_configs` von `5` auf `3` angleichen. |
| `growth` | **Growth** (`399 € / Monat`) · **2.000 Live-Analyse-Läufe / Monat** · **10 Tracking-Profile** · **alle OpenRouter-Modelle & Analyse-Sets** | **Growth** (`€399 / month`) · **2,000 Live Analysis Runs / month** · **10 Tracking Profiles** · **all OpenRouter models & Model Presets** | Ersetzt `2.000 Live-Abfragen`, `Marken-Profile`, `(inkl. EU-Hosted)` und `Vorstandsreports`. |
| `enterprise_managed` | **Enterprise (Managed GEO)** *(Card-Titel: `Enterprise · Managed GEO & Pipeline Defense` · `10.000+ Live-Analyse-Läufe / Monat`)* | **Enterprise (Managed GEO)** *(Card Title: `Enterprise · Managed GEO & Pipeline Defense` · `10,000+ Live Analysis Runs / month`)* | „Enterprise“ sichtbar im Namen und in Tarif-Sperrtexten beibehalten (`Starter, Growth oder Enterprise (Managed GEO)`). |

### 2.7 KPIs, Metriken & Ergebnis-Archiv
| Metrik-Key | Kanonisch (DE) | Kanonisch (EN) | Abgelöste Synonyme / Konflikte | Definition & Verwendungsregel |
| :--- | :--- | :--- | :--- | :--- |
| `som_score` | **KI-Empfehlungsanteil** *(Timeline-Tab: `KI-Empfehlungsanteil (%)`)* | **AI Recommendation Share** *(`AI Recommendation Share (%)`)* | `Share-of-Model (SoM)`, `Share-of-Model (%)` | Anteil aller abgeschlossenen Analyse-Läufe, in denen die eigene Marke im Antworttext empfohlen/genannt wird. |
| `visibility_index` | **Sichtbarkeits-Index** *(Tab: `Sichtbarkeits-Index (%)` · Wettbewerber: `Sichtbarkeit (%)`)* | **Visibility Index** *(`Visibility Index (%)` · Rivals: `Visibility (%)`)* | `Visibility Index` (im DE-HTML `dashboard.html:230`) | Anteil aller Analyse-Läufe mit eigener Markennennung **oder** eigenem Domain-Zitat im Grounding. |
| `avg_earliness` | **Position im Text (Ø)** *(Tab: `Ø Position im Text (%)`)* | **Position in Text (Avg)** *(`Avg. Position in Text (%)`)* | `Average Earliness`, `Ø Earliness (%)` | Relativer Zeichen-Offset der ersten Markennennung (`0 %` = ganz am Anfang, `100 %` = ganz am Ende; niedriger = besser). |
| `first_mention` | **Erstnennung (Zeichen)** / **Erstnennung (Wort-Nr.)** | **First Mention (Char)** / **First Mention (Word)** | — | Exakter 0-basierter Zeichen-Index bzw. 1-basierte Wortnummer der Ersterwähnung in Demo & Archiv. |
| `total_runs` | **Analyse-Läufe gesamt** | **Total Analysis Runs** | `Total Runs`, `Abfragen gesamt`, `Ausgeführte Abfragen`, `Total Queries`, `Ausgeführte Runs` | Gesamtzahl abgeschlossener atomarer Auswertungen im Cockpit-KPI #4 und Admin-KPI #3. |
| `citation_share` | **Domain-Zitat-Anteil** *(Tab: `Domain-Zitate (%)` · Panel: `Zitierte Quell-Domains (Search Grounding)`)* | **Domain Citation Share** *(`Domain Citations (%)` · Panel: `Cited Source Domains (Search Grounding)`)* | `Citations Share`, `Quellen-Anteil`, `Grounding-Zitierungen & Quellen` | Anteil der Analyse-Läufe mit Search Grounding, bei denen die eigene Domain als Recherche-Quelle zitiert wird. |
| `credits_remaining` | **Verbleibende Credits** *(Admin-KPI: `Verfügbare Credits`)* | **Remaining Credits** *(Admin: `Available Credits`)* | `Credits Remaining`, `Verbleibende Abfragen`, `Remaining Queries`, `Verfügbare Abfragen` | Verfügbares Restguthaben in Credits (Cockpit-Header, KPI #6 und Admin-KPI #4). |
| `results_archive` | **Einzel-Läufe & KI-Antworten (Prompt- & Antwort-Archiv)** | **Individual Runs & AI Answers (Prompt & Answer Archive)** | `Einzelabfragen und KI-Antworten`, `Individual Queries & AI Answers` | Aufklappbare Detailtabelle der Einzel-Antworten ganz unten im Cockpit. |

### 2.8 Die 4 Empfehlungs-Stufen (MECE-Taxonomie)
Jeder abgeschlossene Analyse-Lauf fällt in genau eine dieser 4 parallel gebauten Stufen:

| Enum-Key | Kanonisch DE | Kanonisch EN | Abgelöst / Harmonisiert |
| :--- | :--- | :--- | :--- |
| `1_DIRECT_WIN` | **Spitzenreiter · Direkte Empfehlung** | **Frontrunner · Direct Recommendation** | Ersetzt `Platz 1 · Erste Wahl`, `Spitzenreiter · Erste Wahl`, `Optimal (Spitzenreiter)` vs. `Rank 1 · First Choice` / `Frontrunner · First Choice`. |
| `2_BRAND_HALO` | **Verfolgerplatz · Zweitnennung** | **Runner-Up · Secondary Mention** | Ersetzt `Platz 2 · Im Windschatten`, `Verfolgerplatz · Im Windschatten` vs. `Rank 2 · Runner-Up` / `Challenging · Runner-Up`. |
| `3_COMPETITOR_TAKEOVER` | **Marke fehlt · Wettbewerber empfohlen** | **Brand Missing · Competitor Named** | Ersetzt `Verdrängt · Wettbewerbs-Übernahme`, `Verdrängt · Gekaperte Vorlage` / `Stummes Quell-Zitat` im Status-Badge (Dossier trennt Status vs. GEO-Befund sauber!). |
| `4_GENERIC` | **Neutral · Keine Anbieter-Nennung** | **Neutral · No Vendor Named** | Ersetzt `Markenfreie Antwort` / `Brand-Free Response`. |

### 2.9 Die GEO Ursachen-Matrix (4 Quadranten + `NONE` + Diagnose-/Aktions-Labels)
- **Matrix-Titel:** **`GEO Ursachen-Matrix`** (kurz in Nav: **`Ursachen-Matrix`**) | EN **`GEO Root-Cause Matrix`** (kurz: **`Root-Cause Matrix`**). Ersetzt `4-Felder-Ursachen-Diagnose`, `GEO Ursachen- & Maßnahmen-Matrix`.
- **Karten-/Box-Struktur-Labels (Frage 54):** **`Befund`** & **`Empfohlene Maßnahme`** *(kurz: **`Maßnahme`**)* | EN **`Finding`** & **`Recommended Action`**. Ersetzt gemischte Labels (`Problem`, `Technischer Hebel`, `Chatlytics-Hebel`, `Empfohlener Chatlytics-Hebel:`).

| Quadrant-ID | Kanonischer Titel (DE) | Kanonischer Titel (EN) | Kompakte SVG-Zelle (DE / EN) | Diagnose-Bedingung (`metrics_engine.js`) |
| :--- | :--- | :--- | :--- | :--- |
| `1_CITATION_HIJACK` (`q1`) | **1. Quelle zitiert, Konkurrent empfohlen** | **1. Source Cited, Rival Recommended** | `1. QUELLE ZITIERT · Konkurrent empfohlen` / `1. SOURCE CITED · Rival recommended` | Quelle wird zitiert, doch Wettbewerber wird zuerst empfohlen (ersetzt `Gekaperte Vorlage`). |
| `2_PARAMETRIC_BLINDSPOT` (`q2`) | **2. Quelle zitiert, Marke fehlt** | **2. Source Cited, Brand Missing** | `2. QUELLE ZITIERT · Marke fehlt` / `2. SOURCE CITED · Brand missing` | Eigene Domain in Grounding-Quellen zitiert, Markenname fehlt im Text (ersetzt `Stummes Quell-Zitat`). |
| `3_BRAND_HALO_TRAP` (`q3`) | **3. Marke bekannt, aber nur Zweitnennung** | **3. Brand Known, Only Runner-Up** | `3. MARKE BEKANNT · Nur Zweitnennung` / `3. BRAND KNOWN · Only runner-up` | Marke aus Trainingswissen bekannt, verharrt aber systematisch hinter Wettbewerber (ersetzt `Ewige Zweitnennung`). |
| `4_BURIED_WINNER` (`q4`) | **4. Marke empfohlen, aber erst spät im Text (> 50 %)** | **4. Brand Recommended, Late in Text (> 50%)** | `4. EMPFOHLEN · Erst spät (> 50 %)` / `4. RECOMMENDED · Late in text (> 50%)` | Marke genannt/empfohlen, jedoch erst ab Offset `> 50 %` im Antworttext (ersetzt `Versteckter Gewinner`). |
| `NONE` | **Kein kritischer Befund** | **No Critical Findings** | — | Keine der 4 GEO-Anomalien ausgelöst (ersetzt `Optimal · Spitzenreiter`, `Keine kritischen Sichtbarkeitslücken...`). |

### 2.10 Landingpage-Bereiche, Infrastruktur & Modellnamen
- **Navigation / Sektionen:** `KI-Modell-Vergleich` (`AI Model Comparison`) · `Antwort-Analyse-Demo` (`Response Analysis Demo`) · `Ursachen-Matrix` (`Root-Cause Matrix`) · `Preise` (`Pricing`) · `FAQ` (`FAQ`).
- **Infrastruktur-Aussage (Frage 51):** Anwendungs- und Analyse-Plattform klar kommunizieren als **`Chatlytics gehostet in Deutschland (Frankfurt am Main)`** / **`Chatlytics hosted in Germany`**. Keine speziellen EU-Hosting-Versprechen zu den KI-Modellen — stattdessen ausschließlich neutral **`Europäische KI-Modelle verfügbar`** / **`European AI Models available`**. Sämtliche `(Mistral EU)`-, `EU-Souveränitäts`- und `EU-Hosted`-Altlasten (`index.html`, `i18n.js`, `admin.js`, `configs.js`, `api/db.php`) werden entfernt.
- **Modellnamen auf Landingpage & Demo (Frage 52):** Hero, KI-Modell-Vergleich (`dossier-stage.js`), Antwort-Analyse-Demo, Säule 3, FAQ, Auth-Modal und Beispiel-Report-Modal formulieren überall **herstellerneutral über Modellfamilien (`ChatGPT / OpenAI`, `Claude / Anthropic`, `Gemini / Google`, `Mistral`) ohne fiktive oder hartcodierte Versionsnummern** (`GPT-6.1 Sol`, `Claude 5.5`, `Gemini Hydrogen`, `3.8 Flash`). Im produktiven Live-Katalog (`configs.js`, `admin.js`, `api/db.php`) bleiben selbstverständlich die konkreten auswählbaren OpenRouter-Modelle erhalten.

---

## 3. Aufgedeckte Defekte & Inhaltliche Korrekturen (Pflicht-Fixes in Schritt 2)

1. **[KRITISCH] Rotierte `matrix.q1_* .. matrix.q4_*`-Keys in `assets/js/i18n.js` (DE `L171–189` & EN `L746–764`):**
   - *Ist-Zustand in `i18n.js`:* `q1` = Stummes Quell-Zitat, `q2` = Versteckter Gewinner, `q3` = Gekaperte Vorlage, `q4` = Ewige Zweitnennung.
   - *Ist-Zustand in `index.html` (`L406–475`), `dashboard.html` (`L480–532`) & `metrics_engine.js`:* `q1` = Citation Hijack, `q2` = Parametric Blindspot, `q3` = Brand Halo Trap, `q4` = Buried Winner.
   - *Fix:* `matrix.q1_*..q4_*` in `i18n.js` (DE & EN) exakt auf die verbindlichen Titel Q1–Q4 (Abschnitt `2.9`) korrigieren sowie `Befund` & `Empfohlene Maßnahme` in Karten und Reports synchronisieren.
2. **`?`-Encoding-Glitches im UI:**
   - `assets/js/i18n.js:1107–1110`: `'Starter ? 12 datasets...'`, `'Standard ? 24...'`, `'High ? 48...'`, `'Precision ? 96...'` → `'Basic · 12 Analysis Runs...'` bis `'Precision · 96 Analysis Runs...'`.
   - `assets/js/admin.js:333, 342`: `u.company_name || '?'` und `... || '?'` → `'—'`.
   - `assets/js/admin.js:387, 394`: `'? Tokens / Run'`, `'? Tokens / Profil'` → `'Ø Tokens / Analyse-Lauf'`, `'Ø Tokens / Profil'`.
3. **Veraltete Intervall-Altlasten in `assets/js/i18n.js`:**
   - `L453–461` (DE) & `L1028–1036` (EN): `interval.every_2h` bis `interval.manual` komplett entfernen (`SCHEDULE_INTERVALS` kennt nur `every_120m/60m/30m/15m`).
   - `L531` (DE) & `L1037` (EN): `config.tier_hint_free` auf `configs.js:737` + finalisiertes Glossar angleichen (`Mess-Frequenzen über Basis (24, 48 oder 96 Analyse-Läufe / Tag pro LLM) erfordern einen bezahlten Tarif: Starter, Growth oder Enterprise (Managed GEO).`).
4. **Kollision `Starter`-Intervall vs. `Starter`-Tarif:**
   - `every_120m` wird auf **`Basis`** (`Basic`) umbenannt; der Name `Starter` gehört eindeutig dem 149-€-Tarif.
5. **Veraltete „EU-gehostetes Mistral“-/„EU-Hosted“-Versprechen & Demo-Versionsnummern:**
   - `index.html:516, 652`, `i18n.js:29, 196, 237, 262, 604, 771, 812, 837`, `configs.js:167–172`, `admin.js:1720–1727`, `api/db.php:919–925` gemäß Fragen 51 & 52 bereinigen (`Chatlytics gehostet in Deutschland`, `Europäische KI-Modelle verfügbar`, Modellfamilien ohne fiktive Versionsnummern auf Marketing/Demo).
6. **Preset- & Quota-Drift (`index.html` vs. `configs.js` vs. `api/db.php`):**
   - **Quota (Frage 53):** `api/db.php` (`Free max_configs: 3 → 1`, `Starter max_configs: 5 → 3`) an die Landingpage angleichen.
   - **Preset (Frage 23):** `configs.js:140` (`DACH Basis-Radar`) und `api/db.php:890` (`Basis-Radar (Live-Suche)`) einheitlich auf **`Basis-Radar (Live-Suche)`** (`Core Radar (Live Search)`) und Badge **`Standard`** (`Default`) synchronisieren.

---

## 4. Vollständige Fundstellen-Matrix über alle Dateien hinweg

Legende Maßnahmen: **`Umbenennen`** (Wortlaut an finalisiertes Glossar anpassen) · **`DE/EN-Sync`** (Fremdsprach-Rest im DE/EN-HTML bereinigen) · **`Bugfix`** (Logik-/Zuordnungs-/Encoding-Fehler beheben) · **`Inhalt-Sync`** (Hosting-/Modell-/Quota-Wahrheit angleichen) · **`Löschen`** (veraltete Keys entfernen).

### 4.1 `index.html`
| Zeile(n) | Key / Kontext | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `32`, `56` | `nav.matrix` / Dossier-Nav | `Modell-Vergleich`, `Antwort-Prüfstand`, `Ursachen-Matrix` | `KI-Modell-Vergleich`, `Antwort-Analyse-Demo`, `Ursachen-Matrix` | Umbenennen |
| `42`, `61` | `nav.signup` | `Kostenloses Audit starten` | `Kostenloses Audit starten` *(kanonisch!)* | OK |
| `59`, `78` | `hero.cta_secondary` | `Beispiel-Vorstandsreport ansehen →` | `Beispiel-GEO-Report ansehen →` | Umbenennen |
| `73` | `hero.subtitle` | `...ChatGPT (GPT-6.1 Sol & Terra, GPT-6 Astra & Luna), Claude 5.5 (Opus, Sonnet, Haiku) und Google Gemini (Hydrogen, Carbon, Argon, 3.8 Flash)...` | Herstellerneutral über Modellfamilien ohne Versionsnummern (`ChatGPT / OpenAI, Claude / Anthropic, Gemini / Google, Mistral`) | Inhalt-Sync |
| `77` | `hero.cta_primary` | `Eigene Marke kostenlos prüfen (40 Live-Abfragen)` | `Eigene Marke kostenlos prüfen (40 Live-Analyse-Läufe)` | Umbenennen |
| `119–123` | `dossier.scrubber_label`, `hint` | `Lesefortschritt prüfen` / `Ziehen Sie den Regler von 0 % bis 100 %...` | Angleichen an `i18n.js:65–66` (`Lesefortschritt Zeichen für Zeichen`) | DE/EN-Sync |
| `134, 173, 212, 251` | Dossier Modell-Cards | `OpenAI GPT-6.1 Sol`, `Anthropic Claude Sonnet 5.5`, `Google Gemini 3.8 Flash` | Herstellerneutrale Familiennamen (`OpenAI · ChatGPT`, `Anthropic · Claude`, `Google · Gemini`) ohne fiktive Versionsnummern | Inhalt-Sync |
| `163`, `178`, `202`, `217`, `241` | Dossier Status / Diagnose | `Optimal (Spitzenreiter)`, `Platz 2 · Im Windschatten`, `Ewige Zweitnennung`, `Verdrängt · Stummes Quell-Zitat` | Status-Badge strikt MECE (`Spitzenreiter · Direkte Empfehlung`, `Verfolgerplatz · Zweitnennung`, `Marke fehlt · Wettbewerber empfohlen`); Diagnose-Zeile strikt GEO (`Kein kritischer Befund`, `3. Marke bekannt, aber nur Zweitnennung`, `2. Quelle zitiert, Marke fehlt`) | Umbenennen |
| `289–292` | `workbench.*` | `INTERAKTIVER ANTWORT-PRÜFSTAND` / `GPT-6.1-, Claude-5.5- oder Gemini-Antwort (Hydrogen / 3.8 Flash)` | `ANTWORT-ANALYSE-DEMO` / Modellfamilien ohne Versionsnummern (`ChatGPT-, Claude-, Gemini- oder Mistral-Antwort`) | Umbenennen / Inhalt-Sync |
| `299–302` | `workbench.preset_1..4` | `Szenario 1: Spitzenreiter`, `Szenario 2: Im Windschatten`, `Szenario 3: Wettbewerbs-Übernahme` | Mit `i18n.js` abgleichen auf MECE (`Spitzenreiter · Direkte Empfehlung`, `Verfolgerplatz · Zweitnennung`, `Marke fehlt · Wettbewerber empfohlen`) | Umbenennen |
| `381–488` | `matrix.*` | `DIE GEO URSACHEN-MATRIX`, `1. Die gekaperte Vorlage`..`4. Der versteckte Gewinner`, `Befund`/`Chatlytics-Hebel` vs. `Problem`/`Technischer Hebel` | Titel `1. Quelle zitiert, Konkurrent empfohlen` .. `4. Marke empfohlen, aber erst spät im Text (> 50 %)`; Labels **`Befund`** & **`Empfohlene Maßnahme`** synchron zu `i18n.js` | Bugfix / Umbenennen |
| `516` | `pillar.3_desc` | `...GPT-6.1 Sol... sowie EU-gehostetes Mistral & GLM 5.3 statt vager Schätzwerte.` | Modellfamilien + `Chatlytics gehostet in Deutschland (Frankfurt am Main)` + `Europäische KI-Modelle verfügbar` (kein EU-Hosted-LLM-Claim) | Inhalt-Sync |
| `545–548` | `pricing.free.feat_*` | `40 Live-Abfragen (Lifetime)`, `1 Marken-Profil`, `Basis Analyse-Set: DACH Basis-Radar...` | `40 Live-Analyse-Läufe (40 Gratis-Credits)`, `1 Tracking-Profil`, `Basis-Analyse-Set: Basis-Radar (Live-Suche)` | Umbenennen |
| `551` | `pricing.free.cta` | `Kostenlos starten (40 Abfragen)` | `Kostenlos starten (40 Credits)` | Umbenennen |
| `564–568` | `pricing.starter.feat_*` | `500 Live-Abfragen pro Monat`, `3 Marken-Profile...`, `Alle kuratierten Analyse-Sets (Parametrisch, EU-Souveränität & 360° Benchmark)`, `Volle Ursachen- & Maßnahmen-Matrix` | `500 Live-Analyse-Läufe / Monat (inkl. 40 Gratis-Credits vorab)`, `3 Tracking-Profile oder Produktlinien`, `Alle kuratierten Analyse-Sets (Trainingswissen-Radar, Europäisches Modell-Radar & 360°-Radar)`, `Volle GEO Ursachen-Matrix` | Umbenennen / Sync |
| `584–588` | `pricing.growth.feat_*` | `2.000 Live-Abfragen pro Monat`, `10 Marken-Profile / Märkte`, `Freie Modellwahl & Websuche-Steuerung (inkl. EU-Hosted & alle Analyse-Sets)`, `Schreibgeschützte Vorstandsreports per Link` | `2.000 Live-Analyse-Läufe / Monat`, `10 Tracking-Profile / Märkte`, `Freie Modellwahl & Live-Websuche-Steuerung (alle OpenRouter-Modelle & Analyse-Sets)`, `GEO-Reports per Link teilen (schreibgeschützt)` | Umbenennen / Inhalt-Sync |
| `597–609` | `pricing.managed.*` | `Managed GEO & Pipeline Defense`, `10.000+ Live-Abfragen pro Monat...`, `Direkte Content-Optimierung gegen gekaperte Vorlagen` | `Enterprise · Managed GEO & Pipeline Defense`, `10.000+ Live-Analyse-Läufe / Monat (Multi-Region)`, Bullettext zu Q1 ohne Metapher (`gegen Q1: Quelle zitiert, Konkurrent empfohlen`) | Umbenennen |
| `652` | `faq.a3` | `...OpenAI (GPT-6.1 / 6), Anthropic (Claude 5.5), Google (Gemini) und EU-gehostetes Mistral.` | Herstellerneutrale Familien (`OpenAI ChatGPT`, `Anthropic Claude`, `Google Gemini`, `Mistral` u. a.); `Chatlytics gehostet in Deutschland`, `Europäische KI-Modelle verfügbar` | Inhalt-Sync |
| `662` | `faq.a4` | `„Stummes Quell-Zitat“ oder „Gekaperte Vorlage“` | `„2. Quelle zitiert, Marke fehlt“ oder „1. Quelle zitiert, Konkurrent empfohlen“` | Umbenennen |
| `692, 704, 724` | Auth-Modal | `Kostenlos starten (40 Abfragen)`, `40 Live-Abfragen über GPT-6.1 Sol...`, `Konto erstellen & 40 Abfragen sichern` | `Kostenlos starten (40 Credits)`, `40 Live-Analyse-Läufe (40 Gratis-Credits) mit führenden KI-Modellfamilien...`, `Konto erstellen & 40 Credits sichern` | Umbenennen / Inhalt-Sync |
| `755–801` | Report-Modal | `Beispiel-Vorstandsreport (Schreibgeschützte Ansicht)`, `Vorsprung (GPT-6.1 Sol)`, `Gemini 3.8 Flash Search`, `Eigenen Vorstandsreport kostenlos erzeugen` | `Beispiel-GEO-Report (Schreibgeschützte Ansicht)`, Modellfamilien ohne Versionsnummern, `Eigenen GEO-Report kostenlos erzeugen` | Umbenennen / Inhalt-Sync |
| `811` | Strategy-Modal | `Managed GEO & Pipeline Defense anfragen` | `Enterprise · Managed GEO & Pipeline Defense anfragen` | Umbenennen |
| `877` | AGB-Modal | `...umfassen 40 Abfrage-Credits; bezahlte Pakete (Starter, Growth, Managed GEO)...` | `...umfassen 40 Gratis-Credits (40 Live-Analyse-Läufe); bezahlte Tarife (Starter, Growth, Enterprise (Managed GEO))...` | Umbenennen |

### 4.2 `dashboard.html`
| Zeile(n) | Key / Kontext | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `6` | `<title>` | `Chatlytics.de — Client Analytics Dashboard` | `Chatlytics.de — GEO Analyse-Cockpit` | DE/EN-Sync |
| `21–22` | `audit.banner` | `Sie betrachten einen schreibgeschützten Chatlytics-Vorstandsreport.` | `Sie betrachten einen geteilten Chatlytics GEO-Report (schreibgeschützt).` | Umbenennen |
| `44–49` | Config-Dropdown & CTA | `Tracking-Konfiguration`, `Alle Konfigurationen`, `+ Neue Konfiguration` | `Tracking-Profil`, `Alle Tracking-Profile`, `+ Neues Tracking-Profil` | Umbenennen |
| `72` | `dashboard.trigger_run` | `Abfrage starten` | `Test-Lauf starten` | Umbenennen |
| `76` | Credits-Badge Title | `title="Verbleibende Abfrage-Credits"` | `title="Verbleibende Credits"` | Umbenennen |
| `85–89` | Share-Button | `title="Vorstandsreport-Link kopieren"`, `Teilen` | `title="Report-Link kopieren"`, `Report teilen` | Umbenennen |
| `101` | `nav.admin` | `Admin` | `Admin-Cockpit` | Umbenennen |
| `112` | `dashboard.page_title` H1 | `Sichtbarkeits-Workspace` | `GEO Analyse-Cockpit` | Umbenennen |
| `116–132` | Flow-B-Aktionsleiste | `Full Start aktivieren`, `Konfiguration dauerhaft stoppen`, `Gestoppte Konfiguration archivieren`, `Konfiguration löschen` | `Monitoring aktivieren`, `Tracking-Profil dauerhaft stoppen`, `Gestopptes Tracking-Profil archivieren`, `Tracking-Profil löschen` | Umbenennen |
| `182` | Run-Status-Banner Default | `Audit-Run gestartet` | `Audit-Lauf gestartet` | Umbenennen |
| `202–206` | `dashboard.first_day_*` | `Tag 1 der Konfiguration...`, `...gemäß der gewählten Data-Mining-Genauigkeit über den Tag verteilt abgefragt.` | `Tag 1 des Tracking-Profils — Datenerhebung läuft über den Kalendertag`, `Ihre Prompts werden gemäß der gewählten Mess-Frequenz über den Tag verteilt als Analyse-Läufe ausgeführt...` | Umbenennen |
| `224` | `kpi.som_title` / `som_sub` | `Share-of-Model (SoM)`, `Anteil der Nennungen an allen LLM-Runs` | `KI-Empfehlungsanteil`, `Anteil der Nennungen an allen Analyse-Läufen` | Umbenennen |
| `230` | `kpi.visibility` | `Visibility Index` | `Sichtbarkeits-Index` | DE/EN-Sync |
| `242` | `kpi.earliness` | `Average Earliness` | `Position im Text (Ø)` | DE/EN-Sync |
| `254, 260` | `kpi.total_runs`, `runs_sub` | `Total Runs`, `Durchgeführte Multi-Model Evaluierungen` | `Analyse-Läufe gesamt`, `Abgeschlossene Multi-Modell-Läufe` | DE/EN-Sync |
| `266, 272` | `kpi.citation_share`, `sub` | `Citations Share`, `Eigene Domain in Grounding-Quellen` | `Domain-Zitat-Anteil`, `Eigene Domain in Grounding-Quellen` | DE/EN-Sync |
| `278, 283` | `kpi.credits`, `credits_sub` | `Credits Remaining`, `Guthaben für Live- und Queue-Audits` | `Verbleibende Credits`, `Guthaben für Live- und geplante Audits` | DE/EN-Sync |
| `302–308` | `timeline.metric_*` | `Share-of-Model (%)`, `Visibility Index (%)`, `Ø Earliness (%)`, `Citations Share (%)` | `KI-Empfehlungsanteil (%)`, `Sichtbarkeits-Index (%)`, `Ø Position im Text (%)`, `Domain-Zitate (%)` | DE/EN-Sync |
| `338–342` | `dashboard.empty_*` & CTA | `Für die ausgewählte Konfiguration liegen... keine abgeschlossenen Audit-Läufe vor...`, `Ersten Audit-Run starten` | `Für das ausgewählte Tracking-Profil liegen im Zeitraum noch keine abgeschlossenen Analyse-Läufe vor...`, `Test-Lauf starten` | Umbenennen |
| `355–391` | MECE-Trend | `Verteilung der 4 Empfehlungs-Stufen`, `Platz 1 · Erste Wahl`, `Platz 2 · Im Windschatten`, `Verdrängt · Wettbewerbs-Übernahme`, `Markenfreie Antwort` | `Spitzenreiter · Direkte Empfehlung`, `Verfolgerplatz · Zweitnennung`, `Marke fehlt · Wettbewerber empfohlen`, `Neutral · Keine Anbieter-Nennung` | Umbenennen |
| `429` | `dashboard.citations` | `Grounding-Zitierungen & Quellen` | `Zitierte Quell-Domains (Search Grounding)` | Sync mit `i18n.js` |
| `460–468` | `geo.title`, `NONE`, `prescription_label` | `GEO Ursachen- & Maßnahmen-Matrix`, `Kein kritischer Befund`, `Empfohlener Chatlytics-Hebel:` | `GEO Ursachen-Matrix`, `Kein kritischer Befund`, `Empfohlene Maßnahme:` | Umbenennen |
| `476–498` | GEO SVG-Matrix | `2×2 Ursachen-Verteilung`, `1. GEKAPERTE VORLAGE` .. `4. VERSTECKTER GEWINNER` | Kompakte SVG-Titel Q1–Q4 gemäß `2.9` (`1. QUELLE ZITIERT · Konkurrent empfohlen` .. `4. EMPFOHLEN · Erst spät (> 50 %)`) | Umbenennen |
| `505–532` | `matrix.q1_title..q4_title` | `1. Die gekaperte Vorlage`..`4. Der versteckte Gewinner` | Kanonische Titel `1. Quelle zitiert, Konkurrent empfohlen` .. `4. Marke empfohlen, aber erst spät im Text (> 50 %)` + `i18n.js` fixen | Bugfix / Umbenennen |
| `542–593` | `results.*` | `Einzelabfragen und KI-Antworten`, `Einzelabfragen & KI-Antworten (Prompt- & Antwort-Archiv)`, `Lade Einzelabfragen...` | `Einzel-Läufe & KI-Antworten (Prompt- & Antwort-Archiv)`, `Lade Einzel-Läufe…` | Umbenennen |
| `617` | `audit.cta_btn` | `Jetzt kostenlos registrieren (40 Abfragen)` | `Jetzt kostenlos registrieren (40 Credits)` | Umbenennen |
| `628` | Modal-Titel | `Neue Tracking-Konfiguration` | `Neues Tracking-Profil` | Umbenennen |
| `647–648, 672` | `config.prompts_locked_hint`, `market_region` & Lock-Hint | `Ziel-Markt / Region`, `Hinweis: Nach Aktivierung von Full Start...` | `Suchregion & Sprache`, `Hinweis: Nach Aktivierung des Monitorings sind Prompts sowie Suchregion & Sprache gesperrt...` | Umbenennen |
| `681` | Label `#cfg-name` | `Konfigurationsname` | `Profilname` | Umbenennen |
| `686–691` | `config.interval_label`, `interval.*` | `Data-Mining-Genauigkeit (Datensätze / Tag pro KI-Modell)`, `Starter · 12...`, `Standard · 24...`, `High · 48...`, `Precision · 96...` | `Mess-Frequenz (Analyse-Läufe / Tag pro LLM)`, `Basis · 12 Analyse-Läufe...`, `Standard · 24...`, `Hoch · 48...`, `Präzision · 96...` | Umbenennen |
| `697–703` | `config.presets_*` | `Analyse-Set (Model Preset) wählen`, `Kuratiertes Analyse-Set`, `custom_models_locked_hint` | `Analyse-Set wählen`, `Kuratiertes Analyse-Set`, `...ab dem Tarif Growth...` *(ohne `(Model Preset)`)* | Umbenennen |
| `790` | Submit-Button | `Konfiguration speichern` | `Tracking-Profil speichern` | Umbenennen |
| `801` | Share-Modal Titel | `Schreibgeschützter Vorstandsreport-Link` | `Report-Link (schreibgeschützt)` | Umbenennen |
| `821` | Confirm-Modal Default | `Abfrage jetzt starten?` | `Test-Lauf jetzt starten?` | Umbenennen |

### 4.3 `admin.html`
| Zeile(n) | Key / Kontext | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `6–7` | `<title>`, `<meta>` | `Owner Cockpit & Systemverwaltung`, `Benutzerverwaltung` | `Admin-Cockpit — Chatlytics.de`, `Mandantenverwaltung, Credits, Report-Links...` | Umbenennen |
| `27, 32` | Header Badge & Nav | `Owner Cockpit`, `Administration` | `Admin-Cockpit`, `Admin-Cockpit` | Umbenennen |
| `57–59` | Page Header | `Owner Cockpit & Systemverwaltung`, `Zentrale Verwaltung von Mandanten...` | `Admin-Cockpit`, `Zentrale Verwaltung von Mandanten, Credit-Kontingenten, Report-Links und Demodaten.` | Umbenennen |
| `75–95` | Admin KPI-Cards | `Registrierte Benutzer` / `Aktive Mandantenkonten`, `Tracking-Konfigurationen` / `Überwachte Prompt-Keywords`, `Ausgeführte Runs` / `LLM-Audits gesamt`, `Verfügbare Credits` | `Mandanten` / `Aktive Mandantenkonten`, `Tracking-Profile` / `Überwachte Prompt-Profile`, `Analyse-Läufe gesamt` / `Audit-Läufe gesamt`, `Verfügbare Credits` / `Guthaben aller Mandanten` | Umbenennen |
| `100–115` | Admin Tabs | `Owner Cockpit Bereiche`, `Benutzer & Telemetrie`, `Analyse-Sets (Model Presets)` | `Admin-Cockpit Bereiche`, `Mandanten & Telemetrie`, `Analyse-Sets` *(ohne `(Model Presets)`)* | Umbenennen |
| `123–128, 179–190` | Tabelle & Empty State | `Benutzerverzeichnis`, `0 Benutzer`, `Benutzer suchen`, `Keine Benutzerkonten gefunden`, `Benutzer Pagination` | `Mandantenverzeichnis`, `0 Mandanten`, `Mandanten suchen`, `Keine Mandanten gefunden`, `Mandanten-Navigation` | Umbenennen |
| `275–311, 680` | Provider-Tab & Impact-Modal | `Aktive Kundenkonfigs & Sets`, `Modelle mit aktiven Konfigurationen`, `Mit aktiven Konfigurationen` | `Aktive Tracking-Profile & Analyse-Sets`, `Modelle mit aktiven Tracking-Profilen`, `Mit aktiven Tracking-Profilen` | Umbenennen |
| `325–335` | `admin.presets_*` | `Analyse-Sets (Model Presets)`, `Growth & Enterprise erhalten zusätzlich volle manuelle Modellfreiheit` | `Analyse-Sets`, `...ab Growth & Enterprise (Managed GEO) erhalten zusätzlich freie Modellwahl.` | Umbenennen / Sync |
| `350` | `admin.plans_desc` | `...erlaubte Analyse-Sets, Datenabruf-Frequenzen...` | `...erlaubte Analyse-Sets, Mess-Frequenzen...` | Umbenennen |
| `367, 450, 514` | `admin.modal_user_label` | `Benutzer:` | `Mandant:` | Umbenennen |
| `483` | Run-Token-Modal `<th>` | `Konfiguration` | `Tracking-Profil` | Umbenennen |
| `523` | Tier-Modal Select | `<option value="enterprise_managed">Managed GEO & Pipeline Defense</option>` | `Enterprise · Managed GEO & Pipeline Defense` | Umbenennen |
| `608, 612, 662` | Preset-Modal | `Analyse-Set (Model Preset) Modal`, `Analyse-Set bearbeiten`, `Analyse-Set aktiv` | Einheitlich `Analyse-Set` | Umbenennen |

### 4.4 `assets/js/i18n.js`
Alle relevanten DE-Keys (`L28–598`) und 1:1 EN-Keys (`L603–1173`):

| Zeile DE / EN | i18n-Key | Ist-Text (DE / EN) | Soll-Text (DE / EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `29` / `604` | `mission.subtitle` | `...GPT-6.1 Sol... sowie EU-gehostetes Mistral & GLM 5.3...` | Herstellerneutrale Familien; `Chatlytics gehostet in Deutschland`, `Europäische KI-Modelle verfügbar` | Inhalt-Sync |
| `39` / `614` | `nav.*` (`features`, Dossier, Demo) | `Modell-Vergleich`, `Antwort-Prüfstand`, `Ursachen-Matrix` | `KI-Modell-Vergleich` / `AI Model Comparison`, `Antwort-Analyse-Demo` / `Response Analysis Demo`, `Ursachen-Matrix` / `Root-Cause Matrix` | Umbenennen |
| `43` / `618` | `nav.admin` | `Admin Cockpit` / `Admin Cockpit` | `Admin-Cockpit` / `Admin Cockpit` | Umbenennen |
| `56` / `631` | `hero.cta_primary` | `...(40 Live-Abfragen)` / `...(40 Live Queries)` | `Eigene Marke kostenlos prüfen (40 Live-Analyse-Läufe)` / `Audit Your Brand Free (40 Live Analysis Runs)` | Umbenennen |
| `59` / `634` | `hero.cta_secondary` | `Beispiel-Vorstandsreport...` | `Beispiel-GEO-Report ansehen →` / `View Sample GEO Report →` | Umbenennen |
| `78–107` / `653–682` | `1_DIRECT_WIN` .. `4_GENERIC` & `mece.*` | `Platz 1 · Erste Wahl` / `Spitzenreiter · Erste Wahl`; `Platz 2 · Im Windschatten` / `Verfolgerplatz...`; `Verdrängt...`; `Markenfreie Antwort` | Strikte MECE-Vierergruppe: `Spitzenreiter · Direkte Empfehlung` / `Frontrunner · Direct Recommendation`, `Verfolgerplatz · Zweitnennung` / `Runner-Up · Secondary Mention`, `Marke fehlt · Wettbewerber empfohlen` / `Brand Missing · Competitor Named`, `Neutral · Keine Anbieter-Nennung` / `Neutral · No Vendor Named` | Umbenennen |
| `107, 132` / `682, 707` | `NONE`, `geo.NONE.title` | `Optimal · Spitzenreiter` / `Optimal · Frontrunner` | `Kein kritischer Befund` / `No Critical Findings` | Umbenennen |
| **`171–189` / `746–764`** | **`matrix.q1_*` .. `matrix.q4_*`** | **`q1=Stummes Quell-Zitat`, `q2=Versteckter Gewinner`, `q3=Gekaperte Vorlage`, `q4=Ewige Zweitnennung`** | **`q1=1. Quelle zitiert, Konkurrent empfohlen`, `q2=2. Quelle zitiert, Marke fehlt`, `q3=3. Marke bekannt, aber nur Zweitnennung`, `q4=4. Marke empfohlen, aber erst spät im Text (> 50 %)`** (+ `Befund` & `Empfohlene Maßnahme`!) | **KRITISCH BUGFIX** |
| `196` / `771` | `pillar.3_desc` | `...sowie EU-gehostetes Mistral & GLM 5.3...` | Modellfamilien ohne Versionen; `Chatlytics gehostet in Deutschland`, `Europäische KI-Modelle verfügbar` | Inhalt-Sync |
| `201, 210–212, 221–225, 234–238, 248, 262` / `676–837` | `pricing.*`, `faq.a3` | `Live-Abfragen`, `Marken-Profile`, `Abfragen`, `EU-Souveränität`, `EU-Hosted`, `EU-gehostetes Mistral`, `Managed GEO`, `Vorstandsreports` | `Live-Analyse-Läufe` / `Live Analysis Runs`, `Tracking-Profile` / `Tracking Profiles`, `Credits`, `Europäisches Modell-Radar`, `Enterprise (Managed GEO)`, `GEO-Reports`, herstellerneutrale Familien, `Chatlytics gehostet in Deutschland` | Umbenennen / Inhalt-Sync |
| `275, 280` / `850, 855` | `auth.signup_sub`, `auth.btn_signup` | `40 Live-Abfragen über GPT-6.1 Sol...` / `40 Abfragen freischalten` | `40 Live-Analyse-Läufe (40 Gratis-Credits)...` / `Konto erstellen & 40 Credits sichern` (`Create Account & Unlock 40 Credits`) | Umbenennen / Inhalt-Sync |
| `289–297` / `864–872` | `dashboard.*` | `+ Neues Profil`, `Abfrage starten` / `Run Query`, `Abfrage läuft...`, `Report teilen`, `Share Report` | `+ Neues Tracking-Profil` / `+ New Tracking Profile`, `Test-Lauf starten` / `Start Test Run`, `Test-Lauf läuft…` / `Running test…`, `Report teilen` / `Share Report` | Umbenennen |
| `308–317` / `883–892` | `timeline.*` | `Share-of-Model (%)`, `Visibility Index (%)`, `Ø Earliness (%)`, `Citations Share (%)`, `Abfragen` / `Queries` | `KI-Empfehlungsanteil (%)` / `AI Recommendation Share (%)`, `Sichtbarkeits-Index (%)` / `Visibility Index (%)`, `Ø Position im Text (%)` / `Avg. Position in Text (%)`, `Domain-Zitate (%)` / `Domain Citations (%)`, `Analyse-Läufe` / `Analysis Runs` | Umbenennen |
| `321–348` / `896–923` | `run.*` | `Audit-Abfrage jetzt starten?`, `Abfrage-Matrix` / `Query Matrix`, `Tracking-Konfiguration`, `Abfrage gestartet` | `Test-Lauf jetzt starten?` / `Start Test Run now?`, `Ausführungs-Umfang` / `Execution Scope`, `Tracking-Profil` / `Tracking Profile`, `Test-Lauf gestartet` / `Test run started` | Umbenennen |
| `354–358` / `929–933` | `toast.config_*` | `Konfiguration gespeichert/erstellt...` | `Tracking-Profil gespeichert/erstellt…` (`Tracking profile saved/created…`) | Umbenennen |
| `363–374` / `938–949` | `kpi.*` | `Share-of-Model`, `Abfragen gesamt` / `Total Queries`, `Verbleibende Abfragen` / `Remaining Queries`, `Citations Share` | `KI-Empfehlungsanteil` / `AI Recommendation Share`, `Analyse-Läufe gesamt` / `Total Analysis Runs`, `Verbleibende Credits` / `Remaining Credits`, `Domain-Zitat-Anteil` / `Domain Citation Share` | Umbenennen |
| `389–395` / `964–970` | `dashboard.empty_desc`, `geo.title`, `audit.cta_btn` | `abgeschlossenen Abfragen`, `4-Felder-Ursachen-Diagnose` / `4-Field Root-Cause Diagnostics`, `(40 Abfragen)` / `(40 Queries)` | `abgeschlossenen Analyse-Läufen` (`completed analysis runs`), `GEO Ursachen-Matrix` / `GEO Root-Cause Matrix`, `(40 Credits)` / `(40 Credits)` | Umbenennen |
| `398–436` / `973–1011` | `admin.*` (Users/KPI/Modals) | `Owner Cockpit & Systemverwaltung`, `Abfrage-Kontingente`, `Registrierte Benutzer`, `Marken-Profile`, `Prompt-Profile`, `Ausgeführte Abfragen`, `Verfügbare Abfragen`, `Benutzerverzeichnis`, `Abfragen`/`Läufe`, `Schreibgeschützter Report-Link` | `Admin-Cockpit` / `Admin Cockpit`, `Credit-Kontingente`, `Mandanten` / `Clients`, `Tracking-Profile` / `Tracking Profiles`, `Analyse-Läufe gesamt` / `Total Analysis Runs`, `Verfügbare Credits` / `Available Credits`, `Mandantenverzeichnis` / `Client Directory`, `Credits` & `Analyse-Läufe`, `Report-Link` / `Report Link` | Umbenennen |
| `446–464` / `1021–1048` | `config.*`, `dashboard.full_start_config`, `first_day_*` | `Nach Full Start`, `Audit-Intervall`, `Ziel-Markt / Region`, `Tracking-Konfiguration`, `Full Start aktivieren`, `Tag 1 der Konfiguration`, `Data-Mining-Genauigkeit` | `Nach Aktivierung des Monitorings`, `Mess-Frequenz`, `Suchregion & Sprache` / `Search Region & Language`, `Tracking-Profil` / `Tracking Profile`, `Monitoring aktivieren` / `Activate Monitoring`, `Tag 1 des Tracking-Profils` | Umbenennen |
| **`453–461` / `1028–1036`** | `interval.every_2h..manual` | `12x täglich (alle 2 Std.)` .. `Nur Manuell` | **Komplett entfernen** (veraltete Dead-Keys) | **Löschen** |
| **`531` / `1037`** | `config.tier_hint_free` | `Frequenzen über 1x täglich... (Starter, Growth oder Enterprise)` | `Mess-Frequenzen über Basis (24, 48 oder 96 Analyse-Läufe / Tag pro LLM) erfordern einen bezahlten Tarif: Starter, Growth oder Enterprise (Managed GEO).` | **Bugfix / Inhalt-Sync** |
| `467–499` / `1051–1083` | `results.*` | `Einzelabfragen & KI-Antworten`, `Standard-Abfrage` / `Standard Request`, `Test-Abfrage` / `Test Query`, `Einzelabfragen...` | `Einzel-Läufe & KI-Antworten` / `Individual Runs & AI Answers`, `Standard-Lauf` / `Standard Run`, `Test-Lauf` / `Test Run`, `Einzel-Läufe…` / `Individual runs…` | Umbenennen |
| `507–530` / `1091–1114` | `run.*` | `Konfiguration dauerhaft stoppen/entfernen`, `Full Start`, `Test-Abfrage`, `Data-Mining-Genauigkeit`, `Starter · 12 Datensätze...` | `Tracking-Profil dauerhaft stoppen/entfernen`, `Monitoring aktivieren`, `Test-Lauf`, `Mess-Frequenz`, **`Basis · 12 Analyse-Läufe / Tag pro LLM...`** (`Standard/Hoch/Präzision`) | Umbenennen |
| **`1107–1110`** | `interval.every_120m..15m` (EN) | `Starter ? 12 datasets...`, `Standard ? 24...`, `High ? 48...`, `Precision ? 96...` | **`Basic · 12 Analysis Runs / day per LLM (every 120 min)`**, `Standard · 24...`, `High · 48...`, `Precision · 96...` | **Bugfix (`?` + Tier + Unit)** |
| `545–595` / `1120–1170` | `admin.*` & `config.presets_*` | `Analyse-Sets (Model Presets)` im DE, `Model Presets (Analyse-Sets)` im EN, `Kundenkonfigs`, `aktive Konfigurationen`, `Datenabruf-Frequenzen`, `Managed GEO` | Einsprachig **`Analyse-Sets`** (DE) bzw. **`Model Presets`** (EN); `Tracking-Profile`; `Mess-Frequenzen`; `Enterprise (Managed GEO)` | Umbenennen |

### 4.5 `assets/js/configs.js`
| Zeile(n) | Kontext / Symbol | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `25, 33, 41, 49` | `SCHEDULE_INTERVALS.*.fallback` | `Starter · 12 Datensätze / Tag pro LLM...`, `Standard · 24...`, `High · 48...`, `Precision · 96...` | `Basis · 12 Analyse-Läufe / Tag pro LLM (alle 120 Min.)`, `Standard · 24...`, `Hoch · 48...`, `Präzision · 96...` | Umbenennen |
| `140–173` | `DEFAULT_PRESETS` | `DACH Basis-Radar` vs. `api/db.php` (`Basis-Radar`); `badge_de: 'Starter & höher'`; `badge_de: 'EU & GLM'` | Synchron zu `api/db.php`: `Basis-Radar (Live-Suche)` (`Standard`), `Trainingswissen-Radar (Batch-API)` (`Batch-API`), `Europäisches Modell-Radar` (`Mistral & GLM`), `360°-Radar (Alle Kernmodelle + Suche)` (`Vollabdeckung`) | Umbenennen / Sync |
| `422` | Status-Toast Fallback | `Status der Konfiguration konnte nicht geändert werden.` | `Status des Tracking-Profils konnte nicht geändert werden.` | Umbenennen |
| `607–608` | Mode-Badge Fallback | `Schnellauswahl + freie Konfiguration`, `Kuratiertes Analyse-Set` | OK (`Kuratiertes Analyse-Set`) | OK |
| `690–691` | Search-Badge in Card | `Live Web Search: ON` / `Live-Websuche: AN` / `Parametric Only` / `Ohne Websuche` | Einheitlich auf `Live-Websuche` (optional via `i18n.t`) | Optional i18n |
| `737` | `tier_hint_free` Fallback | `Data-Mining-Genauigkeit über 12 Datensätze/Tag... (Starter, Growth oder Enterprise).` | `Mess-Frequenzen über Basis (24, 48 oder 96 Analyse-Läufe / Tag pro LLM) erfordern einen bezahlten Tarif: Starter, Growth oder Enterprise (Managed GEO).` | Umbenennen / Sync |
| `782–805` | Credit-Vorschau | `Pro Durchlauf`, `...bei dieser Data-Mining-Genauigkeit ab.` | `Pro Audit-Lauf` *(bzw. `Pro Auslösung`)*, `...bei dieser Mess-Frequenz ab.` | Umbenennen |
| `851, 875` | Modal Title Fallbacks | `Tracking-Konfiguration bearbeiten`, `Neue Tracking-Konfiguration anlegen` | `Tracking-Profil bearbeiten`, `Neues Tracking-Profil anlegen` | Umbenennen |
| `1021–1022` | Toast Fallbacks | `Konfiguration gespeichert.`, `Konfiguration erstellt.` | `Tracking-Profil gespeichert.`, `Tracking-Profil erstellt.` | Umbenennen |

### 4.6 `assets/js/dashboard.js`
| Zeile(n) | Kontext / Symbol | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `27–33` | `TIMELINE_METRICS` | `Share-of-Model (%)`, `Visibility Index (%)`, `Ø Earliness (%)`, `Citations Share (%)` | `KI-Empfehlungsanteil (%)`, `Sichtbarkeits-Index (%)`, `Ø Position im Text (%)`, `Domain-Zitate (%)` | Umbenennen / DE/EN-Sync |
| `278` | Audit-Banner Fallback | `Sie betrachten einen geteilten Chatlytics-Vorstandsreport (Schreibgeschützt).` | `Sie betrachten einen geteilten Chatlytics GEO-Report (schreibgeschützt).` | Umbenennen |
| `320` | Config-Filter Option | `Alle Konfigurationen` *(hardcoded!)* | `i18n.t('dashboard.all_configs', 'Alle Tracking-Profile')` / `All Tracking Profiles` | Umbenennen + i18n |
| `458–464` | Flow-B Lock Tooltips | `Diese Konfiguration wurde dauerhaft gestoppt...`, `Full Start ist aktiv: Abfragen laufen... Manuelle Abfragen sind gesperrt.`, `Die einmalige Test-Abfrage... Aktivieren Sie Full Start...` | `Dieses Tracking-Profil wurde dauerhaft gestoppt...`, `Monitoring ist aktiv: Analyse-Läufe laufen automatisch nach Zeitplan. Manuelle Test-Läufe sind gesperrt.`, `Der einmalige Test-Lauf wurde bereits genutzt. Aktivieren Sie das Monitoring...` | Umbenennen |
| `715–733` | Flow-B Full-Start Modal & Toasts | `Full Start für dieses Profil aktivieren?`, `Data-Mining-Genauigkeit`, `Full Start verbindlich aktivieren`, `Full Start aktiviert. Abfragen laufen...` | `Monitoring für dieses Tracking-Profil aktivieren?`, `Mess-Frequenz`, `Monitoring verbindlich aktivieren`, `Monitoring aktiviert. Analyse-Läufe laufen ab jetzt automatisch.` | Umbenennen |
| `753–845` | Stop / Archive / Delete Modals & Toasts | `Konfiguration dauerhaft stoppen?`, `Konfiguration aus dem Archiv geholt`, `Konfiguration aus Dashboard entfernen?`, `Konfiguration...` | Konsequent **`Tracking-Profil`** statt `Konfiguration` | Umbenennen |
| `1297, 1331, 1485, 1523, 1543–1596, 1671` | Run-Start Modal & Banner Fallbacks | `Audit-Abfrage jetzt starten?`, `Abfrage-Matrix`, `Bitte erstellen Sie zuerst eine Tracking-Konfiguration.`, `Abfrage gestartet` | `Test-Lauf jetzt starten?`, `Ausführungs-Umfang`, `Bitte legen Sie zuerst ein Tracking-Profil an.`, `Test-Lauf gestartet` | Umbenennen |
| `2131` | Timeline Tooltip | `i18n.t('timeline.runs_label', 'Abfragen')` | `i18n.t('timeline.runs_label', 'Analyse-Läufe')` | Umbenennen |
| `2274, 2320, 2340, 2388, 2446–2473` | Ergebnisse & Accordion Fallbacks | `Einzelabfragen konnten nicht geladen werden.`, `Standard-Abfrage`, `Test-Abfrage`, `Grounding-Quellen` | `Einzel-Läufe konnten nicht geladen werden.`, `Standard-Lauf`, `Test-Lauf` | Umbenennen |
| `2703, 2766` | GEO & Competitor-Table | `Keine kritischen Sichtbarkeitslücken festgestellt.`, `data-label="Sichtbarkeit"` | `Keine kritischen Befunde festgestellt.`, `Sichtbarkeit (%)` | Umbenennen |

### 4.7 `assets/js/admin.js`
| Zeile(n) | Kontext / Symbol | Aktueller Ist-Text | Kanonischer Soll-Text (DE) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| **`333, 342`** | Tabellen-Fallbacks (`renderUsersTable`) | `u.company_name \|\| '?'`, `... \|\| '?'` | `'—'` | **Bugfix (`?`)** |
| **`387, 394`** | `data-label` Mobile-Header | `'? Tokens / Run'`, `'? Tokens / Profil'` | `'Ø Tokens / Analyse-Lauf'`, `'Ø Tokens / Profil'` | **Bugfix (`?`)** |
| `416–450` | Quick Action Buttons (hardcoded) | `Alle pausieren`, `Entsperren`/`Sperren`, `Tarif`, `Runs & Tokens`, `Credits`, `Vorstands-Link` | `Vorstands-Link` → **`Report-Link`**, `Runs & Tokens` → **`Analyse-Läufe & Tokens`**; übrige an `i18n` anbinden | Umbenennen |
| `805–842` | Demo Seeder | `(${runs_created} Runs, ${configs_created} Konfigurationen)` | `(${runs_created} Analyse-Läufe, ${configs_created} Tracking-Profile)` | Umbenennen |
| `1083` | Suspend Toast | `Benutzer ${user.email} wurde gesperrt und aktive Profile pausiert.` | `Mandant ${user.email} wurde gesperrt und aktive Tracking-Profile pausiert.` | Umbenennen |
| `1642` | Presets Rendering | `preset.is_default ? 'Standard' : 'Preset'` | `'Analyse-Set'` statt `'Preset'` (DE) / `'Model Preset'` (EN) | Umbenennen |
| `1720–1727` | `openPresetModal` Fallback-Modelle | `'Z.ai GLM 5.3 (Mistral EU)'`, `'Z.ai GLM 5.3 Flash (Mistral EU)'` | `(Mistral EU)`-Zusatz entfernen (`OpenRouter`) | Inhalt-Sync |
| `1916, 1926, 1968` | Plan-Editor Formular | `Max. Profile / Konfigs`, `Erlaubte Data-Mining-Frequenzen`, `Freigeschaltete Analyse-Sets (Model Presets)` | `Max. Tracking-Profile`, `Erlaubte Mess-Frequenzen`, `Freigeschaltete Analyse-Sets` | Umbenennen |
| `1306, 1458, 2152, 2176, 2224, 2247, 2425, 2574, 2626` | Provider Usage / Impact | `aktive Konfig(s)`, `Konfigurationen: ...`, `aktive/pausierte Kundenkonfigurationen` | `aktive Tracking-Profile`, `Tracking-Profile: ...`, `aktive/pausierte Tracking-Profile` | Umbenennen |

### 4.8 `assets/js/dossier-stage.js`
| Zeile(n) | Kontext / Symbol | Aktueller Ist-Text | Kanonischer Soll-Text (DE / EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `19, 38, 58, 159, 178, 197, 297, 316, 335, 435, 454, 473, 573, 592, 612` *(+ EN)* | `models.*.name` (5 Branchen DE+EN) | `OpenAI GPT-6.1 Sol/Terra/GPT-6 Astra/Luna`, `Anthropic Claude Sonnet/Opus/Haiku 5.5`, `Google Gemini Hydrogen/Carbon/Argon/3.8 Flash` | Herstellerneutrale Familiennamen ohne fiktive Versionsnummern (`OpenAI · ChatGPT`, `Anthropic · Claude`, `Google · Gemini`) | Inhalt-Sync |
| `22, 41, 61, 90, 109, 129, ...` | `models.*.statusLabel` | `Platz 1 · Erste Wahl`, `Platz 2 · Im Windschatten`, `Verdrängt · Stummes Quell-Zitat`, `Verdrängt · Gekaperte Vorlage` | Einheitliche MECE-Taxonomie: `Spitzenreiter · Direkte Empfehlung`, `Verfolgerplatz · Zweitnennung`, `Marke fehlt · Wettbewerber empfohlen` (EN: `Frontrunner · Direct Recommendation`, `Runner-Up · Secondary Mention`, `Brand Missing · Competitor Named`) | Umbenennen |
| `32, 52, 72, ... 467, 534, ...` | `models.*.diagLabel` | `Optimal (Spitzenreiter)`, `Ewige Zweitnennung`, `Im Windschatten`, `Runner-Up`, `Gekaperte Vorlage`, `Stummes Quell-Zitat` | Kanonische GEO-Diagnosen: `Kein kritischer Befund`, `1. Quelle zitiert, Konkurrent empfohlen`, `2. Quelle zitiert, Marke fehlt`, `3. Marke bekannt, aber nur Zweitnennung`, `4. Marke empfohlen, aber erst spät im Text (> 50 %)` | Umbenennen |
| `1053` | Live Scrubber Scrub-Badge | `tKey('1_DIRECT_WIN', 'Platz 1 · Erste Wahl')` | `tKey('1_DIRECT_WIN', 'Spitzenreiter · Direkte Empfehlung')` | Umbenennen |

### 4.9 `assets/js/auth.js` & `assets/js/notifications.js`
| Datei & Zeile | Symbol | Aktueller Ist-Text | Kanonischer Soll-Text (DE / EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `auth.js:234–236` | `TIER_LABELS` | `Gewählter Tarif: Free (0 € · 40 Live-Abfragen)` / `Starter (149 € / Monat · 40 Test-Abfragen vorab)` / `Growth (399 € / Monat · 40 Test-Abfragen vorab)` (+ EN) | `...40 Live-Analyse-Läufe (40 Gratis-Credits)` / `...inkl. 40 Gratis-Credits vorab` (EN: `40 Live Analysis Runs` / `incl. 40 Free Credits upfront`) | Umbenennen |
| `notifications.js:141` | `aria-label` | `'Benachrichtigung schließen'` | Keine Begriffskonflikte (optional an `i18n` anbinden) | OK |

### 4.10 `api/db.php`
| Zeile(n) | Symbol / Key | Aktueller Ist-Text | Kanonischer Soll-Text (DE / EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `890–940` | `getDefaultModelPresetsSeed` | `'Basis-Radar (Live-Suche)'`, `'Europäisches & GLM Benchmark-Set'` (Slug `eu_sovereign_dsgvo`), `'Parametrisches Marken-Gedächtnis'`, `'360° Vorstands-Benchmark'` | `Basis-Radar (Live-Suche)` (`Standard`/`Default`), `Trainingswissen-Radar (Batch-API)` (`Batch-API`), `Europäisches Modell-Radar` (`Mistral & GLM`, ohne EU-Hosting-Claim), `360°-Radar (Alle Kernmodelle + Suche)` (`Vollabdeckung`) | Umbenennen / Sync |
| `974–1110` | `getDefaultSubscriptionPlansSeed` | `max_configs: 3` (Free), `max_configs: 5` (Starter), `40 Live-Abfragen`, `500 Live-Abfragen`, `2.000 Live-Abfragen`, `10.000+ Live-Abfragen`, `Marken-Profile`, `Core Model Preset` | **`max_configs: 1` (Free)** & **`max_configs: 3` (Starter)** gemäß Frage 53; `Live-Analyse-Läufe` (`Live Analysis Runs`), `Tracking-Profile` (`Tracking Profiles`), `Analyse-Set` (`Model Preset`), `Enterprise (Managed GEO)` | Umbenennen / Quota-Sync |

### 4.11 `api/configs.php`
*(Nur menschlich lesbare `message`-/`jsonError`-Strings ändern; HTTP-Codes und interne Feldnamen bleiben unverändert.)*

| Zeile(n) | Symbol / Handler | Aktueller Ist-Text | Kanonischer Soll-Text (EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `233, 328, 365, 391, 509, 539, 593` | `handleCreateConfig`, `Update`, `Delete` | `Tracking configuration created successfully.`, `Configuration permanently stopped/archived/updated/deleted.` | `Tracking profile created / updated / permanently stopped / archived / deleted successfully.` | Umbenennen (Test-Kompatibilität prüfen) |
| `416, 427` | Immutability 409 | `Prompts and target market/region are locked after Full Start...` | `Prompts and search region & language are locked after activating monitoring...` | Umbenennen |
| `508` | Full-Start 200 Message | `Full Data Mining activated successfully.` | `Continuous monitoring activated successfully.` | Umbenennen |
| `949, 966, 1016` | `enforcePlanAndPresetPolicy` | `The selected Analyse-Set '...' is not available...`, `...requires the Growth or Enterprise plan. Please choose a curated Analyse-Set.`, `...Analyse-Sets (Model Presets)...` | Konsequentes Englisch: `Model Preset` statt `Analyse-Set`; `Growth or Enterprise (Managed GEO) plan` | EN-Sync / Umbenennen |

### 4.12 `api/trigger_run.php`, `api/reports.php`, `api/admin_users.php`
| Datei & Zeile | Symbol / Key | Aktueller Ist-Text | Kanonischer Soll-Text (DE / EN) | Maßnahme |
| :--- | :--- | :--- | :--- | :--- |
| `api/trigger_run.php:78, 90, 404, 421` | `trigger_run` | `Full Data Mining has already started...`, `Please activate Full Start to begin continuous daily Data Mining.`, `Pre-start test run completed/dispatched...` | `Continuous monitoring has already been activated...`, `Please activate monitoring to begin scheduled analysis runs.`, `Test run completed/dispatched successfully.` | Umbenennen |
| `api/reports.php:397–418` | `$prescriptions` | `Wettbewerber kapert Ihre Quellen...`, `Keine kritischen GEO-Anomalien festgestellt.` | Titel/Labels auf Q1–Q4 (Fragen 44–47), `Kein kritischer Befund` und `Befund` / `Empfohlene Maßnahme` abgleichen | Sync |
| `api/reports.php:608–613` | `first_day_message_de/en` | `Tag 1 der Konfiguration: Datensätze werden über den Kalendertag verteilt erhoben.` / `Day 1 of configuration: Datasets...` | `Tag 1 des Tracking-Profils: Analyse-Läufe werden über den Kalendertag verteilt ausgeführt.` / `Day 1 of tracking profile: Analysis runs are being executed across the calendar day.` | Umbenennen |
| `api/admin_users.php:996` | `seed_demo_data` | `Demo data successfully seeded across 3 German B2B accounts...` | OK | OK |
| `api/admin_users.php:1950–2040` | `handleSavePreset` / `DeletePreset` | `An Analyse-Set must include...`, `Analyse-Set '{name}' saved/deleted.` | `A Model Preset must include...`, `Model Preset '{name}' saved/deleted.` | EN-Sync |

### 4.13 Übrige Dateien (Referenz & Kompatibilitätsprüfung)
- **`api/auth.php`, `api/user_results.php`, `api/ingest.php`, `api/n8n_queue.php`, `api/bootstrap.php`, `api/stripe_webhook.php`**: Enthalten ausschließlich technische Fehlercodes/englische API-Meldungen (`Configuration not found.`, `Magic Audit mode`). Optional in Schritt 2 auf `Tracking profile not found` vereinheitlichen (vorher testen, dass keine Assertions den exakten Substring `"Configuration"` verlangen).
- **`n8n/lib/metrics_engine.js` & `n8n/chatlytics_universal_worker.json`**: Reine technische Engine (`mece_category`, `geo_quadrant`). Keine UI-Umbenennung nötig.
- **`n8n/N8N_SETUP_AND_POC_GUIDE.md`, `README.md`, `PROJECT.md`**: Optional im Nachgang redaktionell ans finalisierte Glossar (`Admin-Cockpit`, `Mess-Frequenz`, `Tracking-Profil`, `Analyse-Lauf`) angleichen.
- **`sql/schema.sql`, `sql/migrations/*.sql`, `sql/demo_seeder.sql`**: Schema-Bezeichner bleiben unverändert.
- **`tests/`**:
  - `tests/tier1_features/f32_run_feedback_ux.test.js:187` (`btnTrigger.innerHTML = '<svg></svg>Abfrage starten';`) sowie ggf. weitere String-Assertions beim Ausführen nach Schritt 2 mit prüfen/aktualisieren.
  - Nach Änderungen in `api/*.php` und `assets/js/*.js` gesamte Test-Suite (`tests/run_all_e2e.js`) ausführen.

---

## 5. Umsetzungsplan für Schritt 2 (nach deinem „Go“)

1. **`assets/js/i18n.js` bereinigen:**
   - Kritischen Bug `matrix.q1_*..q4_*` (DE & EN) auf Fragen 44–47 fixen + `Befund` / `Empfohlene Maßnahme` (Frage 54) einbauen.
   - Alle 54 kanonischen DE + 1:1 EN Begriffe einpflegen (`Credit`, `Analyse-Lauf`, `Audit-Lauf`, `Ausführungs-Umfang`, `GEO Analyse-Cockpit`, `Admin-Cockpit`, `GEO-Report`, `Mandant`, `Tracking-Profil`, `Suchregion & Sprache`, `Test-Lauf`, `Monitoring aktivieren`, `Standard-Lauf`, `Batch-API`, `Mess-Frequenz` + `Basis/Standard/Hoch/Präzision`, `Analyse-Set` + 4 Radar-Namen, Tarife inkl. `Enterprise (Managed GEO)`, KPIs, 4 MECE-Stufen, 4 GEO-Quadranten, `KI-Modell-Vergleich`, `Antwort-Analyse-Demo`).
   - `?`-Glitch in `1107–1110`, tote `interval.every_2h..manual`-Keys (`453–461`, `1028–1036`), `config.tier_hint_free`, `EU-Hosted`-Claims und Demo-Versionsnummern beheben.
2. **HTML-Templates (`index.html`, `dashboard.html`, `admin.html`) synchronisieren:**
   - Alle Inline-Fallbacks auf exakt dieselben kanonischen DE-Werte setzen, englische Cockpit-Reste entfernen, Dossier/Demo-Modelle herstellerneutral ohne Versionsnummern formulieren, Hosting auf `Chatlytics gehostet in Deutschland` / `Europäische KI-Modelle verfügbar` korrigieren.
3. **Frontend-Module (`assets/js/configs.js`, `dashboard.js`, `admin.js`, `dossier-stage.js`, `auth.js`) aktualisieren:**
   - Fallbacks synchronisieren, `?`-Glitches (`admin.js:333, 342, 387, 394`) und `(Mistral EU)` (`1720–1727`) beheben, hardcoded UI-Strings an `i18n.t` anbinden, `dossier-stage.js` strikt auf MECE-Status vs. GEO-Befund + modellfamilienneutralen Text umstellen.
4. **Backend-Seeds & API-Texte (`api/db.php`, `api/configs.php`, `api/trigger_run.php`, `api/reports.php`, `api/admin_users.php`) nachziehen:**
   - `Free max_configs: 1` und `Starter max_configs: 3` in `api/db.php` setzen (Frage 53), Preset-Namen & Plan-Texte aktualisieren und DB-/Enum-/Payload-Keys vollständig unangetastet lassen.
5. **Verifikation:** Gesamte Unit-/E2E-Test-Suite ausführen und DE/EN-Umschaltung auf Landingpage, GEO Analyse-Cockpit, Formularen und Admin-Cockpit prüfen.
