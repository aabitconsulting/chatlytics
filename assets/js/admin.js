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

    const { users, pagination } = json.data;
    AdminState.users = users || [];
    AdminState.pagination = pagination || { page: 1, limit: 20, total: 0, total_pages: 1 };

    // Update KPI summary cards
    updateKpiCards(users, pagination.total);

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

  // Clear existing content safely
  tbody.textContent = '';

  users.forEach((u) => {
    const tr = document.createElement('tr');

    // ID
    const tdId = document.createElement('td');
    tdId.setAttribute('data-label', 'ID');
    tdId.className = 'font-mono';
    tdId.textContent = String(u.id);
    tr.appendChild(tdId);

    // Email
    const tdEmail = document.createElement('td');
    tdEmail.setAttribute('data-label', 'E-Mail');
    tdEmail.className = 'cell-email font-mono';
    tdEmail.textContent = u.email;
    tr.appendChild(tdEmail);

    // Company Name
    const tdCompany = document.createElement('td');
    tdCompany.setAttribute('data-label', 'Unternehmen');
    tdCompany.textContent = sanitizeLength(u.company_name, 40);
    tr.appendChild(tdCompany);

    // Tier Badge
    const tdTier = document.createElement('td');
    tdTier.setAttribute('data-label', 'Tarif');
    const spanTier = document.createElement('span');
    spanTier.className = `badge badge-tier badge-${escapeHtml(u.tier || 'free')}`;
    spanTier.textContent = u.tier || 'free';
    tdTier.appendChild(spanTier);
    tr.appendChild(tdTier);

    // Credits Remaining
    const tdCredits = document.createElement('td');
    tdCredits.setAttribute('data-label', 'Credits');
    tdCredits.className = 'font-mono text-bold';
    tdCredits.textContent = Number(u.credits_remaining || 0).toLocaleString();
    tr.appendChild(tdCredits);

    // Runs Count
    const tdRuns = document.createElement('td');
    tdRuns.setAttribute('data-label', 'Runs');
    tdRuns.className = 'font-mono';
    tdRuns.textContent = Number(u.run_count || 0).toLocaleString();
    tr.appendChild(tdRuns);

    // Status Badge
    const tdStatus = document.createElement('td');
    tdStatus.setAttribute('data-label', 'Status');
    const spanStatus = document.createElement('span');
    spanStatus.className = `badge badge-status badge-${escapeHtml(u.status || 'active')}`;
    spanStatus.textContent = u.status || 'active';
    tdStatus.appendChild(spanStatus);
    tr.appendChild(tdStatus);

    // Created At
    const tdCreated = document.createElement('td');
    tdCreated.setAttribute('data-label', 'Registriert');
    tdCreated.className = 'cell-date text-muted font-mono';
    tdCreated.textContent = (u.created_at || '').substring(0, 10);
    tr.appendChild(tdCreated);

    // Actions
    const tdActions = document.createElement('td');
    tdActions.setAttribute('data-label', 'Aktionen');
    tdActions.className = 'text-right table-actions';

    const btnCredit = document.createElement('button');
    btnCredit.className = 'btn btn-xs btn-outline';
    btnCredit.textContent = 'Credits';
    btnCredit.addEventListener('click', () => openCreditModal(u));

    const btnMagic = document.createElement('button');
    btnMagic.className = 'btn btn-xs btn-secondary';
    btnMagic.textContent = 'Vorstands-Link';
    btnMagic.addEventListener('click', () => generateAndOpenMagicAudit(u.id));

    tdActions.appendChild(btnCredit);
    tdActions.appendChild(document.createTextNode(' '));
    tdActions.appendChild(btnMagic);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

/**
 * Update Platform KPI overview telemetry.
 */
function updateKpiCards(users, totalUsers) {
  const kpiUsersEl = document.getElementById('kpi-total-users');
  const kpiRunsEl = document.getElementById('kpi-total-runs');
  const kpiCreditsEl = document.getElementById('kpi-total-credits');
  const kpiConfigsEl = document.getElementById('kpi-total-configs');

  if (kpiUsersEl) kpiUsersEl.textContent = Number(totalUsers || 0).toLocaleString();

  let sumRuns = 0;
  let sumCredits = 0;
  users.forEach((u) => {
    sumRuns += Number(u.run_count || 0);
    sumCredits += Number(u.credits_remaining || 0);
  });

  if (kpiRunsEl) kpiRunsEl.textContent = sumRuns.toLocaleString();
  if (kpiCreditsEl) kpiCreditsEl.textContent = sumCredits.toLocaleString();
  if (kpiConfigsEl) kpiConfigsEl.textContent = users.length ? String(users.length) : '0';
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
  if (submitBtn) submitBtn.disabled = true;

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
    if (submitBtn) submitBtn.disabled = false;
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

function showToast(message, type = 'info') {
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
    triggerDemoSeeder
  };
  window.buildCreditPayload = buildCreditPayload;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCreditPayload,
    escapeHtml,
    sanitizeLength,
    AdminState
  };
}