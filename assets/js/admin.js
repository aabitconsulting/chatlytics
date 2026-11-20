/**
 * Chatlytics.de — Owner Cockpit & 1-Click Demo Seeder Module
 * File: assets/js/admin.js
 *
 * Requirements:
 * - Feature 28: Owner Cockpit, User Directory, Credit Modal, Magic Audit Generator, Demo Seeder
 * - Feature 29.5: buildCreditPayload(userId, delta, reason)
 * - Boundary 4: XSS sanitization, Zero CDNs, Empty states, Modal focus trapping, Debouncing
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Core Mathematical and Payload Helpers (Canonical & Test-Asserted)
// -----------------------------------------------------------------------------

/**
 * Builds standard credit adjustment dispatch payload.
 * Tested in tests/tier1_features/f29_client_js_modules.test.js (Feature 29.5).
 *
 * @param {number|string} userId
 * @param {number|string} delta
 * @param {string} reason
 * @returns {{ user_id: number, delta: number, reason: string }}
 */
function buildCreditPayload(userId, delta, reason) {
  return {
    user_id: Number(userId),
    delta: Number(delta),
    reason: String(reason || '').trim()
  };
}

/**
 * HTML sanitization helper preventing XSS injections when rendering dynamic data.
 *
 * @param {*} val
 * @returns {string}
 */
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes length of company and text inputs (Boundary 4.4).
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizeLength(str, maxLen = 255) {
  const limit = Number(maxLen) > 0 ? Number(maxLen) : 255;
  const clean = String(str || '').trim();
  if (!clean) return '—';
  if (clean.length <= limit) return clean;
  return clean.substring(0, limit - 1) + '…';
}

// -----------------------------------------------------------------------------
// 2. Admin Controller State & Management
// -----------------------------------------------------------------------------

const AdminState = {
  currentUser: null,
  users: [],
  pagination: { page: 1, limit: 20, total: 0, total_pages: 1 },
  searchQuery: '',
  selectedUserId: null,
  selectedTierUserId: null,
  activeTab: 'users',
  platformKpis: null,
  models: [],
  modelAlerts: [],
  modelAlertsMeta: { open_count: 0, critical_count: 0, successor_count: 0, eol_count: 0 },
  isRunningModelWatcher: false,
  modelFilters: { search: '', provider: '', capability: '' },
  providerCredentials: [],
  providers: [],
  defaultProviders: [],
  providerDraftSet: new Set(),
  providerFilters: { search: '', mode: 'all' },
  pendingImpactAction: null,
  pendingImpactCancel: null,
  presets: [],
  plans: [],
  loadedTabs: { users: false, models: false, providers: false, presets: false, plans: false },
  isSeeding: false,
  isAdjustingCredit: false,
  searchDebounceTimer: null
};

/**
 * Initialize Admin Cockpit on DOM Ready.
 */
async function initAdminCockpit() {
  // 1. Client-Side Route Guard Enforcement (Feature 29.3)
  const token = localStorage.getItem('chatlytics_token');
  const storedUserRaw = localStorage.getItem('chatlytics_user');
  let user = storedUserRaw ? JSON.parse(storedUserRaw) : null;

  // Verify route guard contract
  const isAuthenticated = Boolean(token);
  const isAdmin = Boolean(user && user.role === 'admin');

  if (!isAuthenticated) {
    window.location.href = 'index.html?auth=required';
    return;
  }
  if (!isAdmin) {
    window.location.href = 'dashboard.html?error=unauthorized';
    return;
  }

  AdminState.currentUser = user;
  const emailEl = document.getElementById('nav-user-email');
  if (emailEl) emailEl.textContent = user.email || 'admin@chatlytics.de';

  // 1b. Sync Light/Dark Theme with Dashboard preference
  initAdminTheme();

  // 2. Bind Event Listeners
  bindAdminEvents();

  // 3. Initial Load of Users and Telemetry
  await loadAdminUsers(1, '');

  // 4. Preload Open Model Lifecycle Alerts & respect #models / #presets hash deep-links (e.g. from alert email)
  loadModelLifecycleAlerts().catch(() => {});
  const hashTab = String(window.location?.hash || '').replace(/^#/, '').toLowerCase();
  if (['users', 'models', 'providers', 'presets', 'plans'].includes(hashTab) && hashTab !== 'users') {
    await switchAdminTab(hashTab);
  }
}

/**
 * Bind DOM Event Listeners.
 */
function bindAdminEvents() {
  // 1-Click Demo Seeder Buttons (Header and Empty-State)
  const seedBtn = document.getElementById('btn-seed-demo');
  if (seedBtn) seedBtn.addEventListener('click', () => triggerDemoSeeder());

  const emptySeedBtn = document.getElementById('btn-empty-seed-demo');
  if (emptySeedBtn) emptySeedBtn.addEventListener('click', () => triggerDemoSeeder());

  // Search input debouncing
  const searchInput = document.getElementById('input-user-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(AdminState.searchDebounceTimer);
      const query = e.target.value.trim();
    AdminState.searchDebounceTimer = setTimeout(() => {
    AdminState.searchQuery = query;
        loadAdminUsers(1, query);
      }, 300);
    });
  }

  // Pagination Controls
  const prevBtn = document.getElementById('btn-page-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (AdminState.pagination.page > 1) {
        loadAdminUsers(AdminState.pagination.page - 1, AdminState.searchQuery);
      }
    });
  }

  const nextBtn = document.getElementById('btn-page-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (AdminState.pagination.page < AdminState.pagination.total_pages) {
        loadAdminUsers(AdminState.pagination.page + 1, AdminState.searchQuery);
      }
    });
  }

  // Credit Adjustment Modal Form
  const creditForm = document.getElementById('form-adjust-credits');
  if (creditForm) creditForm.addEventListener('submit', handleCreditSubmit);

  const creditCloseBtn = document.getElementById('btn-credit-modal-close');
  if (creditCloseBtn) creditCloseBtn.addEventListener('click', () => closeCreditModal());

  const creditCancelBtn = document.getElementById('btn-credit-cancel');
  if (creditCancelBtn) creditCancelBtn.addEventListener('click', () => closeCreditModal());

  // Magic Audit Modal Controls
  const magicCloseBtn = document.getElementById('btn-magic-modal-close');
  if (magicCloseBtn) magicCloseBtn.addEventListener('click', () => closeMagicAuditModal());

  const magicFooterCloseBtn = document.getElementById('btn-magic-close');
  if (magicFooterCloseBtn) magicFooterCloseBtn.addEventListener('click', () => closeMagicAuditModal());

  const magicCopyBtn = document.getElementById('btn-copy-magic-url');
  if (magicCopyBtn) magicCopyBtn.addEventListener('click', () => copyMagicAuditUrl());

  // Logout Button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('chatlytics_token');
      localStorage.removeItem('chatlytics_user');
      window.location.href = 'index.html?auth=logout';
    });
  }

  // Theme Toggle Button
  const themeBtn = document.getElementById('btn-admin-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyAdminTheme(current === 'dark' ? 'light' : 'dark', true);
    });
  }

  // Close open <details class="admin-action-menu"> popovers on outside click
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.admin-action-menu[open]').forEach((menu) => {
      if (!menu.contains(e.target)) menu.removeAttribute('open');
    });
  });

  // Global Keyboard Navigation (Escape closes active modal & menus)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCreditModal();
      closeMagicAuditModal();
      closeRunTokenModal();
      document.querySelectorAll('details.admin-action-menu[open]').forEach((menu) => menu.removeAttribute('open'));
    }
  });

  // Backdrop click closes active modal
  const creditModal = document.getElementById('credit-modal');
  if (creditModal) {
    creditModal.addEventListener('click', (e) => {
      if (e.target === creditModal) closeCreditModal();
    });
  }

  const magicModal = document.getElementById('magic-audit-modal');
  if (magicModal) {
    magicModal.addEventListener('click', (e) => {
      if (e.target === magicModal) closeMagicAuditModal();
    });
  }

  const runTokenModal = document.getElementById('run-token-modal');
  if (runTokenModal) {
    runTokenModal.addEventListener('click', (e) => {
      if (e.target === runTokenModal) closeRunTokenModal();
    });
  }
  const runTokenCloseTop = document.getElementById('btn-run-token-modal-close');
  if (runTokenCloseTop) runTokenCloseTop.addEventListener('click', closeRunTokenModal);
  const runTokenCloseBottom = document.getElementById('btn-run-token-close');
  if (runTokenCloseBottom) runTokenCloseBottom.addEventListener('click', closeRunTokenModal);
  if (typeof bindAdminV2Events === 'function') bindAdminV2Events();
}

// -----------------------------------------------------------------------------
// 3. User Directory Table & Telemetry Fetching
// -----------------------------------------------------------------------------

/**
 * Fetch and render users table.
 *
 * @param {number} page
 * @param {string} search
 */
async function loadAdminUsers(page = 1, search = '') {
  const token = localStorage.getItem('chatlytics_token');
  const tbody = document.getElementById('users-tbody');
  const emptyState = document.getElementById('users-empty-state');
  const table = document.getElementById('users-table');

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const params = new URLSearchParams({
      action: 'list',
      page: String(page),
      limit: String(AdminState.pagination.limit)
    });
    if (search) params.append('search', search);

    const res = await fetch(`api/admin_users.php?${params.toString()}`, { headers });
    const json = await res.json();

    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Laden der Mandanten.', 'error');
      return;
    }

    const { users, pagination, platform_kpis } = json.data;
    AdminState.platformKpis = platform_kpis || null;
    AdminState.users = users || [];
    AdminState.pagination = pagination || { page: 1, limit: 20, total: 0, total_pages: 1 };

    // Update KPI summary cards
    updateKpiCards(users, pagination.total, platform_kpis);
    AdminState.loadedTabs.users = true;

    // Update User Count Badge & Pagination
    updatePaginationUI();

    // Render User Table Rows or Empty State
    if (AdminState.users.length === 0) {
      if (table) table.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    } else {
      if (table) table.style.display = 'table';
      if (emptyState) emptyState.style.display = 'none';
      renderUserTableRows(AdminState.users);
    }

  } catch (err) {
    console.error('loadAdminUsers error:', err);
    showToast('Netzwerkfehler beim Laden der Mandantenliste.', 'error');
  }
}

/**
 * Render user directory table rows using strict XSS protection.
 *
 * @param {Array<Object>} users
 */
