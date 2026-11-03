export interface TririgaServer {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'ssh';
  admin_path: string;
  username?: string;
  password?: string;
  auth_type: string;
  ssh_key_path?: string;
  remote_log_dir: string;
  status: 'configured' | 'online' | 'error' | 'syncing';
  cluster_name?: string;
  last_sync_at?: string;
  created_at: string;
  files_count?: number;
  total_entries?: number;
  total_errors?: number;
  total_warns?: number;
}

export interface LogFile {
  id: number;
  server_id: number;
  filename: string;
  file_type: string;
  local_path: string;
  size_bytes: number;
  downloaded_at: string;
  status: string;
  entry_count: number;
  error_count: number;
  warn_count: number;
}

export interface LogEntry {
  id: number;
  server_id: number;
  file_id: number;
  timestamp: string;
  log_level: 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'SYSTEM';
  logger_name?: string;
  thread_name?: string;
  message: string;
  stack_trace?: string;
  error_hash?: string;
  line_number?: number;
  server_name?: string;
  filename?: string;
  file_type?: string;
  raw_content?: string;
  is_archived?: boolean;
  archive_source?: string;
  correlated_id?: number;
  correlated_message?: string;
  correlated_timestamp?: string;
  correlated_level?: string;
  correlated_logger?: string;
  correlated_thread?: string;
  delta_seconds?: number;
}

export interface DashboardMetrics {
  summary: {
    total_entries: number;
    total_errors: number;
    total_warns: number;
    total_infos: number;
    active_servers: number;
    total_files: number;
  };
  server_stats: Array<{
    server_id: number;
    server_name: string;
    total_entries: number;
    error_count: number;
    warn_count: number;
  }>;
  top_errors: Array<{
    error_hash: string;
    log_level: string;
    logger_name: string;
    message: string;
    count: number;
    first_seen: string;
    last_seen: string;
    server_name: string;
    filename?: string;
    file_type?: string;
  }>;
  timeline: Array<{
    time_bucket: string;
    errors: number;
    warns: number;
    infos: number;
    total: number;
  }>;
}

export interface LLMConfig {
  id: number;
  provider: 'ollama' | 'lm_studio' | 'openai_compatible';
  base_url: string;
  model_name: string;
  temperature: number;
  context_window: number;
  is_active: number;
}

export interface AnalysisReport {
  id: number;
  title: string;
  created_at: string;
  model_used: string;
  provider: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  summary: string;
  raw_report: string;
  server_ids?: string;
  total_logs_analyzed?: number;
  total_errors_analyzed?: number;
}

export interface QueryPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  sql: string;
}

export interface QueryResult {
  success: boolean;
  error?: string;
  message?: string;
  notice?: string;
  columns: string[];
  rows: Array<Record<string, any>>;
  row_count: number;
  execution_time_ms: number;
  source?: string;
}

export interface LiveThread {
  id: string;
  name: string;
  state: string;
  subsystem: string;
  db_blocked: boolean;
  stack_trace: string;
}

export interface ThreadSummary {
  total: number;
  runnable: number;
  waiting: number;
  blocked: number;
  db_blocked: number;
  by_subsystem: Record<string, number>;
}

export interface WFEventSummary {
  total_queued: number;
  events: Array<{
    EVENT_NAME?: string;
    STATUS?: string;
    EVENT_COUNT?: number | string;
    [key: string]: any;
  }>;
}

export interface BusinessConnectUserSession {
  user_name: string;
  full_name: string;
  ip_address: string;
  host_name: string;
  active_sessions: number;
  latest_login: string;
  is_business_connect: boolean;
}

export interface QueuedLoginUser {
  user_name: string;
  full_name: string;
  queued_count: number;
}

export interface BusinessConnectSummary {
  total_active_bc: number;
  total_active_interactive: number;
  bc_users: BusinessConnectUserSession[];
  interactive_users: BusinessConnectUserSession[];
  queued_login_users: QueuedLoginUser[];
}

