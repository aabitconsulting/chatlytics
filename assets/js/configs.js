/**
 * assets/js/configs.js
 * Feature 29 / Feature 33: Tracking Configuration Manager & Data Mining Accuracy Tiers
 *
 * Handles:
 * - 4 Data Mining Accuracy tiers (12, 24, 48, 96 datasets/day per LLM)
 * - 3-Tier Provider Cost-Optimization metadata (prompt_caching -> batch_api -> regular)
 * - Flow B Lifecycle: One-Time Test Run before Full Start, Post-Start Prompt Immutability
 * - Sanitizing brand and competitor domain inputs (RFC URL parsing & protocol stripping)
 * - CRUD operations via apiClient
 */

import { apiClient } from './api-client.js';
import { auth } from './auth.js';
import { i18n } from './i18n.js';
import { showToast, setButtonLoading } from './notifications.js';

export const SCHEDULE_INTERVALS = {
  every_120m: {
    runsPerDay: 12,
    datasetsPerDay: 12,
    minutes: 120,
    highFreq: false,
    i18nKey: 'interval.every_120m',
    fallback: 'Starter · 12 Datensätze / Tag pro LLM (alle 120 Min.)'
  },
  every_60m: {
    runsPerDay: 24,
    datasetsPerDay: 24,
    minutes: 60,
    highFreq: true,
    i18nKey: 'interval.every_60m',
    fallback: 'Standard · 24 Datensätze / Tag pro LLM (alle 60 Min.)'
  },
  every_30m: {
    runsPerDay: 48,
    datasetsPerDay: 48,
    minutes: 30,
    highFreq: true,
    i18nKey: 'interval.every_30m',
    fallback: 'High · 48 Datensätze / Tag pro LLM (alle 30 Min.)'
  },
  every_15m: {
    runsPerDay: 96,
    datasetsPerDay: 96,
    minutes: 15,
    highFreq: true,
    i18nKey: 'interval.every_15m',
    fallback: 'Precision · 96 Datensätze / Tag pro LLM (alle 15 Min.)'
  }
};

export function normalizeScheduleIntervalKey(interval) {
  const key = String(interval || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SCHEDULE_INTERVALS, key)) {
    return key;
  }
  const legacyMap = {
    '12': 'every_120m',
    '24': 'every_60m',
    '48': 'every_30m',
    '96': 'every_15m',
    'every_2h': 'every_120m',
    'every_1h': 'every_60m',
    'hourly': 'every_60m',
    'every_4h': 'every_120m',
    'every_6h': 'every_120m',
    'every_12h': 'every_120m',
    'daily': 'every_120m',
    'weekly': 'every_120m',
    'biweekly': 'every_120m',
    'monthly': 'every_120m',
    'manual': 'every_120m'
  };
  return legacyMap[key] || 'every_120m';
}

export function getScheduleRunsPerDay(interval) {
  const key = normalizeScheduleIntervalKey(interval);
  return SCHEDULE_INTERVALS[key]?.runsPerDay || 12;
}

export function isHighFrequencySchedule(interval) {
  const key = normalizeScheduleIntervalKey(interval);
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
  return { perRun, runsPerDay, datasetsPerDayPerLlm: runsPerDay, perDay, perMonth };
}

export function getScheduleLabel(interval) {
  const key = normalizeScheduleIntervalKey(interval);
  const meta = SCHEDULE_INTERVALS[key] || SCHEDULE_INTERVALS.every_120m;
  return i18n && typeof i18n.t === 'function'
    ? i18n.t(meta.i18nKey, meta.fallback)
    : meta.fallback;
}