function renderUserTableRows(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  tbody.textContent = '';

  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.dataset.userId = String(u.id);

    // 1. ID
    const tdId = document.createElement('td');
    tdId.setAttribute('data-label', 'ID');
    tdId.className = 'font-mono';
    tdId.textContent = String(u.id);
    tr.appendChild(tdId);

    // 2. Email & Company stacked cleanly
    const tdUser = document.createElement('td');
    tdUser.setAttribute('data-label', 'E-Mail & Unternehmen');
    const userStack = document.createElement('div');
    userStack.className = 'cell-user-stack';
    const emailEl = document.createElement('span');
    emailEl.className = 'cell-email font-mono';
    emailEl.textContent = u.email || '';
    const compEl = document.createElement('span');
    compEl.className = 'cell-company text-muted';
    compEl.textContent = sanitizeLength(u.company_name || '—', 40);
    userStack.append(emailEl, compEl);
    tdUser.appendChild(userStack);
    tr.appendChild(tdUser);

    // 3. Member Since
    const tdCreated = document.createElement('td');
    tdCreated.setAttribute('data-label', 'Mitglied seit');
    tdCreated.className = 'cell-date text-muted font-mono';
    tdCreated.textContent = (u.created_at || '').substring(0, 10) || '—';
    tr.appendChild(tdCreated);

    // 4. Profiles (Active / Total)
    const tdProfiles = document.createElement('td');
    tdProfiles.setAttribute('data-label', 'Profile');
    tdProfiles.className = 'font-mono';
    const totalCfg = Number(u.config_count || 0);
    const activeCfg = Number(u.active_config_count || 0);
    tdProfiles.textContent = `${activeCfg} / ${totalCfg}`;
    tdProfiles.title = `${activeCfg} aktiv, ${Number(u.paused_config_count || 0)} pausiert, ${totalCfg} gesamt`;
    tr.appendChild(tdProfiles);

    // 5. Tier Badge
    const tdTier = document.createElement('td');
    tdTier.setAttribute('data-label', 'Tarif');
    const spanTier = document.createElement('span');
    spanTier.className = `badge badge-tier badge-${escapeHtml(u.tier || 'free')}`;
    spanTier.textContent = u.tier || 'free';
    tdTier.appendChild(spanTier);
    tr.appendChild(tdTier);

    // 6. Credits / Runs
    const tdCreditsRuns = document.createElement('td');
    tdCreditsRuns.setAttribute('data-label', 'Credits / Analyse-Läufe');
    tdCreditsRuns.className = 'font-mono';
    const credLine = document.createElement('div');
    credLine.className = 'text-bold';
    credLine.textContent = `${Number(u.credits_remaining || 0).toLocaleString()} Cr`;
    const runLine = document.createElement('div');
    runLine.className = 'text-muted';
    runLine.style.fontSize = '0.75rem';
    runLine.textContent = `${Number(u.run_count || 0).toLocaleString()} Analyse-Läufe`;
    tdCreditsRuns.append(credLine, runLine);
    tr.appendChild(tdCreditsRuns);

    // 7. Total Tokens Spent
    const tdTokensTotal = document.createElement('td');
    tdTokensTotal.setAttribute('data-label', 'Tokens Gesamt');
    tdTokensTotal.className = 'font-mono';
    tdTokensTotal.textContent = Number(u.total_tokens || 0).toLocaleString();
    tr.appendChild(tdTokensTotal);

    // 8. Avg Tokens / Run
    const tdTokPerRun = document.createElement('td');
    tdTokPerRun.setAttribute('data-label', 'Ø Tokens / Analyse-Lauf');
    tdTokPerRun.className = 'font-mono text-muted';
    tdTokPerRun.textContent = Number(u.avg_tokens_per_run || 0).toLocaleString();
    tr.appendChild(tdTokPerRun);

    // 9. Avg Tokens / Profile
    const tdTokPerCfg = document.createElement('td');
    tdTokPerCfg.setAttribute('data-label', 'Ø Tokens / Profil');
    tdTokPerCfg.className = 'font-mono text-muted';
    tdTokPerCfg.textContent = Number(u.avg_tokens_per_config || 0).toLocaleString();
    tr.appendChild(tdTokPerCfg);

    // 10. Status Badge
    const tdStatus = document.createElement('td');
    tdStatus.setAttribute('data-label', 'Status');
    const spanStatus = document.createElement('span');
    spanStatus.className = `badge badge-status badge-${escapeHtml(u.status || 'active')}`;
    spanStatus.textContent = u.status || 'active';
    tdStatus.appendChild(spanStatus);
    tr.appendChild(tdStatus);

    // 11. Quick Actions (3 primary inline + <details> overflow for secondary/destructive)
    const tdActions = document.createElement('td');
    tdActions.setAttribute('data-label', 'Aktionen');
    tdActions.className = 'text-right table-actions admin-quick-actions';

    const btnCredit = document.createElement('button');
    btnCredit.type = 'button';
    btnCredit.className = 'btn btn-xs btn-outline';
    btnCredit.textContent = 'Credits';
    btnCredit.addEventListener('click', () => openCreditModal(u));

    const btnTokens = document.createElement('button');
    btnTokens.type = 'button';
    btnTokens.className = 'btn btn-xs btn-outline';
    btnTokens.textContent = 'Tokens';
    btnTokens.title = 'Analyse-Läufe & Tokens';
    btnTokens.addEventListener('click', () => openRunTokenModal(u));

    const btnMagic = document.createElement('button');
    btnMagic.type = 'button';
    btnMagic.className = 'btn btn-xs btn-secondary';
    btnMagic.textContent = 'Report-Link';
    btnMagic.addEventListener('click', () => generateAndOpenMagicAudit(u.id));

    const moreMenu = document.createElement('details');
    moreMenu.className = 'admin-action-menu';
    moreMenu.addEventListener('toggle', () => {
      if (moreMenu.open) {
        document.querySelectorAll('details.admin-action-menu[open]').forEach((other) => {
          if (other !== moreMenu) other.removeAttribute('open');
        });
      }
    });

    const moreSummary = document.createElement('summary');
    moreSummary.className = 'btn btn-xs btn-outline admin-action-menu-trigger';
    moreSummary.textContent = getAdminLanguage() === 'en' ? 'More ▾' : 'Mehr ▾';

    const moreList = document.createElement('div');
    moreList.className = 'admin-action-menu-list';

    const btnTier = document.createElement('button');
    btnTier.type = 'button';
    btnTier.className = 'admin-action-menu-item';
    btnTier.textContent = 'Tarif ändern';
    btnTier.addEventListener('click', () => {
      moreMenu.removeAttribute('open');
      openTierModal(u);
    });

    const btnPauseAll = document.createElement('button');
    btnPauseAll.type = 'button';
    btnPauseAll.className = 'admin-action-menu-item';
    btnPauseAll.textContent = 'Alle pausieren';
    btnPauseAll.disabled = activeCfg === 0;
    btnPauseAll.addEventListener('click', () => {
      moreMenu.removeAttribute('open');
      handlePauseAllUserConfigs(u, btnPauseAll);
    });

    const isSuspended = String(u.status || 'active') === 'suspended';
    const isSelfAdmin = AdminState.currentUser && Number(AdminState.currentUser.id) === Number(u.id);
    const btnSuspend = document.createElement('button');
    btnSuspend.type = 'button';
    btnSuspend.className = `admin-action-menu-item ${isSuspended ? '' : 'is-danger'}`.trim();
    btnSuspend.textContent = isSuspended ? 'Entsperren' : 'Sperren';
    btnSuspend.disabled = Boolean(isSelfAdmin && !isSuspended);
    btnSuspend.addEventListener('click', () => {
      moreMenu.removeAttribute('open');
      handleToggleUserStatus(u, btnSuspend);
    });

    moreList.append(btnTier, btnPauseAll, btnSuspend);
    moreMenu.append(moreSummary, moreList);
    tdActions.append(btnCredit, btnTokens, btnMagic, moreMenu);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

/**
 * Update Platform KPI overview telemetry.
 */
function updateKpiCards(users, totalUsers, platformKpis = null) {
  const kpiUsersEl = document.getElementById('kpi-total-users');
  const kpiRunsEl = document.getElementById('kpi-total-runs');
  const kpiCreditsEl = document.getElementById('kpi-total-credits');
  const kpiConfigsEl = document.getElementById('kpi-total-configs');

  if (platformKpis && typeof platformKpis === 'object') {
    if (kpiUsersEl) kpiUsersEl.textContent = Number(platformKpis.total_users ?? totalUsers ?? 0).toLocaleString();
    if (kpiConfigsEl) kpiConfigsEl.textContent = Number(platformKpis.total_configs ?? 0).toLocaleString();
    if (kpiRunsEl) kpiRunsEl.textContent = Number(platformKpis.total_runs ?? 0).toLocaleString();
    if (kpiCreditsEl) kpiCreditsEl.textContent = Number(platformKpis.total_credits ?? 0).toLocaleString();
    return;
  }

  if (kpiUsersEl) kpiUsersEl.textContent = Number(totalUsers || 0).toLocaleString();

  let sumRuns = 0;
  let sumCredits = 0;
  let sumConfigs = 0;
  users.forEach((u) => {
    sumRuns += Number(u.run_count || 0);
    sumCredits += Number(u.credits_remaining || 0);
    sumConfigs += Number(u.config_count || 0);
  });

  if (kpiRunsEl) kpiRunsEl.textContent = sumRuns.toLocaleString();
  if (kpiCreditsEl) kpiCreditsEl.textContent = sumCredits.toLocaleString();
  if (kpiConfigsEl) kpiConfigsEl.textContent = (sumConfigs || users.length || 0).toLocaleString();
}

/**
 * Update pagination UI indicator and button disabled states.
 */
function updatePaginationUI() {
  const { page, total, total_pages } = AdminState.pagination;
  const countBadge = document.getElementById('user-count-badge');
  const pageIndicator = document.getElementById('page-indicator');
  const prevBtn = document.getElementById('btn-page-prev');
  const nextBtn = document.getElementById('btn-page-next');

  if (countBadge) countBadge.textContent = `${total} Mandanten`;
  if (pageIndicator) pageIndicator.textContent = `Seite ${page} von ${Math.max(1, total_pages)}`;

  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= total_pages;
}

// -----------------------------------------------------------------------------
// 4. Credit Adjustment Modal Handlers
// -----------------------------------------------------------------------------

function openCreditModal(user) {
  AdminState.selectedUserId = user.id;
  const modal = document.getElementById('credit-modal');
  const emailEl = document.getElementById('credit-user-email');
  const balanceEl = document.getElementById('credit-current-balance');
  const deltaInput = document.getElementById('input-credit-delta');
  const reasonInput = document.getElementById('input-credit-reason');

  if (emailEl) emailEl.textContent = user.email;
  if (balanceEl) balanceEl.textContent = Number(user.credits_remaining || 0).toLocaleString();
  if (deltaInput) {
    deltaInput.value = '';
    setTimeout(() => deltaInput.focus(), 50);
  }
  if (reasonInput) reasonInput.value = '';

  if (modal) modal.style.display = 'flex';
}

function closeCreditModal() {
  const modal = document.getElementById('credit-modal');
  if (modal) modal.style.display = 'none';
  AdminState.selectedUserId = null;
}

async function handleCreditSubmit(e) {
  e.preventDefault();
  if (AdminState.isAdjustingCredit) return;

  const deltaInput = document.getElementById('input-credit-delta');
  const reasonInput = document.getElementById('input-credit-reason');
  const submitBtn = document.getElementById('btn-credit-submit');

  const deltaVal = deltaInput ? deltaInput.value : '';
  const reasonVal = reasonInput ? reasonInput.value : '';

  if (!deltaVal || isNaN(Number(deltaVal))) {
    showToast('Bitte ein gültiges Guthaben-Delta angeben.', 'error');
    return;
  }

  // Build payload via test-asserted Feature 29.5 helper
  const payload = buildCreditPayload(AdminState.selectedUserId, deltaVal, reasonVal);

  AdminState.isAdjustingCredit = true;
  const savingLabel = (typeof window !== 'undefined' && window.i18n?.t)
    ? window.i18n.t('admin.btn_saving', 'Wird gespeichert…')
    : 'Wird gespeichert…';
  setAdminButtonLoading(submitBtn, true, savingLabel);

  try {
    const token = localStorage.getItem('chatlytics_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('api/admin_users.php?action=adjust_credits', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Anpassen der Credits.', 'error');
      return;
    }

    showToast(`Credits erfolgreich angepasst: Neuer Kontostand ${json.data.credits_remaining} Credits.`, 'success');
    closeCreditModal();
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);

  } catch (err) {
    console.error('handleCreditSubmit error:', err);
    showToast('Netzwerkfehler beim Anpassen der Credits.', 'error');
  } finally {
    AdminState.isAdjustingCredit = false;
    setAdminButtonLoading(submitBtn, false);
  }
}

// -----------------------------------------------------------------------------
// 5. Magic Audit Link Modal Handlers
// -----------------------------------------------------------------------------

async function generateAndOpenMagicAudit(userId) {
  const token = localStorage.getItem('chatlytics_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch('api/admin_users.php?action=generate_magic_token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId })
    });
    const json = await res.json();

    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Generieren des Report-Links.', 'error');
      return;
    }

    const shareUrl = json.data.shareable_url || json.data.link;
    const urlInput = document.getElementById('input-magic-url');
    const previewLink = document.getElementById('link-magic-preview');
    const modal = document.getElementById('magic-audit-modal');

    if (urlInput) urlInput.value = shareUrl;
    if (previewLink) previewLink.href = shareUrl;
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => urlInput && urlInput.select(), 50);
    }

  } catch (err) {
    console.error('generateAndOpenMagicAudit error:', err);
    showToast('Netzwerkfehler beim Erzeugen des Report-Links.', 'error');
  }
}

function closeMagicAuditModal() {
  const modal = document.getElementById('magic-audit-modal');
  if (modal) modal.style.display = 'none';
}

// -----------------------------------------------------------------------------
// 5b. Per-User Run & Token Telemetry Inspector Modal Handlers
// -----------------------------------------------------------------------------

async function openRunTokenModal(user) {
  if (!user || !user.id) return;
  const modal = document.getElementById('run-token-modal');
  const emailEl = document.getElementById('run-token-user-email');
  const tableEl = document.getElementById('run-token-table-name');
  const tbody = document.getElementById('run-token-tbody');

  if (emailEl) emailEl.textContent = user.email || `User #${user.id}`;
  if (tableEl) tableEl.textContent = user.results_table || `user_results_${user.id}`;
  if (tbody) {
    tbody.textContent = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'text-center text-muted';
    td.textContent = 'Lade Run- & Token-Telemetrie…';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  if (modal) modal.style.display = 'flex';

  try {
    const token = localStorage.getItem('chatlytics_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`api/user_results.php?user_id=${encodeURIComponent(user.id)}&include_deleted=1&limit=100`, {
      headers
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Laden der Token-Telemetrie.', 'error');
      return;
    }

    renderRunTokenInspector(json.data || {});
  } catch (err) {
    console.error('openRunTokenModal error:', err);
    showToast('Netzwerkfehler beim Laden der Token-Telemetrie.', 'error');
  }
}

function renderRunTokenInspector(data) {
  const summary = data.summary || {};
  const results = Array.isArray(data.results) ? data.results : [];

  const totalRunsEl = document.getElementById('run-token-total-runs');
  const totalInputEl = document.getElementById('run-token-total-input');
  const totalOutputEl = document.getElementById('run-token-total-output');
  const totalCachedEl = document.getElementById('run-token-total-cached');
  const tableEl = document.getElementById('run-token-table-name');
  const tbody = document.getElementById('run-token-tbody');

  if (tableEl && data.results_table) tableEl.textContent = data.results_table;
  if (totalRunsEl) totalRunsEl.textContent = Number(summary.total_runs ?? results.length).toLocaleString();
  if (totalInputEl) totalInputEl.textContent = Number(summary.total_input_tokens ?? 0).toLocaleString();
  if (totalOutputEl) totalOutputEl.textContent = Number(summary.total_output_tokens ?? 0).toLocaleString();
  if (totalCachedEl) totalCachedEl.textContent = Number(summary.total_cached_tokens ?? 0).toLocaleString();

  if (!tbody) return;
  tbody.textContent = '';

  if (results.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'text-center text-muted';
    td.textContent = 'Keine Analyse-Läufe für diesen Mandanten vorhanden.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const mdApi = (typeof window !== 'undefined' && window.ChatlyticsMarkdown) ? window.ChatlyticsMarkdown : null;
  if (mdApi && typeof mdApi.bindMarkdownCopyDelegation === 'function') {
    mdApi.bindMarkdownCopyDelegation(tbody, (mode, ok) => {
      if (ok) {
        showToast(
          mode === 'markdown'
            ? 'Als Markdown (.md) in die Zwischenablage kopiert.'
            : 'Formatierte KI-Antwort in die Zwischenablage kopiert.',
          'success'
        );
      } else {
        showToast('Kopieren fehlgeschlagen. Bitte manuell markieren.', 'error');
      }
    });
  }

  results.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'admin-token-row';
    const detailRowId = `admin-token-detail-${r.id || idx}`;

    const tdDate = document.createElement('td');
    tdDate.className = 'font-mono text-muted admin-token-date-cell';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'admin-token-expand-btn';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', detailRowId);
    toggleBtn.setAttribute('title', 'Vollständige KI-Antwort ein-/ausblenden');
    toggleBtn.textContent = '▸';
    const dateSpan = document.createElement('span');
    dateSpan.textContent = (r.created_at || '').substring(0, 16);
    tdDate.appendChild(toggleBtn);
    tdDate.appendChild(dateSpan);
    tr.appendChild(tdDate);

    const tdCfg = document.createElement('td');
    const cfgName = document.createElement('div');
    cfgName.textContent = sanitizeLength(r.config_name || (r.config_id ? `Profil #${r.config_id}` : '—'), 32);
    tdCfg.appendChild(cfgName);
    if (r.config_status) {
      const cfgBadge = document.createElement('span');
      cfgBadge.className = `badge badge-status badge-${escapeHtml(r.config_status)}`;
      cfgBadge.textContent = r.config_status === 'deleted' ? 'deleted (90d)' : r.config_status;
      tdCfg.appendChild(cfgBadge);
    }
    tr.appendChild(tdCfg);

    const tdPrompt = document.createElement('td');
    const brandStrong = document.createElement('strong');
    brandStrong.textContent = r.brand_name ? `[${r.brand_name}] ` : '';
    const promptSpan = document.createElement('span');
    promptSpan.textContent = sanitizeLength(r.prompt || '', 70);
    tdPrompt.appendChild(brandStrong);
    tdPrompt.appendChild(promptSpan);
    tr.appendChild(tdPrompt);

    const tdModel = document.createElement('td');
    tdModel.className = 'font-mono';
    tdModel.textContent = `${r.provider || ''}/${r.model || ''} (${r.execution_strategy || 'regular'})`;
    tr.appendChild(tdModel);

    const tdInput = document.createElement('td');
    tdInput.className = 'text-right font-mono text-bold';
    tdInput.textContent = Number(r.input_tokens || 0).toLocaleString();
    tr.appendChild(tdInput);

    const tdOutput = document.createElement('td');
    tdOutput.className = 'text-right font-mono text-bold';
    tdOutput.textContent = Number(r.output_tokens || 0).toLocaleString();
    tr.appendChild(tdOutput);

    const tdCached = document.createElement('td');
    tdCached.className = 'text-right font-mono';
    tdCached.textContent = Number(r.cached_tokens || 0).toLocaleString();
    tr.appendChild(tdCached);

    // Expandable detail row with full Prompt & Markdown-rendered AI Answer (+ 2 copy mini-icons)
    const detailTr = document.createElement('tr');
    detailTr.id = detailRowId;
    detailTr.className = 'admin-token-answer-row';
    detailTr.hidden = true;
    const detailTd = document.createElement('td');
    detailTd.colSpan = 7;

    const panel = document.createElement('div');
    panel.className = 'admin-token-answer-panel';

    const promptHeading = document.createElement('h4');
    promptHeading.className = 'accordion-detail-title';
    promptHeading.textContent = 'Ausgeführter User-Prompt';
    const promptPre = document.createElement('pre');
    promptPre.className = 'accordion-pre';
    promptPre.textContent = String(r.prompt || '—');
    panel.appendChild(promptHeading);
    panel.appendChild(promptPre);

    const answerHeading = document.createElement('h4');
    answerHeading.className = 'accordion-detail-title';
    answerHeading.style.marginTop = '0.75rem';
    answerHeading.textContent = 'Vollständige KI-Antwort';
    panel.appendChild(answerHeading);

    const answerRaw = r.status === 'failed'
      ? String(r.error_message || 'Fehlgeschlagen')
      : String(r.llm_answer || '—');

    if (r.status !== 'failed' && mdApi && typeof mdApi.createMarkdownAnswerViewer === 'function') {
      panel.appendChild(mdApi.createMarkdownAnswerViewer(answerRaw, {
        copyRich: 'Alles kopieren (formatiert)',
        copyMarkdown: 'Als Markdown (.md) kopieren',
        toolbarLabel: 'KI-Antwort kopieren'
      }));
    } else {
      const ansPre = document.createElement('pre');
      ansPre.className = 'accordion-pre';
      ansPre.textContent = answerRaw;
      panel.appendChild(ansPre);
    }

    detailTd.appendChild(panel);
    detailTr.appendChild(detailTd);

    const toggleRow = (e) => {
      if (e?.target?.closest?.('a')) return;
      const nextOpen = Boolean(detailTr.hidden);
      detailTr.hidden = !nextOpen;
      toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      toggleBtn.textContent = nextOpen ? '▾' : '▸';
      if (tr.classList) {
        if (nextOpen) tr.classList.add('is-open');
        else tr.classList.remove('is-open');
      }
    };
    tr.addEventListener('click', toggleRow);

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  });
}

