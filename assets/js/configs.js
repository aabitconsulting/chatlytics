/**
 * assets/js/configs.js
 * Feature 29 / Feature 33: Tracking Configuration Manager & Data Mining Accuracy Tiers
 *
 * Handles:
 * - 4 Data Mining Accuracy tiers (12, 24, 48, 96 datasets/day per LLM)
 * - Unified OpenRouter Gateway & Batch-API metadata (batch_api <-> regular)
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
    fallback: 'Basis · 12 Analyse-Läufe / Tag pro LLM (alle 120 Min.)'
  },
  every_60m: {
    runsPerDay: 24,
    datasetsPerDay: 24,
    minutes: 60,
    highFreq: true,
    i18nKey: 'interval.every_60m',
    fallback: 'Standard · 24 Analyse-Läufe / Tag pro LLM (alle 60 Min.)'
  },
  every_30m: {
    runsPerDay: 48,
    datasetsPerDay: 48,
    minutes: 30,
    highFreq: true,
    i18nKey: 'interval.every_30m',
    fallback: 'Hoch · 48 Analyse-Läufe / Tag pro LLM (alle 30 Min.)'
  },
  every_15m: {
    runsPerDay: 96,
    datasetsPerDay: 96,
    minutes: 15,
    highFreq: true,
    i18nKey: 'interval.every_15m',
    fallback: 'Präzision · 96 Analyse-Läufe / Tag pro LLM (alle 15 Min.)'
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

export function canUserUseScheduleInterval(user, interval, plan = null) {
  if (user && String(user.role || '').toLowerCase() === 'admin') return true;
  const key = normalizeScheduleIntervalKey(interval);
  if (plan && Array.isArray(plan.allowed_intervals) && plan.allowed_intervals.length > 0) {
    return plan.allowed_intervals.includes(key);
  }
  if (!isHighFrequencySchedule(key)) return true;
  if (!user) return false;
  const tier = String(user.tier || 'free').toLowerCase();
  return tier !== 'free' && tier !== '';
}

export function canUserCustomizeModels(user, plan = null) {
  if (user && String(user.role || '').toLowerCase() === 'admin') return true;
  if (plan && plan.allow_custom_models !== undefined) {
    return Boolean(Number(plan.allow_custom_models) || plan.allow_custom_models === true);
  }
  const tier = String(user?.tier || 'free').toLowerCase();
  return tier === 'growth' || tier === 'enterprise_managed';
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
  { id: 'openai/gpt-6-luna', provider: 'openai', model: 'gpt-6-luna', label: 'OpenAI · GPT-6 Luna', euHosted: false, defaultChecked: true, supportsBatchApi: true, supportsTools: true, executionStrategy: 'batch_api' },
  { id: 'google/gemini-3.5-flash', provider: 'google', model: 'gemini-3.5-flash', label: 'Google · Gemini 3.5 Flash', euHosted: false, defaultChecked: true, supportsBatchApi: true, supportsTools: true, executionStrategy: 'batch_api' },
  { id: 'mistralai/mistral-medium-3-5', provider: 'mistralai', model: 'mistral-medium-3-5', label: 'Mistral · Medium 3.5', euHosted: false, defaultChecked: true, supportsBatchApi: true, supportsTools: true, executionStrategy: 'batch_api' },
  { id: 'mistralai/mistral-large-4-0', provider: 'mistralai', model: 'mistral-large-4-0', label: 'Mistral · Large 4.0', euHosted: false, defaultChecked: false, supportsBatchApi: false, supportsTools: true, executionStrategy: 'regular' },
  { id: 'z-ai/glm-5.3', provider: 'z-ai', model: 'glm-5.3', label: 'Z.ai · GLM 5.3', euHosted: false, defaultChecked: true, supportsBatchApi: true, supportsTools: true, executionStrategy: 'batch_api' },
  { id: 'z-ai/glm-5.3-flash', provider: 'z-ai', model: 'glm-5.3-flash', label: 'Z.ai · GLM 5.3 Flash', euHosted: false, defaultChecked: false, supportsBatchApi: true, supportsTools: true, executionStrategy: 'batch_api' }
];

export const DEFAULT_PRESETS = [
  {
    id: 'dach_core_baseline',
    name_de: 'Basis-Radar (Live-Suche)',
    name_en: 'Core Radar (Live Search)',
    description_de: 'Direktvergleich über OpenAI GPT-6 Luna und Google Gemini 3.5 Flash via OpenRouter inkl. Live-Websuche & Quellenzitaten.',
    description_en: 'Head-to-head benchmark across OpenAI GPT-6 Luna and Google Gemini 3.5 Flash via OpenRouter with live web search & citations.',
    badge_de: 'Standard',
    badge_en: 'Default',
    target_llms: ['openai/gpt-6-luna', 'google/gemini-3.5-flash'],
    search_enabled: true,
    allowed_tiers: ['free', 'starter', 'growth', 'enterprise_managed'],
    is_default: true,
    is_active: true
  },
  {
    id: 'parametric_brand_memory',
    name_de: 'Trainingswissen-Radar (Batch-API)',
    name_en: 'Pre-Trained Knowledge Radar (Batch API)',
    description_de: 'Prüft das reine Trainingswissen über OpenAI, Google Gemini und Mistral via OpenRouter Batch-API ohne Live-Websuche.',
    description_en: 'Evaluates pure pre-trained knowledge memory across OpenAI, Google Gemini, and Mistral via OpenRouter Batch API without live web search.',
    badge_de: 'Starter & höher',
    badge_en: 'Starter+',
    target_llms: ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-medium-3-5'],
    search_enabled: false,
    allowed_tiers: ['starter', 'growth', 'enterprise_managed'],
    is_default: false,
    is_active: true
  },
  {
    id: 'eu_sovereign_dsgvo',
    name_de: 'Europäisches Modell-Radar',
    name_en: 'European Model Radar',
    description_de: 'Modell-Mix aus Mistral Medium 3.5, Mistral Large 4.0 und Z.ai GLM 5.3 über das OpenRouter-Gateway.',
    description_en: 'Balanced comparison across Mistral Medium 3.5, Mistral Large 4.0, and Z.ai GLM 5.3 via OpenRouter.',
    badge_de: 'EU & GLM',
    badge_en: 'EU & GLM',
    target_llms: ['mistralai/mistral-medium-3-5', 'mistralai/mistral-large-4-0', 'z-ai/glm-5.3'],
    search_enabled: false,
    allowed_tiers: ['starter', 'growth', 'enterprise_managed'],
    is_default: false,
    is_active: true
  },
  {
    id: 'executive_full_spectrum',
    name_de: '360°-Radar (Alle Kernmodelle + Suche)',
    name_en: '360° Radar (All Core Models + Search)',
    description_de: 'Umfassende Multi-LLM-Abdeckung über OpenAI, Google Gemini, Mistral und Z.ai GLM inkl. Live-Websuche.',
    description_en: 'Complete multi-LLM coverage combining OpenAI, Google Gemini, Mistral, and Z.ai GLM with live web search.',
    badge_de: 'Vollabdeckung',
    badge_en: 'Full Coverage',
    target_llms: ['openai/gpt-6-luna', 'google/gemini-3.5-flash', 'mistralai/mistral-medium-3-5', 'z-ai/glm-5.3'],
    search_enabled: true,
    allowed_tiers: ['starter', 'growth', 'enterprise_managed'],
    is_default: false,
    is_active: true
  }
];

const DEFAULT_FALLBACK_LLMS = ['openai/gpt-6-luna', 'google/gemini-3.5-flash'];

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
  if (clean === 'openai') return 'openai/gpt-6-luna';
  if (clean === 'gemini' || clean === 'google' || clean === 'gemini/models/gemini-3.5-flash' || clean === 'models/gemini-3.5-flash') {
    return 'google/gemini-3.5-flash';
  }
  if (clean.startsWith('gemini/models/')) return 'google/' + clean.slice(14);
  if (clean.startsWith('gemini/')) return 'google/' + clean.slice(7);
  if (clean === 'mistral' || clean === 'mistral/mistral-medium-latest' || clean === 'mistral-medium-latest') {
    return 'mistralai/mistral-medium-3-5';
  }
  if (clean === 'mistral/mistral-large-latest' || clean === 'mistral-large-latest') {
    return 'mistralai/mistral-large-4-0';
  }
  if (clean === 'glm' || clean === 'mistral/zai-glm-5-3' || clean === 'zai-glm-5-3') {
    return 'z-ai/glm-5.3';
  }
  if (clean === 'mistral/zai-glm-5-3-flash' || clean === 'zai-glm-5-3-flash') {
    return 'z-ai/glm-5.3-flash';
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
    this.catalog = {
      allowed_models: LLM_CATALOG.map(m => ({ ...m, display_name: m.label, supports_web_search: true, supports_batch_api: Boolean(m.supportsBatchApi), supports_tools: m.supportsTools !== false, eu_hosted: false })),
      presets: DEFAULT_PRESETS,
      user_plan: null
    };
  }

  async loadConfigs() {
    try {
      const res = await apiClient.getConfigs();
      this.configs = Array.isArray(res.configs) ? res.configs : (Array.isArray(res) ? res : []);
      if (res && res.catalog) {
        this.catalog = {
          allowed_models: Array.isArray(res.catalog.allowed_models) && res.catalog.allowed_models.length > 0
            ? res.catalog.allowed_models
            : this.catalog.allowed_models,
          presets: Array.isArray(res.catalog.presets) && res.catalog.presets.length > 0
            ? res.catalog.presets
            : this.catalog.presets,
          user_plan: res.catalog.user_plan || null
        };
      }
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
      preset_id: formData.preset_id || null,
      custom_models_mode: Boolean(formData.custom_models_mode),
      target_llms: (Array.isArray(formData.target_llms) && formData.target_llms.length > 0) ? formData.target_llms : DEFAULT_FALLBACK_LLMS,
      search_enabled: formData.search_enabled !== undefined ? Boolean(formData.search_enabled) : true,
      schedule_interval: normalizedInterval,
      datasets_per_day: getScheduleRunsPerDay(normalizedInterval),
      status: formData.status || 'active'
    };

    if (!formData.promptsLocked) {
      payload.keywords_prompts = Array.isArray(formData.prompts) ? formData.prompts : parsePrompts(formData.prompts || '');
      payload.market_region = formData.market_region || null;
    }

    if (configId) {
      return await apiClient.updateConfig(configId, payload);
    } else {
      payload.keywords_prompts = Array.isArray(formData.prompts) ? formData.prompts : parsePrompts(formData.prompts || '');
      payload.market_region = formData.market_region || null;
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
      showToast(err?.message || (i18n ? i18n.t('toast.config_toggle_error', 'Status des Tracking-Profils konnte nicht geändert werden.') : 'Status des Tracking-Profils konnte nicht geändert werden.'), 'error');
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

  async stopConfig(config) {
    const id = typeof config === 'object' ? config?.id : config;
    if (!id) return null;
    const res = await apiClient.stopConfig(id);
    const updated = res?.config || res;
    const idx = this.configs.findIndex(c => String(c.id) === String(id));
    if (idx >= 0 && updated && updated.id) {
      this.configs[idx] = updated;
    } else if (idx >= 0) {
      this.configs[idx] = { ...this.configs[idx], status: 'stopped', is_stopped: true };
    }
    return updated;
  }

  async archiveConfig(config) {
    const id = typeof config === 'object' ? config?.id : config;
    if (!id) return null;
    const res = await apiClient.archiveConfig(id);
    const updated = res?.config || res;
    const idx = this.configs.findIndex(c => String(c.id) === String(id));
    if (idx >= 0 && updated && updated.id) {
      this.configs[idx] = updated;
    } else if (idx >= 0) {
      this.configs[idx] = { ...this.configs[idx], status: 'archived', is_stopped: true };
    }
    return updated;
  }

  async unarchiveConfig(config) {
    const id = typeof config === 'object' ? config?.id : config;
    if (!id) return null;
    const res = await apiClient.unarchiveConfig(id);
    const updated = res?.config || res;
    const idx = this.configs.findIndex(c => String(c.id) === String(id));
    if (idx >= 0 && updated && updated.id) {
      this.configs[idx] = updated;
    } else if (idx >= 0) {
      this.configs[idx] = { ...this.configs[idx], status: 'stopped', is_stopped: true };
    }
    return updated;
  }

  async deleteConfig(configId) {
    const id = typeof configId === 'object' ? configId?.id : configId;
    const res = await apiClient.deleteConfig(id);
    this.configs = this.configs.filter(c => String(c.id) !== String(id));
    return res;
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

    const getUiLang = () => {
      try {
        return localStorage.getItem('chatlytics_lang') === 'en' ? 'en' : 'de';
      } catch (_) {
        return 'de';
      }
    };

    const getEffectivePlan = (user) => {
      if (this.catalog && this.catalog.user_plan) return this.catalog.user_plan;
      const tier = String(user?.tier || 'free').toLowerCase();
      return {
        tier,
        allow_custom_models: tier === 'growth' || tier === 'enterprise_managed',
        allowed_intervals: tier === 'free' ? ['every_120m'] : ['every_120m', 'every_60m', 'every_30m', 'every_15m'],
        allowed_preset_ids: tier === 'free'
          ? ['dach_core_baseline']
          : ['dach_core_baseline', 'parametric_brand_memory', 'eu_sovereign_dsgvo', 'executive_full_spectrum']
      };
    };

    const getAllowedPresetsForUser = (user, plan) => {
      const allPresets = (this.catalog && Array.isArray(this.catalog.presets) && this.catalog.presets.length > 0)
        ? this.catalog.presets
        : DEFAULT_PRESETS;
      const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
      const tier = String(user?.tier || 'free').toLowerCase();
      const active = allPresets.filter(p => p && p.is_active !== false);
      if (isAdmin) return active;
      const planPresetIds = Array.isArray(plan?.allowed_preset_ids) ? plan.allowed_preset_ids : null;
      return active.filter(p => {
        if (planPresetIds && planPresetIds.length > 0) {
          return planPresetIds.includes(p.id);
        }
        return !Array.isArray(p.allowed_tiers) || p.allowed_tiers.includes(tier);
      });
    };

    const renderCustomModelsList = () => {
      const container = document.getElementById('cfg-llms-list');
      if (!container) return;
      const models = (this.catalog && Array.isArray(this.catalog.allowed_models) && this.catalog.allowed_models.length > 0)
        ? this.catalog.allowed_models
        : LLM_CATALOG;
      container.replaceChildren();
      models.forEach((m) => {
        const label = document.createElement('label');
        label.className = 'llm-option-card';

        const main = document.createElement('span');
        main.className = 'llm-option-main';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'cfg-llm-checkbox';
        cb.name = 'target_llms';
        cb.value = m.id;
        cb.checked = Boolean(m.is_default || m.defaultChecked);

        const textWrap = document.createElement('span');
        const titleEl = document.createElement('span');
        titleEl.className = 'llm-option-title';
        titleEl.textContent = m.display_name || m.label || m.id;
        const metaEl = document.createElement('span');
        metaEl.className = 'llm-option-meta';
        const isBatchCapable = Boolean(m.supports_batch_api || m.supportsBatchApi || m.execution_strategy === 'batch_api' || m.executionStrategy === 'batch_api');
        metaEl.textContent = `${m.id} · ${isBatchCapable ? 'OpenRouter Batch-API' : 'OpenRouter Standard-Lauf'}`;
        textWrap.append(titleEl, metaEl);
        main.append(cb, textWrap);
        label.appendChild(main);

        if (isBatchCapable) {
          const batchBadge = document.createElement('span');
          batchBadge.className = 'badge badge-secondary';
          batchBadge.textContent = ':batch';
          label.appendChild(batchBadge);
        }
        container.appendChild(label);
      });
    };

    const applyCatalogPolicyToModal = (config = null) => {
      const currentUser = auth.getUser();
      const userPlan = getEffectivePlan(currentUser);
      const canCustomize = canUserCustomizeModels(currentUser, userPlan);
      const allowedPresets = getAllowedPresetsForUser(currentUser, userPlan);
      const lang = getUiLang();

      const customSection = document.getElementById('cfg-custom-models-section');
      const lockedBanner = document.getElementById('cfg-custom-locked-banner');
      const modeBadge = document.getElementById('cfg-preset-mode-badge');
      const presetHidden = document.getElementById('cfg-preset-id');
      const presetsGrid = document.getElementById('cfg-presets-grid');

      if (modeBadge) {
        modeBadge.textContent = canCustomize
          ? i18n.t('config.presets_badge_template', 'Schnellauswahl + freie Modellwahl')
          : i18n.t('config.presets_badge_tier', 'Kuratiertes Analyse-Set');
      }
      if (lockedBanner) {
        lockedBanner.classList.toggle('hidden', canCustomize);
      }
      if (customSection) {
        customSection.classList.toggle('is-locked', !canCustomize);
      }
      form.querySelectorAll('.cfg-llm-checkbox').forEach((cb) => {
        cb.disabled = !canCustomize;
      });
      const searchToggleEl = document.getElementById('cfg-search-enabled');
      if (searchToggleEl) {
        searchToggleEl.disabled = !canCustomize;
      }

      let activePresetId = '';
      if (config && config.preset_id && allowedPresets.some(p => p.id === config.preset_id)) {
        activePresetId = config.preset_id;
      } else if (!canCustomize && config && Array.isArray(config.target_llms)) {
        const cfgSet = new Set(config.target_llms.map(mapSavedTokenToCatalogId).filter(Boolean));
        const cfgSearch = config.search_enabled !== undefined ? Boolean(Number(config.search_enabled) || config.search_enabled === true) : true;
        const matched = allowedPresets.find(p => {
          const pSet = new Set((p.target_llms || []).map(mapSavedTokenToCatalogId).filter(Boolean));
          if (pSet.size !== cfgSet.size) return false;
          for (const id of cfgSet) {
            if (!pSet.has(id)) return false;
          }
          return Boolean(p.search_enabled) === cfgSearch;
        });
        activePresetId = matched ? matched.id : (allowedPresets[0]?.id || '');
      } else if (!config && allowedPresets.length > 0) {
        const defPreset = allowedPresets.find(p => p.is_default) || allowedPresets[0];
        activePresetId = defPreset.id;
      }

      if (presetHidden) presetHidden.value = activePresetId;

      if (activePresetId && (!config || !canCustomize)) {
        const chosen = allowedPresets.find(p => p.id === activePresetId);
        if (chosen) {
          applyModelAndSearchFields(chosen.target_llms, chosen.search_enabled);
        }
      }

      if (!presetsGrid) return;
      presetsGrid.replaceChildren();
      allowedPresets.forEach((preset) => {
        const cardBtn = document.createElement('button');
        cardBtn.type = 'button';
        cardBtn.className = `preset-option-card${preset.id === activePresetId ? ' is-selected' : ''}`;
        cardBtn.setAttribute('role', 'radio');
        cardBtn.setAttribute('aria-checked', preset.id === activePresetId ? 'true' : 'false');
        cardBtn.dataset.presetId = preset.id;

        const topRow = document.createElement('div');
        topRow.className = 'preset-option-top';
        const nameEl = document.createElement('strong');
        nameEl.className = 'preset-option-title';
        nameEl.textContent = lang === 'en' ? (preset.name_en || preset.name_de) : (preset.name_de || preset.name_en);
        topRow.appendChild(nameEl);

        const badgeText = lang === 'en' ? (preset.badge_en || preset.badge_de) : (preset.badge_de || preset.badge_en);
        if (badgeText) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-secondary';
          badge.textContent = badgeText;
          topRow.appendChild(badge);
        }

        const descEl = document.createElement('p');
        descEl.className = 'preset-option-desc';
        descEl.textContent = lang === 'en' ? (preset.description_en || preset.description_de) : (preset.description_de || preset.description_en);

        const metaRow = document.createElement('div');
        metaRow.className = 'preset-option-meta';
        const llmBadge = document.createElement('span');
        llmBadge.className = 'badge badge-outline';
        llmBadge.textContent = `${(preset.target_llms || []).length} LLMs`;
        const searchBadge = document.createElement('span');
        searchBadge.className = `badge ${preset.search_enabled ? 'badge-active' : 'badge-muted'}`;
        searchBadge.textContent = preset.search_enabled
          ? (lang === 'en' ? 'Live Web Search: ON' : 'Live-Websuche: AN')
          : (lang === 'en' ? 'Batch API (No Search)' : 'Batch-API (ohne Live-Websuche)');
        metaRow.append(llmBadge, searchBadge);

        cardBtn.append(topRow, descEl, metaRow);
        cardBtn.addEventListener('click', () => {
          if (presetHidden) presetHidden.value = preset.id;
          applyModelAndSearchFields(preset.target_llms || DEFAULT_FALLBACK_LLMS, Boolean(preset.search_enabled));
          presetsGrid.querySelectorAll('.preset-option-card').forEach((el) => {
            const selected = el.dataset.presetId === preset.id;
            el.classList.toggle('is-selected', selected);
            el.setAttribute('aria-checked', selected ? 'true' : 'false');
          });
          updateCreditPreview();
        });

        presetsGrid.appendChild(cardBtn);
      });
    };
    const previewEl = document.getElementById('cfg-credit-preview');
    const intervalSelect = document.getElementById('cfg-interval');
    const promptsLockHint = document.getElementById('cfg-prompts-lock-hint');

    const applyIntervalTierConstraints = () => {
      if (!intervalSelect) return;
      const currentUser = auth.getUser();
      const userPlan = getEffectivePlan(currentUser);
      const allowHighFreq = canUserUseScheduleInterval(currentUser, 'every_60m', userPlan);
      Array.from(intervalSelect.options).forEach(opt => {
        opt.disabled = !canUserUseScheduleInterval(currentUser, opt.value, userPlan);
      });
      Array.from(intervalSelect.options).forEach(opt => {
        if (isHighFrequencySchedule(opt.value)) {
          opt.disabled = !canUserUseScheduleInterval(currentUser, opt.value, userPlan);
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
            'Mess-Frequenzen über Basis (24, 48 oder 96 Analyse-Läufe / Tag pro LLM) erfordern einen bezahlten Tarif: Starter, Growth oder Enterprise (Managed GEO).'
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
      titleSpan.textContent = i18n.t('config.credit_preview_title', 'Geschätzter Credit-Verbrauch (OpenRouter Batch optimiert)');
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
        i18n.t('config.credit_preview_per_run', 'Pro Audit-Lauf'),
        `${est.perRun} Credits`
      );
      appendStat(
        i18n.t('config.credit_preview_per_day', 'Pro Tag'),
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
          'Hinweis: Ihr aktuelles Guthaben deckt weniger als 1 Tag bei dieser Mess-Frequenz ab.'
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
      const regionSelectEl = document.getElementById('cfg-market-region');
      const regionCustomEl = document.getElementById('cfg-market-region-custom');
      const regionLockHintEl = document.getElementById('cfg-market-region-lock-hint');
      const applyMarketRegionFields = (rawRegion, locked) => {
        if (!regionSelectEl) return;
        const cleanReg = rawRegion ? String(rawRegion).trim() : '';
        const hasPresetOpt = Array.from(regionSelectEl.options).some(o => o.value && o.value !== '__custom__' && o.value === cleanReg);
        if (!cleanReg) {
          regionSelectEl.value = '';
          if (regionCustomEl) { regionCustomEl.value = ''; regionCustomEl.classList.add('hidden'); }
        } else if (hasPresetOpt) {
          regionSelectEl.value = cleanReg;
          if (regionCustomEl) { regionCustomEl.value = ''; regionCustomEl.classList.add('hidden'); }
        } else {
          regionSelectEl.value = '__custom__';
          if (regionCustomEl) { regionCustomEl.value = cleanReg; regionCustomEl.classList.remove('hidden'); }
        }
        regionSelectEl.disabled = Boolean(locked);
        if (regionCustomEl) regionCustomEl.disabled = Boolean(locked);
        if (regionLockHintEl) regionLockHintEl.classList.toggle('hidden', !locked);
      };

      renderCustomModelsList();
      if (config) {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_edit_title', 'Tracking-Profil bearbeiten');
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
        applyMarketRegionFields(config.market_region || null, isLocked);
        document.getElementById('cfg-competitors').value = (config.competitors || []).map(c => c.name || c).join(', ');
        ensureIntervalOption(config.schedule_interval || 'every_120m');
        const savedLlms = Array.isArray(config.target_llms) && config.target_llms.length > 0
          ? config.target_llms
          : DEFAULT_FALLBACK_LLMS;
        applyModelAndSearchFields(savedLlms, config.search_enabled !== undefined ? config.search_enabled : true);
      } else {
        if (titleEl) titleEl.textContent = i18n.t('config.modal_create_title', 'Neues Tracking-Profil anlegen');
        delete form.dataset.configStatus;
        delete form.dataset.configId;
        delete form.dataset.promptsLocked;
        form.reset();
        if (promptsEl) promptsEl.disabled = false;
        if (promptsLockHint) promptsLockHint.classList.add('hidden');
        applyMarketRegionFields(null, false);
        ensureIntervalOption('every_120m');
        applyModelAndSearchFields(DEFAULT_SELECTED_LLMS, true);
      }
      applyCatalogPolicyToModal(config);
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
    document.getElementById('cfg-market-region')?.addEventListener('change', (e) => {
      const customInput = document.getElementById('cfg-market-region-custom');
      if (!customInput) return;
      const showCustom = e.target?.value === '__custom__';
      customInput.classList.toggle('hidden', !showCustom);
      if (showCustom) customInput.focus();
    });
    const clearActivePresetOnManualEdit = () => {
      const currentUser = auth.getUser();
      const userPlan = getEffectivePlan(currentUser);
      if (!canUserCustomizeModels(currentUser, userPlan)) return;
      const presetHidden = document.getElementById('cfg-preset-id');
      if (presetHidden) presetHidden.value = '';
      document.getElementById('cfg-presets-grid')?.querySelectorAll('.preset-option-card').forEach((el) => {
        el.classList.remove('is-selected');
        el.setAttribute('aria-checked', 'false');
      });
    };
    document.getElementById('cfg-llms-list')?.addEventListener('change', (e) => {
      if (e.target && e.target.classList?.contains('cfg-llm-checkbox')) {
        clearActivePresetOnManualEdit();
        updateCreditPreview();
      }
    });
    document.getElementById('cfg-search-enabled')?.addEventListener('change', () => {
      clearActivePresetOnManualEdit();
      updateCreditPreview();
    });
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
      const name = document.getElementById('cfg-name')?.value.trim() || `${brandName} Profil`;
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
        if (errBox) errBox.textContent = 'Bitte hinterlegen Sie mindestens einen Prompt.';
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
        const regionSelVal = document.getElementById('cfg-market-region')?.value || '';
        const regionCustomVal = document.getElementById('cfg-market-region-custom')?.value.trim() || '';
        const marketRegion = regionSelVal === '__custom__'
          ? (regionCustomVal || null)
          : (regionSelVal || null);

        const saved = await this.saveConfig({
          name,
          brand_name: brandName,
          brand_domains: domains,
          prompts,
          market_region: marketRegion,
          promptsLocked,
          competitors: rawCompetitors,
          preset_id: document.getElementById('cfg-preset-id')?.value || null,
          custom_models_mode: Boolean(canUserCustomizeModels(auth.getUser(), getEffectivePlan(auth.getUser())) && !(document.getElementById('cfg-preset-id')?.value)),
          target_llms: selectedLlms,
          search_enabled: searchEnabled,
          schedule_interval: interval,
          status: configId ? (form.dataset.configStatus || 'active') : 'active'
        }, configId);

        hideModal();
        showToast(
          configId
            ? (i18n ? i18n.t('toast.config_saved', 'Tracking-Profil gespeichert.') : 'Tracking-Profil gespeichert.')
            : (i18n ? i18n.t('toast.config_created', 'Tracking-Profil erstellt.') : 'Tracking-Profil erstellt.'),
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
  window.DEFAULT_PRESETS = DEFAULT_PRESETS;
  window.canUserCustomizeModels = canUserCustomizeModels;
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
    DEFAULT_PRESETS,
    canUserCustomizeModels,
    ConfigManager,
    configs
  };
}
