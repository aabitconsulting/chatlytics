/**
 * assets/js/configs.js
 * Feature 29: Modular Client-Side JavaScript Suite — Tracking Configuration Manager
 *
 * Handles:
 * - Sanitizing brand and competitor domain inputs (RFC URL parsing & protocol stripping)
 * - CRUD operations via apiClient
 * - Config modal controller for creating and updating prompt-brand configurations
 */

import { apiClient } from './api-client.js';
import { auth } from './auth.js';
import { i18n } from './i18n.js';
import { showToast, setButtonLoading } from './notifications.js';

export const SCHEDULE_INTERVALS = {
  every_2h: { runsPerDay: 12, highFreq: true, i18nKey: 'interval.every_2h', fallback: '12x täglich (alle 2 Std.)' },
  every_4h: { runsPerDay: 6, highFreq: true, i18nKey: 'interval.every_4h', fallback: '6x täglich (alle 4 Std.)' },
  every_6h: { runsPerDay: 4, highFreq: true, i18nKey: 'interval.every_6h', fallback: '4x täglich (alle 6 Std.)' },
  every_12h: { runsPerDay: 2, highFreq: true, i18nKey: 'interval.every_12h', fallback: '2x täglich (alle 12 Std.)' },
  daily: { runsPerDay: 1, highFreq: false, i18nKey: 'interval.daily', fallback: '1x täglich (Daily)' },
  weekly: { runsPerDay: 1 / 7, highFreq: false, i18nKey: 'interval.weekly', fallback: '1x wöchentlich (Weekly)' },
  biweekly: { runsPerDay: 1 / 14, highFreq: false, i18nKey: 'interval.biweekly', fallback: 'Alle 14 Tage' },
  monthly: { runsPerDay: 1 / 30, highFreq: false, i18nKey: 'interval.monthly', fallback: 'Monatlich' },
  manual: { runsPerDay: 0, highFreq: false, i18nKey: 'interval.manual', fallback: 'Nur Manuell (Manual)' }
};

export function getScheduleRunsPerDay(interval) {
  const key = String(interval || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCHEDULE_INTERVALS, key)
    ? SCHEDULE_INTERVALS[key].runsPerDay
    : 1;
}

export function isHighFrequencySchedule(interval) {
  const key = String(interval || '').trim().toLowerCase();
  return Boolean(SCHEDULE_INTERVALS[key]?.highFreq);
}

export function canUserUseScheduleInterval(user, interval) {
  if (!isHighFrequencySchedule(interval)) return true;
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const tier = String(user.tier || 'free').toLowerCase();
  return tier !== 'free' && tier !== '';
}

export function calculateEstimatedCredits(promptCount, llmCount, interval) {
  const prompts = Math.max(0, Number(promptCount) || 0);
  const llms = Math.max(0, Number(llmCount) || 0);
  const perRun = prompts * llms;
  const runsPerDay = getScheduleRunsPerDay(interval);
  const perDay = Number((perRun * runsPerDay).toFixed(2));
  const perMonth = Number((perRun * runsPerDay * 30).toFixed(1));
  return { perRun, runsPerDay, perDay, perMonth };
}

export function getScheduleLabel(interval) {
  const key = String(interval || 'daily').trim().toLowerCase();
  const meta = SCHEDULE_INTERVALS[key] || SCHEDULE_INTERVALS.daily;
  return i18n && typeof i18n.t === 'function'
    ? i18n.t(meta.i18nKey, meta.fallback)
    : meta.fallback;
}