function closeRunTokenModal() {
  const modal = document.getElementById('run-token-modal');
  if (modal) modal.style.display = 'none';
}

function copyMagicAuditUrl() {
  const urlInput = document.getElementById('input-magic-url');
  const copyBtnText = document.getElementById('btn-copy-magic-text');
  if (!urlInput) return;

  navigator.clipboard.writeText(urlInput.value).then(() => {
    if (copyBtnText) copyBtnText.textContent = 'Kopiert!';
    showToast('Report-Link in die Zwischenablage kopiert!', 'success');
    setTimeout(() => {
      if (copyBtnText) copyBtnText.textContent = 'Kopieren';
    }, 2000);
  }).catch(() => {
    urlInput.select();
    showToast('Bitte Link manuell markieren und kopieren.', 'info');
  });
}

// -----------------------------------------------------------------------------
// 6. 1-Click Realistic Demo Data Seeder (Debounced & Fail-Safe)
// -----------------------------------------------------------------------------

/**
 * 1-Click Realistic Demo Data Seeder with multi-click debouncing (Boundary 4.5).
 */
async function triggerDemoSeeder() {
  if (AdminState.isSeeding) return false;
  AdminState.isSeeding = true;

  const seedBtn = document.getElementById('btn-seed-demo');
  const seedBtnText = document.getElementById('btn-seed-demo-text');
  if (seedBtn) seedBtn.disabled = true;
  if (seedBtnText) seedBtnText.textContent = 'Demodaten werden generiert...';

  try {
    const token = localStorage.getItem('chatlytics_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Invoke seed_demo_data (with fallback to seed_demo alias)
    const res = await fetch('api/admin_users.php?action=seed_demo_data', {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    const json = await res.json();

    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Generieren der Demodaten.', 'error');
      return false;
    }

    const { seeded_accounts, configs_created, runs_created } = json.data;
    showToast(
      `Demodaten erfolgreich generiert: ${seeded_accounts.join(', ')} (${runs_created} Analyse-Läufe, ${configs_created} Tracking-Profile).`,
      'success'
    );

    // Refresh directory and KPIs
    await loadAdminUsers(1, '');
    return true;

  } catch (err) {
    console.error('triggerDemoSeeder error:', err);
    showToast('Netzwerkfehler beim Seeden der Demodaten.', 'error');
    return false;
  } finally {
    AdminState.isSeeding = false;
    if (seedBtn) seedBtn.disabled = false;
    if (seedBtnText) seedBtnText.textContent = 'Demodaten generieren';
  }
}

// -----------------------------------------------------------------------------
// 7. Toast Notification Utility (Accessible & Self-Contained)
// -----------------------------------------------------------------------------

function setAdminButtonLoading(btn, isLoading, loadingText = '') {
  if (typeof window !== 'undefined' && typeof window.ChatlyticsNotify?.setButtonLoading === 'function') {
    window.ChatlyticsNotify.setButtonLoading(btn, isLoading, loadingText);
    return;
  }
  if (!btn) return;
  if (isLoading) {
    if (btn._origText === undefined) btn._origText = btn.textContent;
    btn.disabled = true;
    btn.classList?.add('is-loading');
    if (loadingText) btn.textContent = loadingText;
  } else {
    btn.disabled = false;
    btn.classList?.remove('is-loading');
    if (btn._origText !== undefined) {
      btn.textContent = btn._origText;
      delete btn._origText;
    }
  }
}

function showToast(message, type = 'info') {
  if (typeof window !== 'undefined' && typeof window.ChatlyticsNotify?.showToast === 'function') {
    return window.ChatlyticsNotify.showToast(message, type);
  }
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');

  const textNode = document.createElement('span');
  textNode.className = 'toast-message';
  textNode.textContent = message; // Strict XSS protection

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.appendChild(textNode);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 7B. Owner Cockpit v2: Tabs, Quick Actions, Models, Analyse-Sets & Plans
// -----------------------------------------------------------------------------

function initAdminTheme() {
  if (typeof document === 'undefined') return;
  let stored = 'light';
  try {
    const val = localStorage.getItem('chatlytics_theme');
    if (val === 'dark' || val === 'light') stored = val;
  } catch (_) {}
  applyAdminTheme(stored, false);
}

function applyAdminTheme(theme, persist = true) {
  if (typeof document === 'undefined') return;
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement?.setAttribute?.('data-theme', next);
  if (persist) {
    try { localStorage.setItem('chatlytics_theme', next); } catch (_) {}
  }
  const toggleBtn = document.getElementById('btn-admin-theme-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  }
}

function getAdminAuthHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('chatlytics_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function getAdminLanguage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('chatlytics_lang') === 'en') {
      return 'en';
    }
  } catch (_) {}
  return (typeof document !== 'undefined' && document.documentElement?.lang === 'en') ? 'en' : 'de';
}

function bindAdminV2Events() {
  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchAdminTab(btn.dataset.tab || 'users');
    });
  });

  // Tier Modal
  const tierForm = document.getElementById('form-update-tier');
  if (tierForm) tierForm.addEventListener('submit', handleTierSubmit);
  document.getElementById('btn-tier-modal-close')?.addEventListener('click', closeTierModal);
  document.getElementById('btn-tier-cancel')?.addEventListener('click', closeTierModal);
  const tierModal = document.getElementById('tier-modal');
  if (tierModal) {
    tierModal.addEventListener('click', (e) => {
      if (e.target === tierModal) closeTierModal();
    });
  }

  // Model Lifecycle Alerts Banner & Watcher Controls
  document.getElementById('btn-open-model-alerts')?.addEventListener('click', () => {
    switchAdminTab('models');
    const panel = document.getElementById('admin-model-alerts-panel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  document.getElementById('btn-run-model-watcher')?.addEventListener('click', () => triggerModelWatcherRun());

  // Model Management Controls & Modal
  document.getElementById('btn-sync-n8n-models')?.addEventListener('click', () => triggerN8nModelSync());
  document.getElementById('model-filter-search')?.addEventListener('input', (e) => {
    AdminState.modelFilters.search = String(e.target?.value || '').trim().toLowerCase();
    renderModelsTable(AdminState.models);
  });
  document.getElementById('model-filter-provider')?.addEventListener('change', (e) => {
    AdminState.modelFilters.provider = String(e.target?.value || '').trim().toLowerCase();
    renderModelsTable(AdminState.models);
  });
  document.getElementById('model-filter-capability')?.addEventListener('change', (e) => {
    AdminState.modelFilters.capability = String(e.target?.value || '').trim();
    renderModelsTable(AdminState.models);
  });
  document.getElementById('btn-new-model')?.addEventListener('click', () => openModelModal(null));
  document.getElementById('form-save-model')?.addEventListener('submit', handleSaveModel);
  document.getElementById('btn-model-modal-close')?.addEventListener('click', closeModelModal);
  document.getElementById('btn-model-cancel')?.addEventListener('click', closeModelModal);
  const modelModal = document.getElementById('model-modal');
  if (modelModal) {
    modelModal.addEventListener('click', (e) => {
      if (e.target === modelModal) closeModelModal();
    });
  }

  // OpenRouter Provider Management Controls & Impact Modal
  document.getElementById('btn-sync-providers')?.addEventListener('click', () => syncOpenRouterProviders());
  document.getElementById('btn-reset-providers')?.addEventListener('click', () => handleResetOpenRouterProviders());
  document.getElementById('btn-save-providers')?.addEventListener('click', () => handleSaveOpenRouterProviders(false));
  document.getElementById('btn-save-sync-providers')?.addEventListener('click', () => handleSaveOpenRouterProviders(true));
  document.getElementById('provider-filter-search')?.addEventListener('input', (e) => {
    AdminState.providerFilters.search = String(e.target?.value || '').trim().toLowerCase();
    renderOpenRouterProvidersTable(AdminState.providers);
  });
  document.getElementById('provider-filter-mode')?.addEventListener('change', (e) => {
    AdminState.providerFilters.mode = String(e.target?.value || 'all').trim();
    renderOpenRouterProvidersTable(AdminState.providers);
  });

  document.getElementById('btn-impact-modal-close')?.addEventListener('click', () => closeProviderImpactModal(true));
  document.getElementById('btn-impact-cancel')?.addEventListener('click', () => closeProviderImpactModal(true));
  document.getElementById('btn-impact-confirm')?.addEventListener('click', () => confirmProviderImpactModal());
  const impactModal = document.getElementById('provider-impact-modal');
  if (impactModal) {
    impactModal.addEventListener('click', (e) => {
      if (e.target === impactModal) closeProviderImpactModal(true);
    });
  }

  // Preset Management Controls & Modal
  document.getElementById('btn-new-preset')?.addEventListener('click', () => openPresetModal(null));
  document.getElementById('form-save-preset')?.addEventListener('submit', handleSavePreset);
  document.getElementById('btn-preset-modal-close')?.addEventListener('click', closePresetModal);
  document.getElementById('btn-preset-cancel')?.addEventListener('click', closePresetModal);
  const presetModal = document.getElementById('preset-modal');
  if (presetModal) {
    presetModal.addEventListener('click', (e) => {
      if (e.target === presetModal) closePresetModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTierModal();
      closeModelModal();
      closePresetModal();
      closeProviderImpactModal(true);
    }
  });
}

async function switchAdminTab(tabKey) {
  const validTabs = ['users', 'models', 'providers', 'presets', 'plans'];
  const nextTab = validTabs.includes(tabKey) ? tabKey : 'users';
  AdminState.activeTab = nextTab;

  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === nextTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  validTabs.forEach((key) => {
    const panel = document.getElementById(`admin-panel-${key}`);
    if (panel) panel.hidden = (key !== nextTab);
  });

  if (nextTab === 'models') {
    if (!AdminState.loadedTabs.models) await loadAdminModels();
    await loadModelLifecycleAlerts();
  } else if (nextTab === 'providers') {
    await loadOpenRouterProviders();
  } else if (nextTab === 'presets') {
    if (!AdminState.loadedTabs.models) await loadAdminModels();
    await loadAdminPresets();
  } else if (nextTab === 'plans') {
    if (!AdminState.loadedTabs.presets) await loadAdminPresets();
    await loadAdminPlans();
  }
}

async function handlePauseAllUserConfigs(user, triggerBtn = null) {
  if (!user || !user.id) return;
  try {
    setAdminButtonLoading(triggerBtn, true, 'Pausiere...');
    const res = await fetch('api/admin_users.php?action=pause_all_configs', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ user_id: Number(user.id) })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Pausieren der Tracking-Profile.', 'error');
      return;
    }
    const pausedCount = Number(json.data?.paused_count ?? 0);
    showToast(`${pausedCount} aktive(s) Tracking-Profil(e) für ${user.email} pausiert.`, 'success');
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);
  } catch (err) {
    console.error('handlePauseAllUserConfigs error:', err);
    showToast('Netzwerkfehler beim Pausieren.', 'error');
  } finally {
    setAdminButtonLoading(triggerBtn, false);
  }
}

async function handleToggleUserStatus(user, triggerBtn = null) {
  if (!user || !user.id) return;
  const nextStatus = String(user.status || 'active') === 'suspended' ? 'active' : 'suspended';
  if (nextStatus === 'suspended' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const isEn = getAdminLanguage() === 'en';
    const msg = isEn
      ? `Suspend tenant "${user.email || user.id}"? All active tracking profiles will be paused.`
      : `Mandanten "${user.email || user.id}" wirklich sperren? Alle aktiven Tracking-Profile werden pausiert.`;
    if (!window.confirm(msg)) return;
  }
  try {
    setAdminButtonLoading(triggerBtn, true, 'Aktualisiere...');
    const res = await fetch('api/admin_users.php?action=set_user_status', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ user_id: Number(user.id), status: nextStatus })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Status-Änderung fehlgeschlagen.', 'error');
      return;
    }
    showToast(
      nextStatus === 'suspended'
        ? `Mandant ${user.email} wurde gesperrt und aktive Tracking-Profile pausiert.`
        : `Mandant ${user.email} wurde wieder entsperrt.`,
      'success'
    );
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);
  } catch (err) {
    console.error('handleToggleUserStatus error:', err);
    showToast('Netzwerkfehler bei Status-Änderung.', 'error');
  } finally {
    setAdminButtonLoading(triggerBtn, false);
  }
}

