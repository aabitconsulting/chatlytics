/**
 * assets/js/notifications.js
 * Shared accessible Toast Notification & Button Loading Utility (ESM + Global + CommonJS compatible)
 */

const VALID_TYPES = new Set(['info', 'success', 'warning', 'error']);
const TOAST_ICONS = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '✕'
};
const MAX_VISIBLE_TOASTS = 4;

/**
 * Replaces {token} placeholders in i18n message templates safely.
 *
 * @param {string} template
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
export function formatTemplate(template, vars = {}) {
  return String(template ?? '').replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

/**
 * Ensures the floating #toast-container node exists in the document.
 *
 * @returns {HTMLElement|null}
 */
export function ensureToastContainer() {
  if (typeof document === 'undefined') return null;
  let container = document.getElementById('toast-container');
  if (container) return container;
  if (typeof document.createElement !== 'function' || !document.body) return null;

  container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  document.body.appendChild(container);
  return container;
}

/**
 * Toggles accessible loading state and temporary label on a button without losing original markup.
 *
 * @param {HTMLElement|null} btn
 * @param {boolean} isLoading
 * @param {string} loadingText
 */
export function setButtonLoading(btn, isLoading, loadingText = '') {
  if (!btn) return;
  if (isLoading) {
    if (btn._chatlyticsOrigNodes === undefined && btn.childNodes && typeof btn.replaceChildren === 'function') {
      btn._chatlyticsOrigNodes = Array.from(btn.childNodes);
    }
    if (btn._chatlyticsOrigText === undefined && typeof btn.textContent === 'string') {
      btn._chatlyticsOrigText = btn.textContent;
    }
    btn.disabled = true;
    if (btn.classList && typeof btn.classList.add === 'function') {
      btn.classList.add('is-loading');
    }
    if (typeof btn.setAttribute === 'function') {
      btn.setAttribute('aria-busy', 'true');
    }
    if (loadingText) {
      btn.textContent = String(loadingText);
    }
    return;
  }

  btn.disabled = false;
  if (btn.classList && typeof btn.classList.remove === 'function') {
    btn.classList.remove('is-loading');
  }
  if (typeof btn.removeAttribute === 'function') {
    btn.removeAttribute('aria-busy');
  }
  if (btn._chatlyticsOrigNodes !== undefined && typeof btn.replaceChildren === 'function') {
    btn.replaceChildren(...btn._chatlyticsOrigNodes);
    delete btn._chatlyticsOrigNodes;
    delete btn._chatlyticsOrigText;
  } else if (btn._chatlyticsOrigText !== undefined) {
    btn.textContent = btn._chatlyticsOrigText;
    delete btn._chatlyticsOrigText;
  }
}

/**
 * Renders an accessible, XSS-safe floating toast notification.
 *
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs
 * @returns {HTMLElement|null}
 */
export function showToast(message, type = 'info', durationMs = 4500) {
  const container = ensureToastContainer();
  if (!container || typeof document?.createElement !== 'function') return null;

  const safeType = VALID_TYPES.has(String(type)) ? String(type) : 'info';
  const safeMessage = String(message ?? '').trim();
  if (!safeMessage) return null;

  while (container.children && container.children.length >= MAX_VISIBLE_TOASTS) {
    const oldest = container.children[0];
    if (oldest && typeof oldest.remove === 'function') {
      oldest.remove();
    } else {
      break;
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${safeType}`;
  if (typeof toast.setAttribute === 'function') {
    toast.setAttribute('role', safeType === 'error' || safeType === 'warning' ? 'alert' : 'status');
  }

  const iconNode = document.createElement('span');
  iconNode.className = `toast-icon toast-icon-${safeType}`;
  iconNode.textContent = TOAST_ICONS[safeType] || TOAST_ICONS.info;
  if (typeof iconNode.setAttribute === 'function') {
    iconNode.setAttribute('aria-hidden', 'true');
  }

  const textNode = document.createElement('span');
  textNode.className = 'toast-message';
  textNode.textContent = safeMessage;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  if (typeof closeBtn.setAttribute === 'function') {
    closeBtn.setAttribute('aria-label', 'Benachrichtigung schließen');
  }

  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    if (toast.classList && typeof toast.classList.add === 'function') {
      toast.classList.add('toast-fadeout');
    }
    setTimeout(() => {
      if (typeof toast.remove === 'function') {
        toast.remove();
      }
    }, 320);
  };

  if (typeof closeBtn.addEventListener === 'function') {
    closeBtn.addEventListener('click', dismiss);
  }

  toast.appendChild(iconNode);
  toast.appendChild(textNode);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  if (Number(durationMs) > 0) {
    setTimeout(dismiss, Number(durationMs));
  }

  return toast;
}

const ChatlyticsNotify = {
  showToast,
  ensureToastContainer,
  setButtonLoading,
  formatTemplate
};

if (typeof window !== 'undefined') {
  window.ChatlyticsNotify = ChatlyticsNotify;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChatlyticsNotify;
}

export default ChatlyticsNotify;