export const LLM_CATALOG = [
  { id: 'openai/gpt-6-luna', provider: 'openai', model: 'gpt-6-luna', label: 'OpenAI · GPT-6 Luna', euHosted: false, defaultChecked: true },
  { id: 'gemini/models/gemini-3.5-flash', provider: 'gemini', model: 'models/gemini-3.5-flash', label: 'Google · Gemini 3.5 Flash', euHosted: false, defaultChecked: true },
  { id: 'mistral/mistral-medium-latest', provider: 'mistral', model: 'mistral-medium-latest', label: 'Mistral Medium Latest', euHosted: true, defaultChecked: true },
  { id: 'mistral/mistral-large-latest', provider: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large Latest', euHosted: true, defaultChecked: false },
  { id: 'mistral/zai-glm-5-3', provider: 'mistral', model: 'zai-glm-5-3', label: 'Z.ai GLM 5.3 (Mistral EU)', euHosted: true, defaultChecked: true },
  { id: 'mistral/zai-glm-5-3-flash', provider: 'mistral', model: 'zai-glm-5-3-flash', label: 'Z.ai GLM 5.3 Flash (Mistral EU)', euHosted: true, defaultChecked: false }
];

const DEFAULT_FALLBACK_LLMS = ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash'];

function parseConfigArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export function getConfigRunBreakdown(config) {
  if (!config) {
    return {
      llmCount: DEFAULT_FALLBACK_LLMS.length,
      promptCount: 1,
      expectedRuns: DEFAULT_FALLBACK_LLMS.length
    };
  }
  const rawLlms = parseConfigArray(config.target_llms ?? config.llms_json ?? config.llms);
  const rawPrompts = parseConfigArray(config.keywords_prompts ?? config.prompts ?? (config.prompt ? [config.prompt] : []));
  const llmCount = rawLlms.length > 0 ? rawLlms.length : DEFAULT_FALLBACK_LLMS.length;
  const promptCount = rawPrompts.length > 0 ? rawPrompts.length : 1;
  return {
    llmCount,
    promptCount,
    expectedRuns: Math.max(1, llmCount * promptCount)
  };
}
const DEFAULT_SELECTED_LLMS = LLM_CATALOG.filter(m => m.defaultChecked).map(m => m.id);

export function mapSavedTokenToCatalogId(token) {
  const clean = String(token || '').trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'openai' || clean.startsWith('openai/')) return 'openai/gpt-6-luna';
  if (clean === 'gemini' || clean === 'google' || clean.startsWith('gemini/') || clean.startsWith('google/') || clean.startsWith('models/gemini')) {
    return 'gemini/models/gemini-3.5-flash';
  }
  if (clean === 'mistral' || clean === 'mistral/mistral-medium-latest' || clean === 'mistral-medium-latest') {
    return 'mistral/mistral-medium-latest';
  }
  if (clean === 'mistral/mistral-large-latest' || clean === 'mistral-large-latest') {
    return 'mistral/mistral-large-latest';
  }
  if (clean === 'glm' || clean === 'mistral/zai-glm-5-3' || clean === 'zai-glm-5-3') {
    return 'mistral/zai-glm-5-3';
  }
  if (clean === 'mistral/zai-glm-5-3-flash' || clean === 'zai-glm-5-3-flash') {
    return 'mistral/zai-glm-5-3-flash';
  }
  return clean;
}

/**
 * Sanitizes comma-separated domain string into clean hostname array.
 * Strictly adheres to tests/tier1_features/f29_client_js_modules.test.js:
 *   const sanitizeDomains = (rawStr) => {
 *     return rawStr
 *       .split(',')
 *       .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
 *       .filter(Boolean);
 *   };
 * 
 * @param {string} rawStr
 * @returns {string[]}
 */
export function sanitizeDomains(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return [];
  return rawStr
    .split(',')
    .map(d => {
      let clean = d.trim().toLowerCase();
      clean = clean.replace(/^[a-zA-Z0-9+.-]+:\/\/?/, '').replace(/^[a-zA-Z0-9+.-]+:/, '').replace(/[\/?#].*$/, '');
      return clean.trim();
    })
    .filter(Boolean);
}

/**
 * Parses newline-separated prompt input into clean array of prompt strings.
 * 
 * @param {string} rawStr
 * @returns {string[]}
 */
export function parsePrompts(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return [];
  return rawStr
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);
}

/**
 * Parses comma-separated or multiline competitor input into competitor objects.
 * Format: "Workday (workday.com), SAP (sap.com)" or simple "Workday, SAP"
 * 
 * @param {string} rawStr
 * @returns {Array<{ name: string, domains: string[] }>}
 */
export function parseCompetitors(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return [];
  const lines = rawStr.includes('\n') ? rawStr.split('\n') : rawStr.split(',');
  const results = [];

  for (const item of lines) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    // Check for "Name (domain.com)" pattern
    const match = trimmed.match(/^([^()]+)(?:\(([^()]+)\))?$/);
    if (match) {
      const name = match[1].trim();
      const rawDomain = match[2] ? match[2].trim() : '';
      const domains = rawDomain ? sanitizeDomains(rawDomain) : [];
      if (name) {
        results.push({ name, domains });
      }
    } else {
      results.push({ name: trimmed, domains: [] });
    }
  }

  return results;
}

export class ConfigManager {
  constructor() {
    this.configs = [];
    this.selectedConfigId = null;
  }

  async loadConfigs() {
    try {
      const res = await apiClient.getConfigs();
      this.configs = Array.isArray(res.configs) ? res.configs : (Array.isArray(res) ? res : []);
      return this.configs;
    } catch (err) {
      console.error('Error loading configs:', err);
      return [];
    }
  }