export interface LiveAgentMonitorData {
  success: boolean;
  is_online: boolean;
  server_id?: number;
  server_name?: string;
  server_host?: string;
  error?: string;
  threads_summary: ThreadSummary;
  threads: LiveThread[];
  wf_event_summary: WFEventSummary;
  business_connect_summary?: BusinessConnectSummary;
  lock_waits: Array<Record<string, any>>;
  total_execution_time_ms?: number;
}

// Operations Hub Telemetry Types
export interface WFAThreadsInfo {
  total: number;
  runnable: number;
  waiting: number;
  blocked: number;
  threads: LiveThread[];
}

export interface WFEventQueueInfo {
  total_queued: number;
  distribution: Array<{ event_name: string; count: number }>;
  query_error?: string | null;
}

export interface FormulaQueueInfo {
  depth: number;
  accessible: boolean;
  table_name?: string;
  query_error?: string | null;
}

export interface StuckWorkflowItem {
  instance_id: any;
  template_id: any;
  template_name: string;
  start_date: string;
}

export interface WorkflowTelemetryData {
  success: boolean;
  server_id?: number;
  server_name?: string;
  host?: string;
  timestamp: string;
  wfa_threads: WFAThreadsInfo;
  wf_event_queue: WFEventQueueInfo;
  formula_queue: FormulaQueueInfo;
  stuck_workflows: {
    count: number;
    items: StuckWorkflowItem[];
    query_error?: string | null;
  };
}

export interface GCEvent {
  timestamp: string;
  gc_type: string;
  pause_ms: number;
  is_stw_alert: boolean;
  heap_used_mb?: number | null;
  heap_total_mb?: number | null;
  raw_snippet?: string;
}

export interface GCTelemetryData {
  has_gc_logs: boolean;
  server_id?: number;
  message?: string;
  total_files_analyzed?: number;
  events: GCEvent[];
  summary: {
    total_events: number;
    avg_pause_ms: number;
    max_pause_ms: number;
    stw_pause_count: number;
    recent_frequency_per_hr: number;
  };
}

export interface BlockerNode {
  blocker_handle: string;
  user_id: string;
  table_name: string;
  lock_mode: string;
  current_stmt: string;
  waiting_handles: Array<{
    requester_handle: string;
    target_table: string;
    requested_mode: string;
  }>;
}

export interface LockContentionData {
  success: boolean;
  has_locks: boolean;
  error?: string;
  message?: string;
  total_contentions?: number;
  blocker_tree: BlockerNode[];
  raw_locks: Array<Record<string, any>>;
}

export interface TableBloatItem {
  schema: string;
  table_name: string;
  cardinality: number;
  stats_time?: string;
  stats_age_days?: number | null;
  is_stale_stats: boolean;
  is_high_bloat: boolean;
}

export interface TableBloatData {
  success: boolean;
  error?: string;
  tables: TableBloatItem[];
}

export interface DataConnectOMData {
  success: boolean;
  dataconnect: {
    jobs: Array<Record<string, any>>;
    accessible: boolean;
    error?: string | null;
  };
  object_migration: {
    recent_logs: Array<{ timestamp: string; log_level: string; message: string }>;
    total_events: number;
  };
}

export interface LicenseModuleItem {
  product_id: any;
  license_name: string;
  count: number;
}

export interface LoggedInUser {
  user_name: string;
  user_id: string;
  login_time: string;
  last_access_time?: string;
  ip_address?: string;
  host_name?: string;
  host_addr?: string;
  session_id?: string;
  is_active: boolean;
  assigned_licenses: string[];
  primary_license?: string;
  account_type?: 'internal' | 'external' | 'oslc';
  account_type_label?: string;
}

