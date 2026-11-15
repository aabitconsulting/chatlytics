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
  providerCredentials: [],
  presets: [],
  plans: [],
  loadedTabs: { users: false, models: false, presets: false, plans: false },
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

  // 2. Bind Event Listeners
  bindAdminEvents();

  // 3. Initial Load of Users and Telemetry
  await loadAdminUsers(1, '');
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

  // Global Keyboard Navigation (Escape closes active modal)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCreditModal();
      closeMagicAuditModal();
      closeRunTokenModal();
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
      showToast(json.message || 'Fehler beim Laden der Benutzer.', 'error');
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
    showToast('Netzwerkfehler beim Laden der Benutzerliste.', 'error');
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
    compEl.textContent = sanitizeLength(u.company_name || '?', 40);
    userStack.append(emailEl, compEl);
    tdUser.appendChild(userStack);
    tr.appendChild(tdUser);

    // 3. Member Since
    const tdCreated = document.createElement('td');
    tdCreated.setAttribute('data-label', 'Mitglied seit');
    tdCreated.className = 'cell-date text-muted font-mono';
    tdCreated.textContent = (u.created_at || '').substring(0, 10) || '?';
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
    tdCreditsRuns.setAttribute('data-label', 'Credits / Runs');
    tdCreditsRuns.className = 'font-mono';
    const credLine = document.createElement('div');
    credLine.className = 'text-bold';
    credLine.textContent = `${Number(u.credits_remaining || 0).toLocaleString()} Cr`;
    const runLine = document.createElement('div');
    runLine.className = 'text-muted';
    runLine.style.fontSize = '0.75rem';
    runLine.textContent = `${Number(u.run_count || 0).toLocaleString()} Runs`;
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
    tdTokPerRun.setAttribute('data-label', '? Tokens / Run');
    tdTokPerRun.className = 'font-mono text-muted';
    tdTokPerRun.textContent = Number(u.avg_tokens_per_run || 0).toLocaleString();
    tr.appendChild(tdTokPerRun);

    // 9. Avg Tokens / Profile
    const tdTokPerCfg = document.createElement('td');
    tdTokPerCfg.setAttribute('data-label', '? Tokens / Profil');
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

    // 11. Quick Actions
    const tdActions = document.createElement('td');
    tdActions.setAttribute('data-label', 'Aktionen');
    tdActions.className = 'text-right table-actions admin-quick-actions';

    const btnPauseAll = document.createElement('button');
    btnPauseAll.type = 'button';
    btnPauseAll.className = 'btn btn-xs btn-outline';
    btnPauseAll.textContent = 'Alle pausieren';
    btnPauseAll.disabled = activeCfg === 0;
    btnPauseAll.addEventListener('click', () => handlePauseAllUserConfigs(u, btnPauseAll));

    const isSuspended = String(u.status || 'active') === 'suspended';
    const isSelfAdmin = AdminState.currentUser && Number(AdminState.currentUser.id) === Number(u.id);
    const btnSuspend = document.createElement('button');
    btnSuspend.type = 'button';
    btnSuspend.className = `btn btn-xs ${isSuspended ? 'btn-secondary' : 'btn-outline-danger'}`;
    btnSuspend.textContent = isSuspended ? 'Entsperren' : 'Sperren';
    btnSuspend.disabled = Boolean(isSelfAdmin && !isSuspended);
    btnSuspend.addEventListener('click', () => handleToggleUserStatus(u, btnSuspend));

    const btnTier = document.createElement('button');
    btnTier.type = 'button';
    btnTier.className = 'btn btn-xs btn-outline';
    btnTier.textContent = 'Tarif';
    btnTier.addEventListener('click', () => openTierModal(u));

    const btnTokens = document.createElement('button');
    btnTokens.type = 'button';
    btnTokens.className = 'btn btn-xs btn-outline';
    btnTokens.textContent = 'Runs & Tokens';
    btnTokens.addEventListener('click', () => openRunTokenModal(u));

    const btnCredit = document.createElement('button');
    btnCredit.type = 'button';
    btnCredit.className = 'btn btn-xs btn-outline';
    btnCredit.textContent = 'Credits';
    btnCredit.addEventListener('click', () => openCreditModal(u));

    const btnMagic = document.createElement('button');
    btnMagic.type = 'button';
    btnMagic.className = 'btn btn-xs btn-secondary';
    btnMagic.textContent = 'Vorstands-Link';
    btnMagic.addEventListener('click', () => generateAndOpenMagicAudit(u.id));

    tdActions.append(btnPauseAll, btnSuspend, btnTier, btnCredit, btnTokens, btnMagic);
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

  if (countBadge) countBadge.textContent = `${total} Benutzer`;
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
      showToast(json.message || 'Fehler beim Generieren des Vorstandsreport-Links.', 'error');
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
    showToast('Netzwerkfehler beim Erzeugen des Vorstandsreport-Links.', 'error');
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
    td.textContent = 'Keine Runs für diesen Benutzer vorhanden.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  results.forEach((r) => {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.className = 'font-mono text-muted';
    tdDate.textContent = (r.created_at || '').substring(0, 16);
    tr.appendChild(tdDate);

    const tdCfg = document.createElement('td');
    const cfgName = document.createElement('div');
    cfgName.textContent = sanitizeLength(r.config_name || (r.config_id ? `Config #${r.config_id}` : '—'), 32);
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
    tdModel.textContent = `${r.provider || ''}/${r.model || ''} (${r.execution_strategy || 'prompt_caching'})`;
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

    tbody.appendChild(tr);
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
    showToast('Vorstandsreport-Link in die Zwischenablage kopiert!', 'success');
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
      `Demodaten erfolgreich generiert: ${seeded_accounts.join(', ')} (${runs_created} Runs, ${configs_created} Konfigurationen).`,
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

  // Model Management Controls & Modal
  document.getElementById('btn-sync-n8n-models')?.addEventListener('click', () => triggerN8nModelSync());
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
    }
  });
}

