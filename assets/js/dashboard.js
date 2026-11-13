/**
 * assets/js/dashboard.js
 * Feature 26: Client Dashboard & 4-Quadrant GEO Action Panel
 * Feature 27: Magic Audit Shareable Preview Mode
 *
 * Handles:
 * - Authentication validation & route guarding
 * - Magic Audit mode detection and UI locking (hiding mutation controls)
 * - Period filter segmented controls (7d, 14d, 30d, 90d, all)
 * - 6-Card KPI bar rendering with Period-over-Period deltas
 * - MECE category distribution trend bar & metrics
 * - 4-Quadrant GEO diagnostic action panel binding
 * - Competitor leaderboard & grounding citations tables
 * - Debounced instant run trigger button
 * - Zero-data empty state handling
 */

import { apiClient } from './api-client.js';
import { auth } from './auth.js';
import { configs, getScheduleLabel } from './configs.js';

const TIMELINE_METRICS = {
  som_score: { key: 'som_score', i18nKey: 'timeline.metric_som', fallback: 'Share-of-Model (%)', unit: '%' },
  visibility_index: { key: 'visibility_index', i18nKey: 'timeline.metric_visibility', fallback: 'Visibility Index (%)', unit: '%' },
  citation_share: { key: 'citation_share', i18nKey: 'timeline.metric_citations', fallback: 'Quellen-Anteil (%)', unit: '%' },
  avg_earliness: { key: 'avg_earliness', i18nKey: 'timeline.metric_earliness', fallback: 'Ø Earliness (%)', unit: '%' }
};

function getTimelineMetricMeta(metricKey) {
  return TIMELINE_METRICS[metricKey] || TIMELINE_METRICS.som_score;
}

function parseLocalSqlTimestamp(isoOrSql) {
  if (!isoOrSql) return null;
  const raw = String(isoOrSql).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00`
    : raw.replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function computeSlotTimestamp(startStr, slotIndex, granularity = 'day') {
  const base = parseLocalSqlTimestamp(startStr);
  if (!base) return null;
  const idx = Math.max(0, Number(slotIndex) || 0);
  if (granularity === 'hour') {
    return new Date(base.getTime() + idx * 3600 * 1000);
  }
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + idx, 0, 0, 0);
}

function formatShortDate(dateObj, lang = 'de') {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  return lang === 'de' ? `${dd}.${mm}.` : `${mm}/${dd}`;
}

function formatFullDate(dateStr, lang = 'de') {
  const d = parseLocalSqlTimestamp(dateStr);
  if (!d) return String(dateStr || '');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return lang === 'de' ? `${dd}.${mm}.${yyyy}` : `${yyyy}-${mm}-${dd}`;
}

function formatTimelineAxisLabel(datePointOrDate, granularity = 'day', lang = 'de') {
  const d = datePointOrDate instanceof Date ? datePointOrDate : parseLocalSqlTimestamp(datePointOrDate);
  if (!d) return String(datePointOrDate || '');
  if (granularity === 'hour') {
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${formatShortDate(d, lang)} ${hh}:${min}`;
  }
  return formatShortDate(d, lang);
}

function toIsoDateInputValue(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildTimelineAlignedSeries(primaryTimeline = [], comparisonTimeline = [], totalSlots = 0, metricKey = 'som_score') {
  const primaryList = Array.isArray(primaryTimeline) ? primaryTimeline : [];
  const compareList = Array.isArray(comparisonTimeline) ? comparisonTimeline : [];
  const maxSlotFromData = Math.max(
    0,
    ...primaryList.map((r, i) => Number(r.slot_index !== undefined ? r.slot_index : i) + 1),
    ...compareList.map((r, i) => Number(r.slot_index !== undefined ? r.slot_index : i) + 1)
  );
  const slotCount = Math.max(Number(totalSlots) || 0, maxSlotFromData, 1);

  const primaryBySlot = new Map();
  primaryList.forEach((row, idx) => {
    const slotIdx = row.slot_index !== undefined && row.slot_index !== null ? Number(row.slot_index) : idx;
    if (slotIdx >= 0 && slotIdx < slotCount) {
      primaryBySlot.set(slotIdx, row);
    }
  });

  const compareBySlot = new Map();
  compareList.forEach((row, idx) => {
    const slotIdx = row.slot_index !== undefined && row.slot_index !== null ? Number(row.slot_index) : idx;
    if (slotIdx >= 0 && slotIdx < slotCount) {
      compareBySlot.set(slotIdx, row);
    }
  });

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const pRow = primaryBySlot.get(i) || null;
    const cRow = compareBySlot.get(i) || null;
    const pVal = pRow && pRow[metricKey] !== undefined && pRow[metricKey] !== null ? Number(pRow[metricKey]) : null;
    const cVal = cRow && cRow[metricKey] !== undefined && cRow[metricKey] !== null ? Number(cRow[metricKey]) : null;
    slots.push({
      slotIndex: i,
      primaryValue: Number.isFinite(pVal) ? pVal : null,
      compareValue: Number.isFinite(cVal) ? cVal : null,
      primaryRow: pRow,
      compareRow: cRow
    });
  }
  return slots;
}

function buildSvgLinePath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return points.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ');
}
import { i18n } from './i18n.js';

class DashboardController {
  constructor() {
    this.currentPeriod = '30d';
    this.selectedConfigId = null;
    this.isRunning = false;
    this.auditToken = null;
    this.isAuditMode = false;
    this.customStartDate = '';
    this.customEndDate = '';
    this.compareMode = 'previous';
    this.compareStartDate = '';
    this.compareEndDate = '';
    this.activeTimelineMetric = 'som_score';
    this.lastReportsData = null;
  }

  async init() {
    // 1. Detect Magic Audit Mode from URL Query Parameter
    const urlParams = new URLSearchParams(window.location.search);
    this.auditToken = urlParams.get('audit_token');
    this.isAuditMode = Boolean(this.auditToken && this.auditToken.length >= 16);

    if (this.isAuditMode) {
      apiClient.setAuditToken(this.auditToken);
      this.applyMagicAuditUI();
    } else {
      // Enforce Route Guard for authenticated user
      const isAllowed = auth.enforceGuard({ requiresAuth: true, requiresAdmin: false });
      if (!isAllowed) return;

      const user = auth.getUser();
      if (user?.role === 'admin') {
        const adminNav = document.getElementById('admin-nav');
        if (adminNav) adminNav.classList.remove('hidden');
      }
    }

    // 2. Initialize i18n
    if (i18n && typeof i18n.init === 'function') {
      i18n.init();
    }

    // 3. Initialize Tracking Configs
    await this.initConfigs();

    // 4. Setup Event Listeners
    this.setupEventListeners();

    // 5. Initial Data Load
    await this.loadDashboard();
  }