export interface LicenseEntitlementItem {
  product_id: number | string;
  license_name: string;
  category?: string;
  tier_type?: 'PAID_CONTRACTED' | 'FREE_PLATFORM' | 'PAID_UNLICENSED';
  tier_label?: string;
  entitled_count: number;
  assigned_count: number;
  active_count: number;
  available_count: number;
  assigned_utilization_pct: number;
  active_concurrency_pct: number;
  status: 'optimal' | 'warning' | 'over_allocated' | 'under_utilized' | 'complimentary' | 'unlicensed_paid';
  account_type_counts?: {
    internal: number;
    external: number;
    oslc: number;
  };
  assigned_users?: Array<{
    user_name: string;
    user_id: string;
    is_active?: boolean;
    last_login?: string | null;
    last_access_time?: string | null;
    user_account?: string;
    login_count?: number;
    account_type?: 'internal' | 'external' | 'oslc';
    account_type_label?: string;
  }>;
}

export interface LicenseUsageSummary {
  total_entitled_seats: number;
  total_assigned_seats: number;
  paid_contracted_entitled?: number;
  paid_contracted_assigned?: number;
  paid_contracted_over_allocated?: number;
  free_platform_assigned?: number;
  unlicensed_paid_assigned?: number;
  unlicensed_paid_modules_count?: number;
  total_active_sessions: number;
  overall_saturation_pct: number;
  over_allocated_count: number;
  total_products: number;
  active_by_account_type?: { internal: number; external: number; oslc: number };
  dormant_by_account_type?: { internal: number; external: number; oslc: number };
  total_by_account_type?: { internal: number; external: number; oslc: number };
}

export interface LicenseTimeConsumptionPoint {
  date: string;
  total_users: number;
  total_sessions: number;
  by_product?: Record<string, { product_id: number; users: number; sessions: number }>;
  [key: string]: any;
}

export interface SankeyNode {
  id: string;
  name: string;
  category: string;
  value: number;
  depth: number;
  color?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  sourceName?: string;
  targetName?: string;
}

export interface LicenseSankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface DormantUserItem {
  user_id: string;
  user_name: string;
  user_account?: string;
  created_date?: string | null;
  account_created_date?: string | null;
  assigned_licenses: string[];
  assigned_pids: number[];
  primary_license: string;
  last_login: string | null;
  account_last_login?: string | null;
  session_last_login?: string | null;
  login_count: number;
  days_inactive: number | null;
  dormancy_tier: 'never_logged_in' | 'inactive_365d' | 'inactive_180d' | 'inactive_90d' | 'inactive_30d' | 'active_recently';
  reclamation_priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'EXEMPT' | 'ACTIVE';
  reclamation_reason: string;
  account_type?: 'internal' | 'external' | 'oslc';
  account_type_label?: string;
}

export interface DormantLicenseSummary {
  total_licensed_users: number;
  total_dormant_users?: number;
  never_logged_in_count: number;
  inactive_365d_count?: number;
  inactive_180d_count?: number;
  inactive_90d_count: number;
  inactive_30d_count: number;
  active_recently_count: number;
  high_priority_reclaimable: number;
  reclaimable_occasional_enterprise: number;
  reclaimable_approvals_reporting: number;
  reclaimable_enterprise_core: number;
  potential_seats_recovered: number;
  dormant_by_account_type?: { internal: number; external: number; oslc: number };
}

export interface LicenseUsageData {
  success: boolean;
  error?: string;
  license_distribution: LicenseModuleItem[];
  recent_sessions: Array<Record<string, any>>;
  logged_in_users?: LoggedInUser[];
  license_entitlements?: LicenseEntitlementItem[];
  consumption_over_time?: LicenseTimeConsumptionPoint[];
  sankey_data?: LicenseSankeyData;
  dormant_users?: DormantUserItem[];
  dormant_summary?: DormantLicenseSummary;
  summary?: LicenseUsageSummary;
}

export interface ClusterNodeInfo {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: string;
  admin_path: string;
  auth_type: string;
  status: string;
  cluster_name?: string;
  last_sync_at?: string;
  total_logs: number;
  total_errors: number;
  latest_log_time?: string;
}

export interface ClusterGroup {
  name: string;
  is_clustered: boolean;
  node_count: number;
  nodes: ClusterNodeInfo[];
}