function openTierModal(user) {
  if (!user) return;
  AdminState.selectedTierUserId = Number(user.id);
  const modal = document.getElementById('tier-modal');
  const emailEl = document.getElementById('tier-user-email');
  const selectEl = document.getElementById('tier-select');
  const applyCreditsEl = document.getElementById('tier-apply-credits');

  if (emailEl) emailEl.textContent = user.email || '';
  if (selectEl) selectEl.value = user.tier || 'free';
  if (applyCreditsEl) applyCreditsEl.checked = true;
  if (modal) modal.style.display = 'flex';
}

function closeTierModal() {
  const modal = document.getElementById('tier-modal');
  if (modal) modal.style.display = 'none';
  AdminState.selectedTierUserId = null;
}

async function handleTierSubmit(e) {
  e.preventDefault();
  if (!AdminState.selectedTierUserId) return;
  const submitBtn = document.getElementById('btn-tier-save');
  const tier = document.getElementById('tier-select')?.value || 'free';
  const applyCredits = Boolean(document.getElementById('tier-apply-credits')?.checked);

  try {
    setAdminButtonLoading(submitBtn, true, 'Speichert...');
    const res = await fetch('api/admin_users.php?action=update_user_tier', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({
        user_id: AdminState.selectedTierUserId,
        tier,
        apply_plan_credits: applyCredits
      })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Tarif-Update fehlgeschlagen.', 'error');
      return;
    }
    showToast(`Tarif erfolgreich auf '${tier}' geändert.`, 'success');
    closeTierModal();
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);
  } catch (err) {
    console.error('handleTierSubmit error:', err);
    showToast('Netzwerkfehler beim Tarif-Update.', 'error');
  } finally {
    setAdminButtonLoading(submitBtn, false);
  }
}

async function loadAdminModels() {
  try {
    const res = await fetch('api/admin_users.php?action=list_models', { headers: getAdminAuthHeaders() });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Modelle konnten nicht geladen werden.', 'error');
      return;
    }
    AdminState.models = json.data?.models || [];
    AdminState.providerCredentials = json.data?.provider_credentials || [];
    AdminState.loadedTabs.models = true;
    renderProviderCredentials(AdminState.providerCredentials);
    renderModelsTable(AdminState.models);
  } catch (err) {
    console.error('loadAdminModels error:', err);
    showToast('Netzwerkfehler beim Laden des Modellkatalogs.', 'error');
  }
}

function renderProviderCredentials(credentials) {
  const grid = document.getElementById('provider-credentials-grid');
  if (!grid) return;
  grid.replaceChildren();

  (credentials || []).forEach((cred) => {
    const card = document.createElement('div');
    card.className = 'provider-cred-card';

    const header = document.createElement('div');
    header.className = 'provider-cred-header';
    const name = document.createElement('strong');
    name.textContent = String(cred.provider || 'openrouter').toUpperCase();
    const badge = document.createElement('span');
    const isLive = cred.status === 'connected';
    badge.className = `badge ${isLive ? 'badge-active' : 'badge-secondary'}`;
    badge.textContent = cred.status || 'seeded';
    header.append(name, badge);

    const credName = document.createElement('div');
    credName.className = 'provider-cred-name font-mono text-muted';
    credName.textContent = cred.credential_name || 'OpenRouter - Chatlytics - Chatlytics-dev-1';

    const countEl = document.createElement('div');
    countEl.className = 'provider-cred-count';
    countEl.textContent = `${Number(cred.model_count ?? cred.models_discovered ?? 0)} Modell(e)`;

    card.append(header, credName, countEl);

    if (cred.provider_counts && typeof cred.provider_counts === 'object') {
      const breakdown = document.createElement('div');
      breakdown.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem;';
      Object.entries(cred.provider_counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([prov, cnt]) => {
          const pill = document.createElement('span');
          pill.className = 'badge badge-secondary font-mono';
          pill.style.fontSize = '0.72rem';
          pill.textContent = `${prov}: ${cnt}`;
          breakdown.appendChild(pill);
        });
      card.appendChild(breakdown);
    }

    grid.appendChild(card);
  });
}

function populateModelProviderFilterOptions(models) {
  const select = document.getElementById('model-filter-provider');
  if (!select) return;
  const current = AdminState.modelFilters?.provider || '';
  const providers = Array.from(new Set((models || []).map(m => String(m.provider || '').toLowerCase()).filter(Boolean))).sort();
  select.replaceChildren();
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = `Alle Provider (${providers.length})`;
  select.appendChild(allOpt);
  providers.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });
  select.value = providers.includes(current) ? current : '';
}