  /**
   * Feature 27.2 & 27.3 & 27.4:
   * Enforces strict read-only mode, hides mutation elements, and shows preview banners.
   */
  applyMagicAuditUI() {
    // 1. Show persistent preview banner
    const banner = document.getElementById('magic-audit-banner');
    if (banner) {
      banner.style.display = 'flex';
      const lang = i18n ? i18n.getLanguage() : 'de';
      const bannerText = banner.querySelector('.banner-text');
      if (bannerText) {
        bannerText.textContent = lang === 'de'
          ? 'Sie betrachten einen geteilten Chatlytics-Vorstandsreport (Schreibgeschützt).'
          : 'You are viewing a shared Chatlytics Board Report (Read-Only).';
      }
    }

    // 2. Show conversion CTA banner for unregistered visitors
    const ctaBanner = document.getElementById('magic-audit-cta');
    if (ctaBanner) {
      ctaBanner.style.display = 'block';
    }

    // 3. Mutation controls strictly hidden or disabled in Magic Audit mode
    const elementsToHide = [
      '#btn-trigger-run',
      '#btn-new-config',
      '#btn-edit-config',
      '#btn-toggle-config-status',
      '.config-actions-inline',
      '#billing-nav',
      '#profile-settings',
      '#btn-share-audit',
      '#btn-logout'
    ];

    for (const selector of elementsToHide) {
      const el = document.querySelector(selector);
      if (el) {
        el.style.display = 'none';
      }
    }
  }

  async initConfigs() {
    const configSelect = document.getElementById('config-select');
    if (!configSelect) return;

    try {
      const userConfigs = await configs.loadConfigs();
      configSelect.innerHTML = '<option value="">Alle Konfigurationen</option>';

      for (const cfg of userConfigs) {
        const opt = document.createElement('option');
        opt.value = cfg.id;
        opt.textContent = cfg.name || `${cfg.brand_name} Tracking`;
        configSelect.appendChild(opt);
      }

      // Check saved selection or default
      const savedId = configs.getSavedConfigId();
      if (savedId && userConfigs.some(c => String(c.id) === String(savedId))) {
        this.selectedConfigId = Number(savedId);
        configSelect.value = savedId;
      } else if (userConfigs.length > 0) {
        this.selectedConfigId = Number(userConfigs[0].id);
        configSelect.value = String(userConfigs[0].id);
      }
    } catch (err) {
      console.warn('Could not populate configs list:', err);
    }
  }

  getSelectedConfigObject() {
    if (!this.selectedConfigId) return null;
    return configs.configs.find(c => String(c.id) === String(this.selectedConfigId)) || null;
  }

  updateConfigActionControls() {
    const cfg = this.getSelectedConfigObject();
    const editBtn = document.getElementById('btn-edit-config');
    const toggleBtn = document.getElementById('btn-toggle-config-status');
    const scheduleBadge = document.getElementById('config-schedule-badge');

    if (editBtn) {
      editBtn.disabled = !cfg || this.isAuditMode;
    }
    if (toggleBtn) {
      toggleBtn.disabled = !cfg || this.isAuditMode;
      const isPaused = cfg?.status === 'paused';
      toggleBtn.textContent = isPaused
        ? i18n.t('dashboard.resume_config', 'Fortsetzen')
        : i18n.t('dashboard.pause_config', 'Pausieren');
      if (toggleBtn.dataset) toggleBtn.dataset.status = cfg?.status || 'active';
      else if (toggleBtn.setAttribute) toggleBtn.setAttribute('data-status', cfg?.status || 'active');
    }
    if (scheduleBadge) {
      if (!cfg) {
        scheduleBadge.classList.add('hidden');
        scheduleBadge.textContent = '';
      } else {
        const isPaused = cfg.status === 'paused';
        const statusText = isPaused
          ? i18n.t('dashboard.status_paused', 'Pausiert')
          : i18n.t('dashboard.status_active', 'Aktiv');
        scheduleBadge.textContent = `${getScheduleLabel(cfg.schedule_interval)} · ${statusText}`;
        scheduleBadge.className = `badge ${isPaused ? 'badge-warning' : 'badge-success'}`;
      }
    }
  }

  syncPeriodBarVisibility() {
    const customPeriodEl = document.getElementById('custom-period-controls');
    const customCompareEl = document.getElementById('custom-compare-controls');
    const applyBtn = document.getElementById('btn-apply-date-filters');
    const isCustomPeriod = this.currentPeriod === 'custom';
    const isCustomCompare = this.compareMode === 'custom';

    if (customPeriodEl?.classList) { if (isCustomPeriod) customPeriodEl.classList.remove('hidden'); else customPeriodEl.classList.add('hidden'); }
    if (customCompareEl?.classList) { if (isCustomCompare) customCompareEl.classList.remove('hidden'); else customCompareEl.classList.add('hidden'); }
    if (applyBtn?.classList) { if (isCustomPeriod || isCustomCompare) applyBtn.classList.remove('hidden'); else applyBtn.classList.add('hidden'); }
  }