export interface ClusterParityData {
  success: boolean;
  total_nodes: number;
  nodes: ClusterNodeInfo[];
  clusters?: ClusterGroup[];
  drift_warnings: string[];
}

export interface HealthScorecardData {
  success: boolean;
  server_id?: number;
  server_name?: string;
  health_score: number;
  health_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  status: string;
  deductions: Array<{ factor: string; penalty: number; detail: string }>;
  metrics: {
    db_blocked_threads: number;
    wf_queue_depth: number;
    total_errors: number;
  };
  timestamp: string;
}

export interface ServerMachineConfig {
  os: string;
  cpu_count: number | null;
  app_server: string;
  users_online: number | null;
  network_interfaces: string[];
  java_pid: number | null;
  java_version: string;
  jvm_memory: {
    used_mb: number;
    free_mb: number;
    total_mb: number;
    max_mb: number;
    used_pct: number;
  };
  free_disk_mb: number;
  free_temp_mb: number;
  tririga_build: string;
  db_build: string;
  platform_release: string;
  module_level_association: string;
  db_connection: string;
  mail_server: string;
  brava_server: string;
  crystal_ras: string;
  crystal_internal: string;
  sso_configured: string;
  base_currency: string;
  portal_refresh_min: number | null;
  session_timeout_min: number | null;
  unique_session_timeout: boolean;
  disable_session_timeout: boolean;
  record_runtime_ux: string;
  geo_org_security: string;
  allowed_domains: string;
  date_general_processing: boolean;
  date_integration_processing: boolean;
  date_default_processing: boolean;
  row_click_enabled: boolean;
  default_auth_type: string;
  property_files: Record<string, string>;
}

export interface ServerPerformanceMetrics {
  cpu_pct: number;
  jvm_memory: {
    used_mb: number;
    free_mb: number;
    total_mb: number;
    used_pct: number;
  };
  active_db_connections: number;
  wf_queue_count: number;
  wf_throughput_1min: number;
  wf_started: number;
  wf_completed: number;
  wf_steps_processed: number;
  wf_failed: number;
  extended_formula_queue_count: number;
  logged_in_users: number;
  cache: {
    hits: number;
    object_count: number;
    misses: number;
    ratio_pct: number;
  };
}

export interface ServerConfigDetails {
  server_id: number;
  server_name: string;
  host: string;
  port: number;
  protocol: string;
  admin_path: string;
  cluster_name: string;
  is_online: boolean;
  error: string | null;
  machine: ServerMachineConfig;
  performance: ServerPerformanceMetrics;
  response_time_ms: number;
  fetched_at: string;
}

export interface ClusterKPIs {
  total_nodes: number;
  online_nodes: number;
  total_online_users: number;
  total_used_memory_mb: number;
  total_alloc_memory_mb: number;
  total_max_memory_mb: number;
  cluster_memory_utilization_pct: number;
  total_active_db_conns: number;
  total_wf_throughput_1min: number;
  total_wf_queue: number;
  total_wf_failed: number;
  max_cpu_pct: number;
  avg_cpu_pct: number;
}

export interface ConfigDriftItem {
  category: string;
  parameter: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  values: Record<string, any>;
}

export interface ServerConfigComparisonData {
  success: boolean;
  error?: string;
  total_servers: number;
  online_servers: number;
  cluster_kpis: ClusterKPIs;
  drift_items: ConfigDriftItem[];
  servers: ServerConfigDetails[];
  timestamp: string;
}

export interface PropertyFileContent {
  success: boolean;
  error?: string;
  server_name: string;
  file_title: string;
  content: string;
  line_count: number;
  size_bytes: number;
  is_synthetic?: boolean;
}

export interface ClusteredPropertyServer {
  server_id: number;
  server_name: string;
  cluster_name: string;
  is_online: boolean;
  is_synthetic?: boolean;
  line_count: number;
  size_bytes: number;
}

export interface ClusteredPropertyRow {
  key: string;
  category: string;
  values: Record<string, string>;
  has_diff: boolean;
  is_masked: boolean;
}