function filterAdminModels(models) {
  const filters = AdminState.modelFilters || {};
  const q = String(filters.search || '').trim().toLowerCase();
  const prov = String(filters.provider || '').trim().toLowerCase();
  const cap = String(filters.capability || '').trim();

  return (models || []).filter((m) => {
    if (prov && String(m.provider || '').toLowerCase() !== prov) return false;
    if (cap === 'batch_api' && !m.supports_batch_api) return false;
    if (cap === 'tools' && m.supports_tools === false) return false;
    if (cap === 'allowed' && !m.is_allowed) return false;
    if (cap === 'pending' && m.is_allowed) return false;
    if (q) {
      const hay = `${m.id || ''} ${m.display_name || ''} ${m.provider || ''} ${m.model_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderModelsTable(models) {
  populateModelProviderFilterOptions(models);
  const filtered = filterAdminModels(models);

  const countBadge = document.getElementById('model-filter-count');
  if (countBadge) {
    const total = Array.isArray(models) ? models.length : 0;
    countBadge.textContent = filtered.length === total
      ? `${total} Modelle`
      : `${filtered.length} / ${total} Modelle`;
  }

  const tbody = document.getElementById('models-tbody');
  if (!tbody) return;
  tbody.replaceChildren();

  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'text-center text-muted';
    td.textContent = 'Keine passenden KI-Modelle für den aktuellen Filter.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((m) => {
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    tdId.setAttribute('data-label', 'Modell-ID & Provider');
    const idStrong = document.createElement('div');
    idStrong.className = 'font-mono';
    idStrong.textContent = m.id;
    const provSpan = document.createElement('span');
    provSpan.className = 'text-muted font-mono';
    provSpan.style.fontSize = '0.78rem';
    provSpan.textContent = `${m.provider} · Sync: ${m.n8n_sync_status || 'seeded'}`;
    tdId.append(idStrong, provSpan);
    const activeCnt = Number(m.active_config_count || 0);
    const pausedCnt = Number(m.paused_config_count || 0);
    const presetCnt = Number(m.preset_count || 0);
    if (activeCnt > 0 || pausedCnt > 0 || presetCnt > 0) {
      const usageLine = document.createElement('div');
      usageLine.className = 'provider-usage-detail';
      usageLine.style.marginTop = '4px';
      const usageBadge = document.createElement('span');
      usageBadge.className = `badge ${activeCnt > 0 ? 'badge-warning' : 'badge-secondary'}`;
      usageBadge.style.fontSize = '0.72rem';
      const parts = [];
      if (activeCnt > 0) parts.push(`${activeCnt} aktive Tracking-Profile`);
      if (pausedCnt > 0) parts.push(`${pausedCnt} pausiert`);
      if (presetCnt > 0) parts.push(`${presetCnt} Analyse-Set(s)`);
      usageBadge.textContent = parts.join(' · ');
      const samples = Array.isArray(m.config_samples) ? m.config_samples : [];
      if (samples.length > 0) {
        usageBadge.title = samples.map((s) => `${s.name} (${s.status})`).join(', ');
      }
      usageLine.appendChild(usageBadge);
      tdId.appendChild(usageLine);
    }
    tr.appendChild(tdId);

    const tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Anzeigename');
    tdName.textContent = m.display_name || m.id;
    tr.appendChild(tdName);

    const tdStrat = document.createElement('td');
    tdStrat.setAttribute('data-label', 'Strategie & Capabilities');
    const rawStrat = String(m.execution_strategy || '');
    const displayStrat = (!rawStrat || rawStrat === 'prompt_caching')
      ? (m.supports_batch_api ? 'batch_api' : 'regular')
      : rawStrat;

    const stratBadge = document.createElement('span');
    stratBadge.className = `badge strategy-badge strategy-${escapeHtml(displayStrat)}`;
    stratBadge.textContent = displayStrat;
    tdStrat.appendChild(stratBadge);

    if (m.supports_batch_api) {
      const batchBadge = document.createElement('span');
      batchBadge.className = 'badge badge-active';
      batchBadge.style.marginLeft = '6px';
      batchBadge.textContent = ':batch';
      tdStrat.appendChild(batchBadge);
    }

    const toolsBadge = document.createElement('span');
    toolsBadge.className = `badge ${m.supports_tools !== false ? 'badge-secondary' : 'badge-warning'}`;
    toolsBadge.style.marginLeft = '6px';
    toolsBadge.textContent = m.supports_tools !== false ? 'Tools' : 'Web-Plugin';
    tdStrat.appendChild(toolsBadge);
    tr.appendChild(tdStrat);

    const appendToggleCell = (fieldName, checkedVal, labelText) => {
      const td = document.createElement('td');
      td.setAttribute('data-label', labelText);
      const lbl = document.createElement('label');
      lbl.className = 'admin-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(checkedVal);
      input.addEventListener('change', () => handleToggleModelField(m.id, fieldName, input.checked, input));
      const span = document.createElement('span');
      span.className = 'admin-switch-label';
      span.textContent = input.checked ? 'AN' : 'AUS';
      lbl.append(input, span);
      td.appendChild(lbl);
      return td;
    };

    tr.appendChild(appendToggleCell('supports_web_search', m.supports_web_search, 'Live-Websuche'));
    tr.appendChild(appendToggleCell('is_default', m.is_default, 'Standard'));
    tr.appendChild(appendToggleCell('is_allowed', m.is_allowed, 'Freigegeben'));

    const tdAct = document.createElement('td');
    tdAct.setAttribute('data-label', 'Aktionen');
    tdAct.className = 'text-right table-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-xs btn-outline';
    editBtn.textContent = 'Bearbeiten';
    editBtn.addEventListener('click', () => openModelModal(m));
    tdAct.appendChild(editBtn);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

async function triggerN8nModelSync() {
  const btn = document.getElementById('btn-sync-n8n-models');
  const statusBadge = document.getElementById('n8n-sync-status-badge');
  try {
    setAdminButtonLoading(btn, true, 'Synchronisiere OpenRouter via n8n...');
    const res = await fetch('api/admin_users.php?action=sync_n8n_models', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'n8n Model-Sync fehlgeschlagen.', 'error');
      return;
    }
    const data = json.data || {};
    AdminState.models = data.models || AdminState.models;
    AdminState.providerCredentials = data.provider_credentials || AdminState.providerCredentials;
    AdminState.loadedTabs.models = true;
    renderProviderCredentials(AdminState.providerCredentials);
    renderModelsTable(AdminState.models);

    const timeStr = (data.last_synced_at || '').substring(11, 19);
    if (statusBadge) {
      statusBadge.className = `badge ${data.synced ? 'badge-active' : 'badge-secondary'}`;
      statusBadge.textContent = data.synced
        ? `OpenRouter Live-Sync OK (${AdminState.models.length} Modelle · ${timeStr})`
        : `Lokaler OpenRouter-Katalog (${AdminState.models.length} Modelle · ${timeStr})`;
    }
    showToast(
      data.synced
        ? `${AdminState.models.length} OpenRouter-Modelle live über n8n synchronisiert.`
        : (data.detail ? `n8n Offline (${data.detail}) — lokaler OpenRouter-Katalog geladen.` : 'n8n Webhook derzeit nicht erreichbar — lokaler Modellkatalog aktualisiert.'),
      data.synced ? 'success' : 'info'
    );
  } catch (err) {
    console.error('triggerN8nModelSync error:', err);
    showToast('Netzwerkfehler beim n8n Model-Sync.', 'error');
  } finally {
    setAdminButtonLoading(btn, false);
  }
}

async function executeToggleModelField(modelId, field, nextVal) {
  try {
    const res = await fetch('api/admin_users.php?action=toggle_model', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ id: modelId, [field]: Boolean(nextVal) })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Modell-Status konnte nicht gespeichert werden.', 'error');
      await loadAdminModels();
      return;
    }
    AdminState.models = json.data?.models || AdminState.models;
    renderModelsTable(AdminState.models);
    showToast(`Modell ${modelId} aktualisiert.`, 'success');
  } catch (err) {
    console.error('executeToggleModelField error:', err);
    showToast('Netzwerkfehler beim Speichern der Modell-Einstellung.', 'error');
  }
}

async function handleToggleModelField(modelId, field, nextVal, sourceInputEl = null) {
  if (field === 'is_allowed' && !nextVal && sourceInputEl && document.getElementById('provider-impact-modal')) {
    const targetModel = (AdminState.models || []).find((item) => item.id === modelId);
    const hasUsage = targetModel && (
      Number(targetModel.active_config_count || 0) > 0
      || Number(targetModel.paused_config_count || 0) > 0
      || Number(targetModel.preset_count || 0) > 0
    );
    if (hasUsage) {
      openProviderImpactConfirmModal(
        `Das Modell "${modelId}" wird noch in aktiven/pausierten Tracking-Profilen oder Analyse-Sets verwendet. Bei Deaktivierung können Mandanten dieses Modell nicht mehr neu auswählen; prüfen Sie betroffene Tracking-Profile unten:`,
        [targetModel],
        () => executeToggleModelField(modelId, field, false),
        () => {
          sourceInputEl.checked = true;
          renderModelsTable(AdminState.models);
        }
      );
      return;
    }
  }

  await executeToggleModelField(modelId, field, nextVal);
}

function openModelModal(model = null) {
  const modal = document.getElementById('model-modal');
  const idInput = document.getElementById('model-id');
  const provSelect = document.getElementById('model-provider');
  const nameInput = document.getElementById('model-name');
  const dispInput = document.getElementById('model-display-name');
  const stratSelect = document.getElementById('model-strategy');
  const batchEl = document.getElementById('model-supports-batch');
  const toolsEl = document.getElementById('model-supports-tools');
  const searchEl = document.getElementById('model-supports-search');
  const allowEl = document.getElementById('model-is-allowed');
  const defEl = document.getElementById('model-is-default');

  if (provSelect) {
    const existingOpts = new Set(Array.from(provSelect.options).map((o) => String(o.value || '').toLowerCase()));
    const dynamicProvs = (AdminState.providers || []).filter((p) => p.is_relevant).map((p) => p.provider_key);
    if (model && model.provider) dynamicProvs.push(String(model.provider).toLowerCase());
    dynamicProvs.forEach((pKey) => {
      const cleanKey = String(pKey || '').trim().toLowerCase();
      if (cleanKey && !existingOpts.has(cleanKey)) {
        const opt = document.createElement('option');
        opt.value = cleanKey;
        opt.textContent = cleanKey;
        provSelect.appendChild(opt);
        existingOpts.add(cleanKey);
      }
    });
  }

  if (model) {
    AdminState.editingModelId = model.id;
    if (idInput) { idInput.value = model.id || ''; idInput.readOnly = true; }
    if (provSelect) provSelect.value = model.provider || 'openai';
    if (nameInput) nameInput.value = model.model_name || '';
    if (dispInput) dispInput.value = model.display_name || '';
    if (stratSelect) {
      const rawStrat = model.execution_strategy || '';
      stratSelect.value = (rawStrat === 'batch_api' || (rawStrat === 'prompt_caching' && model.supports_batch_api)) ? 'batch_api' : 'regular';
    }
    if (batchEl) batchEl.checked = Boolean(model.supports_batch_api);
    if (toolsEl) toolsEl.checked = model.supports_tools !== false;
    if (searchEl) searchEl.checked = Boolean(model.supports_web_search);
    if (allowEl) allowEl.checked = model.is_allowed !== false;
    if (defEl) defEl.checked = Boolean(model.is_default);
  } else {
    AdminState.editingModelId = null;
    if (idInput) { idInput.value = ''; idInput.readOnly = false; }
    if (provSelect) provSelect.value = 'openai';
    if (nameInput) nameInput.value = '';
    if (dispInput) dispInput.value = '';
    if (stratSelect) stratSelect.value = 'batch_api';
    if (batchEl) batchEl.checked = true;
    if (toolsEl) toolsEl.checked = true;
    if (searchEl) searchEl.checked = true;
    if (allowEl) allowEl.checked = true;
    if (defEl) defEl.checked = false;
  }
  if (modal) modal.style.display = 'flex';
}

function closeModelModal() {
  const modal = document.getElementById('model-modal');
  if (modal) modal.style.display = 'none';
  AdminState.editingModelId = null;
}

async function handleSaveModel(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('btn-model-save');
  const payload = {
    id: document.getElementById('model-id')?.value.trim(),
    provider: document.getElementById('model-provider')?.value || 'openai',
    model_name: document.getElementById('model-name')?.value.trim(),
    display_name: document.getElementById('model-display-name')?.value.trim(),
    execution_strategy: document.getElementById('model-strategy')?.value || 'regular',
    eu_hosted: false,
    supports_batch_api: Boolean(document.getElementById('model-supports-batch')?.checked),
    supports_tools: Boolean(document.getElementById('model-supports-tools')?.checked),
    supports_web_search: Boolean(document.getElementById('model-supports-search')?.checked),
    is_allowed: Boolean(document.getElementById('model-is-allowed')?.checked),
    is_default: Boolean(document.getElementById('model-is-default')?.checked)
  };

  try {
    setAdminButtonLoading(saveBtn, true, 'Speichert...');
    const res = await fetch('api/admin_users.php?action=save_model', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Modell konnte nicht gespeichert werden.', 'error');
      return;
    }
    AdminState.models = json.data?.models || AdminState.models;
    renderProviderCredentials(buildClientCredFallback(AdminState.models));
    renderModelsTable(AdminState.models);
    closeModelModal();
    showToast('KI-Modell gespeichert.', 'success');
  } catch (err) {
    console.error('handleSaveModel error:', err);
    showToast('Netzwerkfehler beim Speichern des Modells.', 'error');
  } finally {
    setAdminButtonLoading(saveBtn, false);
  }
}

function buildClientCredFallback(models) {
  if (AdminState.providerCredentials && AdminState.providerCredentials.length > 0) {
    return AdminState.providerCredentials;
  }
  const providerCounts = {};
  (models || []).forEach((m) => {
    const p = String(m.provider || 'other').toLowerCase();
    providerCounts[p] = (providerCounts[p] || 0) + 1;
  });
  return [{
    provider: 'openrouter',
    credential_name: 'OpenRouter - Chatlytics - Chatlytics-dev-1',
    status: 'seeded',
    model_count: Array.isArray(models) ? models.length : 0,
    provider_counts: providerCounts
  }];
}

async function loadAdminPresets() {
  try {
    const res = await fetch('api/admin_users.php?action=list_presets', { headers: getAdminAuthHeaders() });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Analyse-Sets konnten nicht geladen werden.', 'error');
      return;
    }
    AdminState.presets = json.data?.presets || [];
    AdminState.loadedTabs.presets = true;
    renderPresetsGrid(AdminState.presets);
  } catch (err) {
    console.error('loadAdminPresets error:', err);
    showToast('Netzwerkfehler beim Laden der Analyse-Sets.', 'error');
  }
}

function renderPresetsGrid(presets) {
  const grid = document.getElementById('presets-grid');
  const countBadge = document.getElementById('preset-count-badge');
  const lang = getAdminLanguage();
  if (countBadge) countBadge.textContent = `${(presets || []).length} Analyse-Sets`;
  if (!grid) return;
  grid.replaceChildren();

  (presets || []).forEach((preset) => {
    const card = document.createElement('article');
    card.className = 'admin-preset-card';

    const top = document.createElement('div');
    top.className = 'admin-preset-card-top';
    const titleWrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = lang === 'en' ? (preset.name_en || preset.name_de) : (preset.name_de || preset.name_en);
    const idCode = document.createElement('code');
    idCode.className = 'font-mono text-muted';
    idCode.style.fontSize = '0.75rem';
    idCode.textContent = preset.id;
    titleWrap.append(h3, idCode);

    const badgeText = lang === 'en' ? (preset.badge_en || preset.badge_de) : (preset.badge_de || preset.badge_en);
    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge badge-secondary';
    badgeEl.textContent = badgeText || (preset.is_default ? 'Standard' : 'Analyse-Set');
    top.append(titleWrap, badgeEl);

    const desc = document.createElement('p');
    desc.className = 'text-muted';
    desc.style.fontSize = '0.88rem';
    desc.textContent = lang === 'en' ? (preset.description_en || preset.description_de) : (preset.description_de || preset.description_en);

    const llmsWrap = document.createElement('div');
    llmsWrap.className = 'admin-pill-row';
    (preset.target_llms || []).forEach((llmId) => {
      const pill = document.createElement('span');
      pill.className = 'badge badge-outline font-mono';
      pill.textContent = llmId;
      llmsWrap.appendChild(pill);
    });

    const metaWrap = document.createElement('div');
    metaWrap.className = 'admin-pill-row';
    const searchPill = document.createElement('span');
    searchPill.className = `badge ${preset.search_enabled ? 'badge-active' : 'badge-muted'}`;
    searchPill.textContent = preset.search_enabled ? 'Live-Websuche: AN' : 'Batch-API (ohne Live-Websuche)';
    metaWrap.appendChild(searchPill);
    (preset.allowed_tiers || []).forEach((tierKey) => {
      const tPill = document.createElement('span');
      tPill.className = `badge badge-tier badge-${escapeHtml(tierKey)}`;
      tPill.textContent = tierKey;
      metaWrap.appendChild(tPill);
    });

    const footer = document.createElement('div');
    footer.className = 'admin-preset-card-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-xs btn-outline';
    editBtn.textContent = 'Bearbeiten';
    editBtn.addEventListener('click', () => openPresetModal(preset));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-xs btn-outline-danger';
    delBtn.textContent = 'Löschen';
    delBtn.disabled = Boolean(preset.is_default || preset.id === 'default_visibility_tracking');
    delBtn.addEventListener('click', () => handleDeletePreset(preset));
    footer.append(editBtn, delBtn);

    card.append(top, desc, llmsWrap, metaWrap, footer);
    grid.appendChild(card);
  });
}

function openPresetModal(preset = null) {
  const modal = document.getElementById('preset-modal');
  const idEl = document.getElementById('preset-id');
  const sortEl = document.getElementById('preset-sort-order');
  const nameDeEl = document.getElementById('preset-name-de');
  const nameEnEl = document.getElementById('preset-name-en');
  const badgeDeEl = document.getElementById('preset-badge-de');
  const badgeEnEl = document.getElementById('preset-badge-en');
  const descDeEl = document.getElementById('preset-desc-de');
  const descEnEl = document.getElementById('preset-desc-en');
  const searchEl = document.getElementById('preset-search-enabled');
  const activeEl = document.getElementById('preset-is-active');
  const modelsWrap = document.getElementById('preset-models-list');
  const tiersWrap = document.getElementById('preset-tiers-list');

  if (idEl) { idEl.value = preset ? preset.id : ''; idEl.readOnly = Boolean(preset); }
  if (sortEl) sortEl.value = String(preset?.sort_order ?? 50);
  if (nameDeEl) nameDeEl.value = preset?.name_de || '';
  if (nameEnEl) nameEnEl.value = preset?.name_en || '';
  if (badgeDeEl) badgeDeEl.value = preset?.badge_de || '';
  if (badgeEnEl) badgeEnEl.value = preset?.badge_en || '';
  if (descDeEl) descDeEl.value = preset?.description_de || '';
  if (descEnEl) descEnEl.value = preset?.description_en || '';
  if (searchEl) searchEl.checked = preset ? Boolean(preset.search_enabled) : true;
  if (activeEl) activeEl.checked = preset ? (preset.is_active !== false) : true;

  const selectedLlms = new Set(preset?.target_llms || []);
  const availableModels = AdminState.models.length > 0 ? AdminState.models : [
    { id: 'google/gemini-4-hydrogen', display_name: 'Google · Gemini 4 Hydrogen' },
    { id: 'openai/gpt-6-luna', display_name: 'OpenAI · GPT-6 Luna' },
    { id: 'openai/gpt-6.1-terra', display_name: 'OpenAI · GPT-6.1 Terra' },
    { id: 'anthropic/claude-sonnet-5.5', display_name: 'Anthropic · Claude Sonnet 5.5' },
    { id: 'google/gemini-4-neon', display_name: 'Google · Gemini 4 Neon' },
    { id: 'openai/gpt-6.2-sol', display_name: 'OpenAI · GPT-6.2 Sol' },
    { id: 'anthropic/claude-opus-5.5', display_name: 'Anthropic · Claude Opus 5.5' },
    { id: 'mistralai/mistral-large-4-0', display_name: 'Mistral · Large 4.0' },
    { id: 'mistralai/mistral-medium-3-5', display_name: 'Mistral · Medium 3.5' },
    { id: 'meta/muse-spark-1.3', display_name: 'Meta · Muse Spark 1.3' },
    { id: 'meta/muse-ember', display_name: 'Meta · Muse Ember' },
    { id: 'x-ai/grok-4.7', display_name: 'xAI · Grok 4.7' },
    { id: 'deepseek/deepseek-v4.1-flash', display_name: 'DeepSeek · V4.1 Flash' },
    { id: 'minimax/minimax-m3.1-flash', display_name: 'MiniMax · M3.1 Flash' },
    { id: 'z-ai/glm-5.3-flash', display_name: 'Z.ai · GLM 5.3 Flash' },
    { id: 'qwen/qwen-3.8-flash', display_name: 'Qwen · 3.8 Flash' }
  ];
  if (modelsWrap) {
    modelsWrap.replaceChildren();
    availableModels.forEach((m) => {
      const lbl = document.createElement('label');
      lbl.className = 'form-checkbox-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'preset-model-cb';
      cb.value = m.id;
      cb.checked = selectedLlms.has(m.id);
      const sp = document.createElement('span');
      sp.textContent = m.display_name || m.id;
      lbl.append(cb, sp);
      modelsWrap.appendChild(lbl);
    });
  }

  const selectedTiers = new Set(preset?.allowed_tiers || ['starter', 'growth', 'enterprise_managed']);
  if (tiersWrap) {
    tiersWrap.replaceChildren();
    ['free', 'starter', 'growth', 'enterprise_managed'].forEach((tierKey) => {
      const lbl = document.createElement('label');
      lbl.className = 'form-checkbox-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'preset-tier-cb';
      cb.value = tierKey;
      cb.checked = selectedTiers.has(tierKey);
      const sp = document.createElement('span');
      sp.textContent = tierKey;
      lbl.append(cb, sp);
      tiersWrap.appendChild(lbl);
    });
  }

  if (modal) modal.style.display = 'flex';
}

function closePresetModal() {
  const modal = document.getElementById('preset-modal');
  if (modal) modal.style.display = 'none';
}

async function handleSavePreset(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('btn-preset-save');
  const selectedModels = Array.from(document.querySelectorAll('.preset-model-cb:checked')).map(c => c.value);
  const selectedTiers = Array.from(document.querySelectorAll('.preset-tier-cb:checked')).map(c => c.value);
  if (selectedModels.length === 0) {
    showToast('Bitte wählen Sie mindestens ein KI-Modell für das Analyse-Set.', 'error');
    return;
  }

  const payload = {
    id: document.getElementById('preset-id')?.value.trim(),
    sort_order: Number(document.getElementById('preset-sort-order')?.value || 50),
    name_de: document.getElementById('preset-name-de')?.value.trim(),
    name_en: document.getElementById('preset-name-en')?.value.trim(),
    badge_de: document.getElementById('preset-badge-de')?.value.trim(),
    badge_en: document.getElementById('preset-badge-en')?.value.trim(),
    description_de: document.getElementById('preset-desc-de')?.value.trim(),
    description_en: document.getElementById('preset-desc-en')?.value.trim(),
    target_llms: selectedModels,
    search_enabled: Boolean(document.getElementById('preset-search-enabled')?.checked),
    allowed_tiers: selectedTiers,
    is_active: Boolean(document.getElementById('preset-is-active')?.checked)
  };

  try {
    setAdminButtonLoading(saveBtn, true, 'Speichert...');
    const res = await fetch('api/admin_users.php?action=save_preset', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Analyse-Set konnte nicht gespeichert werden.', 'error');
      return;
    }
    AdminState.presets = json.data?.presets || AdminState.presets;
    renderPresetsGrid(AdminState.presets);
    closePresetModal();
    showToast('Analyse-Set erfolgreich gespeichert.', 'success');
  } catch (err) {
    console.error('handleSavePreset error:', err);
    showToast('Netzwerkfehler beim Speichern des Analyse-Sets.', 'error');
  } finally {
    setAdminButtonLoading(saveBtn, false);
  }
}

async function handleDeletePreset(preset) {
  if (!preset || !preset.id) return;
  try {
    const res = await fetch('api/admin_users.php?action=delete_preset', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ id: preset.id })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Analyse-Set konnte nicht gelöscht werden.', 'error');
      return;
    }
    AdminState.presets = json.data?.presets || [];
    renderPresetsGrid(AdminState.presets);
    showToast(`Analyse-Set '${preset.id}' gelöscht.`, 'success');
  } catch (err) {
    console.error('handleDeletePreset error:', err);
    showToast('Netzwerkfehler beim Löschen.', 'error');
  }
}

async function loadAdminPlans() {
  try {
    const res = await fetch('api/admin_users.php?action=list_plans', { headers: getAdminAuthHeaders() });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Tarif-Konfiguration konnte nicht geladen werden.', 'error');
      return;
    }
    AdminState.plans = json.data?.plans || [];
    AdminState.loadedTabs.plans = true;
    renderPlansEditor(AdminState.plans);
  } catch (err) {
    console.error('loadAdminPlans error:', err);
    showToast('Netzwerkfehler beim Laden der Tarife.', 'error');
  }
}

function renderPlansEditor(plans) {
  const grid = document.getElementById('plans-grid');
  if (!grid) return;
  grid.replaceChildren();
  const presetsList = AdminState.presets || [];

  const appendLabeledInput = (parent, labelText, fieldName, value, type = 'text') => {
    const grp = document.createElement('div');
    grp.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.className = 'form-label';
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'form-input';
    if (fieldName.startsWith('stripe_') || type === 'number') {
      inp.classList.add('font-mono');
    }
    inp.dataset.field = fieldName;
    inp.value = value !== undefined && value !== null ? String(value) : '';
    grp.append(lbl, inp);
    parent.appendChild(grp);
  };

  (plans || []).forEach((plan) => {
    const card = document.createElement('section');
    card.className = 'admin-plan-card';
    card.dataset.planEditor = plan.tier;

    const head = document.createElement('div');
    head.className = 'admin-plan-card-header';
    const title = document.createElement('h3');
    title.textContent = `${plan.name_de || plan.tier} (${plan.tier})`;
    const badge = document.createElement('span');
    badge.className = `badge badge-tier badge-${escapeHtml(plan.tier)}`;
    badge.textContent = plan.tier;
    head.append(title, badge);
    card.appendChild(head);

    const stripeGrid = document.createElement('div');
    stripeGrid.className = 'admin-form-grid-2';
    appendLabeledInput(stripeGrid, 'Stripe Product ID', 'stripe_product_id', plan.stripe_product_id || '');
    appendLabeledInput(stripeGrid, 'Stripe Price ID', 'stripe_price_id', plan.stripe_price_id || '');
    card.appendChild(stripeGrid);

    appendLabeledInput(card, 'Stripe Checkout / Payment Link URL (optional)', 'stripe_checkout_url', plan.stripe_checkout_url || '', 'url');

    const priceGrid = document.createElement('div');
    priceGrid.className = 'admin-form-grid-3';
    appendLabeledInput(priceGrid, 'Preis (€)', 'price_eur', plan.price_eur ?? 0, 'number');
    appendLabeledInput(priceGrid, 'Preisanzeige (DE)', 'price_label_de', plan.price_label_de || '');
    appendLabeledInput(priceGrid, 'Price Label (EN)', 'price_label_en', plan.price_label_en || '');
    card.appendChild(priceGrid);

    const quotaGrid = document.createElement('div');
    quotaGrid.className = 'admin-form-grid-2';
    appendLabeledInput(quotaGrid, 'Inklusiv-Credits / Monat', 'included_credits', plan.included_credits ?? 0, 'number');
    appendLabeledInput(quotaGrid, 'Max. Tracking-Profile', 'max_configs', plan.max_configs ?? 1, 'number');
    appendLabeledInput(quotaGrid, 'Max. Wettbewerber / Profil', 'max_competitors_per_config', plan.max_competitors_per_config ?? 2, 'number');
    appendLabeledInput(quotaGrid, 'Max. Prompts / Profil', 'max_prompts_per_config', plan.max_prompts_per_config ?? 5, 'number');
    card.appendChild(quotaGrid);

    // Allowed schedule intervals
    const ivGroup = document.createElement('div');
    ivGroup.className = 'form-group';
    const ivLabel = document.createElement('span');
    ivLabel.className = 'form-label';
    ivLabel.textContent = 'Erlaubte Mess-Frequenzen';
    const ivCheckRow = document.createElement('div');
    ivCheckRow.className = 'admin-checkbox-grid';
    const curIntervals = new Set(plan.allowed_intervals || ['every_120m']);
    ['every_120m', 'every_60m', 'every_30m', 'every_15m'].forEach((iv) => {
      const lbl = document.createElement('label');
      lbl.className = 'form-checkbox-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.field = 'allowed_intervals';
      cb.value = iv;
      cb.checked = curIntervals.has(iv);
      const sp = document.createElement('span');
      sp.className = 'font-mono';
      sp.textContent = iv;
      lbl.append(cb, sp);
      ivCheckRow.appendChild(lbl);
    });
    ivGroup.append(ivLabel, ivCheckRow);
    card.appendChild(ivGroup);

    // Custom models switch
    const customGrp = document.createElement('div');
    customGrp.className = 'form-group';
    const customLbl = document.createElement('label');
    customLbl.className = 'form-checkbox-row';
    const customCb = document.createElement('input');
    customCb.type = 'checkbox';
    customCb.dataset.field = 'allow_custom_models';
    customCb.checked = Boolean(plan.allow_custom_models);
    const customTxt = document.createElement('span');
    customTxt.textContent = 'Freie Einzelmodell- & Live-Websuche-Auswahl erlauben (sonst nur Analyse-Sets)';
    customLbl.append(customCb, customTxt);
    customGrp.appendChild(customLbl);
    card.appendChild(customGrp);

    // Allowed Analyse-Sets checkboxes
    if (presetsList.length > 0) {
      const prGroup = document.createElement('div');
      prGroup.className = 'form-group';
      const prLabel = document.createElement('span');
      prLabel.className = 'form-label';
      prLabel.textContent = 'Freigeschaltete Analyse-Sets';
      const prCheckRow = document.createElement('div');
      prCheckRow.className = 'admin-checkbox-grid';
      const curPresets = new Set(plan.allowed_preset_ids || []);
      presetsList.forEach((p) => {
        const lbl = document.createElement('label');
        lbl.className = 'form-checkbox-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.field = 'allowed_preset_ids';
        cb.value = p.id;
        cb.checked = curPresets.has(p.id);
        const sp = document.createElement('span');
        sp.textContent = p.name_de || p.id;
        lbl.append(cb, sp);
        prCheckRow.appendChild(lbl);
      });
      prGroup.append(prLabel, prCheckRow);
      card.appendChild(prGroup);
    }

    // Features DE & EN textareas
    const featGrid = document.createElement('div');
    featGrid.className = 'admin-form-grid-2';
    [
      { field: 'features_de', label: 'Leistungsmerkmale DE (1 pro Zeile)', list: plan.features_de || [] },
      { field: 'features_en', label: 'Feature Bullets EN (1 per line)', list: plan.features_en || [] }
    ].forEach(({ field, label, list }) => {
      const grp = document.createElement('div');
      grp.className = 'form-group';
      const lbl = document.createElement('label');
      lbl.className = 'form-label';
      lbl.textContent = label;
      const ta = document.createElement('textarea');
      ta.className = 'form-control';
      ta.rows = 4;
      ta.dataset.field = field;
      ta.value = Array.isArray(list) ? list.join('\n') : '';
      grp.append(lbl, ta);
      featGrid.appendChild(grp);
    });
    card.appendChild(featGrid);

    const actions = document.createElement('div');
    actions.className = 'admin-plan-card-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Tarif & Stripe-Mapping speichern';
    saveBtn.addEventListener('click', () => handleSavePlan(plan.tier, card, saveBtn));
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    grid.appendChild(card);
  });
}

async function handleSavePlan(tier, cardEl, saveBtn = null) {
  if (!cardEl) return;
  const val = (field) => cardEl.querySelector(`[data-field="${field}"]`)?.value ?? '';
  const checkedVals = (field) => Array.from(cardEl.querySelectorAll(`[data-field="${field}"]:checked`)).map(el => el.value);
  const splitLines = (text) => String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const payload = {
    tier,
    stripe_product_id: val('stripe_product_id').trim(),
    stripe_price_id: val('stripe_price_id').trim(),
    stripe_checkout_url: val('stripe_checkout_url').trim(),
    price_eur: Number(val('price_eur') || 0),
    price_label_de: val('price_label_de').trim(),
    price_label_en: val('price_label_en').trim(),
    included_credits: Number(val('included_credits') || 0),
    max_configs: Math.max(1, Number(val('max_configs') || 1)),
    max_competitors_per_config: Math.max(1, Number(val('max_competitors_per_config') || 1)),
    max_prompts_per_config: Math.max(1, Number(val('max_prompts_per_config') || 1)),
    allowed_intervals: checkedVals('allowed_intervals'),
    allow_custom_models: Boolean(cardEl.querySelector('[data-field="allow_custom_models"]')?.checked),
    allowed_preset_ids: checkedVals('allowed_preset_ids'),
    features_de: splitLines(val('features_de')),
    features_en: splitLines(val('features_en'))
  };

  try {
    setAdminButtonLoading(saveBtn, true, 'Speichert...');
    const res = await fetch('api/admin_users.php?action=save_plan', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Tarif konnte nicht gespeichert werden.', 'error');
      return;
    }
    AdminState.plans = json.data?.plans || AdminState.plans;
    AdminState.loadedTabs.presets = false;
    showToast(`Tarif '${tier}' & Stripe-Mapping gespeichert.`, 'success');
  } catch (err) {
    console.error('handleSavePlan error:', err);
    showToast('Netzwerkfehler beim Speichern des Tarifs.', 'error');
  } finally {
    setAdminButtonLoading(saveBtn, false);
  }
}

// -----------------------------------------------------------------------------
// 8. Auto-Bootstrap on DOMContentLoaded
// -----------------------------------------------------------------------------
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if on admin.html page
    if (document.getElementById('users-table')) {
      initAdminCockpit();
    }
  });
}

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 8.5 OpenRouter Provider Registry & Active Config Impact Warning Helpers
// -----------------------------------------------------------------------------
function populateProviderDraftFromList(providers) {
  const list = Array.isArray(providers) ? providers : [];
  AdminState.providerDraftSet = new Set(
    list.filter((p) => Boolean(p && p.is_relevant)).map((p) => String(p.provider_key || '').toLowerCase()).filter(Boolean)
  );
}

function getProviderDraftSelectedArray() {
  if (!(AdminState.providerDraftSet instanceof Set)) {
    return [];
  }
  return Array.from(AdminState.providerDraftSet).sort();
}

function computeDeselectedProviderImpact(selectedKeysSet = null) {
  const activeSet = selectedKeysSet instanceof Set
    ? selectedKeysSet
    : (AdminState.providerDraftSet instanceof Set ? AdminState.providerDraftSet : new Set());
  const affectedModels = [];

  (AdminState.providers || []).forEach((p) => {
    const key = String(p.provider_key || '').toLowerCase();
    if (!key || activeSet.has(key)) return;
    const usedModels = Array.isArray(p.used_models) ? p.used_models : [];
    usedModels.forEach((m) => {
      if (
        Number(m.active_config_count || 0) > 0
        || Number(m.paused_config_count || 0) > 0
        || Number(m.preset_count || 0) > 0
      ) {
        affectedModels.push(m);
      }
    });
  });

  return affectedModels;
}

function renderModelImpactCards(container, affectedModels) {
  if (!container) return;
  container.textContent = '';

  (affectedModels || []).forEach((m) => {
    const item = document.createElement('div');
    item.className = 'admin-impact-item';

    const head = document.createElement('div');
    head.className = 'admin-impact-item-head';

    const idSpan = document.createElement('strong');
    idSpan.className = 'font-mono';
    idSpan.textContent = m.model_id || m.id || '';

    const badgesWrap = document.createElement('div');
    badgesWrap.className = 'provider-usage-detail';

    const actCount = Number(m.active_config_count || 0);
    const pausedCount = Number(m.paused_config_count || 0);
    const presetCount = Number(m.preset_count || 0);

    if (actCount > 0) {
      const bAct = document.createElement('span');
      bAct.className = 'badge badge-warning';
      bAct.textContent = `${actCount} aktive Tracking-Profile`;
      badgesWrap.appendChild(bAct);
    }
    if (pausedCount > 0) {
      const bPau = document.createElement('span');
      bPau.className = 'badge badge-secondary';
      bPau.textContent = `${pausedCount} pausiert`;
      badgesWrap.appendChild(bPau);
    }
    if (presetCount > 0) {
      const bPre = document.createElement('span');
      bPre.className = 'badge badge-primary';
      bPre.textContent = `${presetCount} Analyse-Set(s)`;
      badgesWrap.appendChild(bPre);
    }

    head.append(idSpan, badgesWrap);
    item.appendChild(head);

    const samples = Array.isArray(m.config_samples) ? m.config_samples : [];
    if (samples.length > 0) {
      const cfgMeta = document.createElement('div');
      cfgMeta.className = 'admin-impact-item-meta';
      const names = samples.map((s) => `${s.name || ('#' + s.id)} (${s.status === 'active' ? 'aktiv' : 'pausiert'})`).join(', ');
      cfgMeta.textContent = `Tracking-Profile: ${names}${samples.length >= 10 ? ' …' : ''}`;
      item.appendChild(cfgMeta);
    }

    const presetNames = Array.isArray(m.preset_names) ? m.preset_names : [];
    if (presetNames.length > 0) {
      const preMeta = document.createElement('div');
      preMeta.className = 'admin-impact-item-meta';
      preMeta.textContent = `Analyse-Sets: ${presetNames.join(', ')}`;
      item.appendChild(preMeta);
    }

    container.appendChild(item);
  });
}

function renderProviderImpactWarning() {
  const providers = Array.isArray(AdminState.providers) ? AdminState.providers : [];
  const draftSet = AdminState.providerDraftSet instanceof Set ? AdminState.providerDraftSet : new Set();

  const totalBadge = document.getElementById('providers-stat-total');
  const relevantBadge = document.getElementById('providers-stat-relevant');
  const activeUsageBadge = document.getElementById('providers-stat-active-usage');
  const warningBox = document.getElementById('providers-impact-warning');
  const warningBody = document.getElementById('providers-impact-warning-body');

  if (totalBadge) totalBadge.textContent = `${providers.length} Provider`;
  if (relevantBadge) relevantBadge.textContent = `${draftSet.size} Relevant`;

  const affectedModels = computeDeselectedProviderImpact(draftSet);
  if (activeUsageBadge) {
    if (affectedModels.length > 0) {
      activeUsageBadge.hidden = false;
      activeUsageBadge.textContent = `${affectedModels.length} verwendete Modell(e) bei abgewählten Providern`;
    } else {
      activeUsageBadge.hidden = true;
    }
  }

  if (warningBox && warningBody) {
    if (affectedModels.length === 0) {
      warningBox.hidden = true;
      warningBody.textContent = '';
    } else {
      warningBox.hidden = false;
      warningBody.textContent = '';
      const intro = document.createElement('p');
      intro.style.margin = '0 0 8px 0';
      intro.textContent = 'Folgende Modelle abgewählter Provider werden noch in aktiven/pausierten Tracking-Profilen oder Analyse-Sets genutzt. Unbenutzte Modelle werden beim Speichern entfernt; bereits freigeschaltete/verwendete Modelle bleiben für bestehende Tracking-Profile geschützt, werden aber aus dem neuen Standard-Katalog gefiltert:';
      const listContainer = document.createElement('div');
      listContainer.className = 'admin-impact-list';
      renderModelImpactCards(listContainer, affectedModels);
      warningBody.append(intro, listContainer);
    }
  }
}

function openProviderImpactConfirmModal(summaryText, affectedModelsList, onConfirm, onCancel = null) {
  const modal = document.getElementById('provider-impact-modal');
  const summaryEl = document.getElementById('provider-impact-modal-summary');
  const listEl = document.getElementById('provider-impact-modal-list');

  if (!modal || !listEl) {
    if (typeof onConfirm === 'function') onConfirm();
    return;
  }

  AdminState.pendingImpactAction = typeof onConfirm === 'function' ? onConfirm : null;
  AdminState.pendingImpactCancel = typeof onCancel === 'function' ? onCancel : null;

  if (summaryEl) {
    summaryEl.textContent = summaryText || 'Betroffene Modelle mit aktiven Tracking-Profilen oder Analyse-Sets:';
  }
  renderModelImpactCards(listEl, affectedModelsList);
  modal.style.display = 'flex';
}

function closeProviderImpactModal(invokeCancel = false) {
  const modal = document.getElementById('provider-impact-modal');
  if (modal) modal.style.display = 'none';
  const cancelCb = AdminState.pendingImpactCancel;
  AdminState.pendingImpactAction = null;
  AdminState.pendingImpactCancel = null;
  if (invokeCancel && typeof cancelCb === 'function') {
    cancelCb();
  }
}

async function confirmProviderImpactModal() {
  const actionCb = AdminState.pendingImpactAction;
  AdminState.pendingImpactCancel = null;
  closeProviderImpactModal(false);
  if (typeof actionCb === 'function') {
    await actionCb();
  }
}

function renderOpenRouterProvidersTable(providers = []) {
  const tbody = document.getElementById('providers-tbody');
  const countBadge = document.getElementById('provider-filter-count');
  renderProviderImpactWarning();
  if (!tbody) return;

  const list = Array.isArray(providers) ? providers : [];
  const draftSet = AdminState.providerDraftSet instanceof Set ? AdminState.providerDraftSet : new Set();
  const q = String(AdminState.providerFilters?.search || '').trim().toLowerCase();
  const mode = String(AdminState.providerFilters?.mode || 'all');

  const filtered = list.filter((p) => {
    const key = String(p.provider_key || '').toLowerCase();
    const name = String(p.display_name || '').toLowerCase();
    const samples = Array.isArray(p.sample_models) ? p.sample_models.join(' ').toLowerCase() : '';
    const isRelDraft = draftSet.has(key);
    const hasUsage = Number(p.active_config_count || 0) > 0
      || Number(p.paused_config_count || 0) > 0
      || Number(p.preset_count || 0) > 0;

    if (mode === 'relevant' && !isRelDraft) return false;
    if (mode === 'default' && !p.is_default) return false;
    if (mode === 'used' && !hasUsage) return false;
    if (q && !key.includes(q) && !name.includes(q) && !samples.includes(q)) return false;
    return true;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} / ${list.length} Provider`;
  }

  tbody.textContent = '';
  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'text-muted';
    td.textContent = 'Keine passenden OpenRouter-Provider gefunden.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((p) => {
    const pKey = String(p.provider_key || '').toLowerCase();
    const isRelDraft = draftSet.has(pKey);
    const actCount = Number(p.active_config_count || 0);
    const pausedCount = Number(p.paused_config_count || 0);
    const presetCount = Number(p.preset_count || 0);
    const hasUsage = actCount > 0 || pausedCount > 0 || presetCount > 0;

    const tr = document.createElement('tr');
    if (!isRelDraft && hasUsage) {
      tr.className = 'provider-row-deselected-used';
    }

    // Col 1: Relevant switch
    const tdToggle = document.createElement('td');
    tdToggle.setAttribute('data-label', 'Relevant');
    const lbl = document.createElement('label');
    lbl.className = 'admin-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isRelDraft;
    checkbox.setAttribute('aria-label', `Provider ${pKey} relevant`);
    const spanTxt = document.createElement('span');
    spanTxt.className = 'admin-switch-label';
    spanTxt.textContent = isRelDraft ? 'AN' : 'AUS';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        AdminState.providerDraftSet.add(pKey);
      } else {
        AdminState.providerDraftSet.delete(pKey);
      }
      spanTxt.textContent = checkbox.checked ? 'AN' : 'AUS';
      tr.classList.toggle('provider-row-deselected-used', !checkbox.checked && hasUsage);
      renderProviderImpactWarning();
    });
    lbl.append(checkbox, spanTxt);
    tdToggle.appendChild(lbl);
    tr.appendChild(tdToggle);

    // Col 2: Display Name + Namespace + Default Badge
    const tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Provider & Namespace');
    const titleWrap = document.createElement('div');
    const strongName = document.createElement('strong');
    strongName.textContent = p.display_name || pKey;
    titleWrap.appendChild(strongName);
    if (p.is_default) {
      const defBadge = document.createElement('span');
      defBadge.className = 'badge badge-secondary';
      defBadge.style.marginLeft = '6px';
      defBadge.textContent = 'Default';
      titleWrap.appendChild(defBadge);
    }
    const nsLine = document.createElement('div');
    nsLine.className = 'font-mono text-muted';
    nsLine.style.fontSize = '0.78rem';
    nsLine.textContent = pKey;
    tdName.append(titleWrap, nsLine);
    tr.appendChild(tdName);

    // Col 3: Model counts
    const tdCounts = document.createElement('td');
    tdCounts.setAttribute('data-label', 'Modelle');
    const discovered = Number(p.discovered_model_count || 0);
    const catalogCnt = Number(p.catalog_model_count || 0);
    const allowedCnt = Number(p.allowed_model_count || 0);
    const countTop = document.createElement('div');
    countTop.className = 'font-mono';
    countTop.textContent = `${discovered} OpenRouter`;
    const countSub = document.createElement('div');
    countSub.className = 'text-muted';
    countSub.style.fontSize = '0.78rem';
    countSub.textContent = `${catalogCnt} im Katalog (${allowedCnt} frei)`;
    tdCounts.append(countTop, countSub);
    tr.appendChild(tdCounts);

    // Col 4: Sample models
    const tdSamples = document.createElement('td');
    tdSamples.setAttribute('data-label', 'Beispielmodelle');
    const sampleWrap = document.createElement('div');
    sampleWrap.className = 'provider-sample-chips';
    const samples = Array.isArray(p.sample_models) ? p.sample_models.slice(0, 4) : [];
    if (samples.length === 0) {
      const emptyTxt = document.createElement('span');
      emptyTxt.className = 'text-muted';
      emptyTxt.style.fontSize = '0.78rem';
      emptyTxt.textContent = 'Noch nicht gesynct';
      sampleWrap.appendChild(emptyTxt);
    } else {
      samples.forEach((sId) => {
        const chip = document.createElement('span');
        chip.className = 'badge badge-secondary font-mono';
        chip.textContent = sId;
        sampleWrap.appendChild(chip);
      });
    }
    tdSamples.appendChild(sampleWrap);
    tr.appendChild(tdSamples);

    // Col 5: Active customer configs & Analyse-Sets usage
    const tdUsage = document.createElement('td');
    tdUsage.setAttribute('data-label', 'Aktive Profile & Sets');
    if (!hasUsage) {
      const noneTxt = document.createElement('span');
      noneTxt.className = 'text-muted';
      noneTxt.style.fontSize = '0.78rem';
      noneTxt.textContent = 'Keine aktiven Tracking-Profile';
      tdUsage.appendChild(noneTxt);
    } else {
      const badgeRow = document.createElement('div');
      badgeRow.className = 'provider-usage-detail';
      if (actCount > 0) {
        const bA = document.createElement('span');
        bA.className = 'badge badge-warning';
        bA.textContent = `${actCount} aktive Tracking-Profile`;
        badgeRow.appendChild(bA);
      }
      if (pausedCount > 0) {
        const bP = document.createElement('span');
        bP.className = 'badge badge-secondary';
        bP.textContent = `${pausedCount} pausiert`;
        badgeRow.appendChild(bP);
      }
      if (presetCount > 0) {
        const bS = document.createElement('span');
        bS.className = 'badge badge-primary';
        bS.textContent = `${presetCount} Analyse-Set(s)`;
        badgeRow.appendChild(bS);
      }
      tdUsage.appendChild(badgeRow);

      const usedModels = Array.isArray(p.used_models) ? p.used_models : [];
      if (usedModels.length > 0) {
        const detailLine = document.createElement('div');
        detailLine.className = 'admin-impact-item-meta';
        detailLine.style.marginTop = '4px';
        detailLine.textContent = usedModels.slice(0, 3).map((um) => {
          const cfgs = Array.isArray(um.config_samples) && um.config_samples.length > 0
            ? ` [${um.config_samples.slice(0, 2).map((c) => c.name).join(', ')}]`
            : '';
          return `${um.model_id}${cfgs}`;
        }).join(' · ');
        tdUsage.appendChild(detailLine);
      }
    }
    tr.appendChild(tdUsage);

    tbody.appendChild(tr);
  });
}