async function switchAdminTab(tabKey) {
  const validTabs = ['users', 'models', 'presets', 'plans'];
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

  if (nextTab === 'models' && !AdminState.loadedTabs.models) {
    await loadAdminModels();
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
    setButtonLoading(triggerBtn, true, 'Pausiere...');
    const res = await fetch('api/admin_users.php?action=pause_all_configs', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ user_id: Number(user.id) })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') {
      showToast(json.message || 'Fehler beim Pausieren der Profile.', 'error');
      return;
    }
    const pausedCount = Number(json.data?.paused_count ?? 0);
    showToast(`${pausedCount} aktive(s) Profil(e) für ${user.email} pausiert.`, 'success');
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);
  } catch (err) {
    console.error('handlePauseAllUserConfigs error:', err);
    showToast('Netzwerkfehler beim Pausieren.', 'error');
  } finally {
    setButtonLoading(triggerBtn, false);
  }
}

async function handleToggleUserStatus(user, triggerBtn = null) {
  if (!user || !user.id) return;
  const nextStatus = String(user.status || 'active') === 'suspended' ? 'active' : 'suspended';
  try {
    setButtonLoading(triggerBtn, true, 'Aktualisiere...');
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
        ? `Benutzer ${user.email} wurde gesperrt und aktive Profile pausiert.`
        : `Benutzer ${user.email} wurde wieder entsperrt.`,
      'success'
    );
    await loadAdminUsers(AdminState.pagination.page, AdminState.searchQuery);
  } catch (err) {
    console.error('handleToggleUserStatus error:', err);
    showToast('Netzwerkfehler bei Status-Änderung.', 'error');
  } finally {
    setButtonLoading(triggerBtn, false);
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
    setButtonLoading(submitBtn, true, 'Speichert...');
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
    setButtonLoading(submitBtn, false);
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
    name.textContent = String(cred.provider || '').toUpperCase();
    const badge = document.createElement('span');
    const isLive = cred.status === 'connected';
    badge.className = `badge ${isLive ? 'badge-active' : 'badge-secondary'}`;
    badge.textContent = cred.status || 'seeded';
    header.append(name, badge);

    const credName = document.createElement('div');
    credName.className = 'provider-cred-name font-mono text-muted';
    credName.textContent = cred.credential_name || '—';

    const countEl = document.createElement('div');
    countEl.className = 'provider-cred-count';
    countEl.textContent = `${Number(cred.model_count || 0)} Modell(e)`;

    card.append(header, credName, countEl);
    grid.appendChild(card);
  });
}