export interface ClusteredPropertyFileResponse {
  success: boolean;
  error?: string;
  property_name: string;
  file_title: string;
  is_xml: boolean;
  cluster_name: string;
  servers: ClusteredPropertyServer[];
  total_properties: number;
  diff_count: number;
  properties: ClusteredPropertyRow[];
  raw_contents: Record<string, string>;
}

export interface AuthStatus {
  is_enabled: boolean;
  authenticated: boolean;
}

export interface IngestionSchedule {
  is_enabled: boolean;
  interval_minutes: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: 'success' | 'failed' | 'running' | 'pending';
  last_summary: string | null;
  is_running: boolean;
  updated_at?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  thought?: string;
}

export interface StorageSettings {
  retention_days: number;
  auto_prune_enabled: boolean;
  compress_raw_logs: boolean;
  last_pruned_at: string | null;
  last_prune_summary: string | null;
  updated_at?: string;
}

export interface StorageServerBreakdown {
  server_id: number;
  server_name: string;
  total_entries: number;
  offloadable_entries: number;
  live_active_entries: number;
}

export interface StorageStats {
  retention_days: number;
  cutoff_timestamp: string;
  live_db_size_bytes: number;
  live_db_size_mb: number;
  cold_archives_size_bytes: number;
  cold_archives_size_mb: number;
  raw_logs_size_bytes: number;
  raw_logs_size_mb: number;
  total_live_entries: number;
  live_active_entries: number;
  offloadable_entries: number;
  oldest_live_log: string | null;
  newest_live_log: string | null;
  archive_packages_count: number;
  archived_records_total: number;
  server_breakdown: StorageServerBreakdown[];
  settings: StorageSettings;
}

export interface ArchiveFile {
  id: number;
  filename: string;
  filepath: string;
  size_bytes: number;
  size_mb: number;
  size_kb: number;
  entry_count: number;
  error_count: number;
  warn_count: number;
  min_timestamp: string;
  max_timestamp: string;
  server_ids: string;
  server_names: string;
  retention_days: number;
  created_at: string;
}

export interface StoragePruneResult {
  success: boolean;
  archived_entries: number;
  errors_archived: number;
  warns_archived: number;
  archive_filename?: string;
  archive_size_kb?: number;
  initial_db_size_mb: number;
  final_db_size_mb: number;
  bytes_freed_mb: number;
  min_timestamp?: string;
  max_timestamp?: string;
  duration_seconds: number;
  summary?: string;
  message?: string;
}

// ==========================================
// WorkTask & Slow Query / Contention Models
// ==========================================

export interface WorkTaskRecordLogItem {
  id: number;
  timestamp: string;
  log_level: string;
  message: string;
  logger_name?: string;
  filename?: string;
}

export interface CorrelatedThreadEvent {
  id: number;
  timestamp: string;
  log_level: string;
  logger_name: string;
  message_snippet: string;
}

export interface CrossReferencedContext {
  inferred_subsystem?: string;
  root_cause_diagnosis?: string;
  correlated_thread_events?: CorrelatedThreadEvent[];
  spec_related_logs?: CorrelatedThreadEvent[];
}

export interface WorkTaskRecord {
  spec_id?: number | null;
  control_number: string;
  name?: string | null;
  module_name?: string | null;
  bo_name?: string | null;
  status?: string | null;
  priority?: string | null;
  assigned_to?: string | null;
  location?: string | null;
  description?: string | null;
  is_resolved?: boolean;
  associated_logs_count?: number;
  recent_logs?: WorkTaskRecordLogItem[];
  inferred_subsystem?: string;
  root_cause_diagnosis?: string;
  associated_workflows?: Array<{ id: number; name: string }>;
  common_bottlenecks?: string[];
}

export interface TririgaResolvedSpec {
  spec_id: number;
  spec_name?: string | null;
  module_name?: string | null;
  bo_name?: string | null;
  control_number?: string | null;
  status?: string | null;
  task_type?: string | null;
  email?: string | null;
  job_title?: string | null;
  department?: string | null;
  priority?: string | null;
  assigned_to?: string | null;
  location?: string | null;
  asset_name?: string | null;
  description?: string | null;
  is_resolved?: boolean;
  associated_logs_count?: number;
  recent_logs?: any[];
}