async function loadOpenRouterProviders() {
  const statusBadge = document.getElementById('providers-sync-status-badge');
  try {
    const res = await fetch('api/admin_users.php?action=list_openrouter_providers', {
      headers: getAdminAuthHeaders()
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'OpenRouter-Provider konnten nicht geladen werden.', 'error');
      return;
    }
    AdminState.providers = json.data?.providers || [];
    AdminState.defaultProviders = json.data?.default_providers || [];
    populateProviderDraftFromList(AdminState.providers);
    AdminState.loadedTabs.providers = true;
    renderOpenRouterProvidersTable(AdminState.providers);
    if (statusBadge) {
      statusBadge.className = 'badge badge-secondary';
      statusBadge.textContent = `${AdminState.providerDraftSet.size} / ${AdminState.providers.length} aktiv`;
    }
  } catch (err) {
    console.error('loadOpenRouterProviders error:', err);
    showToast('Netzwerkfehler beim Laden der OpenRouter-Provider.', 'error');
  }
}

async function syncOpenRouterProviders() {
  const btn = document.getElementById('btn-sync-providers');
  const statusBadge = document.getElementById('providers-sync-status-badge');
  try {
    setAdminButtonLoading(btn, true, 'Lade alle OpenRouter-Provider...');
    const res = await fetch('api/admin_users.php?action=sync_openrouter_providers', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Provider-Discovery fehlgeschlagen.', 'error');
      return;
    }
    AdminState.providers = json.data?.providers || [];
    AdminState.defaultProviders = json.data?.default_providers || AdminState.defaultProviders;
    populateProviderDraftFromList(AdminState.providers);
    AdminState.loadedTabs.providers = true;
    renderOpenRouterProvidersTable(AdminState.providers);
    if (statusBadge) {
      statusBadge.className = json.data?.synced ? 'badge badge-active' : 'badge badge-warning';
      statusBadge.textContent = json.data?.synced
        ? `Live-Sync OK (${json.data.source})`
        : 'Lokaler Fallback';
    }
    showToast(json.data?.message || 'OpenRouter-Provider aktualisiert.', json.data?.synced ? 'success' : 'info');
  } catch (err) {
    console.error('syncOpenRouterProviders error:', err);
    showToast('Netzwerkfehler beim Provider-Sync.', 'error');
  } finally {
    setAdminButtonLoading(btn, false);
  }
}