  getSelectedConfig() {
    if (!this.selectedConfigId && this.configs.length > 0) {
      return this.configs[0];
    }
    return this.configs.find(c => String(c.id) === String(this.selectedConfigId)) || this.configs[0] || null;
  }

  setSelectedConfigId(id) {
    this.selectedConfigId = id;
    try {
      localStorage.setItem('chatlytics_selected_config_id', String(id));
    } catch (_) {}
  }

  getSavedConfigId() {
    try {
      return localStorage.getItem('chatlytics_selected_config_id') || null;
    } catch (_) {
      return null;
    }
  }

  async saveConfig(formData, configId = null) {
    const payload = {
      name: formData.name || `${formData.brand_name} Tracking`,
      brand_name: formData.brand_name,
      brand_domains: Array.isArray(formData.brand_domains) ? formData.brand_domains : sanitizeDomains(formData.brand_domains || ''),
      keywords_prompts: Array.isArray(formData.prompts) ? formData.prompts : parsePrompts(formData.prompts || ''),
      competitors: Array.isArray(formData.competitors) ? formData.competitors : parseCompetitors(formData.competitors || ''),
      target_llms: (Array.isArray(formData.target_llms) && formData.target_llms.length > 0) ? formData.target_llms : DEFAULT_FALLBACK_LLMS,
      search_enabled: formData.search_enabled !== undefined ? Boolean(formData.search_enabled) : true,
      schedule_interval: formData.schedule_interval || 'daily',
      status: formData.status || 'active'
    };

    if (configId) {
      return await apiClient.updateConfig(configId, payload);
    } else {
      return await apiClient.createConfig(payload);
    }
  }

  async toggleConfigStatus(config) {
    if (!config || !config.id) return null;
    const nextStatus = config.status === 'paused' ? 'active' : 'paused';
    let res;
    try {
      res = await apiClient.updateConfig(config.id, { status: nextStatus });
    } catch (err) {
      showToast(err?.message || (i18n ? i18n.t('toast.config_toggle_error', 'Status der Konfiguration konnte nicht geändert werden.') : 'Status der Konfiguration konnte nicht geändert werden.'), 'error');
      throw err;
    }
    const updated = res?.config || res;
    const idx = this.configs.findIndex(c => String(c.id) === String(config.id));
    if (idx >= 0 && updated && updated.id) {
      this.configs[idx] = updated;
    } else if (idx >= 0) {
      this.configs[idx] = { ...this.configs[idx], status: nextStatus };
    }
    return updated;
  }

  async deleteConfig(configId) {
    return await apiClient.deleteConfig(configId);
  }

  // --- Modal Controller for Config Creation / Edit ---
  initModal(onSaveCallback) {
    const modal = document.getElementById('config-modal');
    if (!modal) return;

    const form = document.getElementById('config-form');
    const closeBtn = document.getElementById('config-modal-close');
    const cancelBtn = document.getElementById('config-cancel');
    const titleEl = document.getElementById('config-modal-title');
    const errBox = document.getElementById('config-error');

    const openBtns = document.querySelectorAll('#btn-new-config, [data-open-modal="new-config"]');

    const applyModelAndSearchFields = (selectedLlms, searchEnabled) => {
      const normalized = new Set((selectedLlms || []).map(mapSavedTokenToCatalogId).filter(Boolean));
      const checkboxes = form.querySelectorAll('.cfg-llm-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = normalized.has(cb.value);
      });
      const searchToggle = document.getElementById('cfg-search-enabled');
      if (searchToggle) {
        searchToggle.checked = searchEnabled !== undefined ? Boolean(Number(searchEnabled) || searchEnabled === true) : true;
      }
    };

    const tierHintEl = document.getElementById('cfg-tier-hint');
    const previewEl = document.getElementById('cfg-credit-preview');
    const intervalSelect = document.getElementById('cfg-interval');

    const applyIntervalTierConstraints = () => {
      if (!intervalSelect) return;
      const currentUser = auth.getUser();
      const allowHighFreq = canUserUseScheduleInterval(currentUser, 'every_2h');
      Array.from(intervalSelect.options).forEach(opt => {
        if (isHighFrequencySchedule(opt.value)) {
          opt.disabled = !allowHighFreq;
        }
      });
      if (!allowHighFreq && isHighFrequencySchedule(intervalSelect.value)) {
        intervalSelect.value = 'daily';
      }
      if (tierHintEl) {
        if (allowHighFreq) {
          tierHintEl.classList.add('hidden');
          tierHintEl.textContent = '';
        } else {
          tierHintEl.classList.remove('hidden');
          tierHintEl.textContent = i18n.t(
            'config.tier_hint_free',
            'Frequenzen über 1x täglich (alle 12 Std. bis alle 2 Std.) erfordern einen bezahlten Tarif (Starter, Growth oder Enterprise).'
          );
        }
      }
    };