export interface TririgaResolvedWorkflow {
  wf_id: number;
  template_name?: string | null;
  module_name?: string | null;
  bo_name?: string | null;
  event_name?: string | null;
  execution_mode?: string | null;
  locking_strategy?: string | null;
  description?: string | null;
  is_resolved?: boolean;
}

export interface TririgaExtractAndResolveResult {
  extracted_ids: {
    spec_ids: number[];
    control_numbers?: string[];
    wf_ids: number[];
    bo_ids: number[];
  };
  resolved_specs: TririgaResolvedSpec[];
  resolved_control_numbers?: WorkTaskRecord[];
  resolved_workflows: TririgaResolvedWorkflow[];
  formatted_summary: string;
}

export interface WorkTaskWorkflow {
  template_id?: number | null;
  template_name?: string | null;
  task_step?: string | null;
  event_name?: string | null;
}

export interface WorkTaskRecommendation {
  title: string;
  category: string;
  primary_table: string;
  db2_ddl: string;
  action_plan: string[];
}

export interface WorkTaskQueryIncident {
  id: number;
  server_id: number;
  server_name: string;
  timestamp: string;
  started_at?: string | null;
  completed_at?: string | null;
  log_level: string;
  thread_name: string;
  logger_name?: string;
  filename?: string;
  incident_type: 'SLOW_QUERY' | 'LOCK_CONTENTION' | 'DEADLOCK' | 'TABLE_SCAN';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  duration_ms: number | null;
  duration_formatted?: string;
  system_impact?: string;
  business_impact?: string;
  sql_statement?: string;
  tables_involved: string[];
  worktask: WorkTaskRecord;
  workflow: WorkTaskWorkflow;
  cross_referenced_context?: CrossReferencedContext;
  recommendation?: WorkTaskRecommendation;
  raw_message: string;
  stack_trace?: string;
}

export interface WorkTaskQueryMetrics {
  total_incidents: number;
  slow_queries_count: number;
  lock_contentions_count: number;
  deadlocks_count: number;
  max_latency_ms: number;
  high_contention_tables: string[];
}

export interface WorkTaskQueryResponse {
  items: WorkTaskQueryIncident[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  metrics: WorkTaskQueryMetrics;
}

export interface WorkTaskLiveTelemetry {
  success: boolean;
  error?: string;
  server_id?: number;
  server_name?: string;
  execution_time_ms: number;
  timestamp: string;
  lock_contentions: Array<Record<string, any>>;
  slow_dynamic_queries: Array<Record<string, any>>;
  active_worktask_workflows: Array<Record<string, any>>;
  has_active_locks: boolean;
}

export interface WorkflowBottleneckItem {
  workflow_id?: number | null;
  workflow_name?: string | null;
  task_step?: string | null;
  task_type: string;
  target_table: string;
  avg_duration_ms?: number | null;
  occurrences?: number;
  latest_message?: string;
  impact: string;
  remedy: string;
}

export interface TririgaUserDirectoryItem {
  user_id: string | number;
  user_account: string;
  user_name: string;
  organization: string;
  organization_clean: string;
  email: string;
  account_type: 'internal' | 'external' | 'oslc';
  account_type_label: string;
  status: string;
  is_active: boolean;
  form_type: string;
  last_login: string;
  last_login_raw?: number | string | null;
  days_inactive?: number | null;
}

export interface TririgaUserDirectorySummary {
  total: number;
  active: number;
  inactive: number;
  internal: number;
  external: number;
  oslc: number;
  organizations_count: number;
}

export interface TririgaUserDirectoryResponse {
  success: boolean;
  total_count: number;
  filtered_count: number;
  summary: TririgaUserDirectorySummary;
  organizations: string[];
  users: TririgaUserDirectoryItem[];
}


