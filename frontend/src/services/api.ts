import { 
  TririgaServer, 
  DashboardMetrics, 
  LogEntry, 
  LLMConfig, 
  AnalysisReport, 
  QueryPreset, 
  QueryResult, 
  LiveAgentMonitorData,
  WorkflowTelemetryData,
  GCTelemetryData,
  LockContentionData,
  TableBloatData,
  DataConnectOMData,
  LicenseUsageData,
  ClusterParityData,
  HealthScorecardData,
  ServerConfigDetails,
  ServerConfigComparisonData,
  PropertyFileContent,
  ClusteredPropertyFileResponse,
  AuthStatus,
  IngestionSchedule,
  StorageStats,
  ArchiveFile,
  StoragePruneResult,
  StorageSettings,
  WorkTaskQueryResponse,
  WorkTaskLiveTelemetry,
  WorkTaskRecord,
  WorkflowBottleneckItem,
  TririgaResolvedSpec,
  TririgaResolvedWorkflow,
  TririgaExtractAndResolveResult,
  TririgaUserDirectoryItem,
  TririgaUserDirectoryResponse
} from '../types';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && window.location) {
    let path = window.location.pathname;
    // Strip trailing file name if present (like index.html)
    path = path.replace(/\/[^/]+\.[^/]+$/, '');
    // Strip trailing slashes
    path = path.replace(/\/+$/, '');
    return path ? `${path}/api` : '/api';
  }
  return '/api';
};

export const BASE_URL = getApiBaseUrl();

export const getAuthToken = (): string => {
  try {
    return localStorage.getItem('tririga_auth_token') || '';
  } catch {
    return '';
  }
};

export const setAuthToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem('tririga_auth_token', token);
    } else {
      localStorage.removeItem('tririga_auth_token');
    }
  } catch {}
};

export interface ApiPerfRecord {
  url: string;
  durationMs: number;
  serverDurationMs?: number;
  timestamp: number;
}

const _perfHistory: ApiPerfRecord[] = [];
export const getApiPerfHistory = () => [..._perfHistory];

async function perfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) {
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('X-Auth-Token')) {
      headers.set('X-Auth-Token', token);
    }
  }

  const updatedInit: RequestInit = {
    ...init,
    headers,
  };

  const t0 = performance.now();
  const res = await fetch(input, updatedInit);
  const durationMs = Math.round(performance.now() - t0);
  const serverHeader = res.headers.get('x-response-time-ms');
  const serverDurationMs = serverHeader ? parseFloat(serverHeader) : undefined;
  
  const urlStr = typeof input === 'string' ? input : input.toString();
  _perfHistory.push({
    url: urlStr,
    durationMs,
    serverDurationMs,
    timestamp: Date.now(),
  });
  if (_perfHistory.length > 50) _perfHistory.shift();

  if (res.status === 401 && !urlStr.includes('/auth/')) {
    window.dispatchEvent(new CustomEvent('tririga_auth_required'));
  }

  const method = (init?.method || 'GET').toUpperCase();
  const cleanUrl = urlStr.startsWith('http') ? urlStr.replace(/^https?:\/\/[^/]+/, '') : urlStr;

  if (res.ok) {
    if (durationMs > 400) {
      console.warn(
        `%c[API SLOW]%c ${method} %c${cleanUrl} %c-> ${res.status} (${durationMs}ms, server: ${serverDurationMs ?? 'n/a'}ms)`,
        'color: #d97706; font-weight: bold;',
        'color: #2563eb; font-weight: bold;',
        'color: inherit;',
        'color: #b45309; font-weight: bold;'
      );
    } else {
      console.log(
        `%c[API]%c ${method} %c${cleanUrl} %c-> ${res.status} (${durationMs}ms)`,
        'color: #0284c7; font-weight: bold;',
        'color: #4f46e5; font-weight: bold;',
        'color: inherit;',
        'color: #16a34a; font-weight: bold;'
      );
    }
  } else {
    console.error(
      `%c[API ERROR]%c ${method} %c${cleanUrl} %c-> ${res.status} ${res.statusText} (${durationMs}ms)`,
      'color: #dc2626; font-weight: bold;',
      'color: #b91c1c; font-weight: bold;',
      'color: inherit;',
      'color: #dc2626; font-weight: bold;'
    );
  }

  return res;
}

