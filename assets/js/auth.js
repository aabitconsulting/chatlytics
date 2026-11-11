/**
 * assets/js/auth.js
 * Feature 29: Modular Client-Side JavaScript Suite — Authentication & Route Guards
 *
 * Handles:
 * - Session and token persistence (localStorage)
 * - Work-email corporate validation
 * - Declarative Route Guards with Magic Audit bypass
 * - Authentication modal dialog controller (Login & Freemium Signup)
 */

import { apiClient } from './api-client.js';

const DISALLOWED_FREEMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com',
  'outlook.com', 'live.com', 'icloud.com', 'gmx.de', 'gmx.net', 'web.de',
  't-online.de', 'freenet.de', 'mail.ru', 'protonmail.com', 'proton.me',
  'yandex.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'guerrillamail.com', 'mailinator.com', 'trashmail.com'
];

/**
 * Validates whether an email is a legitimate corporate/work email address.
 * 
 * @param {string} email
 * @returns {{ valid: boolean, reason?: string, domain?: string }}
 */
export function validateWorkEmail(email) {
  if (email === null || email === undefined || typeof email !== 'string' || email === '') {
    return { valid: false, reason: 'empty' };
  }
  const clean = email.trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { valid: false, reason: 'malformed' };
  }
  const parts = clean.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' };
  }
  const domain = parts[1];
  for (const dis of DISALLOWED_FREEMAIL_DOMAINS) {
    if (domain === dis || domain.endsWith('.' + dis)) {
      return { valid: false, reason: 'disallowed_freemail', domain };
    }
  }
  return { valid: true, domain };
}

/**
 * Route guard evaluation logic matching tests/tier1_features/f29_client_js_modules.test.js.
 * 
 * @param {{ isAuthenticated: boolean, isAdmin?: boolean, requiresAdmin?: boolean }} params
 * @returns {{ redirect: string|null }}
 */
export function routeGuard({ isAuthenticated, isAdmin = false, requiresAdmin = false }) {
  if (!isAuthenticated) {
    return { redirect: 'index.html?auth=required' };
  }
  if (requiresAdmin && !isAdmin) {
    return { redirect: 'dashboard.html?error=unauthorized' };
  }
  return { redirect: null };
}

/**
 * Magic Audit route access check matching tests/tier1_features/f27_magic_audit_mode.test.js.
 * 
 * @param {string|null} userToken
 * @param {string|null} auditToken
 * @returns {{ allowed: boolean, mode: 'magic_audit'|'authenticated'|'unauthorized' }}
 */
export function checkAccess(userToken, auditToken) {
  if (auditToken && auditToken.length >= 16) {
    return { allowed: true, mode: 'magic_audit' };
  }
  if (userToken) {
    return { allowed: true, mode: 'authenticated' };
  }
  return { allowed: false, mode: 'unauthorized' };
}

export class AuthManager {
  constructor() {
    this.token = this.getToken();
    this.user = this.getUser();
    this.auditToken = this.getAuditTokenFromUrl();
  }

  getToken() {
    try {
      return localStorage.getItem('chatlytics_token') || null;
    } catch (_) {
      return null;
    }
  }

  setToken(token) {
    this.token = token;
    try {
      if (token) {
        localStorage.setItem('chatlytics_token', token);
      } else {
        localStorage.removeItem('chatlytics_token');
      }
    } catch (_) {}
    apiClient.setToken(token);
  }