export const LLM_CATALOG = [
  { id: 'openai/gpt-6-luna', provider: 'openai', model: 'gpt-6-luna', label: 'OpenAI · GPT-6 Luna', euHosted: false, defaultChecked: true, executionStrategy: 'prompt_caching' },
  { id: 'gemini/models/gemini-3.5-flash', provider: 'gemini', model: 'models/gemini-3.5-flash', label: 'Google · Gemini 3.5 Flash', euHosted: false, defaultChecked: true, executionStrategy: 'prompt_caching' },
  { id: 'mistral/mistral-medium-latest', provider: 'mistral', model: 'mistral-medium-latest', label: 'Mistral Medium Latest', euHosted: true, defaultChecked: true, executionStrategy: 'prompt_caching' },
  { id: 'mistral/mistral-large-latest', provider: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large Latest', euHosted: true, defaultChecked: false, executionStrategy: 'prompt_caching' },
  { id: 'mistral/zai-glm-5-3', provider: 'mistral', model: 'zai-glm-5-3', label: 'Z.ai GLM 5.3 (Mistral EU)', euHosted: true, defaultChecked: true, executionStrategy: 'regular' },
  { id: 'mistral/zai-glm-5-3-flash', provider: 'mistral', model: 'zai-glm-5-3-flash', label: 'Z.ai GLM 5.3 Flash (Mistral EU)', euHosted: true, defaultChecked: false, executionStrategy: 'regular' }
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
    const normalizedInterval = normalizeScheduleIntervalKey(formData.schedule_interval || 'every_120m');
    const payload = {
      name: formData.name || `${formData.brand_name} Tracking`,
      brand_name: formData.brand_name,
      brand_domains: Array.isArray(formData.brand_domains) ? formData.brand_domains : sanitizeDomains(formData.brand_domains || ''),
      competitors: Array.isArray(formData.competitors) ? formData.competitors : parseCompetitors(formData.competitors || ''),
      target_llms: (Array.isArray(formData.target_llms) && formData.target_llms.length > 0) ? formData.target_llms : DEFAULT_FALLBACK_LLMS,
      search_enabled: formData.search_enabled !== undefined ? Boolean(formData.search_enabled) : true,
      schedule_interval: normalizedInterval,
      datasets_per_day: getScheduleRunsPerDay(normalizedInterval),
      status: formData.status || 'active'
    };

    if (!formData.promptsLocked) {
      payload.keywords_prompts = Array.isArray(formData.prompts) ? formData.prompts : parsePrompts(formData.prompts || '');
    }

    if (configId) {
      return await apiClient.updateConfig(configId, payload);
    } else {
      payload.keywords_prompts = Array.isArray(formData.prompts) ? formData.prompts : parsePrompts(formData.prompts || '');
      return await apiClient.createConfig(payload);
    }
  }

  async fullStartConfig(config) {
    if (!config || !config.id) return null;
    const res = await apiClient.fullStartConfig(config.id);
    const updated = res?.config || res;
    const idx = this.configs.findIndex(c => String(c.id) === String(config.id));
    if (idx >= 0 && updated && updated.id) {
      this.configs[idx] = updated;
    }
    return updated;
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
    const promptsLockHint = document.getElementById('cfg-prompts-lock-hint');

    const applyIntervalTierConstraints = () => {
      if (!intervalSelect) return;
      const currentUser = auth.getUser();
      const allowHighFreq = canUserUseScheduleInterval(currentUser, 'every_60m');
      Array.from(intervalSelect.options).forEach(opt => {
        if (isHighFrequencySchedule(opt.value)) {
          opt.disabled = !allowHighFreq;
        }
      });
      if (!allowHighFreq && isHighFrequencySchedule(intervalSelect.value)) {
        intervalSelect.value = 'every_120m';
      }
      if (tierHintEl) {
        if (allowHighFreq) {
          tierHintEl.classList.add('hidden');
          tierHintEl.textContent = '';
        } else {
          tierHintEl.classList.remove('hidden');
          tierHintEl.textContent = i18n.t(
            'config.tier_hint_free',
            'Data-Mining-Genauigkeit über 12 Datensätze/Tag (24, 48 oder 96 Datensätze/Tag pro LLM) erfordert einen bezahlten Tarif (Starter, Growth oder Enterprise).'
          );
        }
      }
    };

    const updateCreditPreview = () => {
      if (!previewEl) return;
      const prompts = parsePrompts(document.getElementById('cfg-prompts')?.value || '');
      const llmCount = form.querySelectorAll('.cfg-llm-checkbox:checked').length;
      const interval = normalizeScheduleIntervalKey(intervalSelect?.value || 'every_120m');
      const est = calculateEstimatedCredits(prompts.length, llmCount, interval);
      const balanceRaw = auth.getUser()?.credits_remaining;
      const hasBalance = balanceRaw !== undefined && balanceRaw !== null && !isNaN(Number(balanceRaw));
      const balance = hasBalance ? Number(balanceRaw) : null;

      previewEl.replaceChildren();

      const header = document.createElement('div');
      header.className = 'cfg-credit-preview-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'cfg-credit-preview-title';
      titleSpan.textContent = i18n.t('config.credit_preview_title', 'Geschätzter Credit-Verbrauch (Prompt-Caching & Batch optimiert)');
      const formulaSpan = document.createElement('span');
      formulaSpan.className = 'cfg-credit-preview-formula font-mono';
      formulaSpan.textContent = `${prompts.length} × ${llmCount} × ${est.runsPerDay}/d`;
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
        i18n.t('config.credit_preview_per_run', 'Pro Durchlauf'),
        `${est.perRun} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_per_day', 'Pro Tag (Gesamt)'),
        `${est.perDay} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_per_month', 'Pro Monat (~30 Tage)'),
        `${Math.round(est.perMonth)} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_balance', 'Aktuelles Guthaben'),
        hasBalance ? `${balance} Credits` : '—'
      );

      previewEl.append(header, grid);

      if (hasBalance && est.perDay > 0 && balance < est.perDay) {
        const warn = document.createElement('p');
        warn.className = 'cfg-credit-warning';
        warn.textContent = i18n.t(
          'config.credit_preview_low_warning',
          'Hinweis: Ihr aktuelles Guthaben deckt weniger als 1 vollen Kalendertag bei dieser Data-Mining-Genauigkeit ab.'
        );
        previewEl.appendChild(warn);
      }
    };

    const ensureIntervalOption = (value) => {
      if (!intervalSelect) return;
      const normVal = normalizeScheduleIntervalKey(value || 'every_120m');
      const exists = Array.from(intervalSelect.options).some(opt => opt.value === normVal);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = normVal;
        opt.textContent = getScheduleLabel(normVal);
        intervalSelect.appendChild(opt);
      }
      intervalSelect.value = normVal;
    };

    const showModal = (config = null) => {
      if (errBox) errBox.textContent = '';
      const promptsEl = document.getElementById('cfg-prompts');
      if (config) {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_edit_title', 'Tracking-Konfiguration bearbeiten');
        form.dataset.configStatus = config.status || 'active';
        form.dataset.configId = config.id;
        const isLocked = Boolean(config.is_full_started || config.full_started_at);
        form.dataset.promptsLocked = isLocked ? '1' : '0';
        document.getElementById('cfg-name').value = config.name || '';
        document.getElementById('cfg-brand').value = config.brand_name || '';
        document.getElementById('cfg-domains').value = (config.brand_domains || []).join(', ');
        if (promptsEl) {
          promptsEl.value = (config.keywords_prompts || config.prompts || []).join('\n');
          promptsEl.disabled = isLocked;
        }
        if (promptsLockHint) {
          if (isLocked) promptsLockHint.classList.remove('hidden');
          else promptsLockHint.classList.add('hidden');
        }
        document.getElementById('cfg-competitors').value = (config.competitors || []).map(c => c.name || c).join(', ');
        ensureIntervalOption(config.schedule_interval || 'every_120m');
        const savedLlms = Array.isArray(config.target_llms) && config.target_llms.length > 0
          ? config.target_llms
          : DEFAULT_FALLBACK_LLMS;
        applyModelAndSearchFields(savedLlms, config.search_enabled !== undefined ? config.search_enabled : true);
      } else {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_create_title', 'Neue Tracking-Konfiguration anlegen');
        delete form.dataset.configStatus;
        delete form.dataset.configId;
        delete form.dataset.promptsLocked;
        form.reset();
        if (promptsEl) promptsEl.disabled = false;
        if (promptsLockHint) promptsLockHint.classList.add('hidden');
        ensureIntervalOption('every_120m');
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
      const promptsLocked = form.dataset.promptsLocked === '1';
      const brandName = document.getElementById('cfg-brand')?.value.trim();
      const rawDomains = document.getElementById('cfg-domains')?.value.trim();
      const rawPrompts = document.getElementById('cfg-prompts')?.value.trim();
      const rawCompetitors = document.getElementById('cfg-competitors')?.value.trim();
      const name = document.getElementById('cfg-name')?.value.trim() || `${brandName} Tracking`;
      const interval = normalizeScheduleIntervalKey(document.getElementById('cfg-interval')?.value || 'every_120m');

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
      if (!promptsLocked && prompts.length === 0) {
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
          promptsLocked,
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
    normalizeScheduleIntervalKey,
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