async function executeSaveOpenRouterProviders(selectedArray, syncModelsAfter = false) {
  const btn = document.getElementById(syncModelsAfter ? 'btn-save-sync-providers' : 'btn-save-providers');
  try {
    setAdminButtonLoading(btn, true, syncModelsAfter ? 'Speichere & synce...' : 'Speichere Set...');
    const res = await fetch('api/admin_users.php?action=save_openrouter_providers', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ providers: selectedArray })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Provider-Auswahl konnte nicht gespeichert werden.', 'error');
      return;
    }
    AdminState.providers = json.data?.providers || AdminState.providers;
    AdminState.defaultProviders = json.data?.default_providers || AdminState.defaultProviders;
    populateProviderDraftFromList(AdminState.providers);
    AdminState.loadedTabs.providers = true;
    renderOpenRouterProvidersTable(AdminState.providers);

    if (Array.isArray(json.data?.models)) {
      AdminState.models = json.data.models;
      AdminState.loadedTabs.models = true;
      renderModelsTable(AdminState.models);
    }

    const prunedCount = Array.isArray(json.data?.pruned_model_ids) ? json.data.pruned_model_ids.length : 0;
    const preservedCount = Array.isArray(json.data?.preserved_active_models) ? json.data.preserved_active_models.length : 0;
    let infoMsg = json.data?.message || 'Relevante OpenRouter-Provider gespeichert.';
    if (prunedCount > 0 || preservedCount > 0) {
      infoMsg += ` (${prunedCount} unbenutzte Modelle bereinigt, ${preservedCount} aktive/verwendete geschützt)`;
    }
    showToast(infoMsg, 'success');

    if (syncModelsAfter) {
      await triggerN8nModelSync();
    }
  } catch (err) {
    console.error('executeSaveOpenRouterProviders error:', err);
    showToast('Netzwerkfehler beim Speichern der Provider-Auswahl.', 'error');
  } finally {
    setAdminButtonLoading(btn, false);
  }
}

async function handleSaveOpenRouterProviders(syncModelsAfter = false) {
  const selected = getProviderDraftSelectedArray();
  const affectedModels = computeDeselectedProviderImpact(new Set(selected));

  if (affectedModels.length > 0 && document.getElementById('provider-impact-modal')) {
    openProviderImpactConfirmModal(
      'Mindestens ein abgewählter Provider enthält noch Modelle mit aktiven/pausierten Tracking-Profilen oder Analyse-Sets. Laufende Tracking-Profile bleiben durch DB-Schutz erhalten, die Provider werden jedoch aus künftigen Syncs und dem aktiven Katalog ausgeschlossen:',
      affectedModels,
      () => executeSaveOpenRouterProviders(selected, syncModelsAfter)
    );
    return;
  }

  await executeSaveOpenRouterProviders(selected, syncModelsAfter);
}