  prefillCustomDates(type = 'primary') {
    const dr = this.lastReportsData?.date_range || {};
    const today = new Date();
    const fallbackEnd = toIsoDateInputValue(today);
    const fallbackStartObj = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    const fallbackStart = toIsoDateInputValue(fallbackStartObj);

    if (type === 'primary') {
      const startInput = document.getElementById('custom-start-date');
      const endInput = document.getElementById('custom-end-date');
      const rangeStart = dr.current_start ? String(dr.current_start).slice(0, 10) : fallbackStart;
      const rangeEnd = dr.current_end ? String(dr.current_end).slice(0, 10) : fallbackEnd;
      if (!this.customStartDate) this.customStartDate = rangeStart;
      if (!this.customEndDate) this.customEndDate = rangeEnd;
      if (startInput && !startInput.value) startInput.value = this.customStartDate;
      if (endInput && !endInput.value) endInput.value = this.customEndDate;
    } else if (type === 'compare') {
      const startInput = document.getElementById('compare-start-date');
      const endInput = document.getElementById('compare-end-date');
      const fallbackPrevEnd = toIsoDateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30));
      const fallbackPrevStart = toIsoDateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 59));
      const prevStart = dr.previous_start ? String(dr.previous_start).slice(0, 10) : fallbackPrevStart;
      const prevEnd = dr.previous_end ? String(dr.previous_end).slice(0, 10) : fallbackPrevEnd;
      if (!this.compareStartDate) this.compareStartDate = prevStart;
      if (!this.compareEndDate) this.compareEndDate = prevEnd;
      if (startInput && !startInput.value) startInput.value = this.compareStartDate;
      if (endInput && !endInput.value) endInput.value = this.compareEndDate;
    }
  }

  validateDateInputs() {
    const errEl = document.getElementById('period-bar-error');
    const clearErr = () => {
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }
    };
    const showErr = (msg) => {
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
    };

    if (this.currentPeriod === 'custom') {
      this.customStartDate = document.getElementById('custom-start-date')?.value || '';
      this.customEndDate = document.getElementById('custom-end-date')?.value || '';
      if (!this.customStartDate || !this.customEndDate) return false;
      if (this.customStartDate > this.customEndDate) {
        showErr(i18n.t('period.invalid_range', 'Das Startdatum darf nicht nach dem Enddatum liegen.'));
        return false;
      }
    }

    if (this.compareMode === 'custom') {
      this.compareStartDate = document.getElementById('compare-start-date')?.value || '';
      this.compareEndDate = document.getElementById('compare-end-date')?.value || '';
      if (!this.compareStartDate || !this.compareEndDate) return false;
      if (this.compareStartDate > this.compareEndDate) {
        showErr(i18n.t('period.invalid_range', 'Das Startdatum darf nicht nach dem Enddatum liegen.'));
        return false;
      }
    }

    clearErr();
    return true;
  }

  setupEventListeners() {
    // 1. Period Filter Buttons
    const periodButtons = document.querySelectorAll('#period-filter .segment-btn');
    periodButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        periodButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentPeriod = btn.dataset.period || '30d';
        this.syncPeriodBarVisibility();
        if (this.currentPeriod === 'custom') {
          this.prefillCustomDates('primary');
          if (!this.validateDateInputs()) return;
        } else {
          document.getElementById('period-bar-error')?.classList.add('hidden');
        }
        await this.loadDashboard();
      });
    });

    // 2. Config Selector Dropdown
    const configSelect = document.getElementById('config-select');
    configSelect?.addEventListener('change', async (e) => {
      const val = e.target.value;
      this.selectedConfigId = val ? Number(val) : null;
      this.updateConfigActionControls();
      if (this.selectedConfigId) {
        configs.setSelectedConfigId(this.selectedConfigId);
      }
      await this.loadDashboard();
    });

    // 3. Debounced Instant Run Trigger Button (Feature 26.5 & Boundary 4.5)
    const btnTrigger = document.getElementById('btn-trigger-run');
    btnTrigger?.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.handleTriggerRun();
    });

    const btnEmptyTrigger = document.getElementById('btn-empty-trigger');
    btnEmptyTrigger?.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.handleTriggerRun();
    });

    // 4. Config Modal Initialization
    configs.initModal(async (savedResult) => {
      const savedId = savedResult?.config?.id || savedResult?.id;
      if (savedId) {
        this.selectedConfigId = Number(savedId);
        configs.setSelectedConfigId(this.selectedConfigId);
      }
      await this.initConfigs();
      await this.loadDashboard();
    });

    // 5. Share Magic Audit Modal
    const btnShare = document.getElementById('btn-share-audit');
    const shareModal = document.getElementById('share-modal');
    const shareInput = document.getElementById('share-url-input');
    const shareClose = document.getElementById('share-modal-close');
    const btnCopy = document.getElementById('btn-copy-share-url');

    btnShare?.addEventListener('click', () => {
      const user = auth.getUser();
      const token = user?.magic_audit_token;
      if (token && shareInput) {
        const fullUrl = `${window.location.origin}${window.location.pathname}?audit_token=${token}`;
        shareInput.value = fullUrl;
      }
      shareModal?.classList.remove('modal-hidden');
    });

    shareClose?.addEventListener('click', () => {
      shareModal?.classList.add('modal-hidden');
    });

    btnCopy?.addEventListener('click', async () => {
      if (shareInput) {
        try {
          await navigator.clipboard.writeText(shareInput.value);
          btnCopy.textContent = '✔ In Zwischenablage kopiert!';
          setTimeout(() => {
            btnCopy.textContent = 'Link in die Zwischenablage kopieren';
          }, 2500);
        } catch (_) {
          shareInput.select();
        }
      }
    });

    // 5b. Config Edit & Pause/Resume Actions
    const btnEditConfig = document.getElementById('btn-edit-config');
    btnEditConfig?.addEventListener('click', (e) => {
      e.preventDefault();
      const cfg = this.getSelectedConfigObject();
      if (cfg && !this.isAuditMode) {
        configs.showModal(cfg);
      }
    });

    const btnToggleConfig = document.getElementById('btn-toggle-config-status');
    btnToggleConfig?.addEventListener('click', async (e) => {
      e.preventDefault();
      const cfg = this.getSelectedConfigObject();
      if (!cfg || this.isAuditMode) return;
      try {
        btnToggleConfig.disabled = true;
        await configs.toggleConfigStatus(cfg);
        this.updateConfigActionControls();
      } catch (err) {
        console.error('Failed to toggle config status:', err);
      } finally {
        btnToggleConfig.disabled = false;
      }
    });

    // 5c. Comparison Mode & Custom Date Range Listeners
    const compareSelect = document.getElementById('compare-mode-select');
    compareSelect?.addEventListener('change', async (e) => {
      this.compareMode = e.target.value || 'previous';
      this.syncPeriodBarVisibility();
      if (this.compareMode === 'custom') {
        this.prefillCustomDates('compare');
        if (!this.validateDateInputs()) return;
      } else {
        document.getElementById('period-bar-error')?.classList.add('hidden');
      }
      await this.loadDashboard();
    });

    const btnApplyDates = document.getElementById('btn-apply-date-filters');
    btnApplyDates?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!this.validateDateInputs()) return;
      await this.loadDashboard();
    });

    ['custom-start-date', 'custom-end-date', 'compare-start-date', 'compare-end-date'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.validateDateInputs();
      });
    });

    // 5d. Timeline Metric Tabs
    const metricTabs = document.querySelectorAll('#timeline-metric-tabs .timeline-tab-btn');
    metricTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const metric = tab.dataset.metric || 'som_score';
        this.activeTimelineMetric = metric;
        metricTabs.forEach(tBtn => {
          const isMatch = tBtn === tab;
          if (isMatch) tBtn.classList.add('active'); else tBtn.classList.remove('active');
          tBtn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });
        if (this.lastReportsData) {
          this.renderTimelineChart(this.lastReportsData);
        }
      });
    });

    // 6. Logout Button
    const btnLogout = document.getElementById('btn-logout');
    btnLogout?.addEventListener('click', async (e) => {
      e.preventDefault();
      await auth.logout();
    });

    // 7. Dynamic reactive update on language change
    if (typeof window !== 'undefined') {
      window.addEventListener('languageChanged', () => {
        if (this.isAuditMode) {
          this.applyMagicAuditUI();
        }
        this.updateConfigActionControls();
        if (this.lastReportsData) {
          this.renderDashboard(this.lastReportsData);
        }
      });
    }
  }

  async handleTriggerRun() {
    if (this.isRunning) return;
    if (this.isAuditMode) return;

    if (!this.selectedConfigId && configs.configs.length > 0) {
      this.selectedConfigId = Number(configs.configs[0].id);
    }

    if (!this.selectedConfigId) {
      alert('Bitte erstellen Sie zuerst eine Tracking-Konfiguration.');
      configs.showModal();
      return;
    }

    this.isRunning = true;
    const btnTrigger = document.getElementById('btn-trigger-run');
    const origText = btnTrigger ? btnTrigger.innerHTML : '';
    if (btnTrigger) {
      btnTrigger.disabled = true;
      const runningLabel = i18n ? i18n.t('dashboard.btn_running', 'Abfrage läuft...') : 'Abfrage läuft...';
      btnTrigger.textContent = runningLabel;
    }

    try {
      const res = await apiClient.triggerRun(this.selectedConfigId, { mode: 'async' });
      const remaining = res.credits_remaining;
      if (remaining !== undefined) {
        this.updateCreditBadge(remaining);
      }
      // Reload dashboard after short interval to allow n8n worker ingestion
      setTimeout(async () => {
        await this.loadDashboard();
      }, 1500);
    } catch (err) {
      alert(err.message || 'Audit-Run konnte nicht gestartet werden.');
    } finally {
      this.isRunning = false;
      if (btnTrigger) {
        btnTrigger.disabled = false;
        btnTrigger.innerHTML = origText;
      }
    }
  }

  async loadDashboard() {
    this.updateConfigActionControls();
    this.syncPeriodBarVisibility();
    const params = {
      period: this.currentPeriod,
      compare_mode: this.compareMode
    };
    if (this.currentPeriod === 'custom' && this.customStartDate && this.customEndDate) {
      params.start_date = this.customStartDate;
      params.end_date = this.customEndDate;
    }
    if (this.compareMode === 'custom' && this.compareStartDate && this.compareEndDate) {
      params.compare_start_date = this.compareStartDate;
      params.compare_end_date = this.compareEndDate;
    }
    if (this.selectedConfigId) {
      params.config_id = this.selectedConfigId;
    }

    try {
      const res = await apiClient.getReports(params);
      const data = res.data || res;
      this.lastReportsData = data;
      this.renderDashboard(data);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  }

  renderDashboard(data) {
    const metrics = data.metrics || {};
    const totalRuns = Number(metrics.total_runs || 0);

    const emptyState = document.getElementById('empty-state');
    const dataGrid = document.getElementById('dashboard-data-grid');
    const timelineCard = document.getElementById('timeline-card');
    this.updateRangeBanner(data);

    // Boundary 4.2: Zero-data empty state handling
    if (totalRuns === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (dataGrid) dataGrid.style.display = 'none';
      if (timelineCard) timelineCard.style.display = 'none';
      this.renderZeroKPIs(metrics);
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (dataGrid) dataGrid.style.display = 'grid';

    // 1. Render 6 KPI Cards
    if (timelineCard) timelineCard.style.display = 'block';
    this.renderKPIs(metrics, data.pop_comparison || {});
    this.renderTimelineChart(data);

    // 2. Render MECE Category Distribution
    this.renderMECETrend(data.mece_breakdown || {}, totalRuns);

    // 3. Render 4-Quadrant GEO Action Panel
    this.renderGEOPanel(data.geo_diagnostic || {});

    // 4. Render Competitor Leaderboard
    this.renderCompetitors(data.competitors || data.competitors_leaderboard || []);

    // 5. Render Grounding Citations
    this.renderCitations(data.citations || data.top_citations || {});
  }

  updateRangeBanner(data) {
    const lang = i18n ? i18n.getLanguage() : 'de';
    const dr = data?.date_range || {};
    const rangeLabelEl = document.getElementById('active-range-label');
    const primaryLegendEl = document.getElementById('timeline-legend-primary');
    const compareWrapEl = document.getElementById('timeline-legend-compare-wrap');
    const compareLegendEl = document.getElementById('timeline-legend-compare');

    const hasCurrentRange = dr.current_start && dr.current_end;
    const currentText = hasCurrentRange
      ? `${formatFullDate(dr.current_start, lang)} – ${formatFullDate(dr.current_end, lang)}`
      : '';
    const hasCompareRange = dr.compare_mode !== 'none' && dr.previous_start && dr.previous_end;
    const compareText = hasCompareRange
      ? `${formatFullDate(dr.previous_start, lang)} – ${formatFullDate(dr.previous_end, lang)}`
      : '';

    if (rangeLabelEl) {
      if (currentText && compareText) {
        rangeLabelEl.textContent = `${currentText} ${i18n.t('compare.vs_short', 'vs.')} ${compareText}`;
      } else {
        rangeLabelEl.textContent = currentText;
      }
    }

    if (primaryLegendEl) {
      const base = i18n.t('timeline.legend_primary', 'Gewählter Zeitraum');
      primaryLegendEl.textContent = currentText ? `${base} (${currentText})` : base;
    }

    if (compareWrapEl && compareLegendEl) {
      if (!hasCompareRange) {
        compareWrapEl.classList.add('hidden');
      } else {
        compareWrapEl.classList.remove('hidden');
        const baseCmp = i18n.t('timeline.legend_compare', 'Vergleichszeitraum');
        compareLegendEl.textContent = `${baseCmp} (${compareText})`;
      }
    }
  }

  createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        el.setAttribute(k, String(v));
      }
    });
    return el;
  }

  renderTimelineChart(data) {
    const host = document.getElementById('timeline-svg-host');
    const wrap = document.getElementById('timeline-svg-wrap');
    const tooltip = document.getElementById('timeline-tooltip');
    const granPill = document.getElementById('timeline-granularity-pill');
    const subtitleEl = document.getElementById('timeline-subtitle');
    if (!host || typeof document.createElementNS !== 'function') return;

    const lang = i18n ? i18n.getLanguage() : 'de';
    const dr = data?.date_range || {};
    const granularity = dr.granularity === 'hour' ? 'hour' : 'day';
    const metricKey = this.activeTimelineMetric || 'som_score';
    const metricMeta = getTimelineMetricMeta(metricKey);

    if (subtitleEl) {
      subtitleEl.textContent = i18n.t(metricMeta.i18nKey, metricMeta.fallback);
    }
    if (granPill) {
      granPill.textContent = granularity === 'hour'
        ? i18n.t('timeline.granularity_hour', 'Stündliche Auflösung')
        : i18n.t('timeline.granularity_day', 'Tägliche Auflösung');
    }

    const aligned = buildTimelineAlignedSeries(
      data?.timeline || [],
      data?.comparison_timeline || [],
      dr.total_slots || 0,
      metricKey
    );

    const hasAnyValue = aligned.some(s => s.primaryValue !== null || s.compareValue !== null);
    if (typeof host.replaceChildren === 'function') host.replaceChildren(); else host.innerHTML = '';
    tooltip?.classList.add('hidden');

    if (!hasAnyValue) {
      const msg = document.createElement('p');
      msg.className = 'timeline-empty-note';
      msg.textContent = i18n.t('timeline.no_data', 'Keine Zeitreihendaten für diesen Zeitraum vorhanden.');
      host.appendChild(msg);
      return;
    }

    const W = 920;
    const H = 290;
    const pad = { top: 20, right: 24, bottom: 38, left: 48 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const slotCount = aligned.length;

    const xForSlot = (idx) => (slotCount <= 1 ? pad.left + plotW / 2 : pad.left + (idx / (slotCount - 1)) * plotW);
    const yForVal = (val) => pad.top + plotH - (Math.max(0, Math.min(100, val)) / 100) * plotH;

    const svg = this.createSvgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'timeline-svg',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': i18n.t('timeline.title', 'Entwicklung über Zeitverlauf & Vergleich')
    });

    const defs = this.createSvgEl('defs');
    const grad = this.createSvgEl('linearGradient', { id: 'timeline-primary-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(
      this.createSvgEl('stop', { offset: '0%', 'stop-color': '#059669', 'stop-opacity': '0.18' }),
      this.createSvgEl('stop', { offset: '100%', 'stop-color': '#059669', 'stop-opacity': '0.0' })
    );
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Y-axis grid & tick labels (0..100%)
    [0, 25, 50, 75, 100].forEach(tick => {
      const y = yForVal(tick);
      svg.appendChild(this.createSvgEl('line', {
        x1: pad.left,
        y1: y.toFixed(2),
        x2: W - pad.right,
        y2: y.toFixed(2),
        class: tick === 0 ? 'timeline-axis-line' : 'timeline-grid-line'
      }));
      const txt = this.createSvgEl('text', {
        x: pad.left - 10,
        y: (y + 4).toFixed(2),
        'text-anchor': 'end',
        class: 'timeline-axis-text'
      });
      txt.textContent = `${tick}%`;
      svg.appendChild(txt);
    });

    // Compute plotted points cleanly without dropping gaps to 0
    const primaryPoints = [];
    const comparePoints = [];
    aligned.forEach(slot => {
      const x = xForSlot(slot.slotIndex);
      if (slot.primaryValue !== null) {
        primaryPoints.push({ x, y: yForVal(slot.primaryValue), slot });
      }
      if (slot.compareValue !== null && dr.compare_mode !== 'none') {
        comparePoints.push({ x, y: yForVal(slot.compareValue), slot });
      }
    });

    // Comparison series first (underneath primary)
    if (comparePoints.length >= 2) {
      svg.appendChild(this.createSvgEl('path', {
        d: buildSvgLinePath(comparePoints),
        class: 'timeline-line-compare'
      }));
    }
    comparePoints.forEach(pt => {
      svg.appendChild(this.createSvgEl('circle', {
        cx: pt.x.toFixed(2),
        cy: pt.y.toFixed(2),
        r: '3.5',
        class: 'timeline-dot-compare'
      }));
    });

    // Primary area & line
    if (primaryPoints.length >= 2) {
      const firstPt = primaryPoints[0];
      const lastPt = primaryPoints[primaryPoints.length - 1];
      const baseY = (pad.top + plotH).toFixed(2);
      const areaD = `${buildSvgLinePath(primaryPoints)} L ${lastPt.x.toFixed(2)} ${baseY} L ${firstPt.x.toFixed(2)} ${baseY} Z`;
      svg.appendChild(this.createSvgEl('path', {
        d: areaD,
        fill: 'url(#timeline-primary-grad)'
      }));
      svg.appendChild(this.createSvgEl('path', {
        d: buildSvgLinePath(primaryPoints),
        class: 'timeline-line-primary'
      }));
    }
    primaryPoints.forEach(pt => {
      svg.appendChild(this.createSvgEl('circle', {
        cx: pt.x.toFixed(2),
        cy: pt.y.toFixed(2),
        r: primaryPoints.length === 1 ? '6' : '4.25',
        class: 'timeline-dot-primary'
      }));
    });

    // X-axis labels (up to 7 evenly distributed ticks)
    const maxTicks = 7;
    const tickIndices = new Set();
    if (slotCount <= maxTicks) {
      for (let i = 0; i < slotCount; i++) tickIndices.add(i);
    } else {
      const step = (slotCount - 1) / (maxTicks - 1);
      for (let k = 0; k < maxTicks; k++) {
        tickIndices.add(Math.round(k * step));
      }
      tickIndices.add(slotCount - 1);
    }
    tickIndices.forEach(idx => {
      const slot = aligned[idx];
      if (!slot) return;
      const x = xForSlot(idx);
      const ts = slot.primaryRow?.date_point || computeSlotTimestamp(dr.current_start, idx, granularity);
      const labelText = formatTimelineAxisLabel(ts, granularity, lang);
      if (!labelText) return;
      const txt = this.createSvgEl('text', {
        x: x.toFixed(2),
        y: H - 10,
        'text-anchor': idx === 0 && slotCount > 1 ? 'start' : (idx === slotCount - 1 && slotCount > 1 ? 'end' : 'middle'),
        class: 'timeline-axis-text'
      });
      txt.textContent = labelText;
      svg.appendChild(txt);
    });

    // Interactive Crosshair & Hover Layer
    const crosshair = this.createSvgEl('line', {
      x1: pad.left,
      y1: pad.top,
      x2: pad.left,
      y2: pad.top + plotH,
      class: 'timeline-crosshair',
      opacity: '0'
    });
    const activeCompareDot = this.createSvgEl('circle', {
      cx: pad.left,
      cy: pad.top,
      r: '5.5',
      class: 'timeline-dot-active-compare',
      opacity: '0'
    });
    const activePrimaryDot = this.createSvgEl('circle', {
      cx: pad.left,
      cy: pad.top,
      r: '6.5',
      class: 'timeline-dot-active-primary',
      opacity: '0'
    });
    const hitRect = this.createSvgEl('rect', {
      x: pad.left,
      y: pad.top,
      width: plotW,
      height: plotH,
      fill: 'transparent',
      class: 'timeline-hit-layer'
    });

    const showSlotTooltip = (clientX, clientY, slotIdx) => {
      const slot = aligned[slotIdx];
      if (!slot) return;
      const cx = xForSlot(slotIdx);
      crosshair.setAttribute('x1', cx.toFixed(2));
      crosshair.setAttribute('x2', cx.toFixed(2));
      crosshair.setAttribute('opacity', '1');

      if (slot.primaryValue !== null) {
        activePrimaryDot.setAttribute('cx', cx.toFixed(2));
        activePrimaryDot.setAttribute('cy', yForVal(slot.primaryValue).toFixed(2));
        activePrimaryDot.setAttribute('opacity', '1');
      } else {
        activePrimaryDot.setAttribute('opacity', '0');
      }

      if (slot.compareValue !== null && dr.compare_mode !== 'none') {
        activeCompareDot.setAttribute('cx', cx.toFixed(2));
        activeCompareDot.setAttribute('cy', yForVal(slot.compareValue).toFixed(2));
        activeCompareDot.setAttribute('opacity', '1');
      } else {
        activeCompareDot.setAttribute('opacity', '0');
      }

      if (!tooltip || !wrap) return;
      const pTs = slot.primaryRow?.date_point || computeSlotTimestamp(dr.current_start, slotIdx, granularity);
      const cTs = slot.compareRow?.date_point || computeSlotTimestamp(dr.previous_start, slotIdx, granularity);
      const pLabel = formatTimelineAxisLabel(pTs, granularity, lang) || `#${slotIdx + 1}`;
      const cLabel = formatTimelineAxisLabel(cTs, granularity, lang);
      const emptyTxt = i18n.t('timeline.empty_slot', 'Kein Messwert');
      const runsWord = i18n.t('timeline.runs_label', 'Abfragen');

      tooltip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'timeline-tooltip-title font-mono';
      head.textContent = pLabel;
      tooltip.appendChild(head);

      const addRow = (swatchClass, labelStr, valNum, rowObj) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'timeline-tooltip-row';
        const leftSpan = document.createElement('span');
        leftSpan.className = 'timeline-tooltip-label-wrap';
        const dot = document.createElement('span');
        dot.className = `timeline-tooltip-dot ${swatchClass}`;
        const lbl = document.createElement('span');
        lbl.textContent = labelStr;
        leftSpan.append(dot, lbl);

        const rightSpan = document.createElement('span');
        rightSpan.className = 'timeline-tooltip-val font-mono';
        if (valNum !== null) {
          const runs = Number(rowObj?.total_runs || 0);
          rightSpan.textContent = `${valNum.toFixed(1)}% (${runs} ${runsWord})`;
        } else {
          rightSpan.textContent = emptyTxt;
        }
        rowDiv.append(leftSpan, rightSpan);
        tooltip.appendChild(rowDiv);
      };

      addRow('dot-primary', i18n.t('timeline.legend_primary', 'Gewählt'), slot.primaryValue, slot.primaryRow);
      if (dr.compare_mode !== 'none' && dr.previous_start) {
        const cmpLbl = cLabel ? `${i18n.t('compare.vs_short', 'vs.')} ${cLabel}` : i18n.t('timeline.legend_compare', 'Vergleich');
        addRow('dot-compare', cmpLbl, slot.compareValue, slot.compareRow);
      }

      if (slot.primaryValue !== null && slot.compareValue !== null && dr.compare_mode !== 'none') {
        const diff = slot.primaryValue - slot.compareValue;
        const deltaRow = document.createElement('div');
        deltaRow.className = `timeline-tooltip-delta font-mono ${diff > 0 ? 'delta-pos' : (diff < 0 ? 'delta-neg' : '')}`;
        deltaRow.textContent = `${i18n.t('timeline.delta_label', 'Delta')}: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} %`;
        tooltip.appendChild(deltaRow);
      }

      tooltip.classList.remove('hidden');
      const wrapRect = wrap.getBoundingClientRect();
      const relX = Math.max(12, Math.min(wrapRect.width - 12, clientX - wrapRect.left));
      const relY = Math.max(12, Math.min(wrapRect.height - 20, clientY - wrapRect.top));
      const placeLeft = relX > wrapRect.width * 0.62;
      tooltip.style.left = placeLeft ? 'auto' : `${Math.round(relX + 14)}px`;
      tooltip.style.right = placeLeft ? `${Math.round(wrapRect.width - relX + 14)}px` : 'auto';
      tooltip.style.top = `${Math.max(8, Math.round(relY - 40))}px`;
    };

    const handlePointerMove = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const svgX = ((clientX - rect.left) / rect.width) * W;
      const ratio = (svgX - pad.left) / plotW;
      const clampedIdx = slotCount <= 1
        ? 0
        : Math.max(0, Math.min(slotCount - 1, Math.round(ratio * (slotCount - 1))));
      showSlotTooltip(clientX, clientY, clampedIdx);
    };

    hitRect.addEventListener('mousemove', (e) => handlePointerMove(e.clientX, e.clientY));
    hitRect.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    hitRect.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    hitRect.addEventListener('mouseleave', () => {
      crosshair.setAttribute('opacity', '0');
      activePrimaryDot.setAttribute('opacity', '0');
      activeCompareDot.setAttribute('opacity', '0');
      tooltip?.classList.add('hidden');
    });

    svg.append(crosshair, activeCompareDot, activePrimaryDot, hitRect);
    host.appendChild(svg);
  }

  renderZeroKPIs(metrics) {
    document.getElementById('kpi-som').textContent = '0.0 %';
    document.getElementById('kpi-visibility').textContent = '0.0 %';
    document.getElementById('kpi-earliness').textContent = '0.0 %';
    document.getElementById('kpi-runs').textContent = '0';
    document.getElementById('kpi-citations').textContent = '0.0 %';
    const credits = metrics.credits_remaining !== undefined ? metrics.credits_remaining : 0;
    document.getElementById('kpi-credits').textContent = String(credits);
    this.updateCreditBadge(credits);
    ['kpi-som-delta', 'kpi-visibility-delta', 'kpi-earliness-delta', 'kpi-runs-delta', 'kpi-citations-delta'].forEach(id => {
      this.setDeltaBadge(id, null);
    });
  }

  renderKPIs(metrics, pop) {
    // 1. SoM
    const som = Number(metrics.som_score || 0).toFixed(1);
    document.getElementById('kpi-som').textContent = `${som} %`;
    this.setDeltaBadge('kpi-som-delta', pop.som_delta);

    // 2. Visibility
    const vis = Number(metrics.visibility_index || 0).toFixed(1);
    document.getElementById('kpi-visibility').textContent = `${vis} %`;
    this.setDeltaBadge('kpi-visibility-delta', pop.visibility_delta);

    // 3. Earliness
    const early = Number(metrics.avg_earliness || 0).toFixed(1);
    document.getElementById('kpi-earliness').textContent = `${early} %`;
    this.setDeltaBadge('kpi-earliness-delta', pop.earliness_delta, true);

    // 4. Runs
    const runs = Number(metrics.total_runs || 0);
    document.getElementById('kpi-runs').textContent = String(runs);
    this.setDeltaBadge('kpi-runs-delta', pop.runs_delta);

    // 5. Citations Share
    const citShare = Number(metrics.citation_share || 0).toFixed(1);
    document.getElementById('kpi-citations').textContent = `${citShare} %`;
    this.setDeltaBadge('kpi-citations-delta', pop.citation_delta);

    // 6. Credits
    const creds = metrics.credits_remaining !== undefined ? metrics.credits_remaining : 0;
    document.getElementById('kpi-credits').textContent = String(creds);
    this.updateCreditBadge(creds);
  }

  setDeltaBadge(elementId, deltaVal, invertPositive = false) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (deltaVal === null || deltaVal === undefined || isNaN(deltaVal)) {
      el.textContent = '—';
      el.className = 'delta-badge delta-neutral';
      return;
    }

    const num = Number(deltaVal);
    const formatted = (num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1)) + '%';
    el.textContent = formatted;

    const isGood = invertPositive ? num < 0 : num > 0;
    if (num === 0) {
      el.className = 'delta-badge delta-neutral';
    } else if (isGood) {
      el.className = 'delta-badge delta-positive';
    } else {
      el.className = 'delta-badge delta-negative';
    }
  }

  updateCreditBadge(credits) {
    const headerCredits = document.getElementById('header-credits-val');
    if (headerCredits) headerCredits.textContent = String(credits);
  }

  renderMECETrend(mece, totalRuns) {
    const directWin = Number(mece.direct_win || 0);
    const brandHalo = Number(mece.brand_halo || 0);
    const takeover = Number(mece.competitor_takeover || 0);
    const generic = Number(mece.generic || 0);

    const safeTotal = totalRuns > 0 ? totalRuns : (directWin + brandHalo + takeover + generic) || 1;

    const pctWin = ((directWin / safeTotal) * 100).toFixed(1);
    const pctHalo = ((brandHalo / safeTotal) * 100).toFixed(1);
    const pctTakeover = ((takeover / safeTotal) * 100).toFixed(1);
    const pctGeneric = ((generic / safeTotal) * 100).toFixed(1);

    // Update Progress Bar Segment Widths
    const barWin = document.getElementById('mece-bar-win');
    const barHalo = document.getElementById('mece-bar-halo');
    const barTakeover = document.getElementById('mece-bar-takeover');
    const barGeneric = document.getElementById('mece-bar-generic');

    if (barWin) barWin.style.width = `${pctWin}%`;
    if (barHalo) barHalo.style.width = `${pctHalo}%`;
    if (barTakeover) barTakeover.style.width = `${pctTakeover}%`;
    if (barGeneric) barGeneric.style.width = `${pctGeneric}%`;

    // Update Numerical Legend
    document.getElementById('mece-count-win').textContent = String(directWin);
    document.getElementById('mece-pct-win').textContent = `(${pctWin}%)`;

    document.getElementById('mece-count-halo').textContent = String(brandHalo);
    document.getElementById('mece-pct-halo').textContent = `(${pctHalo}%)`;

    document.getElementById('mece-count-takeover').textContent = String(takeover);
    document.getElementById('mece-pct-takeover').textContent = `(${pctTakeover}%)`;

    document.getElementById('mece-count-generic').textContent = String(generic);
    document.getElementById('mece-pct-generic').textContent = `(${pctGeneric}%)`;
  }

  renderGEOPanel(geo) {
    const activeQuad = geo.active_quadrant || 'NONE';
    const activeBadge = document.getElementById('geo-active-badge');
    const prescriptionEl = document.getElementById('geo-prescription');

    if (activeBadge) {
      const activeLabel = i18n ? i18n.t(activeQuad, activeQuad) : activeQuad;
      activeBadge.textContent = activeLabel;
      activeBadge.className = 'badge geo-badge';
      if (activeQuad === '1_CITATION_HIJACK') activeBadge.classList.add('geo-hijack');
      else if (activeQuad === '2_PARAMETRIC_BLINDSPOT') activeBadge.classList.add('geo-blindspot');
      else if (activeQuad === '3_BRAND_HALO_TRAP') activeBadge.classList.add('geo-trap');
      else if (activeQuad === '4_BURIED_WINNER') activeBadge.classList.add('geo-buried');
      else activeBadge.classList.add('geo-none');
    }

    if (prescriptionEl) {
      const lang = i18n ? i18n.getLanguage() : 'de';
      const fallbackRx = i18n ? i18n.t(`geo.${activeQuad}.prescription`, 'Keine kritischen Sichtbarkeitslücken festgestellt.') : 'Keine kritischen Sichtbarkeitslücken festgestellt.';
      const prescription = lang === 'en'
        ? (geo.prescription_en || geo.prescription_de || fallbackRx)
        : (geo.prescription_de || geo.prescription_en || fallbackRx);
      prescriptionEl.textContent = prescription;
    }

    const counts = geo.quadrant_counts || {};
    const countHijack = document.getElementById('geo-count-hijack');
    const countBlindspot = document.getElementById('geo-count-blindspot');
    const countTrap = document.getElementById('geo-count-trap');
    const countBuried = document.getElementById('geo-count-buried');

    if (countHijack) countHijack.textContent = String(counts['1_CITATION_HIJACK'] || 0);
    if (countBlindspot) countBlindspot.textContent = String(counts['2_PARAMETRIC_BLINDSPOT'] || 0);
    if (countTrap) countTrap.textContent = String(counts['3_BRAND_HALO_TRAP'] || 0);
    if (countBuried) countBuried.textContent = String(counts['4_BURIED_WINNER'] || 0);

    // Synchronize 2x2 SVG Coordinate Grid & Active List Row
    const cellMap = [
      { quad: '1_CITATION_HIJACK', cellId: 'geo-cell-hijack', cls: 'active-hijack', itemId: 'geo-stat-hijack' },
      { quad: '2_PARAMETRIC_BLINDSPOT', cellId: 'geo-cell-blindspot', cls: 'active-blindspot', itemId: 'geo-stat-blindspot' },
      { quad: '3_BRAND_HALO_TRAP', cellId: 'geo-cell-trap', cls: 'active-trap', itemId: 'geo-stat-trap' },
      { quad: '4_BURIED_WINNER', cellId: 'geo-cell-buried', cls: 'active-buried', itemId: 'geo-stat-buried' }
    ];
    cellMap.forEach(({ quad, cellId, cls, itemId }) => {
      const cellEl = document.getElementById(cellId);
      const itemEl = document.getElementById(itemId);
      const isActive = activeQuad === quad;
      if (cellEl && cellEl.classList) {
        if (isActive) cellEl.classList.add(cls);
        else cellEl.classList.remove(cls);
      }
      if (itemEl && itemEl.classList) {
        if (isActive) itemEl.classList.add('geo-item-active');
        else itemEl.classList.remove('geo-item-active');
      }
    });
  }

  renderCompetitors(competitors) {
    const tbody = document.getElementById('competitors-tbody');
    if (!tbody) return;

    if (!Array.isArray(competitors) || competitors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Keine Wettbewerberdaten erfasst.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    competitors.forEach((comp, idx) => {
      const row = document.createElement('tr');
      const name = comp.competitor_name || comp.name || 'Unbekannt';
      const domain = comp.competitor_domain || comp.domain || '—';
      const visPct = Number(comp.visibility_pct || 0).toFixed(1);
      const mentions = comp.mentions || comp.mentions_count || 0;
      const recs = comp.recommendations_count || comp.recommendations || 0;
      const avgPos = comp.avg_relative_pos ? `${Number(comp.avg_relative_pos).toFixed(1)}%` : '—';

      row.innerHTML = `
        <td data-label="#" class="text-muted font-mono">${idx + 1}</td>
        <td data-label="Wettbewerber"><strong>${escapeHtml(name)}</strong></td>
        <td data-label="Domain" class="font-mono text-muted text-sm">${escapeHtml(domain)}</td>
        <td data-label="Sichtbarkeit" class="text-right font-mono">${visPct}%</td>
        <td data-label="Nennungen" class="text-right font-mono">${mentions}</td>
        <td data-label="Empfehlungen" class="text-right font-mono">${recs}</td>
        <td data-label="Ø Position" class="text-right font-mono">${avgPos}</td>
      `;
      tbody.appendChild(row);
    });
  }

  renderCitations(citations) {
    const tbody = document.getElementById('citations-tbody');
    if (!tbody) return;

    const domains = Array.isArray(citations.domains) ? citations.domains : [];
    if (domains.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Keine Quellenzitierungen vorhanden.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    domains.forEach(d => {
      const row = document.createElement('tr');
      const domain = d.citation_domain || d.domain || '—';
      const count = d.citation_count || d.count || 0;
      const isBrand = Boolean(d.is_brand_domain);

      const badgeHtml = isBrand
        ? '<span class="badge badge-success">Brand Domain</span>'
        : '<span class="badge badge-neutral">Third Party</span>';

      row.innerHTML = `
        <td data-label="Quell-Domain" class="font-mono">${escapeHtml(domain)}</td>
        <td data-label="Typ" class="text-center">${badgeHtml}</td>
        <td data-label="Zitate" class="text-right font-mono">${count}</td>
      `;
      tbody.appendChild(row);
    });
  }
}

function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const dashboard = new DashboardController();

// Assign to browser window globals & auto-initialize
if (typeof window !== 'undefined') {
  window.DashboardController = DashboardController;
  window.escapeHtml = escapeHtml;
  window.dashboard = dashboard;
  document.addEventListener('DOMContentLoaded', () => {
    dashboard.init();
  });
}

// CommonJS compatibility export for test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DashboardController,
    dashboard,
    getTimelineMetricMeta,
    computeSlotTimestamp,
    formatTimelineAxisLabel,
    buildTimelineAlignedSeries,
    buildSvgLinePath,
    escapeHtml
  };
}

export {
  DashboardController,
  dashboard,
  escapeHtml,
  getTimelineMetricMeta,
  computeSlotTimestamp,
  formatTimelineAxisLabel,
  buildTimelineAlignedSeries,
  buildSvgLinePath
};
export default dashboard;