function renderModelsTable(models) {
  const tbody = document.getElementById('models-tbody');
  if (!tbody) return;
  tbody.replaceChildren();

  (models || []).forEach((m) => {
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    const idStrong = document.createElement('div');
    idStrong.className = 'font-mono';
    idStrong.textContent = m.id;
    const provSpan = document.createElement('div');
    provSpan.className = 'text-muted';
    provSpan.style.fontSize = '0.75rem';
    provSpan.textContent = `${m.provider} · Sync: ${m.n8n_sync_status || 'seeded'}`;
    tdId.append(idStrong, provSpan);
    tr.appendChild(tdId);

    const tdName = document.createElement('td');
    tdName.textContent = m.display_name || m.id;
    tr.appendChild(tdName);

    const tdStrat = document.createElement('td');
    const stratBadge = document.createElement('span');
    stratBadge.className = `badge strategy-badge strategy-${escapeHtml(m.execution_strategy || 'prompt_caching')}`;
    stratBadge.textContent = m.execution_strategy || 'prompt_caching';
    tdStrat.appendChild(stratBadge);
    if (m.eu_hosted) {
      const euBadge = document.createElement('span');
      euBadge.className = 'badge badge-eu';
      euBadge.style.marginLeft = '6px';
      euBadge.textContent = 'EU-Hosted';
      tdStrat.appendChild(euBadge);
    }
    tr.appendChild(tdStrat);

    const appendToggleCell = (fieldName, checkedVal) => {
      const td = document.createElement('td');
      const lbl = document.createElement('label');
      lbl.className = 'admin-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(checkedVal);
      input.addEventListener('change', () => handleToggleModelField(m.id, fieldName, input.checked));
      const span = document.createElement('span');
      span.className = 'admin-switch-label';
      span.textContent = input.checked ? 'AN' : 'AUS';
      lbl.append(input, span);
      td.appendChild(lbl);
      return td;
    };

    tr.appendChild(appendToggleCell('supports_web_search', m.supports_web_search));
    tr.appendChild(appendToggleCell('is_default', m.is_default));
    tr.appendChild(appendToggleCell('is_allowed', m.is_allowed));

    const tdAct = document.createElement('td');
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
    setButtonLoading(btn, true, 'Synchronisiere mit n8n...');
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

    if (statusBadge) {
      statusBadge.className = `badge ${data.synced ? 'badge-active' : 'badge-secondary'}`;
      statusBadge.textContent = data.synced
        ? `Live-Sync erfolgreich (${(data.last_synced_at || '').substring(11, 19)})`
        : `Lokaler Cache (n8n offline · ${(data.last_synced_at || '').substring(11, 19)})`;
    }
    showToast(
      data.synced
        ? 'Modelle erfolgreich live über n8n-Credentials synchronisiert.'
        : 'n8n Webhook derzeit nicht erreichbar — lokaler Modellkatalog aktualisiert.',
      data.synced ? 'success' : 'info'
    );
  } catch (err) {
    console.error('triggerN8nModelSync error:', err);
    showToast('Netzwerkfehler beim n8n Model-Sync.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleToggleModelField(modelId, field, nextVal) {
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
    console.error('handleToggleModelField error:', err);
    showToast('Netzwerkfehler beim Speichern der Modell-Einstellung.', 'error');
  }
}

function openModelModal(model = null) {
  const modal = document.getElementById('model-modal');
  const idInput = document.getElementById('model-id');
  const provSelect = document.getElementById('model-provider');
  const nameInput = document.getElementById('model-name');
  const dispInput = document.getElementById('model-display-name');
  const stratSelect = document.getElementById('model-strategy');
  const euEl = document.getElementById('model-eu-hosted');
  const searchEl = document.getElementById('model-supports-search');
  const allowEl = document.getElementById('model-is-allowed');
  const defEl = document.getElementById('model-is-default');

  if (model) {
    AdminState.editingModelId = model.id;
    if (idInput) { idInput.value = model.id || ''; idInput.readOnly = true; }
    if (provSelect) provSelect.value = model.provider || 'openai';
    if (nameInput) nameInput.value = model.model_name || '';
    if (dispInput) dispInput.value = model.display_name || '';
    if (stratSelect) stratSelect.value = model.execution_strategy || 'prompt_caching';
    if (euEl) euEl.checked = Boolean(model.eu_hosted);
    if (searchEl) searchEl.checked = Boolean(model.supports_web_search);
    if (allowEl) allowEl.checked = model.is_allowed !== false;
    if (defEl) defEl.checked = Boolean(model.is_default);
  } else {
    AdminState.editingModelId = null;
    if (idInput) { idInput.value = ''; idInput.readOnly = false; }
    if (provSelect) provSelect.value = 'openai';
    if (nameInput) nameInput.value = '';
    if (dispInput) dispInput.value = '';
    if (stratSelect) stratSelect.value = 'prompt_caching';
    if (euEl) euEl.checked = false;
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
    execution_strategy: document.getElementById('model-strategy')?.value || 'prompt_caching',
    eu_hosted: Boolean(document.getElementById('model-eu-hosted')?.checked),
    supports_web_search: Boolean(document.getElementById('model-supports-search')?.checked),
    is_allowed: Boolean(document.getElementById('model-is-allowed')?.checked),
    is_default: Boolean(document.getElementById('model-is-default')?.checked)
  };

  try {
    setButtonLoading(saveBtn, true, 'Speichert...');
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
    setButtonLoading(saveBtn, false);
  }
}

function buildClientCredFallback(models) {
  return AdminState.providerCredentials && AdminState.providerCredentials.length > 0
    ? AdminState.providerCredentials
    : [
        { provider: 'openai', credential_name: 'OpenAI - Chatlytics', status: 'seeded', model_count: (models || []).filter(m => m.provider === 'openai').length },
        { provider: 'gemini', credential_name: 'Google AI Studio', status: 'seeded', model_count: (models || []).filter(m => m.provider === 'gemini').length },
        { provider: 'mistral', credential_name: 'Mistral EU', status: 'seeded', model_count: (models || []).filter(m => m.provider === 'mistral').length }
      ];
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
    badgeEl.textContent = badgeText || (preset.is_default ? 'Standard' : 'Preset');
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
    searchPill.textContent = preset.search_enabled ? 'Live-Websuche: AN' : 'Ohne Websuche';
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
    delBtn.disabled = Boolean(preset.is_default || preset.id === 'dach_core_baseline');
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
    { id: 'openai/gpt-6-luna', display_name: 'OpenAI · GPT-6 Luna' },
    { id: 'gemini/models/gemini-3.5-flash', display_name: 'Google · Gemini 3.5 Flash' },
    { id: 'mistral/mistral-medium-latest', display_name: 'Mistral Medium Latest' },
    { id: 'mistral/mistral-large-latest', display_name: 'Mistral Large Latest' },
    { id: 'mistral/zai-glm-5-3', display_name: 'Z.ai GLM 5.3 (Mistral EU)' },
    { id: 'mistral/zai-glm-5-3-flash', display_name: 'Z.ai GLM 5.3 Flash (Mistral EU)' }
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
    setButtonLoading(saveBtn, true, 'Speichert...');
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
    setButtonLoading(saveBtn, false);
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
    appendLabeledInput(quotaGrid, 'Max. Profile / Konfigs', 'max_configs', plan.max_configs ?? 1, 'number');
    appendLabeledInput(quotaGrid, 'Max. Wettbewerber / Profil', 'max_competitors_per_config', plan.max_competitors_per_config ?? 2, 'number');
    appendLabeledInput(quotaGrid, 'Max. Prompts / Profil', 'max_prompts_per_config', plan.max_prompts_per_config ?? 5, 'number');
    card.appendChild(quotaGrid);

    // Allowed schedule intervals
    const ivGroup = document.createElement('div');
    ivGroup.className = 'form-group';
    const ivLabel = document.createElement('span');
    ivLabel.className = 'form-label';
    ivLabel.textContent = 'Erlaubte Data-Mining-Frequenzen';
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
    customTxt.textContent = 'Freie Einzelmodell- & Websuche-Konfiguration erlauben (sonst nur Analyse-Sets)';
    customLbl.append(customCb, customTxt);
    customGrp.appendChild(customLbl);
    card.appendChild(customGrp);

    // Allowed Analyse-Sets checkboxes
    if (presetsList.length > 0) {
      const prGroup = document.createElement('div');
      prGroup.className = 'form-group';
      const prLabel = document.createElement('span');
      prLabel.className = 'form-label';
      prLabel.textContent = 'Freigeschaltete Analyse-Sets (Model Presets)';
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
    setButtonLoading(saveBtn, true, 'Speichert...');
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
    setButtonLoading(saveBtn, false);
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
    handleSavePlan
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
    AdminState
  };
}