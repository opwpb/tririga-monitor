import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Server,
  Cpu,
  Database,
  Activity,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  BrainCircuit,
  Eye,
  Download,
  Copy,
  Check,
  Search,
  Filter,
  Layers,
  ArrowUpDown,
  Lock,
  FileCode2,
  Table,
  FileText,
  Code,
  X,
  Clock,
  Sparkles,
  HardDrive,
  Users
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import {
  TririgaServer,
  ServerConfigComparisonData,
  ServerConfigDetails,
  ConfigDriftItem,
  PropertyFileContent,
  ClusteredPropertyFileResponse,
  ClusteredPropertyRow,
  ClusteredPropertyServer
} from '../types';
import { api } from '../services/api';
import { startLiveTimer } from '../utils/liveTimer';
import { CardSparkline } from './common/CardSparkline';
import { findPrimaryProdServer } from '../utils/serverUtils';

interface ServerConfigComparisonProps {
  servers: TririgaServer[];
  onSendToAI: (promptText: string) => void;
  initialServerId?: number;
  onLiveStatusChange?: (isLive: boolean) => void;
}

export const ServerConfigComparison: React.FC<ServerConfigComparisonProps> = ({
  servers,
  onSendToAI,
  initialServerId,
  onLiveStatusChange
}) => {
  const [viewMode, setViewMode] = useState<'matrix' | 'deepdive'>('matrix');
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(() => {
    if (initialServerId) return initialServerId;
    const prod = findPrimaryProdServer(servers);
    return prod ? prod.id : servers[0]?.id;
  });

  // Synchronize if initialServerId prop changes (e.g. deep linking from Server Manager)
  useEffect(() => {
    if (initialServerId) {
      setSelectedServerId(initialServerId);
      setViewMode('deepdive');
    }
  }, [initialServerId]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<ServerConfigComparisonData | null>(null);
  const [selectedServerDetails, setSelectedServerDetails] = useState<ServerConfigDetails | null>(null);
  const [singleServerLoading, setSingleServerLoading] = useState<boolean>(false);

  // Filter & Diff View Options
  const [highlightDiffOnly, setHighlightDiffOnly] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedServerFilter, setSelectedServerFilter] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Auto Refresh - Persisted in localStorage
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tririga_server_config_autorefresh');
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Notify parent of live activity status & persist
  useEffect(() => {
    try {
      localStorage.setItem('tririga_server_config_autorefresh', String(autoRefreshInterval));
    } catch {}
    onLiveStatusChange?.(autoRefreshInterval > 0);
  }, [autoRefreshInterval, onLiveStatusChange]);

  // Clustered Property File Modal
  const [clusteredPropertyData, setClusteredPropertyData] = useState<ClusteredPropertyFileResponse | null>(null);
  const [propertyModalLoading, setPropertyModalLoading] = useState<boolean>(false);
  const [propertyModalError, setPropertyModalError] = useState<string | null>(null);
  const [propertySearchQuery, setPropertySearchQuery] = useState<string>('');
  const [propertyDiffOnly, setPropertyDiffOnly] = useState<boolean>(false);
  const [propertyCategoryFilter, setPropertyCategoryFilter] = useState<string>('All');
  const [propertyModalTab, setPropertyModalTab] = useState<'table' | 'raw'>('table');
  const [rawSelectedServer, setRawSelectedServer] = useState<string>('');
  const [selectedPropertyServers, setSelectedPropertyServers] = useState<string[]>([]);

  // Keyboard Escape listener for property modal dismissal
  useEffect(() => {
    if (!clusteredPropertyData && !propertyModalLoading && !propertyModalError) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setClusteredPropertyData(null);
        setPropertyModalError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clusteredPropertyData, propertyModalLoading, propertyModalError]);

  // History buffer for sparklines
  const [sparkHistory, setSparkHistory] = useState<Record<string, number[]>>({});

  const recordSample = useCallback((key: string, value: number) => {
    setSparkHistory(prev => {
      const list = prev[key] || [];
      return { ...prev, [key]: [...list, value].slice(-20) };
    });
  }, []);

  const getSparkData = (key: string, currentVal: number): number[] => {
    const list = sparkHistory[key] || [];
    if (list.length === 0) return [currentVal, currentVal];
    if (list.length === 1) return [list[0], currentVal];
    return list;
  };

  // Fetch Full Comparison Data (silent background refresh when isBackground=true)
  const fetchComparison = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const data = await api.compareServerConfigs();
      if (!data) {
        throw new Error('Server returned empty data. Please ensure the backend server has reloaded with the latest endpoints.');
      }
      setComparisonData(data);

      if (data.cluster_kpis) {
        recordSample('users', data.cluster_kpis.total_online_users ?? 0);
        recordSample('memUsed', data.cluster_kpis.total_used_memory_mb ?? 0);
        recordSample('dbConns', data.cluster_kpis.total_active_db_conns ?? 0);
        recordSample('wfThroughput', data.cluster_kpis.total_wf_throughput_1min ?? 0);
        recordSample('cpu', data.cluster_kpis.max_cpu_pct ?? 0);
      }

      // Initialize server filter with all online server IDs if empty
      if (selectedServerFilter.length === 0 && data.servers?.length > 0) {
        setSelectedServerFilter(data.servers.map(s => s.server_id));
      }
    } catch (err: any) {
      console.error('Failed to fetch server config comparison:', err);
      if (!isBackground) {
        setError(err.message || 'Failed to retrieve server configurations.');
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [recordSample, selectedServerFilter.length]);

  // Initial load
  useEffect(() => {
    fetchComparison(false);
  }, [fetchComparison]);

  // Unthrottled background auto-refresh timer (stays active across tab switching and browser minimization)
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = startLiveTimer(() => {
      fetchComparison(true);
    }, autoRefreshInterval * 1000);
    return () => timer.stop();
  }, [autoRefreshInterval, fetchComparison]);

  // Fetch Single Server Details when in Deep Dive view
  useEffect(() => {
    if (viewMode !== 'deepdive' || !selectedServerId) return;
    let isCancelled = false;

    const loadSingleServer = async () => {
      setSingleServerLoading(true);
      try {
        const details = await api.getServerConfig(selectedServerId);
        if (!isCancelled) {
          setSelectedServerDetails(details);
        }
      } catch (err: any) {
        console.error('Failed to load server details:', err);
      } finally {
        if (!isCancelled) setSingleServerLoading(false);
      }
    };

    loadSingleServer();
    return () => {
      isCancelled = true;
    };
  }, [viewMode, selectedServerId]);

  // Open Clustered Property File Modal
  const handleOpenPropertyFile = async (propName: string, clusterName?: string) => {
    setPropertyModalLoading(true);
    setPropertyModalError(null);
    setClusteredPropertyData(null);
    setPropertySearchQuery('');
    setPropertyDiffOnly(false);
    setPropertyCategoryFilter('All');
    setPropertyModalTab('table');

    try {
      const res = await api.getClusteredPropertyFile(propName, clusterName);
      setClusteredPropertyData(res);
      if (res.servers && res.servers.length > 0) {
        setRawSelectedServer(res.servers[0].server_name);
        setSelectedPropertyServers(res.servers.map(s => s.server_name));
      }
    } catch (err: any) {
      setPropertyModalError(err.message || `Failed to fetch clustered property file ${propName}`);
    } finally {
      setPropertyModalLoading(false);
    }
  };

  // Active visible servers in property modal
  const activePropertyServers = useMemo(() => {
    if (!clusteredPropertyData?.servers) return [];
    if (selectedPropertyServers.length === 0) return clusteredPropertyData.servers;
    return clusteredPropertyData.servers.filter(s => selectedPropertyServers.includes(s.server_name));
  }, [clusteredPropertyData, selectedPropertyServers]);

  // Evaluated properties with dynamic per-node diff calculation and individual cell diff flagging
  const evaluatedProperties = useMemo(() => {
    if (!clusteredPropertyData?.properties) return [];
    const activeNames = activePropertyServers.map(s => s.server_name);

    return clusteredPropertyData.properties.map(p => {
      // Gather values strictly for active selected nodes
      const activeValues = activeNames.map(name => p.values[name] ?? '—');
      // A property has a diff only if there are at least 2 active servers and their values differ
      const hasDiff = activeNames.length > 1 && new Set(activeValues).size > 1;

      // Identify which specific servers have differing / outlier values
      // If there's a majority value, cells differing from majority are flagged; otherwise all distinct values are flagged
      const valueCounts = activeValues.reduce<Record<string, number>>((acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
      }, {});

      // Majority value if any
      let majorityVal = '';
      let maxCount = 0;
      Object.entries(valueCounts).forEach(([val, count]) => {
        if (count > maxCount) {
          maxCount = count;
          majorityVal = val;
        }
      });

      // Cell diff map: serverName -> boolean (is this cell an outlier/drift from other servers?)
      const cellDiffMap: Record<string, boolean> = {};
      if (hasDiff) {
        activeNames.forEach(name => {
          const val = p.values[name] ?? '—';
          // If >50% agree on majorityVal, highlight cells that do NOT match majority
          if (maxCount > 1 && maxCount > activeNames.length / 2) {
            cellDiffMap[name] = val !== majorityVal;
          } else {
            // Otherwise highlight all cells since no single majority exists
            cellDiffMap[name] = true;
          }
        });
      }

      return {
        ...p,
        has_diff: hasDiff,
        cell_diffs: cellDiffMap
      };
    });
  }, [clusteredPropertyData, activePropertyServers]);

  // Total active discrepancies count across current selection
  const activeDiffCount = useMemo(() => {
    return evaluatedProperties.filter(p => p.has_diff).length;
  }, [evaluatedProperties]);

  // Filtered clustered properties
  const filteredProperties = useMemo(() => {
    let list = evaluatedProperties;

    if (propertyDiffOnly) {
      list = list.filter(p => p.has_diff);
    }

    if (propertyCategoryFilter !== 'All') {
      list = list.filter(p => p.category === propertyCategoryFilter);
    }

    if (propertySearchQuery.trim()) {
      const q = propertySearchQuery.toLowerCase().trim();
      const activeNames = activePropertyServers.map(s => s.server_name);
      list = list.filter(p => {
        if (p.key.toLowerCase().includes(q)) return true;
        if (p.category.toLowerCase().includes(q)) return true;
        return activeNames.some(name => String(p.values[name] ?? '').toLowerCase().includes(q));
      });
    }

    return list;
  }, [evaluatedProperties, propertyDiffOnly, propertyCategoryFilter, propertySearchQuery, activePropertyServers]);

  // Unique categories for clustered property filtering
  const propertyCategories = useMemo(() => {
    if (!clusteredPropertyData?.properties) return ['All'];
    const cats = new Set<string>();
    clusteredPropertyData.properties.forEach(p => cats.add(p.category));
    return ['All', ...Array.from(cats).sort()];
  }, [clusteredPropertyData]);

  // Export filtered clustered properties to CSV
  const handleExportPropertiesCSV = () => {
    if (!clusteredPropertyData || !clusteredPropertyData.properties.length) return;
    const servers = activePropertyServers.map(s => s.server_name);
    const headers = ['Property Key', 'Category', ...servers, 'Diff Status'];
    const rows = filteredProperties.map(p => {
      const vals = servers.map(sName => {
        const val = p.values[sName] ?? '—';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      return [`"${p.key}"`, `"${p.category}"`, ...vals, p.has_diff ? 'DIFF' : 'MATCH'].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${clusteredPropertyData.file_title.replace(/\s+/g, '_')}_cluster_comparison.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy filtered clustered properties as TSV (ready to paste into Excel/Google Sheets)
  const handleCopyPropertiesTSV = () => {
    if (!clusteredPropertyData || !clusteredPropertyData.properties.length) return;
    const servers = activePropertyServers.map(s => s.server_name);
    const headers = ['Property Key', 'Category', ...servers, 'Diff Status'];
    const rows = filteredProperties.map(p => {
      const vals = servers.map(sName => p.values[sName] ?? '—');
      return [p.key, p.category, ...vals, p.has_diff ? 'DIFF' : 'MATCH'].join('\t');
    });
    const tsvContent = [headers.join('\t'), ...rows].join('\n');
    handleCopy(tsvContent, 'Table copied to clipboard (TSV)');
  };

  // Copy to clipboard helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotification(label);
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  // AI Diagnostic Prompt generator
  const handleSendDriftToAI = () => {
    if (!comparisonData) return;

    const driftSummary = (comparisonData.drift_items || [])
      .map(d => `- [${d.severity}] ${d.parameter} (${d.category}): ${d.message}`)
      .join('\n');

    const serverStats = (comparisonData.servers || []).map(s => {
      const m = s.machine;
      const p = s.performance;
      return `Server '${s.server_name}' (${s.host}):
  - JVM Heap: ${m.jvm_memory.used_mb}MB / ${m.jvm_memory.total_mb}MB (${m.jvm_memory.used_pct}%), Max: ${m.jvm_memory.max_mb}MB
  - CPU: ${p.cpu_pct}%, Active DB Conns: ${p.active_db_connections}, Online Users: ${p.logged_in_users}
  - Platform: ${m.platform_release} (Build ${m.tririga_build}), DB Build: ${m.db_build}
  - DB URL: ${m.db_connection}
  - Session Timeout: ${m.session_timeout_min}m, Carbon UX: ${m.record_runtime_ux}, Geo/Org: ${m.geo_org_security}`;
    }).join('\n\n');

    const prompt = `Analyze IBM TRIRIGA cluster configuration and performance telemetry across all nodes based on read-only data from machineMain.jsp and performanceMain.jsp:

CLUSTER SUMMARY:
- Total Nodes: ${comparisonData.cluster_kpis.total_nodes} (${comparisonData.cluster_kpis.online_nodes} online)
- Aggregate Online Users: ${comparisonData.cluster_kpis.total_online_users}
- Total JVM Memory Used: ${comparisonData.cluster_kpis.total_used_memory_mb} MB / ${comparisonData.cluster_kpis.total_alloc_memory_mb} MB (${comparisonData.cluster_kpis.cluster_memory_utilization_pct}%)
- Active DB Connections: ${comparisonData.cluster_kpis.total_active_db_conns}
- Peak CPU: ${comparisonData.cluster_kpis.max_cpu_pct}%

DETECTED CONFIGURATION DRIFT:
${driftSummary || 'No major configuration drift detected.'}

NODE DETAILS:
${serverStats}

Please provide:
1. Architectural evaluation of workload distribution across nodes.
2. Risks associated with any detected configuration drift (e.g. heap sizing, DB connection targets, session settings).
3. Performance optimization recommendations for JVM memory or DB connection pooling.`;

    onSendToAI(prompt);
  };

  // Prepare Recharts dataset
  const chartData = useMemo(() => {
    if (!comparisonData?.servers) return [];
    return comparisonData.servers
      .filter(s => selectedServerFilter.includes(s.server_id))
      .map(s => ({
        name: s.server_name,
        usedMb: s.machine.jvm_memory.used_mb,
        freeMb: s.machine.jvm_memory.free_mb,
        maxMb: s.machine.jvm_memory.max_mb,
        cpuPct: s.performance.cpu_pct,
        dbConns: s.performance.active_db_connections,
        users: s.performance.logged_in_users,
        wfThroughput: s.performance.wf_throughput_1min,
        wfStarted: s.performance.wf_started,
        wfCompleted: s.performance.wf_completed,
        wfSteps: s.performance.wf_steps_processed,
      }));
  }, [comparisonData, selectedServerFilter]);

  // Comparison Matrix Row Definitions
  interface MatrixRow {
    category: string;
    label: string;
    getValue: (s: ServerConfigDetails) => string | number | boolean;
    formatValue?: (val: any) => React.ReactNode;
    isKey?: boolean;
  }

  const matrixRows: MatrixRow[] = [
    // System & Hardware
    { category: 'System & Hardware', label: 'Operating System', getValue: s => s.machine.os },
    { category: 'System & Hardware', label: 'Available CPUs', getValue: s => s.machine.cpu_count ?? 'N/A' },
    { category: 'System & Hardware', label: 'Application Server', getValue: s => s.machine.app_server },
    { category: 'System & Hardware', label: 'Online Users', getValue: s => s.performance.logged_in_users, formatValue: v => <span className="font-semibold text-cyan-400">{v} users</span> },
    { category: 'System & Hardware', label: 'Host IP / Network', getValue: s => s.machine.network_interfaces?.join(', ') || s.host },
    { category: 'System & Hardware', label: 'Free Disk Space', getValue: s => s.machine.free_disk_mb ? `${(s.machine.free_disk_mb / 1024).toFixed(1)} GB` : 'N/A' },
    { category: 'System & Hardware', label: 'Free Temp Space', getValue: s => s.machine.free_temp_mb ? `${(s.machine.free_temp_mb / 1024).toFixed(1)} GB` : 'N/A' },

    // JVM & Memory
    { category: 'JVM & Memory', label: 'Java Version / Vendor', getValue: s => s.machine.java_version },
    { category: 'JVM & Memory', label: 'Java Host PID', getValue: s => s.machine.java_pid ?? 'N/A', formatValue: v => <span className="font-mono text-slate-400">PID {v}</span> },
    { category: 'JVM & Memory', label: 'Heap Memory Used', getValue: s => s.machine.jvm_memory.used_mb, formatValue: v => <span className="font-mono font-medium text-amber-400">{v} MB</span> },
    { category: 'JVM & Memory', label: 'Heap Memory Total', getValue: s => s.machine.jvm_memory.total_mb, formatValue: v => <span className="font-mono text-slate-300">{v} MB</span> },
    { category: 'JVM & Memory', label: 'Heap Memory Max (Xmx)', getValue: s => s.machine.jvm_memory.max_mb, formatValue: v => <span className="font-mono font-semibold text-emerald-400">{v} MB</span> },
    { category: 'JVM & Memory', label: 'Memory Utilization', getValue: s => s.machine.jvm_memory.used_pct, formatValue: v => (
      <div className="flex items-center gap-2">
        <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${Number(v) > 85 ? 'bg-rose-500' : Number(v) > 70 ? 'bg-amber-500' : 'bg-cyan-500'}`}
            style={{ width: `${Math.min(100, Number(v))}%` }}
          />
        </div>
        <span className="font-mono text-xs text-slate-200">{v}%</span>
      </div>
    )},
    { category: 'JVM & Memory', label: 'Java CPU Utilization', getValue: s => s.performance.cpu_pct, formatValue: v => (
      <span className={`font-mono font-semibold ${Number(v) > 50 ? 'text-rose-400' : Number(v) > 20 ? 'text-amber-400' : 'text-slate-300'}`}>
        {v}%
      </span>
    )},

    // TRIRIGA Platform & Build
    { category: 'Platform & Build', label: 'Platform Release', getValue: s => s.machine.platform_release, formatValue: v => <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold">{v}</span> },
    { category: 'Platform & Build', label: 'TRIRIGA Build Number', getValue: s => s.machine.tririga_build, formatValue: v => <span className="font-mono text-slate-200">{v}</span> },
    { category: 'Platform & Build', label: 'Database Build Number', getValue: s => s.machine.db_build, formatValue: v => <span className="font-mono text-slate-200">{v}</span> },
    { category: 'Platform & Build', label: 'Module Level Association', getValue: s => s.machine.module_level_association },

    // Database & Environment
    { category: 'Database & Environment', label: 'Database JDBC Target', getValue: s => s.machine.db_connection, formatValue: v => <span className="font-mono text-[11px] text-purple-300 break-all">{v}</span> },
    { category: 'Database & Environment', label: 'Active DB Connections', getValue: s => s.performance.active_db_connections, formatValue: v => <span className="font-mono font-bold text-emerald-400">{v}</span> },
    { category: 'Database & Environment', label: 'Outgoing Mail Server', getValue: s => s.machine.mail_server || 'Not Configured' },
    { category: 'Database & Environment', label: 'Crystal Report Server', getValue: s => s.machine.crystal_ras || 'N/A' },
    { category: 'Database & Environment', label: 'SSO Configured', getValue: s => s.machine.sso_configured === 'Y' ? 'Yes (SSO)' : 'No (Standard)', formatValue: v => <span className={`px-2 py-0.5 rounded text-xs ${v.startsWith('Yes') ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Database & Environment', label: 'Base Currency', getValue: s => s.machine.base_currency || 'N/A' },
    { category: 'Database & Environment', label: 'Portal Refresh (Min)', getValue: s => s.machine.portal_refresh_min ?? 'N/A' },

    // Feature Flags & Sessions
    { category: 'Feature Flags & Sessions', label: 'Session Timeout (Minutes)', getValue: s => s.machine.session_timeout_min ?? 30, formatValue: v => <span className="font-medium text-slate-200">{v} min</span> },
    { category: 'Feature Flags & Sessions', label: 'Unique User Session Timeout', getValue: s => s.machine.unique_session_timeout ? 'Enabled' : 'Disabled', formatValue: v => <span className={`px-2 py-0.5 rounded text-[10px] ${v === 'Enabled' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Feature Flags & Sessions', label: 'Disable Session Timeout', getValue: s => s.machine.disable_session_timeout ? 'Yes (Disabled)' : 'No (Active)', formatValue: v => <span className={`px-2 py-0.5 rounded text-[10px] ${v.startsWith('Yes') ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Feature Flags & Sessions', label: 'Carbon UI UX Enhancement', getValue: s => s.machine.record_runtime_ux, formatValue: v => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${v === 'ON' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Feature Flags & Sessions', label: 'Geo/Org Security Model', getValue: s => s.machine.geo_org_security, formatValue: v => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${v === 'ON' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Feature Flags & Sessions', label: 'Allowed Domain Names', getValue: s => s.machine.allowed_domains || 'Any / Not Restriced' },
    { category: 'Feature Flags & Sessions', label: 'Legacy Date (General)', getValue: s => s.machine.date_general_processing ? 'Legacy (Pre-3.6.1)' : 'Standard', formatValue: v => <span className={`px-2 py-0.5 rounded text-[10px] ${v.startsWith('Legacy') ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{v}</span> },
    { category: 'Feature Flags & Sessions', label: 'Legacy Date (Integration)', getValue: s => s.machine.date_integration_processing ? 'Legacy' : 'Standard' },
    { category: 'Feature Flags & Sessions', label: 'Enable Row Click for Records', getValue: s => s.machine.row_click_enabled ? 'Enabled' : 'Disabled' },

    // Workflow & Cache Performance
    { category: 'Workflow & Cache', label: 'WF Events Queue Count', getValue: s => s.performance.wf_queue_count, formatValue: v => <span className={`font-mono font-bold ${Number(v) > 10 ? 'text-rose-400' : 'text-emerald-400'}`}>{v}</span> },
    { category: 'Workflow & Cache', label: 'WF 1-Min Throughput', getValue: s => s.performance.wf_throughput_1min, formatValue: v => <span className="font-mono font-semibold text-cyan-400">{v} /min</span> },
    { category: 'Workflow & Cache', label: 'Total Workflows Completed', getValue: s => s.performance.wf_completed, formatValue: v => <span className="font-mono text-slate-300">{Number(v).toLocaleString()}</span> },
    { category: 'Workflow & Cache', label: 'Total Workflow Steps', getValue: s => s.performance.wf_steps_processed, formatValue: v => <span className="font-mono text-slate-300">{Number(v).toLocaleString()}</span> },
    { category: 'Workflow & Cache', label: 'Total Workflows Failed', getValue: s => s.performance.wf_failed, formatValue: v => <span className={`font-mono font-bold ${Number(v) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{v}</span> },
    { category: 'Workflow & Cache', label: 'Cache Hit Ratio', getValue: s => s.performance.cache?.ratio_pct ? `${s.performance.cache.ratio_pct}%` : 'N/A' },
  ];

  const categories = ['All', 'System & Hardware', 'JVM & Memory', 'Platform & Build', 'Database & Environment', 'Feature Flags & Sessions', 'Workflow & Cache'];

  // Filter matrix rows based on category, diff-only toggle, and search
  const filteredRows = useMemo(() => {
    if (!comparisonData?.servers) return [];

    const activeServers = comparisonData.servers.filter(s => selectedServerFilter.includes(s.server_id));
    if (activeServers.length === 0) return [];

    return matrixRows.filter(row => {
      // 1. Category filter
      if (selectedCategory !== 'All' && row.category !== selectedCategory) return false;

      // 2. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesLabel = row.label.toLowerCase().includes(query);
        const matchesCat = row.category.toLowerCase().includes(query);
        const matchesAnyVal = activeServers.some(s => String(row.getValue(s)).toLowerCase().includes(query));
        if (!matchesLabel && !matchesCat && !matchesAnyVal) return false;
      }

      // 3. Diff-only filter
      if (highlightDiffOnly && activeServers.length > 1) {
        const values = activeServers.map(s => String(row.getValue(s)).trim());
        const hasDifference = new Set(values).size > 1;
        if (!hasDifference) return false;
      }

      return true;
    });
  }, [comparisonData, selectedServerFilter, selectedCategory, searchQuery, highlightDiffOnly, matrixRows]);

  // Export Matrix to CSV
  const handleExportCSV = () => {
    if (!comparisonData?.servers) return;
    const activeServers = comparisonData.servers.filter(s => selectedServerFilter.includes(s.server_id));
    if (activeServers.length === 0) return;

    const headers = ['Category', 'Parameter', ...activeServers.map(s => s.server_name)];
    const csvLines = [headers.map(h => `"${h}"`).join(',')];

    filteredRows.forEach(row => {
      const line = [
        `"${row.category}"`,
        `"${row.label}"`,
        ...activeServers.map(s => `"${String(row.getValue(s)).replace(/"/g, '""')}"`)
      ];
      csvLines.push(line.join(','));
    });

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `TRIRIGA_Server_Config_Comparison_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const kpis = comparisonData?.cluster_kpis;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header & Control Center */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white">
            <SlidersHorizontal className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">Per-Server Configuration & Comparison</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Live machineMain & performanceMain
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Real-time hardware inspection, JVM memory allocation, configuration drift parity, and performance telemetry
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                viewMode === 'matrix'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Comparison Matrix</span>
            </button>
            <button
              onClick={() => setViewMode('deepdive')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                viewMode === 'deepdive'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Node Deep Dive</span>
            </button>
          </div>

          {/* Auto Refresh Cadence */}
          <select
            value={autoRefreshInterval}
            onChange={e => setAutoRefreshInterval(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
            title="Auto-refresh interval"
          >
            <option value={0}>Auto-refresh: Off</option>
            <option value={15}>Every 15s</option>
            <option value={30}>Every 30s</option>
            <option value={60}>Every 60s</option>
          </select>

          {/* Refresh All */}
          <button
            onClick={() => fetchComparison()}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-all disabled:opacity-50"
            title="Refresh live machine and performance metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{loading ? 'Polling...' : 'Refresh'}</span>
          </button>

          {/* Send to AI Assistant */}
          <button
            onClick={handleSendDriftToAI}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-900/30 transition-all"
            title="Analyze configuration drift and JVM memory distribution with AI"
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            <span>AI Diagnostic</span>
          </button>
        </div>
      </div>

      {/* Copy notification popup */}
      {copiedNotification && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>Copied {copiedNotification} to clipboard</span>
        </div>
      )}

      {/* KPI Cards with Sparklines */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Total Online Users */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-cyan-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Online Users</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span>{kpis?.total_online_users ?? 0}</span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">across cluster</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {kpis?.online_nodes ?? 0} of {kpis?.total_nodes ?? 0} nodes reporting
          </p>
          <CardSparkline
            data={getSparkData('users', kpis?.total_online_users ?? 0)}
            color="#06b6d4"
            unit="users"
          />
        </div>

        {/* Card 2: Cluster JVM Memory */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-blue-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Cluster Memory</span>
            <Cpu className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span>{kpis?.total_used_memory_mb ? `${(kpis.total_used_memory_mb / 1024).toFixed(1)} GB` : '0 GB'}</span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">/ {(kpis?.total_alloc_memory_mb ? (kpis.total_alloc_memory_mb / 1024).toFixed(0) : 0)} GB</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {kpis?.cluster_memory_utilization_pct ?? 0}% heap footprint
          </p>
          <CardSparkline
            data={getSparkData('memUsed', kpis?.total_used_memory_mb ?? 0)}
            color="#3b82f6"
            unit="MB"
          />
        </div>

        {/* Card 3: Active DB Connections */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>DB Connections</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span>{kpis?.total_active_db_conns ?? 0}</span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">active pool</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Liberty to DB2 sessions
          </p>
          <CardSparkline
            data={getSparkData('dbConns', kpis?.total_active_db_conns ?? 0)}
            color="#10b981"
            unit="conns"
          />
        </div>

        {/* Card 4: Workflow Throughput */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-purple-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>WF Throughput</span>
            <Zap className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span>{kpis?.total_wf_throughput_1min ?? 0}</span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">events/min</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Queue: {kpis?.total_wf_queue ?? 0} pending
          </p>
          <CardSparkline
            data={getSparkData('wfThroughput', kpis?.total_wf_throughput_1min ?? 0)}
            color="#a855f7"
            unit="/min"
          />
        </div>

        {/* Card 5: Max CPU Load */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-amber-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Peak Java CPU</span>
            <Activity className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span>{kpis?.max_cpu_pct ?? 0}%</span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">avg {kpis?.avg_cpu_pct ?? 0}%</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Highest load among nodes
          </p>
          <CardSparkline
            data={getSparkData('cpu', kpis?.max_cpu_pct ?? 0)}
            color="#f59e0b"
            unit="%"
          />
        </div>

        {/* Card 6: Configuration Drift Count */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg relative overflow-hidden group hover:border-rose-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Configuration Drift</span>
            {comparisonData?.drift_items && comparisonData.drift_items.length > 0 ? (
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-1.5">
            <span className={comparisonData?.drift_items && comparisonData.drift_items.length > 0 ? 'text-amber-400' : 'text-emerald-400'}>
              {comparisonData?.drift_items?.length ?? 0}
            </span>
            <span className="text-[10px] text-slate-400 font-sans font-normal">discrepancies</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {comparisonData?.drift_items && comparisonData.drift_items.length > 0 ? (
              <button
                onClick={() => { setHighlightDiffOnly(true); setViewMode('matrix'); }}
                className="text-cyan-400 hover:underline cursor-pointer"
              >
                Inspect differences
              </button>
            ) : (
              <span className="text-emerald-400">Nodes fully aligned</span>
            )}
          </p>
        </div>
      </div>

      {/* Drift Alert Banner if any discrepancies exist */}
      {comparisonData?.drift_items && comparisonData.drift_items.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  Cross-Node Configuration Drift & Parity Discrepancies ({comparisonData.drift_items.length})
                </h3>
              </div>
              <p className="text-xs text-slate-300">
                The following parameters diverge across cluster nodes. Discrepancies in maximum heap sizing or DB targets can cause silent failover issues.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                {comparisonData.drift_items.map((drift: ConfigDriftItem, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-white">{drift.parameter}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        drift.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                        drift.severity === 'WARNING' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                        'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {drift.severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{drift.message}</p>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setHighlightDiffOnly(prev => !prev)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-all"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{highlightDiffOnly ? 'Show All Parameters' : 'Filter Table to Differences Only'}</span>
            </button>
          </div>
        </div>
      )}

      {/* VIEW MODE 1: COMPARISON MATRIX */}
      {viewMode === 'matrix' && (
        <div className="space-y-6">
          {/* Quick Clustered Property File Comparison Bar */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <FileCode2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Clustered Property Files & Liberty server.xml</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-normal lowercase">side-by-side table</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Inspect and compare runtime configuration side-by-side across all nodes with drift detection
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'TRIRIGADB', label: 'TRIRIGADB.properties', desc: 'Pool & DB' },
                { id: 'TRIRIGAWEB', label: 'TRIRIGAWEB.properties', desc: 'Agents & Web' },
                { id: 'TRIRIGACRYSTAL', label: 'TRIRIGACRYSTAL.properties', desc: 'Crystal Bridge' },
                { id: 'LIBERTY_SERVER_XML', label: 'server.xml', desc: 'Liberty Profile' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => handleOpenPropertyFile(p.id)}
                  className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 hover:border-cyan-500/50 text-left transition-all group flex items-center gap-2"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
                  <div>
                    <span className="text-xs font-semibold text-white group-hover:text-cyan-300 block transition-colors">
                      {p.label}
                    </span>
                    <span className="text-[9px] text-slate-400 block -mt-0.5">{p.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Comparison Graphs: Memory Allocation & Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: JVM Memory Allocation Comparison */}
            <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-cyan-400" />
                    <span>JVM Heap Footprint Comparison (MB)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Used Memory vs Free Allocated vs Configured Max Heap (Xmx)</p>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px' }}
                      formatter={(val: any, name: any) => [`${Number(val).toLocaleString()} MB`, name === 'usedMb' ? 'Used Heap' : name === 'freeMb' ? 'Free Allocated' : 'Max Heap (Xmx)']}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="usedMb" name="Used Heap" fill="#06b6d4" stackId="a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="freeMb" name="Free Allocated" fill="#3b82f6" stackId="a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="maxMb" name="Max Heap (Xmx)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Workload & Activity Comparison */}
            <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>Workload & Resource Distribution</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Online Users, Active DB Connections, and WF 1-Min Throughput</p>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="users" name="Online Users" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="dbConns" name="Active DB Conns" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="wfThroughput" name="WF Events / Min" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Matrix Filter & Control Bar */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Category Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      selectedCategory === cat
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Search, Toggle & Export */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search parameter..."
                    className="pl-8 pr-3 py-1 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-44"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setHighlightDiffOnly(prev => !prev)}
                  className={`px-3 py-1 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                    highlightDiffOnly
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                  title="Toggle differences only"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>{highlightDiffOnly ? 'Differences Only' : 'All Parameters'}</span>
                </button>

                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition-all"
                  title="Export comparison matrix as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Server Selector Checkboxes */}
            {comparisonData?.servers && (
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mr-1">Compare Nodes:</span>
                {comparisonData.servers.map(s => {
                  const isChecked = selectedServerFilter.includes(s.server_id);
                  return (
                    <label
                      key={s.server_id}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-slate-800 text-white border-cyan-500/40 shadow-sm'
                          : 'bg-slate-900/60 text-slate-500 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            if (selectedServerFilter.length > 1) {
                              setSelectedServerFilter(prev => prev.filter(id => id !== s.server_id));
                            }
                          } else {
                            setSelectedServerFilter(prev => [...prev, s.server_id]);
                          }
                        }}
                        className="rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                      />
                      <span className="font-medium">{s.server_name}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.is_online ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comparison Matrix Table */}
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 z-10 backdrop-blur-md">
                  <tr>
                    <th className="p-3.5 w-64 min-w-[220px] font-bold text-slate-200">
                      Configuration Parameter
                    </th>
                    {comparisonData?.servers
                      ?.filter(s => selectedServerFilter.includes(s.server_id))
                      .map(s => (
                        <th key={s.server_id} className="p-3.5 min-w-[180px]">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-bold text-white text-xs flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${s.is_online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                                <span>{s.server_name}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono font-normal">
                                {s.host}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedServerId(s.server_id);
                                setViewMode('deepdive');
                              }}
                              className="p-1 rounded bg-slate-700/60 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition-colors"
                              title={`Deep dive into ${s.server_name}`}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400 text-xs">
                        No parameters match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, rowIdx) => {
                      const activeServers = comparisonData?.servers?.filter(s => selectedServerFilter.includes(s.server_id)) || [];
                      const values = activeServers.map(s => String(row.getValue(s)).trim());
                      const hasDiscrepancy = activeServers.length > 1 && new Set(values).size > 1;

                      return (
                        <tr
                          key={rowIdx}
                          className={`transition-colors ${
                            hasDiscrepancy
                              ? 'bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                              : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="p-3.5 font-medium text-slate-200">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-white">{row.label}</span>
                              <div className="flex items-center gap-1">
                                {hasDiscrepancy ? (
                                  <span
                                    className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                    title="Parameter value differs across selected nodes"
                                  >
                                    DRIFT
                                  </span>
                                ) : (
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-emerald-500/60"
                                    title="Identical across cluster"
                                  />
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-500">{row.category}</span>
                          </td>

                          {activeServers.map(s => {
                            const val = row.getValue(s);
                            const rendered = row.formatValue ? row.formatValue(val) : String(val);
                            return (
                              <td
                                key={s.server_id}
                                className={`p-3.5 align-top ${
                                  hasDiscrepancy ? 'border-l border-amber-500/10' : ''
                                }`}
                              >
                                {rendered}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 2: PER-SERVER DEEP DIVE */}
      {viewMode === 'deepdive' && (
        <div className="space-y-6">
          {/* Server Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Select Node:</span>
              <div className="flex flex-wrap gap-1.5">
                {servers.map(s => {
                  const isSelected = selectedServerId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedServerId(s.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/30'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span>{s.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedServerDetails && (
              <div className="text-xs text-slate-400 font-mono flex items-center gap-3">
                <span>Response Time: <strong className="text-emerald-400">{selectedServerDetails.response_time_ms}ms</strong></span>
                <span>Polled: <strong>{new Date(selectedServerDetails.fetched_at).toLocaleTimeString()}</strong></span>
              </div>
            )}
          </div>

          {singleServerLoading && !selectedServerDetails ? (
            <div className="py-24 text-center rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Querying machineMain.jsp and performanceMain.jsp...</p>
            </div>
          ) : selectedServerDetails ? (
            <div className="space-y-6">
              {/* Server Specific KPI Banner */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Metric 1: JVM Heap Memory */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>JVM Heap Footprint</span>
                    <Cpu className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {selectedServerDetails.machine.jvm_memory.used_mb} <span className="text-xs font-normal text-slate-400">/ {selectedServerDetails.machine.jvm_memory.total_mb} MB</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedServerDetails.machine.jvm_memory.used_pct > 80 ? 'bg-rose-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${selectedServerDetails.machine.jvm_memory.used_pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
                    <span>{selectedServerDetails.machine.jvm_memory.used_pct}% allocated</span>
                    <span>Max: {selectedServerDetails.machine.jvm_memory.max_mb} MB</span>
                  </div>
                </div>

                {/* Metric 2: Java CPU */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Java CPU Utilization</span>
                    <Activity className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {selectedServerDetails.performance.cpu_pct}%
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {selectedServerDetails.machine.cpu_count ?? 4} Host CPUs available
                  </p>
                </div>

                {/* Metric 3: Active DB Connections */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Active DB Connections</span>
                    <Database className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {selectedServerDetails.performance.active_db_connections}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 truncate font-mono">
                    {selectedServerDetails.machine.db_connection}
                  </p>
                </div>

                {/* Metric 4: Workflow Engine */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Workflow Throughput</span>
                    <Zap className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {selectedServerDetails.performance.wf_throughput_1min} <span className="text-xs font-normal text-slate-400">/min</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Queue depth: {selectedServerDetails.performance.wf_queue_count} events
                  </p>
                </div>
              </div>

              {/* Deep Dive Sections Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Panel 1: Hardware & System Architecture */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-2">
                    <Server className="w-4 h-4 text-cyan-400" />
                    <span>System & Hardware Architecture</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Operating System</span>
                      <span className="font-semibold text-white">{selectedServerDetails.machine.os}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">CPU Cores</span>
                      <span className="font-semibold text-white">{selectedServerDetails.machine.cpu_count ?? 'N/A'} Cores</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Application Server</span>
                      <span className="font-semibold text-white">{selectedServerDetails.machine.app_server}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Java Host Process ID</span>
                      <span className="font-mono text-cyan-300">PID {selectedServerDetails.machine.java_pid}</span>
                    </div>
                    <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Java Version & Vendor</span>
                      <span className="font-semibold text-slate-200">{selectedServerDetails.machine.java_version}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Free Disk Space</span>
                      <span className="font-semibold text-emerald-400">{(selectedServerDetails.machine.free_disk_mb / 1024).toFixed(1)} GB</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Free Temp Space</span>
                      <span className="font-semibold text-emerald-400">{(selectedServerDetails.machine.free_temp_mb / 1024).toFixed(1)} GB</span>
                    </div>
                    <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Network Interfaces</span>
                      <div className="font-mono text-[11px] text-slate-300 space-y-0.5 mt-0.5">
                        {selectedServerDetails.machine.network_interfaces?.map((net, i) => (
                          <div key={i}>{net}</div>
                        )) || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Panel 2: TRIRIGA Platform & Build Revisions */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span>TRIRIGA Platform & Database Releases</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">TRIRIGA Platform Release</span>
                      <span className="text-sm font-bold text-cyan-300">{selectedServerDetails.machine.platform_release}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Module Level Association</span>
                      <span className="font-semibold text-slate-300">{selectedServerDetails.machine.module_level_association}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">TRIRIGA Application Build</span>
                      <span className="font-mono font-medium text-slate-200">{selectedServerDetails.machine.tririga_build}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Database Build</span>
                      <span className="font-mono font-medium text-slate-200">{selectedServerDetails.machine.db_build}</span>
                    </div>
                    <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/40">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px]">Database Connection Target</span>
                        <button
                          onClick={() => handleCopy(selectedServerDetails.machine.db_connection, 'DB Connection URL')}
                          className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </button>
                      </div>
                      <span className="font-mono text-purple-300 break-all">{selectedServerDetails.machine.db_connection}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Outgoing Mail Server</span>
                      <span className="font-semibold text-slate-300">{selectedServerDetails.machine.mail_server || 'Not Configured'}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">SSO Authentication</span>
                      <span className="font-semibold text-slate-300">{selectedServerDetails.machine.sso_configured === 'Y' ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>
                </div>

                {/* Panel 3: Session Security & Feature Flags */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span>Runtime Feature Flags & User Sessions</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">User Session Timeout</span>
                      <span className="font-bold text-white">{selectedServerDetails.machine.session_timeout_min} Minutes</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Unique Session Timeout</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${selectedServerDetails.machine.unique_session_timeout ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                        {selectedServerDetails.machine.unique_session_timeout ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Carbon UI Record Runtime UX</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${selectedServerDetails.machine.record_runtime_ux === 'ON' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                        {selectedServerDetails.machine.record_runtime_ux}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Geo/Org Security Model</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${selectedServerDetails.machine.geo_org_security === 'ON' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>
                        {selectedServerDetails.machine.geo_org_security}
                      </span>
                    </div>
                    <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/40">
                      <span className="text-slate-400 block text-[10px]">Allowed Domain Names</span>
                      <span className="font-mono text-slate-300">{selectedServerDetails.machine.allowed_domains || 'Any Domain (No Filter)'}</span>
                    </div>
                  </div>
                </div>

                {/* Panel 4: Read-Only Property Files */}
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <FileCode2 className="w-4 h-4 text-amber-400" />
                      <span>Property Files & Liberty server.xml</span>
                    </h3>
                    <span className="text-[10px] text-slate-400">Passwords masked</span>
                  </div>

                  <p className="text-xs text-slate-400">
                    Inspect core runtime configuration files exposed directly from TRIRIGA Admin Console:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {['TRIRIGADB', 'TRIRIGAWEB', 'TRIRIGACRYSTAL', 'LIBERTY_SERVER_XML'].map(pName => (
                      <button
                        key={pName}
                        onClick={() => handleOpenPropertyFile(pName, selectedServerDetails.cluster_name)}
                        className="p-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/40 text-left transition-all group flex items-center justify-between"
                      >
                        <div>
                          <span className="text-xs font-semibold text-white block group-hover:text-cyan-300 transition-colors">
                            {pName === 'LIBERTY_SERVER_XML' ? 'server.xml' : `${pName}.properties`}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {pName === 'TRIRIGADB' ? 'Database & Pool sizing' :
                             pName === 'TRIRIGAWEB' ? 'Web container & caches' :
                             pName === 'TRIRIGACRYSTAL' ? 'Crystal report bridge' : 'Liberty runtime profile'}
                          </span>
                        </div>
                        <Eye className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* CLUSTERED PROPERTY FILE INSPECTION MODAL */}
      {(clusteredPropertyData || propertyModalLoading || propertyModalError) && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setClusteredPropertyData(null);
              setPropertyModalError(null);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-7xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-in">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                  <FileCode2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white">
                      {clusteredPropertyData?.file_title || 'Clustered Configuration Property File'}
                    </h3>
                    {clusteredPropertyData && (
                      <>
                        <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-mono">
                          {activePropertyServers.length === clusteredPropertyData.servers.length
                            ? clusteredPropertyData.cluster_name
                            : `${activePropertyServers.length} Nodes Selected`}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[10px]">
                          {clusteredPropertyData.total_properties} properties
                        </span>
                        {activeDiffCount === 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            All Nodes Aligned
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            {activeDiffCount} Discrepancies
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Multi-node side-by-side comparative inspection • Passwords and secrets masked
                  </p>
                </div>
              </div>

              {/* View Switcher & Action Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                {clusteredPropertyData && (
                  <>
                    <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
                      <button
                        onClick={() => setPropertyModalTab('table')}
                        className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 transition-all ${
                          propertyModalTab === 'table'
                            ? 'bg-cyan-500 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Table className="w-3.5 h-3.5" />
                        <span>Side-by-Side Table</span>
                      </button>
                      <button
                        onClick={() => setPropertyModalTab('raw')}
                        className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 transition-all ${
                          propertyModalTab === 'raw'
                            ? 'bg-cyan-500 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>Raw Source</span>
                      </button>
                    </div>

                    {propertyModalTab === 'table' && (
                      <>
                        <button
                          onClick={handleCopyPropertiesTSV}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-all border border-slate-700"
                          title="Copy Table to Clipboard (TSV format for Excel/Sheets)"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Copy TSV</span>
                        </button>
                        <button
                          onClick={handleExportPropertiesCSV}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-all border border-slate-700"
                          title="Export CSV comparison"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Export CSV</span>
                        </button>
                      </>
                    )}

                    {propertyModalTab === 'raw' && rawSelectedServer && (
                      <button
                        onClick={() => handleCopy(clusteredPropertyData.raw_contents[rawSelectedServer] || '', `${rawSelectedServer} Source`)}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-all border border-slate-700"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy File</span>
                      </button>
                    )}
                  </>
                )}

                <button
                  onClick={() => {
                    setClusteredPropertyData(null);
                    setPropertyModalError(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors ml-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / Loading / Error */}
            {propertyModalLoading ? (
              <div className="py-24 text-center space-y-3 bg-slate-950">
                <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin mx-auto" />
                <p className="text-slate-300 text-sm font-medium">Gathering and parsing property files across cluster nodes...</p>
                <p className="text-slate-500 text-xs">Querying all configured instances in parallel</p>
              </div>
            ) : propertyModalError ? (
              <div className="p-6 bg-slate-950">
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <span>{propertyModalError}</span>
                </div>
              </div>
            ) : clusteredPropertyData ? (
              <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950">
                {propertyModalTab === 'table' ? (
                  <>
                    {/* Toolbar: Search, Category, Node Filters, Diff Filter */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-1.5 text-xs">
                          <Search className="w-4 h-4 text-slate-400 shrink-0" />
                          <input
                            type="text"
                            value={propertySearchQuery}
                            onChange={e => setPropertySearchQuery(e.target.value)}
                            placeholder="Filter properties or values..."
                            className="bg-transparent text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none w-full"
                          />
                          {propertySearchQuery && (
                            <button
                              onClick={() => setPropertySearchQuery('')}
                              className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-white"
                            >
                              Clear
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Category Dropdown */}
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>Category:</span>
                            <select
                              value={propertyCategoryFilter}
                              onChange={e => setPropertyCategoryFilter(e.target.value)}
                              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500"
                            >
                              {propertyCategories.map(cat => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Diffs Only Toggle */}
                          <button
                            onClick={() => setPropertyDiffOnly(prev => !prev)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                              propertyDiffOnly
                                ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40 shadow'
                                : 'bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white dark:border-slate-700/80'
                            }`}
                          >
                            <Filter className="w-3.5 h-3.5" />
                            <span>Show Differences Only</span>
                            {activeDiffCount > 0 && (
                              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                                propertyDiffOnly
                                  ? 'bg-amber-500 text-slate-950 font-bold'
                                  : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                              }`}>
                                {activeDiffCount}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Compare Nodes Checkbox Pills */}
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
                          Compare Nodes:
                        </span>
                        {clusteredPropertyData.servers.map(s => {
                          const isChecked = selectedPropertyServers.includes(s.server_name);
                          return (
                            <label
                              key={s.server_name}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                                isChecked
                                  ? 'bg-cyan-50 text-cyan-900 border-cyan-400 dark:bg-slate-800 dark:text-white dark:border-cyan-500/40 shadow-sm'
                                  : 'bg-white text-slate-500 border-slate-200 dark:bg-slate-900/60 dark:text-slate-500 dark:border-slate-800 hover:text-slate-700 dark:hover:text-slate-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedPropertyServers(prev => [...prev, s.server_name]);
                                  } else {
                                    if (selectedPropertyServers.length <= 1) return; // Keep at least one node selected
                                    setSelectedPropertyServers(prev => prev.filter(name => name !== s.server_name));
                                  }
                                }}
                                className="rounded bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-cyan-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                              />
                              <span className="font-medium">{s.server_name}</span>
                              <span className={`w-1.5 h-1.5 rounded-full ${s.is_online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            </label>
                          );
                        })}
                        {selectedPropertyServers.length < clusteredPropertyData.servers.length && (
                          <button
                            onClick={() => setSelectedPropertyServers(clusteredPropertyData.servers.map(s => s.server_name))}
                            className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 underline ml-2"
                          >
                            Select All ({clusteredPropertyData.servers.length})
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Formatted Side-by-Side Table */}
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
                          <tr>
                            <th className="p-3 text-xs font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider sticky left-0 z-30 bg-slate-100 dark:bg-slate-900 min-w-[280px]">
                              Property Name & Category
                            </th>
                            {activePropertyServers.map(server => (
                              <th key={server.server_name} className="p-3 text-xs font-bold text-slate-900 dark:text-white min-w-[200px] border-l border-slate-200 dark:border-slate-800/80">
                                <div className="flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <Server className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                                    <span className="truncate">{server.server_name}</span>
                                  </div>
                                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase ${
                                    server.is_synthetic
                                      ? 'bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30'
                                  }`}>
                                    {server.is_synthetic ? 'Cached' : 'Online'}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 block font-normal mt-0.5">
                                  {server.cluster_name}
                                </span>
                              </th>
                            ))}
                            <th className="p-3 text-xs font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider text-center min-w-[110px] border-l border-slate-200 dark:border-slate-800/80">
                              Parity Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 text-xs font-mono">
                          {filteredProperties.length === 0 ? (
                            <tr>
                              <td colSpan={activePropertyServers.length + 2} className="p-12 text-center text-slate-500">
                                No properties match current filter or search query.
                              </td>
                            </tr>
                          ) : (
                            filteredProperties.map((row, idx) => {
                              return (
                                <tr
                                  key={row.key}
                                  className={`transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/40 ${
                                    row.has_diff
                                      ? 'bg-amber-50/60 dark:bg-amber-500/5'
                                      : idx % 2 === 1
                                      ? 'bg-slate-50 dark:bg-slate-900/30'
                                      : 'bg-white dark:bg-transparent'
                                  }`}
                                >
                                  {/* Property Key & Category (Sticky Column) */}
                                  <td className={`p-3 sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800/60 font-sans ${
                                    row.has_diff
                                      ? 'bg-amber-50 dark:bg-slate-900/95'
                                      : idx % 2 === 1
                                      ? 'bg-slate-50 dark:bg-slate-900/95'
                                      : 'bg-white dark:bg-slate-900/95'
                                  }`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span
                                        onClick={() => handleCopy(row.key, 'Property Key')}
                                        className="font-mono text-xs text-slate-900 dark:text-white font-medium hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer break-all"
                                        title="Click to copy property name"
                                      >
                                        {row.key}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <span className="px-2 py-0.5 rounded-full text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                                        {row.category}
                                      </span>
                                      {row.is_masked && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30 flex items-center gap-0.5">
                                          <Lock className="w-2.5 h-2.5" /> Masked
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Values across Clustered Servers */}
                                  {activePropertyServers.map(server => {
                                    const val = row.values[server.server_name] ?? '—';
                                    const isMaskedVal = typeof val === 'string' && val.includes('********');
                                    // Highlight only if this specific cell differs/drifts from others
                                    const isCellDiff = Boolean(row.cell_diffs && row.cell_diffs[server.server_name]);

                                    return (
                                      <td
                                        key={server.server_name}
                                        onClick={() => handleCopy(val, `${server.server_name} value`)}
                                        className={`p-3 border-l border-slate-200 dark:border-slate-800/50 cursor-pointer group transition-colors ${
                                          isCellDiff ? 'bg-amber-100/50 dark:bg-amber-500/[0.07]' : ''
                                        }`}
                                        title="Click to copy value"
                                      >
                                        <div className={`p-1.5 rounded transition-all text-xs ${
                                          isCellDiff
                                            ? 'bg-amber-100 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200 font-semibold shadow-sm'
                                            : isMaskedVal
                                            ? 'text-amber-700 dark:text-amber-400/90 font-sans'
                                            : 'text-slate-800 dark:text-slate-300 group-hover:text-black dark:group-hover:text-white'
                                        }`}>
                                          <span className="break-all">{val}</span>
                                        </div>
                                      </td>
                                    );
                                  })}

                                  {/* Parity Status Badge */}
                                  <td className="p-3 text-center border-l border-slate-200 dark:border-slate-800/50">
                                    {row.has_diff ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40 whitespace-nowrap">
                                        <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                                        <span>Diff</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 whitespace-nowrap">
                                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        <span>Parity</span>
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  /* RAW SOURCE VIEW */
                  <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950">
                    {/* Server selector tabs for raw file */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 overflow-x-auto">
                        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 mr-1">Select Node:</span>
                        {clusteredPropertyData.servers.map(server => (
                          <button
                            key={server.server_name}
                            onClick={() => setRawSelectedServer(server.server_name)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                              rawSelectedServer === server.server_name
                                ? 'bg-cyan-600 text-white shadow'
                                : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white dark:border-slate-700'
                            }`}
                          >
                            <Server className="w-3 h-3" />
                            <span>{server.server_name}</span>
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                          {rawSelectedServer && clusteredPropertyData.raw_contents[rawSelectedServer]
                            ? `${clusteredPropertyData.raw_contents[rawSelectedServer].split('\n').length} lines`
                            : ''}
                        </span>
                      </div>
                    </div>

                    {/* Raw Text Pre */}
                    <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-slate-800 dark:text-slate-300 bg-slate-50 dark:bg-slate-950">
                      <pre className="whitespace-pre-wrap select-text leading-relaxed">
                        {(clusteredPropertyData.raw_contents[rawSelectedServer] || '')
                          .split('\n')
                          .filter(line => {
                            if (!propertySearchQuery.trim()) return true;
                            return line.toLowerCase().includes(propertySearchQuery.toLowerCase());
                          })
                          .map((line, idx) => {
                            const isComment = line.trim().startsWith('#') || line.trim().startsWith('<!--');
                            const isMasked = line.includes('********');
                            return (
                              <div
                                key={idx}
                                className={`${
                                  isComment ? 'text-slate-400 dark:text-slate-500 italic' :
                                  isMasked ? 'text-amber-800 dark:text-amber-300 font-semibold bg-amber-100 dark:bg-amber-500/10 px-1 rounded' :
                                  'text-slate-900 dark:text-slate-200'
                                }`}
                              >
                                {line}
                              </div>
                            );
                          })}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Modal Footer Summary */}
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span>Showing {filteredProperties.length} of {clusteredPropertyData.total_properties} properties</span>
                    <span>•</span>
                    <span className={activeDiffCount > 0 ? 'text-amber-400 font-medium' : 'text-emerald-400'}>
                      {activeDiffCount} node difference{activeDiffCount === 1 ? '' : 's'} across {activePropertyServers.length} selected node{activePropertyServers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Press ESC or click outside to dismiss
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