export const api = {
  // Servers
  async getServers(): Promise<TririgaServer[]> {
    const res = await perfFetch(`${BASE_URL}/servers`);
    if (!res.ok) throw new Error('Failed to fetch servers');
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.sort((a: TririgaServer, b: TririgaServer) => {
      const nameA = (a.name || '').trim().toLowerCase();
      const nameB = (b.name || '').trim().toLowerCase();
      const rankA = nameA === 'prod app1' ? 1 : nameA === 'prod app2' ? 2 : 3;
      const rankB = nameB === 'prod app1' ? 1 : nameB === 'prod app2' ? 2 : 3;
      if (rankA !== rankB) return rankA - rankB;
      return nameA.localeCompare(nameB);
    });
  },

  async createServer(data: Partial<TririgaServer>): Promise<TririgaServer> {
    const res = await perfFetch(`${BASE_URL}/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create server');
    return res.json();
  },

  async updateServer(id: number, data: Partial<TririgaServer>): Promise<TririgaServer> {
    const res = await perfFetch(`${BASE_URL}/servers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update server');
    return res.json();
  },

  async deleteServer(id: number): Promise<void> {
    const res = await perfFetch(`${BASE_URL}/servers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete server');
  },

  async testConnection(data: Partial<TririgaServer>): Promise<{ success: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/servers/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async seedMockCluster(): Promise<{ success: boolean; message: string; created_count: number }> {
    const res = await perfFetch(`${BASE_URL}/servers/seed-mock-cluster`, { method: 'POST' });
    return res.json();
  },

  // Collector & Ingestion
  async syncServer(serverId: number): Promise<any> {
    const res = await perfFetch(`${BASE_URL}/collector/sync/${serverId}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Sync failed');
    }
    return res.json();
  },

  async syncAllServers(): Promise<any> {
    const res = await perfFetch(`${BASE_URL}/collector/sync-all`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Sync all failed');
    }
    return res.json();
  },

  async uploadLogFile(serverId: number, fileType: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('server_id', serverId.toString());
    formData.append('file_type', fileType);
    formData.append('file', file);
    const res = await perfFetch(`${BASE_URL}/collector/upload-log`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('File upload failed');
    return res.json();
  },

  async getIngestionSchedule(): Promise<IngestionSchedule> {
    const res = await perfFetch(`${BASE_URL}/collector/schedule`);
    if (!res.ok) throw new Error('Failed to fetch ingestion schedule');
    return res.json();
  },

  async updateIngestionSchedule(data: { is_enabled?: boolean; interval_minutes?: number }): Promise<IngestionSchedule> {
    const res = await perfFetch(`${BASE_URL}/collector/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update ingestion schedule');
    return res.json();
  },

  async triggerScheduledIngestionNow(): Promise<{ result: any; schedule: IngestionSchedule }> {
    const res = await perfFetch(`${BASE_URL}/collector/schedule/run-now`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to trigger scheduled ingestion run');
    return res.json();
  },

  async getMetrics(params?: {
    serverIds?: string;
    fileType?: string;
    filename?: string;
    logLevel?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<DashboardMetrics> {
    const query = new URLSearchParams();
    if (params?.serverIds) query.set('server_ids', params.serverIds);
    if (params?.fileType && params.fileType !== 'ALL') query.set('file_type', params.fileType);
    if (params?.filename && params.filename !== 'ALL') query.set('filename', params.filename);
    if (params?.logLevel && params.logLevel !== 'ALL') query.set('log_level', params.logLevel);
    if (params?.startDate) query.set('start_date', params.startDate);
    if (params?.endDate) query.set('end_date', params.endDate);
    if (params?.startTime) query.set('start_time', params.startTime);
    if (params?.endTime) query.set('end_time', params.endTime);
    
    const url = query.toString() ? `${BASE_URL}/logs/metrics?${query.toString()}` : `${BASE_URL}/logs/metrics`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },

  async getFilterOptions(): Promise<{
    servers: Array<{ id: number; name: string; host: string; log_count: number }>;
    file_types: Array<{ file_type: string; file_count: number }>;
    filenames: Array<{ filename: string; file_type: string; entry_count: number }>;
    log_levels: Array<{ log_level: string; count: number }>;
  }> {
    const res = await perfFetch(`${BASE_URL}/logs/filter-options`);
    if (!res.ok) throw new Error('Failed to fetch filter options');
    return res.json();
  },

  async queryLogs(params: {
    server_id?: number;
    server_ids?: string;
    log_level?: string;
    file_type?: string;
    filename?: string;
    search?: string;
    start_time?: string;
    end_time?: string;
    page?: number;
    page_size?: number;
  }): Promise<{ items: LogEntry[]; total: number; page: number; page_size: number; total_pages: number }> {
    const query = new URLSearchParams();
    if (params.server_ids) query.set('server_ids', params.server_ids);
    else if (params.server_id) query.set('server_id', params.server_id.toString());
    if (params.log_level && params.log_level !== 'ALL') query.set('log_level', params.log_level);
    if (params.file_type && params.file_type !== 'ALL') query.set('file_type', params.file_type);
    if (params.filename && params.filename !== 'ALL') query.set('filename', params.filename);
    if (params.search) query.set('search', params.search);
    if (params.start_time) query.set('start_time', params.start_time);
    if (params.end_time) query.set('end_time', params.end_time);
    if (params.page) query.set('page', params.page.toString());
    if (params.page_size) query.set('page_size', params.page_size.toString());

    const res = await perfFetch(`${BASE_URL}/logs?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to query logs');
    return res.json();
  },

  async getLogEntry(id: number): Promise<LogEntry> {
    const res = await perfFetch(`${BASE_URL}/logs/${id}`);
    if (!res.ok) throw new Error('Failed to fetch entry');
    return res.json();
  },

  async getLogContext(id: number, windowSeconds: number = 30, limit: number = 25): Promise<{
    anchor: LogEntry;
    window_seconds: number;
    surrounding: (LogEntry & { delta_seconds: number })[];
  }> {
    const res = await perfFetch(`${BASE_URL}/logs/${id}/context?window_seconds=${windowSeconds}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch log context window');
    return res.json();
  },

  async clearAllLogs(): Promise<{ success: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/logs/clear-all`, { method: 'DELETE' });
    return res.json();
  },

  // LLM Config
  async getLLMConfigs(): Promise<LLMConfig[]> {
    const res = await perfFetch(`${BASE_URL}/llm-config`);
    return res.json();
  },

  async getActiveLLMConfig(): Promise<LLMConfig> {
    const res = await perfFetch(`${BASE_URL}/llm-config/active`);
    return res.json();
  },

  async saveLLMConfig(data: Partial<LLMConfig>): Promise<LLMConfig> {
    const res = await perfFetch(`${BASE_URL}/llm-config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async testLLM(data: { provider: string; base_url: string; model_name: string }): Promise<{ success: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/llm-config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async discoverModels(provider: string, baseUrl: string): Promise<{ models: Array<{ id: string; name: string }> }> {
    const res = await perfFetch(`${BASE_URL}/llm-config/discover-models?provider=${provider}&base_url=${encodeURIComponent(baseUrl)}`);
    return res.json();
  },

  // Reports
  async getReports(): Promise<AnalysisReport[]> {
    const res = await perfFetch(`${BASE_URL}/analysis/reports`);
    return res.json();
  },

  async saveReport(data: Partial<AnalysisReport>): Promise<AnalysisReport> {
    const res = await perfFetch(`${BASE_URL}/analysis/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteReport(id: number): Promise<void> {
    await perfFetch(`${BASE_URL}/analysis/reports/${id}`, { method: 'DELETE' });
  },

  async exportDocx(title: string, markdownContent: string): Promise<void> {
    const res = await perfFetch(`${BASE_URL}/analysis/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, markdown_content: markdownContent }),
    });
    if (!res.ok) throw new Error('Failed to export Word document');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (title || 'tririga-log-audit-report').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safeTitle}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async exportSavedReportDocx(reportId: number, title?: string): Promise<void> {
    const res = await perfFetch(`${BASE_URL}/analysis/reports/${reportId}/export-docx`);
    if (!res.ok) throw new Error('Failed to export saved report as Word document');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (title || `tririga-report-${reportId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safeTitle}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Performance Monitoring
  async getPerfMetrics(): Promise<any> {
    const res = await perfFetch(`${BASE_URL}/perf/metrics`);
    if (!res.ok) throw new Error('Failed to fetch performance metrics');
    return res.json();
  },

  async resetPerfMetrics(): Promise<any> {
    const res = await perfFetch(`${BASE_URL}/perf/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset performance metrics');
    return res.json();
  },

  // DB2 Query Tool over HTTP
  async getDbQueryPresets(): Promise<QueryPreset[]> {
    const res = await perfFetch(`${BASE_URL}/db-query/presets`);
    if (!res.ok) throw new Error('Failed to fetch DB query presets');
    return res.json();
  },

  async validateDbQuery(sql: string): Promise<{ is_valid: boolean; error?: string }> {
    const res = await perfFetch(`${BASE_URL}/db-query/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    return res.json();
  },

  async executeDbQuery(params: {
    serverId?: number;
    customHost?: string;
    customPort?: number;
    customProtocol?: string;
    customAdminPath?: string;
    customUsername?: string;
    customPassword?: string;
    sql: string;
  }): Promise<QueryResult> {
    const res = await perfFetch(`${BASE_URL}/db-query/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_id: params.serverId,
        custom_host: params.customHost,
        custom_port: params.customPort,
        custom_protocol: params.customProtocol,
        custom_admin_path: params.customAdminPath,
        custom_username: params.customUsername,
        custom_password: params.customPassword,
        sql: params.sql,
      }),
    });
    return res.json();
  },

  // Live Agent & Thread Health Monitor
  async getLiveAgentMonitor(serverId?: number): Promise<LiveAgentMonitorData> {
    const url = serverId ? `${BASE_URL}/agent-monitor/live?server_id=${serverId}` : `${BASE_URL}/agent-monitor/live`;
    const res = await perfFetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch live agent monitor' }));
      throw new Error(err.detail || 'Failed to fetch live agent monitor');
    }
    return res.json();
  },

  // Operations Hub & Admin Telemetry
  async getWorkflowTelemetry(serverId?: number): Promise<WorkflowTelemetryData> {
    const url = serverId ? `${BASE_URL}/operations/workflow-telemetry?server_id=${serverId}` : `${BASE_URL}/operations/workflow-telemetry`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch workflow telemetry');
    return res.json();
  },

  async getGCTelemetry(serverId?: number): Promise<GCTelemetryData> {
    const url = serverId ? `${BASE_URL}/operations/gc-telemetry?server_id=${serverId}` : `${BASE_URL}/operations/gc-telemetry`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch GC telemetry');
    return res.json();
  },

  async getLockContention(serverId?: number): Promise<LockContentionData> {
    const url = serverId ? `${BASE_URL}/operations/lock-contention?server_id=${serverId}` : `${BASE_URL}/operations/lock-contention`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch lock contention');
    return res.json();
  },

  async getTableBloat(serverId?: number): Promise<TableBloatData> {
    const url = serverId ? `${BASE_URL}/operations/table-bloat?server_id=${serverId}` : `${BASE_URL}/operations/table-bloat`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch table bloat');
    return res.json();
  },

  async getDataConnectOM(serverId?: number): Promise<DataConnectOMData> {
    const url = serverId ? `${BASE_URL}/operations/dataconnect-om?server_id=${serverId}` : `${BASE_URL}/operations/dataconnect-om`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch DataConnect and OM data');
    return res.json();
  },

  async getLicenseUsage(serverId?: number, clusterMode?: boolean): Promise<LicenseUsageData> {
    const params = new URLSearchParams();
    if (serverId !== undefined) params.set('server_id', String(serverId));
    if (clusterMode) params.set('cluster_mode', 'true');
    const qs = params.toString();
    const url = qs ? `${BASE_URL}/operations/license-usage?${qs}` : `${BASE_URL}/operations/license-usage`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch license usage');
    return res.json();
  },

  async getUserDirectory(params?: {
    serverId?: number;
    status?: string;
    accountType?: string;
    org?: string;
    search?: string;
  }): Promise<TririgaUserDirectoryResponse> {
    const q = new URLSearchParams();
    if (params?.serverId !== undefined) q.set('server_id', String(params.serverId));
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.accountType && params.accountType !== 'all') q.set('account_type', params.accountType);
    if (params?.org && params.org !== 'all') q.set('org', params.org);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    const url = qs ? `${BASE_URL}/operations/users-directory?${qs}` : `${BASE_URL}/operations/users-directory`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch user directory');
    return res.json();
  },

  getUserDirectoryExportUrl(params?: {
    serverId?: number;
    status?: string;
    accountType?: string;
    org?: string;
    search?: string;
  }): string {
    const q = new URLSearchParams();
    if (params?.serverId !== undefined) q.set('server_id', String(params.serverId));
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.accountType && params.accountType !== 'all') q.set('account_type', params.accountType);
    if (params?.org && params.org !== 'all') q.set('org', params.org);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return qs ? `${BASE_URL}/operations/users-export.csv?${qs}` : `${BASE_URL}/operations/users-export.csv`;
  },

  async getClusterParity(): Promise<ClusterParityData> {
    const res = await perfFetch(`${BASE_URL}/operations/cluster-parity`);
    if (!res.ok) throw new Error('Failed to fetch cluster parity');
    return res.json();
  },

  async getHealthScorecard(serverId?: number): Promise<HealthScorecardData> {
    const url = serverId ? `${BASE_URL}/operations/health-scorecard?server_id=${serverId}` : `${BASE_URL}/operations/health-scorecard`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch health scorecard');
    return res.json();
  },

  async downloadDiagnosticBundle(serverId?: number): Promise<void> {
    const url = serverId ? `${BASE_URL}/operations/diagnostic-bundle?server_id=${serverId}` : `${BASE_URL}/operations/diagnostic-bundle`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to generate diagnostic bundle');
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `TRIRIGA_Diagnostic_Bundle_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  // Server Configuration & Performance Telemetry (machineMain.jsp & performanceMain.jsp)
  async getServerConfig(serverId: number): Promise<ServerConfigDetails> {
    const res = await perfFetch(`${BASE_URL}/server-config/server/${serverId}`);
    if (!res.ok) throw new Error(`Failed to fetch server config for server ${serverId}`);
    return res.json();
  },

  async compareServerConfigs(): Promise<ServerConfigComparisonData> {
    const res = await perfFetch(`${BASE_URL}/server-config/compare`);
    if (!res.ok) throw new Error('Failed to fetch server configuration comparison');
    const data = await res.json();
    if (!data) throw new Error('Server returned empty data. Backend server must be restarted to load new endpoints.');
    return data;
  },

  async getServerPropertyFile(serverId: number, propertyName: string): Promise<PropertyFileContent> {
    const res = await perfFetch(`${BASE_URL}/server-config/property-file?server_id=${serverId}&property_name=${encodeURIComponent(propertyName)}`);
    if (!res.ok) throw new Error(`Failed to fetch property file ${propertyName}`);
    return res.json();
  },

  async getClusteredPropertyFile(propertyName: string, clusterName?: string): Promise<ClusteredPropertyFileResponse> {
    const clusterParam = clusterName ? `&cluster_name=${encodeURIComponent(clusterName)}` : '';
    const res = await perfFetch(`${BASE_URL}/server-config/cluster-property-file?property_name=${encodeURIComponent(propertyName)}${clusterParam}`);
    if (!res.ok) throw new Error(`Failed to fetch clustered property file ${propertyName}`);
    return res.json();
  },

  // Authentication & Console Access
  async getAuthStatus(): Promise<AuthStatus> {
    try {
      const res = await perfFetch(`${BASE_URL}/auth/status`);
      if (!res.ok) {
        return { is_enabled: true, authenticated: false };
      }
      const cType = res.headers.get('content-type') || '';
      if (!cType.includes('application/json')) {
        return { is_enabled: true, authenticated: false };
      }
      return await res.json();
    } catch {
      return { is_enabled: true, authenticated: false };
    }
  },

  async login(password: string): Promise<{ success: boolean; token?: string; detail?: string }> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const cType = res.headers.get('content-type') || '';
    if (!cType.includes('application/json')) {
      if (res.status === 500 || res.status === 502 || res.status === 503) {
        throw new Error('Backend service is offline. Please ensure Python FastAPI service is running on TRIVIS.');
      }
      throw new Error(`Authentication server returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Invalid password');
    }
    return data;
  },

  async logout(): Promise<void> {
    try {
      await perfFetch(`${BASE_URL}/auth/logout`, { method: 'POST' });
    } catch {}
    setAuthToken(null);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to update master password');
    }
    return data;
  },

  async toggleAuth(isEnabled: boolean, password: string): Promise<{ success: boolean; is_enabled: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/auth/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: isEnabled, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to update console protection setting');
    }
    return data;
  },

  // Storage & Log Retention Management
  async getStorageStats(retentionDays?: number): Promise<StorageStats> {
    const url = retentionDays ? `${BASE_URL}/storage/stats?retention_days=${retentionDays}` : `${BASE_URL}/storage/stats`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch storage statistics');
    return res.json();
  },

  async getStorageSettings(): Promise<StorageSettings> {
    const res = await perfFetch(`${BASE_URL}/storage/settings`);
    if (!res.ok) throw new Error('Failed to fetch storage settings');
    return res.json();
  },

  async updateStorageSettings(settings: Partial<StorageSettings>): Promise<StorageSettings> {
    const res = await perfFetch(`${BASE_URL}/storage/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update storage settings');
    return res.json();
  },

  async archiveAndPruneLogs(body?: { retention_days?: number; compress_raw_logs?: boolean }): Promise<StoragePruneResult> {
    const res = await perfFetch(`${BASE_URL}/storage/archive-and-prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to archive and prune logs');
    return data;
  },

  async getArchives(): Promise<ArchiveFile[]> {
    const res = await perfFetch(`${BASE_URL}/storage/archives`);
    if (!res.ok) throw new Error('Failed to fetch archive list');
    return res.json();
  },

  async downloadArchive(filename: string): Promise<void> {
    const downloadUrl = `${BASE_URL}/storage/archives/${encodeURIComponent(filename)}/download`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async deleteArchive(filename: string): Promise<{ success: boolean; message: string }> {
    const res = await perfFetch(`${BASE_URL}/storage/archives/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to delete archive');
    return data;
  },

  async restoreArchive(filename: string): Promise<{ success: boolean; message: string; restored_entries?: number }> {
    const res = await perfFetch(`${BASE_URL}/storage/archives/${encodeURIComponent(filename)}/restore`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to restore archive');
    return data;
  },

  // ==========================================
  // WorkTask Slow Query & Lock Contention Tooling
  // ==========================================

  async getWorkTaskQueriesAndContention(params?: {
    serverId?: number;
    serverIds?: string;
    issueType?: string;
    minDurationMs?: number;
    search?: string;
    worktaskIdentifier?: string;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  }): Promise<WorkTaskQueryResponse> {
    const q = new URLSearchParams();
    if (params?.serverId) q.set('server_id', String(params.serverId));
    if (params?.serverIds) q.set('server_ids', params.serverIds);
    if (params?.issueType && params.issueType !== 'ALL') q.set('issue_type', params.issueType);
    if (params?.minDurationMs !== undefined) q.set('min_duration_ms', String(params.minDurationMs));
    if (params?.search) q.set('search', params.search);
    if (params?.worktaskIdentifier) q.set('worktask_identifier', params.worktaskIdentifier);
    if (params?.startTime) q.set('start_time', params.startTime);
    if (params?.endTime) q.set('end_time', params.endTime);
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('page_size', String(params.pageSize));

    const res = await perfFetch(`${BASE_URL}/worktasks/queries-and-contention?${q.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch worktask queries and contention incidents');
    return res.json();
  },

  async getWorkTaskLiveTelemetry(serverId?: number): Promise<WorkTaskLiveTelemetry> {
    const q = serverId ? `?server_id=${serverId}` : '';
    const res = await perfFetch(`${BASE_URL}/worktasks/live-telemetry${q}`);
    if (!res.ok) throw new Error('Failed to fetch live worktask telemetry');
    return res.json();
  },

  async getWorkTaskRecord(identifier: string): Promise<WorkTaskRecord> {
    const res = await perfFetch(`${BASE_URL}/worktasks/record/${encodeURIComponent(identifier)}`);
    if (!res.ok) throw new Error(`Failed to resolve work task record '${identifier}'`);
    return res.json();
  },

  async getWorkTaskWorkflowBottlenecks(serverId?: number): Promise<{ bottlenecks: WorkflowBottleneckItem[] }> {
    const url = serverId ? `${BASE_URL}/worktasks/workflow-bottlenecks?server_id=${serverId}` : `${BASE_URL}/worktasks/workflow-bottlenecks`;
    const res = await perfFetch(url);
    if (!res.ok) throw new Error('Failed to fetch worktask workflow bottlenecks');
    return res.json();
  },

  // ==========================================
  // TRIRIGA Record & Workflow Resolution
  // ==========================================

  async resolveSpec(specId: number): Promise<TririgaResolvedSpec> {
    const res = await perfFetch(`${BASE_URL}/tririga/resolve-spec/${specId}`);
    if (!res.ok) throw new Error(`Failed to resolve Spec ID ${specId}`);
    return res.json();
  },

  async resolveWorkflow(wfId: number): Promise<TririgaResolvedWorkflow> {
    const res = await perfFetch(`${BASE_URL}/tririga/resolve-workflow/${wfId}`);
    if (!res.ok) throw new Error(`Failed to resolve Workflow ID ${wfId}`);
    return res.json();
  },

  async resolveRecordIdentifier(identifier: string, includeLogs: boolean = false): Promise<TririgaResolvedSpec> {
    const res = await perfFetch(`${BASE_URL}/tririga/resolve/${encodeURIComponent(identifier)}?include_logs=${includeLogs}`);
    if (!res.ok) throw new Error(`Failed to resolve record identifier '${identifier}'`);
    return res.json();
  },

  async getRecordAssociatedLogs(identifier: string, limit: number = 15): Promise<{ identifier: string; count: number; logs: any[] }> {
    const res = await perfFetch(`${BASE_URL}/tririga/resolve/${encodeURIComponent(identifier)}/logs?limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to scan logs for record '${identifier}'`);
    return res.json();
  },

  async extractAndResolveRecords(text: string): Promise<TririgaExtractAndResolveResult> {
    const res = await perfFetch(`${BASE_URL}/tririga/extract-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('Failed to extract and resolve TRIRIGA records');
    return res.json();
  },
};



