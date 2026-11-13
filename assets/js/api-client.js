/**
 * assets/js/api-client.js
 * Feature 29: Modular Client-Side JavaScript Suite — Universal API Client
 *
 * Handles:
 * - JSON request/response envelopes
 * - Bearer token injection for authenticated sessions
 * - X-Audit-Token / ?audit_token injection for Magic Audit preview mode
 * - Robust error handling with error extraction
 * - Zero build-step pure ES6 module export
 */

export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = this.loadToken();
    this.auditToken = this.loadAuditToken();
  }

  loadToken() {
    try {
      return localStorage.getItem('chatlytics_token') || null;
    } catch (_) {
      return null;
    }
  }

  loadAuditToken() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('audit_token') || null;
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
  }

  setAuditToken(auditToken) {
    this.auditToken = auditToken;
  }

  buildHeaders(customHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...customHeaders
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.auditToken) {
      headers['X-Audit-Token'] = this.auditToken;
    }

    return headers;
  }

  buildUrl(endpoint, params = {}) {
    let url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;
    const queryParams = new URLSearchParams();

    // Auto-inject audit token into query string for GET requests to reports/configs
    if (this.auditToken && !params.audit_token) {
      queryParams.set('audit_token', this.auditToken);
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        queryParams.set(key, String(value));
      }
    }

    const qs = queryParams.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }

    return url;
  }

  async request(endpoint, options = {}) {
    const { method = 'GET', data = null, params = {}, headers: customHeaders = {} } = options;
    const url = this.buildUrl(endpoint, params);
    const headers = this.buildHeaders(customHeaders);

    const fetchConfig = {
      method: method.toUpperCase(),
      headers,
      credentials: 'same-origin'
    };

    if (data && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      fetchConfig.body = typeof data === 'string' ? data : JSON.stringify(data);
    }

    let response;
    try {
      response = await fetch(url, fetchConfig);
    } catch (networkError) {
      throw new Error(`Netzwerkfehler: ${networkError.message}`);
    }

    let responsePayload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        responsePayload = await response.json();
      } catch (_) {
        responsePayload = null;
      }
    } else {
      const text = await response.text();
      responsePayload = { message: text };
    }

    if (!response.ok) {
      const errorMessage = responsePayload?.message
        || (responsePayload?.data && responsePayload.data.message)
        || `API error: HTTP ${response.status}`;
      const err = new Error(errorMessage);
      err.status = response.status;
      err.data = responsePayload;
      throw err;
    }

    if (responsePayload && typeof responsePayload === 'object' && responsePayload.status === 'error') {
      const err = new Error(responsePayload.message || 'API operation returned error status');
      err.status = response.status;
      err.data = responsePayload;
      throw err;
    }

    return responsePayload;
  }

  get(endpoint, params = {}) {
    return this.request(endpoint, { method: 'GET', params });
  }

  post(endpoint, data = {}, params = {}) {
    return this.request(endpoint, { method: 'POST', data, params });
  }

  put(endpoint, data = {}, params = {}) {
    return this.request(endpoint, { method: 'PUT', data, params });
  }

  delete(endpoint, data = {}, params = {}) {
    return this.request(endpoint, { method: 'DELETE', data, params });
  }

  // --- Domain Methods ---

  // Auth
  async login(email, password) {
    const res = await this.post('api/auth.php?action=login', { email, password });
    const token = res.token || res.data?.token;
    if (token) {
      this.setToken(token);
    }
    return res.data || res;
  }

  async signup(email, password, companyName = '') {
    const res = await this.post('api/auth.php?action=signup', {
      email,
      password,
      company_name: companyName
    });
    const token = res.token || res.data?.token;
    if (token) {
      this.setToken(token);
    }
    return res.data || res;
  }

  async logout() {
    try {
      await this.post('api/auth.php?action=logout');
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    const res = await this.get('api/auth.php?action=me');
    return res.data || res;
  }

  // Reports / Analytics
  async getReports(params = {}) {
    const res = await this.get('api/reports.php', params);
    return res.data || res;
  }

  // Per-User Physical Results Table Lookup
  async getUserResults(params = {}) {
    const res = await this.get('api/user_results.php', params);
    return res.data || res;
  }

  // Configs CRUD
  async getConfigs() {
    const res = await this.get('api/configs.php');
    return res.data || res;
  }

  async getConfig(id) {
    const res = await this.get('api/configs.php', { id });
    return res.data || res;
  }

  async createConfig(configData) {
    const res = await this.post('api/configs.php', configData);
    return res.data || res;
  }

  async updateConfig(id, configData) {
    const res = await this.put(`api/configs.php?id=${id}`, configData);
    return res.data || res;
  }

  async fullStartConfig(id) {
    const res = await this.put(`api/configs.php?id=${id}`, { action: 'full_start' });
    return res.data || res;
  }

  async deleteConfig(id) {
    const res = await this.delete(`api/configs.php?id=${id}`);
    return res.data || res;
  }

  // Trigger Execution (One-Time Pre-Start Test Run)
  async getRunStatus(runId) {
    const res = await this.get('api/reports.php', { action: 'run_status', run_id: runId });
    return res.data || res;
  }

  async triggerRun(configId, options = {}) {
    const payload = {
      config_id: configId,
      response_mode: options.mode || 'async',
      ...options
    };
    const res = await this.post('api/trigger_run.php', payload);
    return res.data || res;
  }
}

// Global Singleton Instance
export const apiClient = new ApiClient();

if (typeof window !== 'undefined') {
  window.apiClient = apiClient;
  window.ApiClient = ApiClient;
}

// CommonJS compatibility export for test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ApiClient,
    apiClient,
    buildHeaders: (token, auditToken) => {
      const client = new ApiClient();
      client.token = token;
      client.auditToken = auditToken;
      return client.buildHeaders();
    }
  };
}