    const updateCreditPreview = () => {
      if (!previewEl) return;
      const prompts = parsePrompts(document.getElementById('cfg-prompts')?.value || '');
      const llmCount = form.querySelectorAll('.cfg-llm-checkbox:checked').length;
      const interval = intervalSelect?.value || 'daily';
      const est = calculateEstimatedCredits(prompts.length, llmCount, interval);
      const balanceRaw = auth.getUser()?.credits_remaining;
      const hasBalance = balanceRaw !== undefined && balanceRaw !== null && !isNaN(Number(balanceRaw));
      const balance = hasBalance ? Number(balanceRaw) : null;
      const isManual = interval === 'manual';

      previewEl.replaceChildren();

      const header = document.createElement('div');
      header.className = 'cfg-credit-preview-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'cfg-credit-preview-title';
      titleSpan.textContent = i18n.t('config.credit_preview_title', 'Geschätzter Credit-Verbrauch');
      const formulaSpan = document.createElement('span');
      formulaSpan.className = 'cfg-credit-preview-formula font-mono';
      formulaSpan.textContent = `${prompts.length} × ${llmCount}`;
      header.append(titleSpan, formulaSpan);

      const grid = document.createElement('div');
      grid.className = 'cfg-credit-preview-grid';

      const appendStat = (label, valueText) => {
        const box = document.createElement('div');
        box.className = 'cfg-credit-stat';
        const lbl = document.createElement('span');
        lbl.className = 'cfg-credit-stat-label';
        lbl.textContent = label;
        const val = document.createElement('strong');
        val.className = 'cfg-credit-stat-val font-mono';
        val.textContent = valueText;
        box.append(lbl, val);
        grid.appendChild(box);
      };

      appendStat(
        i18n.t('config.credit_preview_per_run', 'Pro Lauf'),
        `${est.perRun} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_per_day', 'Pro Tag'),
        isManual ? i18n.t('config.credit_preview_manual', 'Manuell') : `${est.perDay} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_per_month', 'Pro Monat (~30 Tage)'),
        isManual ? '—' : `${Math.round(est.perMonth)} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_balance', 'Aktuelles Guthaben'),
        hasBalance ? `${balance} Credits` : '—'
      );

      previewEl.append(header, grid);

      if (hasBalance && !isManual && est.perDay > 0 && balance < est.perDay) {
        const warn = document.createElement('p');
        warn.className = 'cfg-credit-warning';
        warn.textContent = i18n.t(
          'config.credit_preview_low_warning',
          'Hinweis: Ihr aktuelles Guthaben deckt weniger als 1 Tag bei dieser Frequenz ab.'
        );
        previewEl.appendChild(warn);
      }
    };

    const ensureIntervalOption = (value) => {
      if (!intervalSelect || !value) return;
      const exists = Array.from(intervalSelect.options).some(opt => opt.value === value);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = getScheduleLabel(value);
        intervalSelect.appendChild(opt);
      }
      intervalSelect.value = value;
    };

    const showModal = (config = null) => {
      if (errBox) errBox.textContent = '';
      if (config) {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_edit_title', 'Tracking-Konfiguration bearbeiten');
        form.dataset.configStatus = config.status || 'active';
        form.dataset.configId = config.id;
        document.getElementById('cfg-name').value = config.name || '';
        document.getElementById('cfg-brand').value = config.brand_name || '';
        document.getElementById('cfg-domains').value = (config.brand_domains || []).join(', ');
        document.getElementById('cfg-prompts').value = (config.keywords_prompts || config.prompts || []).join('\n');
        document.getElementById('cfg-competitors').value = (config.competitors || []).map(c => c.name || c).join(', ');
        ensureIntervalOption(config.schedule_interval || 'daily');
        const savedLlms = Array.isArray(config.target_llms) && config.target_llms.length > 0
          ? config.target_llms
          : DEFAULT_FALLBACK_LLMS;
        applyModelAndSearchFields(savedLlms, config.search_enabled !== undefined ? config.search_enabled : true);
      } else {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_create_title', 'Neue Tracking-Konfiguration anlegen');
        delete form.dataset.configStatus;
        delete form.dataset.configId;
        form.reset();
        ensureIntervalOption('daily');
        applyModelAndSearchFields(DEFAULT_SELECTED_LLMS, true);
      }
      applyIntervalTierConstraints();
      updateCreditPreview();
      modal.classList.remove('modal-hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('cfg-brand')?.focus();
    };

    const hideModal = () => {
      modal.classList.add('modal-hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    openBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        showModal();
      });
    });

    closeBtn?.addEventListener('click', hideModal);
    cancelBtn?.addEventListener('click', hideModal);

    document.getElementById('cfg-prompts')?.addEventListener('input', updateCreditPreview);
    intervalSelect?.addEventListener('change', updateCreditPreview);
    form?.querySelectorAll('.cfg-llm-checkbox').forEach(cb => {
      cb.addEventListener('change', updateCreditPreview);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
        hideModal();
      }
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errBox) errBox.textContent = '';
      const submitBtn = form.querySelector('button[type="submit"]');

      const configId = form.dataset.configId || null;
      const brandName = document.getElementById('cfg-brand')?.value.trim();
      const rawDomains = document.getElementById('cfg-domains')?.value.trim();
      const rawPrompts = document.getElementById('cfg-prompts')?.value.trim();
      const rawCompetitors = document.getElementById('cfg-competitors')?.value.trim();
      const name = document.getElementById('cfg-name')?.value.trim() || `${brandName} Tracking`;
      const interval = document.getElementById('cfg-interval')?.value || 'daily';

      if (!brandName) {
        if (errBox) errBox.textContent = 'Bitte geben Sie einen Markennamen an.';
        return;
      }

      const domains = sanitizeDomains(rawDomains);
      if (domains.length === 0) {
        if (errBox) errBox.textContent = 'Bitte geben Sie mindestens eine gültige Domain an (z.B. meinedomain.de).';
        return;
      }

      const prompts = parsePrompts(rawPrompts);
      if (prompts.length === 0) {
        if (errBox) errBox.textContent = 'Bitte hinterlegen Sie mindestens einen Such-Prompt.';
        return;
      }

      const selectedLlms = Array.from(form.querySelectorAll('.cfg-llm-checkbox:checked')).map(cb => cb.value);
      if (selectedLlms.length === 0) {
        if (errBox) {
          const msg = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function')
            ? window.i18n.t('config.llms_required', 'Bitte wählen Sie mindestens ein Ziel-KI-Modell aus.')
            : 'Bitte wählen Sie mindestens ein Ziel-KI-Modell aus.';
          errBox.textContent = msg;
        }
        return;
      }

      const searchToggle = document.getElementById('cfg-search-enabled');
      const searchEnabled = searchToggle ? Boolean(searchToggle.checked) : true;

      try {
        setButtonLoading(submitBtn, true, i18n ? i18n.t('config.btn_saving', 'Wird gespeichert…') : 'Wird gespeichert…');
        const saved = await this.saveConfig({
          name,
          brand_name: brandName,
          brand_domains: domains,
          prompts,
          competitors: rawCompetitors,
          target_llms: selectedLlms,
          search_enabled: searchEnabled,
          schedule_interval: interval,
          status: configId ? (form.dataset.configStatus || 'active') : 'active'
        }, configId);

        hideModal();
        showToast(
          configId
            ? (i18n ? i18n.t('toast.config_saved', 'Konfiguration gespeichert.') : 'Konfiguration gespeichert.')
            : (i18n ? i18n.t('toast.config_created', 'Konfiguration erstellt.') : 'Konfiguration erstellt.'),
          'success'
        );
        if (typeof onSaveCallback === 'function') {
          onSaveCallback(saved);
        }
      } catch (err) {
        if (errBox) errBox.textContent = err.message;
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });

    this.showModal = showModal;
    this.hideModal = hideModal;
  }
}

export const configs = new ConfigManager();

if (typeof window !== 'undefined') {
  window.configs = configs;
  window.ConfigManager = ConfigManager;
  window.sanitizeDomains = sanitizeDomains;
  window.LLM_CATALOG = LLM_CATALOG;
  window.getConfigRunBreakdown = getConfigRunBreakdown;
}

// CommonJS compatibility export for test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LLM_CATALOG,
    DEFAULT_FALLBACK_LLMS,
    DEFAULT_SELECTED_LLMS,
    SCHEDULE_INTERVALS,
    getScheduleRunsPerDay,
    isHighFrequencySchedule,
    canUserUseScheduleInterval,
    calculateEstimatedCredits,
    getConfigRunBreakdown,
    getScheduleLabel,
    mapSavedTokenToCatalogId,
    sanitizeDomains,
    parsePrompts,
    parseCompetitors,
    ConfigManager,
    configs
  };
}