async function executeResetOpenRouterProviders() {
  const btn = document.getElementById('btn-reset-providers');
  try {
    setAdminButtonLoading(btn, true, 'Setze auf Default zurück...');
    const res = await fetch('api/admin_users.php?action=reset_openrouter_providers', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Default-Wiederherstellung fehlgeschlagen.', 'error');
      return;
    }
    AdminState.providers = json.data?.providers || [];
    AdminState.defaultProviders = json.data?.default_providers || AdminState.defaultProviders;
    populateProviderDraftFromList(AdminState.providers);
    AdminState.loadedTabs.providers = true;
    renderOpenRouterProvidersTable(AdminState.providers);

    if (Array.isArray(json.data?.models)) {
      AdminState.models = json.data.models;
      AdminState.loadedTabs.models = true;
      renderModelsTable(AdminState.models);
    }
    showToast(json.data?.message || 'Standard-Provider wiederhergestellt (inkl. meta).', 'success');
  } catch (err) {
    console.error('executeResetOpenRouterProviders error:', err);
    showToast('Netzwerkfehler beim Zurücksetzen der Provider.', 'error');
  } finally {
    setAdminButtonLoading(btn, false);
  }
}

async function handleResetOpenRouterProviders() {
  const defaultKeys = Array.isArray(AdminState.defaultProviders) && AdminState.defaultProviders.length > 0
    ? AdminState.defaultProviders
    : (AdminState.providers || []).filter((p) => p.is_default).map((p) => p.provider_key);
  const affectedModels = computeDeselectedProviderImpact(new Set(defaultKeys.map((k) => String(k).toLowerCase())));

  if (affectedModels.length > 0 && document.getElementById('provider-impact-modal')) {
    openProviderImpactConfirmModal(
      'Beim Zurücksetzen auf die Standard-Provider werden benutzerdefinierte Provider abgewählt, deren Modelle noch aktive/pausierte Tracking-Profile oder Analyse-Sets haben:',
      affectedModels,
      () => executeResetOpenRouterProviders()
    );
    return;
  }

  await executeResetOpenRouterProviders();
}

// -----------------------------------------------------------------------------
// 8b. Model Lifecycle Alerts (Predecessor/Successor & EOL Watcher UI)
// -----------------------------------------------------------------------------

async function loadModelLifecycleAlerts() {
  try {
    const res = await fetch('api/admin_users.php?action=list_model_alerts', {
      headers: getAdminAuthHeaders()
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      return [];
    }
    const d = json.data || {};
    AdminState.modelAlerts = Array.isArray(d.alerts) ? d.alerts : [];
    AdminState.modelAlertsMeta = {
      open_count: Number(d.open_count ?? AdminState.modelAlerts.filter((a) => a.status === 'open').length),
      critical_count: Number(d.critical_count ?? 0),
      successor_count: Number(d.successor_count ?? 0),
      eol_count: Number(d.eol_count ?? 0)
    };
    renderModelAlertsBanner();
    renderModelAlertsPanel();
    return AdminState.modelAlerts;
  } catch (err) {
    console.error('loadModelLifecycleAlerts error:', err);
    return [];
  }
}

function renderModelAlertsBanner() {
  const banner = document.getElementById('admin-model-alerts-banner');
  const summaryEl = document.getElementById('admin-alerts-banner-summary');
  const tabBadge = document.getElementById('admin-tab-models-alert-badge');
  const openAlerts = (AdminState.modelAlerts || []).filter((a) => a && a.status === 'open');
  const openCount = openAlerts.length;

  if (tabBadge) {
    tabBadge.textContent = String(openCount);
    tabBadge.hidden = openCount === 0;
  }

  if (!banner) return;
  if (openCount === 0) {
    banner.hidden = true;
    return;
  }

  const lang = getAdminLanguage();
  const eolCount = openAlerts.filter((a) => a.alert_type !== 'successor_available').length;
  const succCount = openAlerts.filter((a) => a.alert_type === 'successor_available').length;
  const hasCritical = openAlerts.some((a) => a.severity === 'critical' || a.alert_type !== 'successor_available');

  if (banner.classList) {
    if (hasCritical) banner.classList.add('is-critical');
    else banner.classList.remove('is-critical');
  }

  if (summaryEl) {
    const parts = [];
    if (eolCount > 0) parts.push(lang === 'en' ? `${eolCount} EOL / missing` : `${eolCount} EOL / fehlt`);
    if (succCount > 0) parts.push(lang === 'en' ? `${succCount} successor(s) available` : `${succCount} Nachfolger verfügbar`);
    summaryEl.textContent = lang === 'en'
      ? `${openCount} open model alert(s): ${parts.join(' · ')}`
      : (openCount === 1
        ? `1 offener Modell-Hinweis: ${parts.join(' · ')}`
        : `${openCount} offene Modell-Hinweise: ${parts.join(' · ')}`);
  }

  banner.hidden = false;
}

function renderModelAlertsPanel() {
  const panel = document.getElementById('admin-model-alerts-panel');
  const list = document.getElementById('admin-model-alerts-list');
  const countBadge = document.getElementById('admin-model-alerts-count');
  if (!panel || !list) return;

  const openAlerts = (AdminState.modelAlerts || []).filter((a) => a && a.status === 'open');
  const lang = getAdminLanguage();

  if (countBadge) {
    countBadge.textContent = lang === 'en' ? `${openAlerts.length} open` : `${openAlerts.length} offen`;
  }

  list.textContent = '';
  if (openAlerts.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  openAlerts.forEach((alert) => {
    const card = document.createElement('article');
    const sev = alert.severity === 'critical' ? 'critical' : (alert.severity === 'warning' ? 'warning' : 'info');
    card.className = `admin-alert-card is-${sev}`;
    card.setAttribute('data-alert-id', String(alert.id || ''));

    const head = document.createElement('div');
    head.className = 'admin-alert-card-head';

    const typeBadge = document.createElement('span');
    typeBadge.className = `badge ${sev === 'critical' ? 'badge-danger' : (sev === 'warning' ? 'badge-warning' : 'badge-active')}`;
    if (alert.alert_type === 'model_missing_openrouter') {
      typeBadge.textContent = lang === 'en' ? 'Missing on OpenRouter' : 'Fehlt auf OpenRouter';
    } else if (alert.alert_type === 'model_eol') {
      typeBadge.textContent = lang === 'en' ? 'End-of-Life Notice' : 'End-of-Life Hinweis';
    } else {
      typeBadge.textContent = lang === 'en' ? 'Successor Available' : 'Nachfolger verfügbar';
    }

    const confBadge = document.createElement('span');
    confBadge.className = 'badge badge-secondary font-mono';
    confBadge.textContent = `${Number(alert.confidence_score || 0)}% Konfidenz`;
    if (lang === 'en') confBadge.textContent = `${Number(alert.confidence_score || 0)}% confidence`;

    head.appendChild(typeBadge);
    head.appendChild(confBadge);

    const transition = document.createElement('div');
    transition.className = 'admin-alert-model-transition font-mono';
    const curCode = document.createElement('code');
    curCode.className = 'admin-alert-model-old';
    curCode.textContent = alert.current_model_id || '—';
    transition.appendChild(curCode);

    if (alert.suggested_model_id) {
      const arrow = document.createElement('span');
      arrow.className = 'admin-alert-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      const nextCode = document.createElement('code');
      nextCode.className = 'admin-alert-model-new';
      nextCode.textContent = alert.suggested_model_id;
      transition.appendChild(arrow);
      transition.appendChild(nextCode);
    }

    const reason = document.createElement('p');
    reason.className = 'admin-alert-reason';
    reason.textContent = (lang === 'en' ? (alert.reason_en || alert.reason_de) : (alert.reason_de || alert.reason_en)) || '—';

    if (alert.source_url && /^https?:\/\//i.test(String(alert.source_url))) {
      const link = document.createElement('a');
      link.href = String(alert.source_url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'admin-alert-source-link';
      link.textContent = lang === 'en' ? 'Provider notice ↗' : 'Anbieter-Quelle ↗';
      reason.appendChild(document.createTextNode(' '));
      reason.appendChild(link);
    }

    const meta = document.createElement('div');
    meta.className = 'admin-alert-meta';
    const presets = Array.isArray(alert.affected_presets) ? alert.affected_presets : [];
    if (presets.length > 0) {
      const pLabel = document.createElement('span');
      pLabel.className = 'text-xs text-muted';
      pLabel.textContent = lang === 'en' ? 'Affected presets:' : 'Betroffene Sets:';
      meta.appendChild(pLabel);
      presets.forEach((pName) => {
        const pill = document.createElement('span');
        pill.className = 'badge badge-outline';
        pill.textContent = String(pName);
        meta.appendChild(pill);
      });
    }
    const cfgCount = Number(alert.affected_configs_count || 0);
    const cfgPill = document.createElement('span');
    cfgPill.className = 'badge badge-secondary font-mono';
    cfgPill.textContent = lang === 'en'
      ? `${cfgCount} active profile(s)`
      : `${cfgCount} aktive Tracking-Profile`;
    meta.appendChild(cfgPill);

    const actions = document.createElement('div');
    actions.className = 'admin-alert-card-actions';

    if (alert.suggested_model_id) {
      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'btn btn-xs btn-primary';
      replaceBtn.textContent = lang === 'en' ? 'Replace in Presets' : 'In Analyse-Sets ersetzen';
      replaceBtn.addEventListener('click', () => handleResolveModelAlert(alert.id, 'replace_in_presets', replaceBtn));
      actions.appendChild(replaceBtn);

      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'btn btn-xs btn-outline';
      enableBtn.textContent = lang === 'en' ? 'Enable Model Only' : 'Modell freigeben';
      enableBtn.addEventListener('click', () => handleResolveModelAlert(alert.id, 'enable_model_only', enableBtn));
      actions.appendChild(enableBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-xs btn-outline';
    dismissBtn.textContent = lang === 'en' ? 'Dismiss' : 'Ignorieren';
    dismissBtn.addEventListener('click', () => handleResolveModelAlert(alert.id, 'dismiss', dismissBtn));
    actions.appendChild(dismissBtn);

    card.appendChild(head);
    card.appendChild(transition);
    card.appendChild(reason);
    card.appendChild(meta);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

async function triggerModelWatcherRun() {
  if (AdminState.isRunningModelWatcher) return;
  AdminState.isRunningModelWatcher = true;
  const btn = document.getElementById('btn-run-model-watcher');
  try {
    setAdminButtonLoading(btn, true, 'Prüfe Modelle…');
    const res = await fetch('api/admin_users.php?action=trigger_model_watcher', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler bei der Modell-Überwachung.', 'error');
      return;
    }
    const d = json.data || {};
    if (Array.isArray(d.alerts)) {
      AdminState.modelAlerts = d.alerts;
      renderModelAlertsBanner();
      renderModelAlertsPanel();
    } else {
      await loadModelLifecycleAlerts();
    }
    showToast(d.message || 'Modell-Überwachung abgeschlossen.', d.triggered ? 'success' : 'info');
  } catch (err) {
    console.error('triggerModelWatcherRun error:', err);
    showToast('Netzwerkfehler bei der Modell-Überwachung.', 'error');
  } finally {
    AdminState.isRunningModelWatcher = false;
    setAdminButtonLoading(btn, false);
  }
}

async function handleResolveModelAlert(alertId, resolution, triggerBtn = null) {
  if (!alertId || !resolution) return;
  try {
    setAdminButtonLoading(triggerBtn, true, 'Übernehme…');
    const res = await fetch('api/admin_users.php?action=resolve_model_alert', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ id: Number(alertId), resolution })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Aktion konnte nicht ausgeführt werden.', 'error');
      return;
    }
    const d = json.data || {};
    if (Array.isArray(d.alerts)) {
      AdminState.modelAlerts = d.alerts;
      renderModelAlertsBanner();
      renderModelAlertsPanel();
    }
    if (Array.isArray(d.models)) {
      AdminState.models = d.models;
      AdminState.loadedTabs.models = true;
      renderModelsTable(AdminState.models);
    }
    if (Array.isArray(d.presets)) {
      AdminState.presets = d.presets;
      AdminState.loadedTabs.presets = true;
      renderPresetsGrid(AdminState.presets);
    }
    showToast(d.message || 'Modell-Hinweis aktualisiert.', 'success');
  } catch (err) {
    console.error('handleResolveModelAlert error:', err);
    showToast('Netzwerkfehler beim Aktualisieren des Hinweises.', 'error');
  } finally {
    setAdminButtonLoading(triggerBtn, false);
  }
}

// -----------------------------------------------------------------------------
// 9. Universal Module Exports (Node.js Test Runner & Browser Global)
// -----------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.ChatlyticsAdmin = {
    buildCreditPayload,
    escapeHtml,
    sanitizeLength,
    initAdminCockpit,
    loadAdminUsers,
    openCreditModal,
    closeCreditModal,
    handleCreditSubmit,
    generateAndOpenMagicAudit,
    copyMagicAuditUrl,
    openRunTokenModal,
    closeRunTokenModal,
    renderRunTokenInspector,
    triggerDemoSeeder,
    switchAdminTab,
    handlePauseAllUserConfigs,
    handleToggleUserStatus,
    openTierModal,
    closeTierModal,
    handleTierSubmit,
    loadAdminModels,
    triggerN8nModelSync,
    handleToggleModelField,
    openModelModal,
    closeModelModal,
    handleSaveModel,
    loadAdminPresets,
    openPresetModal,
    closePresetModal,
    handleSavePreset,
    handleDeletePreset,
    loadAdminPlans,
    handleSavePlan,
    loadOpenRouterProviders,
    syncOpenRouterProviders,
    renderOpenRouterProvidersTable,
    computeDeselectedProviderImpact,
    renderProviderImpactWarning,
    openProviderImpactConfirmModal,
    closeProviderImpactModal,
    confirmProviderImpactModal,
    handleSaveOpenRouterProviders,
    handleResetOpenRouterProviders,
    loadModelLifecycleAlerts,
    renderModelAlertsBanner,
    renderModelAlertsPanel,
    triggerModelWatcherRun,
    handleResolveModelAlert
  };
  window.buildCreditPayload = buildCreditPayload;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCreditPayload,
    escapeHtml,
    sanitizeLength,
    openRunTokenModal,
    closeRunTokenModal,
    renderRunTokenInspector,
    switchAdminTab,
    handlePauseAllUserConfigs,
    handleToggleUserStatus,
    openTierModal,
    closeTierModal,
    handleTierSubmit,
    loadAdminModels,
    triggerN8nModelSync,
    handleToggleModelField,
    openModelModal,
    closeModelModal,
    handleSaveModel,
    loadAdminPresets,
    openPresetModal,
    closePresetModal,
    handleSavePreset,
    handleDeletePreset,
    loadAdminPlans,
    handleSavePlan,
    loadOpenRouterProviders,
    syncOpenRouterProviders,
    renderOpenRouterProvidersTable,
    computeDeselectedProviderImpact,
    renderProviderImpactWarning,
    openProviderImpactConfirmModal,
    closeProviderImpactModal,
    confirmProviderImpactModal,
    handleSaveOpenRouterProviders,
    handleResetOpenRouterProviders,
    loadModelLifecycleAlerts,
    renderModelAlertsBanner,
    renderModelAlertsPanel,
    triggerModelWatcherRun,
    handleResolveModelAlert,
    AdminState
  };
}