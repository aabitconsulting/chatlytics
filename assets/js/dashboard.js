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
import { configs } from './configs.js';
import { i18n } from './i18n.js';

class DashboardController {
  constructor() {
    this.currentPeriod = '30d';
    this.selectedConfigId = null;
    this.isRunning = false;
    this.auditToken = null;
    this.isAuditMode = false;
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
          ? '👁️ Sie betrachten ein geteiltes Chatlytics Magic Audit (Schreibgeschützt).'
          : '👁️ You are viewing a shared Chatlytics Magic Audit (Read-Only).';
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

  setupEventListeners() {
    // 1. Period Filter Buttons
    const periodButtons = document.querySelectorAll('#period-filter .segment-btn');
    periodButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        periodButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentPeriod = btn.dataset.period || '30d';
        await this.loadDashboard();
      });
    });

    // 2. Config Selector Dropdown
    const configSelect = document.getElementById('config-select');
    configSelect?.addEventListener('change', async (e) => {
      const val = e.target.value;
      this.selectedConfigId = val ? Number(val) : null;
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
    configs.initModal(async () => {
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
      btnTrigger.innerHTML = '<span class="icon">⏳</span> Dispatching...';
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
    const params = { period: this.currentPeriod };
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

    // Boundary 4.2: Zero-data empty state handling
    if (totalRuns === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (dataGrid) dataGrid.style.display = 'none';
      this.renderZeroKPIs(metrics);
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (dataGrid) dataGrid.style.display = 'grid';

    // 1. Render 6 KPI Cards
    this.renderKPIs(metrics, data.pop_comparison || {});

    // 2. Render MECE Category Distribution
    this.renderMECETrend(data.mece_breakdown || {}, totalRuns);

    // 3. Render 4-Quadrant GEO Action Panel
    this.renderGEOPanel(data.geo_diagnostic || {});

    // 4. Render Competitor Leaderboard
    this.renderCompetitors(data.competitors || data.competitors_leaderboard || []);

    // 5. Render Grounding Citations
    this.renderCitations(data.citations || data.top_citations || {});
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
      activeBadge.textContent = activeQuad;
      activeBadge.className = 'badge geo-badge';
      if (activeQuad === '1_CITATION_HIJACK') activeBadge.classList.add('geo-hijack');
      else if (activeQuad === '2_PARAMETRIC_BLINDSPOT') activeBadge.classList.add('geo-blindspot');
      else if (activeQuad === '3_BRAND_HALO_TRAP') activeBadge.classList.add('geo-trap');
      else if (activeQuad === '4_BURIED_WINNER') activeBadge.classList.add('geo-buried');
      else activeBadge.classList.add('geo-none');
    }

    if (prescriptionEl) {
      const lang = i18n ? i18n.getLanguage() : 'de';
      const prescription = lang === 'en'
        ? (geo.prescription_en || geo.prescription_de || '')
        : (geo.prescription_de || geo.prescription_en || '');
      prescriptionEl.textContent = prescription || 'Keine kritischen Anomalien festgestellt.';
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
    escapeHtml
  };
}

export { DashboardController, dashboard, escapeHtml };
export default dashboard;