  getUser() {
    try {
      const raw = localStorage.getItem('chatlytics_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  setUser(user) {
    this.user = user;
    try {
      if (user) {
        localStorage.setItem('chatlytics_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('chatlytics_user');
      }
    } catch (_) {}
  }

  getAuditTokenFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('audit_token') || null;
    } catch (_) {
      return null;
    }
  }

  isAuthenticated() {
    return Boolean(this.token);
  }

  isAdmin() {
    return this.user?.role === 'admin';
  }

  isAuditMode() {
    return Boolean(this.auditToken && this.auditToken.length >= 16);
  }

  /**
   * Enforces route protection on current page.
   * Redirects immediately if unauthorized.
   */
  enforceGuard({ requiresAuth = true, requiresAdmin = false } = {}) {
    if (this.isAuditMode()) {
      if (requiresAdmin) {
        window.location.href = 'dashboard.html?error=unauthorized';
        return false;
      }
      return true; // Audit mode allows read access to dashboard
    }

    if (requiresAuth) {
      const guardResult = routeGuard({
        isAuthenticated: this.isAuthenticated(),
        isAdmin: this.isAdmin(),
        requiresAdmin
      });

      if (guardResult.redirect) {
        window.location.href = guardResult.redirect;
        return false;
      }
    }

    return true;
  }

  async login(email, password) {
    const res = await apiClient.login(email, password);
    const user = res.user || res;
    const token = res.token || user.api_key;
    this.setToken(token);
    this.setUser(user);
    return user;
  }

  async signup(email, password, companyName = '') {
    const val = validateWorkEmail(email);
    if (!val.valid) {
      throw new Error(
        val.reason === 'disallowed_freemail'
          ? 'Bitte verwenden Sie Ihre geschäftliche Firmen-E-Mail (keine Freemail-Adressen wie Gmail, Web.de, GMX).'
          : 'Bitte geben Sie eine gültige Firmen-E-Mail-Adresse an.'
      );
    }
    const res = await apiClient.signup(email, password, companyName);
    const user = res.user || res;
    const token = res.token || user.api_key;
    this.setToken(token);
    this.setUser(user);
    return user;
  }

  async logout() {
    try {
      await apiClient.logout();
    } finally {
      this.setToken(null);
      this.setUser(null);
      window.location.href = 'index.html?logged_out=1';
    }
  }

  // --- Auth Modal Controller ---
  initModal() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const formLogin = document.getElementById('form-login');
    const formSignup = document.getElementById('form-signup');
    const closeBtn = document.getElementById('modal-close');
    const backdrop = modal.querySelector('.modal-backdrop');

    const openBtns = document.querySelectorAll('[data-open-modal="auth"], #btn-open-login, #btn-open-signup, #hero-btn-signup');

    const switchTab = (mode) => {
      if (mode === 'signup') {
        tabSignup?.classList.add('active');
        tabLogin?.classList.remove('active');
        formSignup?.classList.remove('hidden');
        formLogin?.classList.add('hidden');
      } else {
        tabLogin?.classList.add('active');
        tabSignup?.classList.remove('active');
        formLogin?.classList.remove('hidden');
        formSignup?.classList.add('hidden');
      }
    };

    const showModal = (mode = 'signup') => {
      switchTab(mode);
      modal.classList.remove('modal-hidden');
      modal.setAttribute('aria-hidden', 'false');
      const focusTarget = mode === 'signup'
        ? document.getElementById('signup-email')
        : document.getElementById('login-email');
      focusTarget?.focus();
    };

    const hideModal = () => {
      modal.classList.add('modal-hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    openBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = btn.id.includes('login') ? 'login' : 'signup';
        showModal(mode);
      });
    });

    closeBtn?.addEventListener('click', hideModal);
    backdrop?.addEventListener('click', hideModal);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
        hideModal();
      }
    });

    tabLogin?.addEventListener('click', () => switchTab('login'));
    tabSignup?.addEventListener('click', () => switchTab('signup'));

    // Handle Signup Form
    formSignup?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('signup-error');
      const submitBtn = formSignup.querySelector('button[type="submit"]');
      if (errBox) errBox.textContent = '';

      const email = document.getElementById('signup-email')?.value.trim();
      const password = document.getElementById('signup-password')?.value;
      const company = document.getElementById('signup-company')?.value.trim();

      try {
        if (submitBtn) submitBtn.disabled = true;
        await this.signup(email, password, company);
        window.location.href = 'dashboard.html?welcome=1';
      } catch (err) {
        if (errBox) errBox.textContent = err.message;
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    // Handle Login Form
    formLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('login-error');
      const submitBtn = formLogin.querySelector('button[type="submit"]');
      if (errBox) errBox.textContent = '';

      const email = document.getElementById('login-email')?.value.trim();
      const password = document.getElementById('login-password')?.value;

      try {
        if (submitBtn) submitBtn.disabled = true;
        await this.login(email, password);
        window.location.href = 'dashboard.html';
      } catch (err) {
        if (errBox) errBox.textContent = err.message;
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

export const auth = new AuthManager();

if (typeof window !== 'undefined') {
  window.auth = auth;
  window.AuthManager = AuthManager;
}

// CommonJS compatibility export for test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateWorkEmail,
    routeGuard,
    checkAccess,
    AuthManager,
    auth
  };
}
