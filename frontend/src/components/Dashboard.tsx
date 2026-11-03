import React, { useState, useEffect } from 'react';
import { 
  Server, 
  AlertTriangle, 
  CheckCircle2, 
  BrainCircuit, 
  RefreshCw, 
  Layers, 
  HardDrive,
  Plus,
  ArrowRight,
  TrendingUp,
  FileText,
  Filter,
  CheckSquare,
  Square,
  FileCode,
  Eye,
  ExternalLink,
  Calendar,
  ShieldAlert,
  Clock,
  RotateCcw,
  Cpu,
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  Activity,
  Sparkles
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { DashboardMetrics, TririgaServer, LicenseUsageData } from '../types';
import { api } from '../services/api';
import { LogExplorerFilter } from './LogExplorer';
import { useTimeContext } from '../context/TimeContext';
import { getProdServerIds } from '../utils/serverUtils';

interface DashboardProps {
  metrics: DashboardMetrics | null;
  servers: TririgaServer[];
  onNavigateTab: (tab: string, filter?: LogExplorerFilter, configServerId?: number, section?: string) => void;
  onSyncAll: () => void;
  loading: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  metrics: initialMetrics,
  servers,
  onNavigateTab,
  onSyncAll,
  loading: parentLoading,
}) => {
  const { getDateRangeForPreset } = useTimeContext();

  const [selectedServers, setSelectedServers] = useState<number[]>(() => {
    return getProdServerIds(servers);
  });
  const [selectedFileType, setSelectedFileType] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedDatePreset, setSelectedDatePreset] = useState<string>('TODAY');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(initialMetrics);
  const [filterLoading, setFilterLoading] = useState(false);
  const [licenseData, setLicenseData] = useState<LicenseUsageData | null>(null);
  const [licenseLoading, setLicenseLoading] = useState<boolean>(false);

  // Sync initial metrics from parent if available
  useEffect(() => {
    if (initialMetrics && !metrics) {
      setMetrics(initialMetrics);
    }
  }, [initialMetrics]);

  // Initialize selected servers to prod app1 & prod app2 on first load of servers list
  const hasInitializedServersRef = React.useRef(false);
  useEffect(() => {
    if (!hasInitializedServersRef.current && servers.length > 0) {
      hasInitializedServersRef.current = true;
      const prodIds = getProdServerIds(servers);
      if (prodIds.length > 0) {
        setSelectedServers(prodIds);
      }
    }
  }, [servers]);

  const prodIds = getProdServerIds(servers);
  const isDefaultServerSelection = (
    prodIds.length > 0
      ? selectedServers.length === prodIds.length && prodIds.every(id => selectedServers.includes(id))
      : selectedServers.length === 0
  );

  const isFiltered = !isDefaultServerSelection || 
    selectedFileType !== 'ALL' || 
    selectedSeverity !== 'ALL' || 
    selectedDatePreset !== 'TODAY' || 
    startDate !== '' || 
    endDate !== '';

  const handleResetFilters = () => {
    const defaultIds = getProdServerIds(servers);
    setSelectedServers(defaultIds.length > 0 ? defaultIds : []);
    setSelectedFileType('ALL');
    setSelectedSeverity('ALL');
    setSelectedDatePreset('TODAY');
    setStartDate('');
    setEndDate('');
  };

  // Load user activity & license telemetry for cluster KPI cards (with 6s timeout safety)
  const loadLicenseData = async () => {
    setLicenseLoading(true);
    const timer = setTimeout(() => {
      setLicenseLoading(false);
    }, 6000);
    try {
      const data = await api.getLicenseUsage(undefined, true);
      setLicenseData(data);
    } catch (err) {
      console.warn('Failed to load user & license metrics for dashboard:', err);
    } finally {
      clearTimeout(timer);
      setLicenseLoading(false);
    }
  };

  useEffect(() => {
    loadLicenseData();
  }, []);

  // Re-fetch filtered metrics when parent sync finishes
  const prevLoadingRef = React.useRef(parentLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !parentLoading) {
      loadFilteredMetrics();
      loadLicenseData();
    }
    prevLoadingRef.current = parentLoading;
  }, [parentLoading]);

  // Load filtered metrics when any filter changes or on initial mount
  const loadFilteredMetrics = async () => {
    setFilterLoading(true);
    try {
      const serverIdsStr = selectedServers.length > 0 ? selectedServers.join(',') : undefined;
      const { start, end } = getDateRangeForPreset(selectedDatePreset, startDate, endDate);
      const data = await api.getMetrics({
        serverIds: serverIdsStr,
        fileType: selectedFileType === 'ALL' ? undefined : selectedFileType,
        logLevel: selectedSeverity === 'ALL' ? undefined : selectedSeverity,
        startTime: start,
        endTime: end,
      });
      setMetrics(data);
    } catch (err) {
      console.error('Failed to load filtered dashboard metrics:', err);
    } finally {
      setFilterLoading(false);
    }
  };

  useEffect(() => {
    loadFilteredMetrics();
  }, [selectedServers, selectedFileType, selectedSeverity, selectedDatePreset, startDate, endDate]);

  const toggleServer = (serverId: number) => {
    setSelectedServers(prev => 
      prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]
    );
  };

  const summary = {
    total_entries: metrics?.summary?.total_entries ?? 0,
    total_errors: metrics?.summary?.total_errors ?? 0,
    total_warns: metrics?.summary?.total_warns ?? 0,
    total_infos: metrics?.summary?.total_infos ?? 0,
    active_servers: metrics?.summary?.active_servers ?? 0,
    total_files: metrics?.summary?.total_files ?? 0,
  };

  // User, Licence & Activity KPI computations
  const activeUsersCount = licenseData?.logged_in_users ? licenseData.logged_in_users.length : (licenseData?.summary?.total_active_sessions ?? 0);
  const assignedSeats = licenseData?.summary?.total_assigned_seats ?? licenseData?.license_distribution?.reduce((acc: number, i: any) => acc + (i.count || 0), 0) ?? 0;
  const entitledSeats = licenseData?.summary?.total_entitled_seats ?? 500;
  const saturationPct = licenseData?.summary?.overall_saturation_pct ?? (entitledSeats > 0 ? Math.round((assignedSeats / entitledSeats) * 100) : 0);
  const dormantCount = licenseData?.summary?.dormant_user_count ?? licenseData?.dormant_users?.length ?? 0;
  const sessionAuditCount = licenseData?.session_audit_users?.length ?? licenseData?.recent_sessions?.length ?? 0;
  const totalActiveSessions = licenseData?.summary?.total_active_sessions ?? activeUsersCount;

  const chartData = (metrics?.timeline || []).map(t => {
    const label = t.time_bucket.length >= 13 
      ? `${t.time_bucket.substring(5, 10)} ${t.time_bucket.substring(11, 16)}` 
      : t.time_bucket;
    return {
      time: label,
      errors: t.errors ?? 0,
      warns: t.warns ?? 0,
      infos: t.infos ?? 0,
      total: t.total ?? 0,
    };
  });

  const TimelineTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-chart-tooltip rounded-xl border p-3 text-xs shadow-2xl backdrop-blur-md min-w-[180px]">
          <div className="font-semibold pb-1.5 mb-2 border-b flex items-center justify-between gap-2">
            <span className="tooltip-time font-bold">{label}</span>
            <span className="text-[10px] font-mono opacity-70">UTC</span>
          </div>
          <div className="space-y-1.5 font-mono">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.stroke || entry.color }} />
                  <span className="tooltip-item-name font-medium">{entry.name}:</span>
                </span>
                <span className="tooltip-item-value font-bold">
                  {Number(entry.value).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const getSearchQueryForError = (err: any) => {
    if (!err || !err.message) return '';
    const msg = err.message.trim();
    const midMatch = msg.match(/MID-\d+/i);
    if (midMatch) return midMatch[0];
    const oraMatch = msg.match(/ORA-\d+/i);
    if (oraMatch) return oraMatch[0];
    const excMatch = msg.match(/([A-Z][a-zA-Z0-9_]*(?:Exception|Error|Deadlock|Timeout))/);
    if (excMatch) return excMatch[1];
    const clean = msg.replace(/^\[[^\]]+\]\s*/, '').replace(/[^a-zA-Z0-9\s_-]/g, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    return words || msg.slice(0, 40);
  };

  const handleNavigateToErrorCluster = (err: any) => {
    const targetServer = servers.find(s => s.name === err.server_name);
    const searchTerm = getSearchQueryForError(err);
    onNavigateTab('explorer', {
      serverId: targetServer ? targetServer.id : undefined,
      level: err.log_level === 'WARN' ? 'WARN' : 'FATAL,ERROR',
      fileType: err.file_type || 'ALL',
      filename: err.filename || 'ALL',
      search: searchTerm,
      datePreset: selectedDatePreset,
      startDate,
      endDate,
    });
  };

  return (
    <div className="space-y-6">
      {/* Welcome & Quick Action Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950/80 border border-slate-800 p-6 shadow-xl hero-banner">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Tririga Log Activity
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {servers.length === 0 ? (
              <button
                onClick={() => onNavigateTab('servers')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add TRIRIGA Server</span>
              </button>
            ) : (
              <>
                <button
                  onClick={onSyncAll}
                  disabled={parentLoading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${parentLoading ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>Sync All Servers</span>
                </button>
                <button
                  onClick={() => onNavigateTab('agent_monitor')}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-all cursor-pointer"
                  title="Open Live JVM Thread & Workflow Agent Monitor"
                >
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span>Live Thread Monitor</span>
                </button>
                <button
                  onClick={() => onNavigateTab('analysis')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-cyan-500/25 transition-all cursor-pointer"
                >
                  <BrainCircuit className="w-4 h-4" />
                  <span>Run Production Log AI analysis</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Section 1: Core Log & System Telemetry KPIs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Log Diagnostics &amp; Cluster Telemetry</span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {isFiltered ? 'Filtered View' : 'Cluster Baseline'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div 
            onClick={() => onNavigateTab('explorer', { serverIds: selectedServers.length > 0 ? selectedServers : undefined, level: 'ALL', search: '', fileType: 'ALL', filename: 'ALL', datePreset: selectedDatePreset, startDate, endDate })}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-blue-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to view all amalgamated log entries in Log Explorer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-slate-200 transition-colors">Total Log Entries</span>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-blue-500/20 transition-all">
                <Layers className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white mt-3 font-mono">{(summary.total_entries || 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-cyan-400 transition-colors">
              <HardDrive className="w-3 h-3 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              <span>Across {summary.total_files || 0} log files • View all →</span>
            </p>
          </div>

          <div 
            onClick={() => onNavigateTab('explorer', { serverIds: selectedServers.length > 0 ? selectedServers : undefined, level: 'FATAL,ERROR', search: '', fileType: 'ALL', filename: 'ALL', datePreset: selectedDatePreset, startDate, endDate })}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-rose-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to filter Log Explorer by Critical Errors &amp; Fatal events"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-rose-300 transition-colors">Critical Errors</span>
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-rose-500/20 transition-all">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-rose-400 mt-3 font-mono">{(summary.total_errors || 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-rose-400 transition-colors">
              <span>Requires triage &amp; investigation • Filter errors →</span>
            </p>
          </div>

          <div 
            onClick={() => onNavigateTab('explorer', { serverIds: selectedServers.length > 0 ? selectedServers : undefined, level: 'WARN', search: '', fileType: 'ALL', filename: 'ALL', datePreset: selectedDatePreset, startDate, endDate })}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-amber-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to filter Log Explorer by Warning events"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-amber-300 transition-colors">Warnings</span>
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-500/20 transition-all">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-400 mt-3 font-mono">{(summary.total_warns || 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1 group-hover:text-amber-400 transition-colors">
              <span>Potential bottlenecks • Filter warnings →</span>
            </p>
          </div>

          <div 
            onClick={() => onNavigateTab('servers')}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-emerald-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to manage TRIRIGA cluster server nodes"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-emerald-300 transition-colors">TRIRIGA Cluster Nodes</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">
                <Server className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-400 mt-3 font-mono">{servers.length}</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-emerald-400 transition-colors">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Configured nodes • Manage servers →</span>
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: User Activity, Licences & Concurrency Operations KPIs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">User Activity, Licences &amp; Concurrency</span>
          </div>
          <button
            onClick={() => onNavigateTab('user_activity')}
            className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
            title="Open comprehensive User Activity Hub"
          >
            <span>Open User Hub</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Active Users */}
          <div 
            onClick={() => onNavigateTab('user_activity', undefined, undefined, 'logged_in')}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-emerald-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to view live active logged-in users in User Activity"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-emerald-300 transition-colors">Active Users</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">
                <UserCheck className="w-4 h-4" />
              </div>
            </div>
            {licenseLoading && !licenseData ? (
              <div className="h-8 w-24 bg-slate-800/80 animate-pulse rounded mt-3" />
            ) : (
              <p className="text-2xl font-bold text-emerald-400 mt-3 font-mono">
                {activeUsersCount.toLocaleString()}
                <span className="text-xs font-sans font-normal text-slate-400 ml-1.5">active</span>
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-emerald-400 transition-colors">
              <Activity className="w-3 h-3 text-slate-400 group-hover:text-emerald-400 transition-colors" />
              <span>Real-time cluster concurrency • View users →</span>
            </p>
          </div>

          {/* Card 2: License Allocation */}
          <div 
            onClick={() => onNavigateTab('user_activity', undefined, undefined, 'entitlements')}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-cyan-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to inspect license quotas and contractual entitlements in User Activity"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-cyan-300 transition-colors">Licence Allocation</span>
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-cyan-500/20 transition-all">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            {licenseLoading && !licenseData ? (
              <div className="h-8 w-32 bg-slate-800/80 animate-pulse rounded mt-3" />
            ) : (
              <div className="flex items-baseline gap-2 mt-3 font-mono">
                <span className="text-2xl font-bold text-white">{assignedSeats.toLocaleString()}</span>
                <span className="text-xs font-sans text-slate-400">of {entitledSeats.toLocaleString()}</span>
                <span className={`text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded border ml-auto ${
                  saturationPct > 100 
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' 
                    : saturationPct >= 85 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                      : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                }`}>
                  {saturationPct}% Sat
                </span>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-cyan-400 transition-colors">
              <Users className="w-3 h-3 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              <span>Assigned in USER_PRODUCT • Entitlements →</span>
            </p>
          </div>

          {/* Card 3: Dormant Accounts */}
          <div 
            onClick={() => onNavigateTab('user_activity', undefined, undefined, 'dormant')}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-amber-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to view dormant accounts and deprovisioning recommendations in User Activity"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-amber-300 transition-colors">Dormant Accounts</span>
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-500/20 transition-all">
                <UserX className="w-4 h-4" />
              </div>
            </div>
            {licenseLoading && !licenseData ? (
              <div className="h-8 w-24 bg-slate-800/80 animate-pulse rounded mt-3" />
            ) : (
              <div className="flex items-baseline gap-2 mt-3 font-mono">
                <span className="text-2xl font-bold text-amber-400">{dormantCount.toLocaleString()}</span>
                <span className="text-xs font-sans text-slate-400">dormant</span>
                <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 ml-auto">
                  Reclaimable
                </span>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-amber-400 transition-colors">
              <AlertTriangle className="w-3 h-3 text-slate-400 group-hover:text-amber-400 transition-colors" />
              <span>Inactive &gt;90d or never logged in • Review →</span>
            </p>
          </div>

          {/* Card 4: Session Audit */}
          <div 
            onClick={() => onNavigateTab('user_activity', undefined, undefined, 'sessions')}
            className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm hover:border-indigo-500/50 hover:bg-slate-900/90 transition-all cursor-pointer group"
            title="Click to inspect user login history and session audit in User Activity"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider group-hover:text-indigo-300 transition-colors">Session Audit</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            {licenseLoading && !licenseData ? (
              <div className="h-8 w-24 bg-slate-800/80 animate-pulse rounded mt-3" />
            ) : (
              <div className="flex items-baseline gap-2 mt-3 font-mono">
                <span className="text-2xl font-bold text-indigo-300">
                  {sessionAuditCount > 0 ? sessionAuditCount.toLocaleString() : totalActiveSessions.toLocaleString()}
                </span>
                <span className="text-xs font-sans text-slate-400">records</span>
                <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 ml-auto">
                  Audit Trail
                </span>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 group-hover:text-indigo-300 transition-colors">
              <Clock className="w-3 h-3 text-slate-400 group-hover:text-indigo-300 transition-colors" />
              <span>Authentication &amp; access trail • View audit →</span>
            </p>
          </div>
        </div>
      </div>

      {/* Comprehensive Dashboard Filter Bar - Positioned between KPI cards and Chart */}
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Chart & Activity Filters</span>
            {isFiltered && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 ml-2 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset All Filters</span>
              </button>
            )}
          </div>
          {filterLoading && (
            <span className="text-[11px] text-cyan-400 flex items-center gap-1 animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" /> Updating chart data...
            </span>
          )}
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
          {/* Filter 1: Server Node Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <Server className="w-3.5 h-3.5 text-cyan-400" /> Server Node:
            </label>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setSelectedServers([])}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  selectedServers.length === 0
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:text-white'
                }`}
              >
                All Nodes
              </button>
              {servers.map((s) => {
                const isSelected = selectedServers.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleServer(s.id)}
                    className={`px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-600 text-white border border-cyan-400 shadow-sm'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filter 2: Log Type / Stream */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Log Type / Stream:
            </label>
            <select
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Streams (Full Spectrum)</option>
              <option value="server">Core Application (server.log)</option>
              <option value="security">Security & Auth (security.log)</option>
              <option value="workflow">Workflows & ObjectMigration</option>
              <option value="datapool">Database Pool (datapool.log)</option>
              <option value="gc">Garbage Collection (gc.log)</option>
              <option value="performance">Performance Metrics</option>
            </select>
          </div>

          {/* Filter 3: Log Severity */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> Log Severity:
            </label>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Severities</option>
              <option value="FATAL,ERROR">Errors & Critical (FATAL, ERROR)</option>
              <option value="WARN">Warnings Only (WARN)</option>
              <option value="INFO">Informational (INFO)</option>
            </select>
          </div>

          {/* Filter 4: Date / Time Window */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-amber-400" /> Date Range:
            </label>
            <select
              value={selectedDatePreset}
              onChange={(e) => setSelectedDatePreset(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Time Available</option>
              <option value="30M">Last 30 Minutes</option>
              <option value="1H">Last 1 Hour</option>
              <option value="6H">Last 6 Hours</option>
              <option value="24H">Last 24 Hours</option>
              <option value="TODAY">Today (00:00 - 23:59)</option>
              <option value="7D">Last 7 Days</option>
              <option value="30D">Last 30 Days</option>
              <option value="CUSTOM">Custom Date Range...</option>
            </select>

            {selectedDatePreset === 'CUSTOM' && (
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-1/2 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                  title="Start Date"
                />
                <span className="text-slate-500 text-xs">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-1/2 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                  title="End Date"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Timeline (Max Width) */}
      <div className="w-full rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Activity Timeline</h2>
              {isFiltered && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium">Filtered</span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {selectedServers.length > 0 
                ? `Filtered by ${selectedServers.length} selected node(s)` 
                : 'Comprehensive distribution of log events, warnings, and error spikes over time across the cluster'}
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-medium flex items-center gap-1.5 w-fit border border-slate-700/80">
            <Clock className="w-3 h-3 text-cyan-400" />
            <span>
              {selectedDatePreset === 'ALL' 
                ? 'All Time' 
                : selectedDatePreset === '30M'
                  ? 'Last 30 Min'
                  : selectedDatePreset === '1H'
                    ? 'Last 1 Hour'
                    : selectedDatePreset === '6H'
                      ? 'Last 6 Hours'
                      : selectedDatePreset === '24H' 
                        ? 'Last 24h' 
                        : selectedDatePreset === 'TODAY' 
                          ? 'Today' 
                          : selectedDatePreset === '7D' 
                            ? 'Last 7 Days' 
                            : selectedDatePreset === '30D' 
                              ? 'Last 30 Days' 
                              : 'Custom Date Range'}
            </span>
          </span>
        </div>

        <div className="h-72 w-full">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 15, right: 25, left: 10, bottom: 25 }}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.45}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="warnGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="infoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45}/>
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis 
                  dataKey="time" 
                  stroke="#64748b" 
                  fontSize={11} 
                  tickLine={{ stroke: '#64748b' }}
                  label={{ value: 'Timeline (Time UTC)', position: 'insideBottom', offset: -15, fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  tickLine={{ stroke: '#64748b' }}
                  label={{ value: 'Event Volume (Log Count)', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                />
                <Tooltip content={<TimelineTooltip />} />
                {(selectedSeverity === 'ALL' || selectedSeverity === 'FATAL,ERROR') && (
                  <Area type="monotone" dataKey="errors" stroke="#f43f5e" fillOpacity={1} fill="url(#errorGrad)" name="Errors / Fatal" strokeWidth={2.5} />
                )}
                {(selectedSeverity === 'ALL' || selectedSeverity === 'WARN') && (
                  <Area type="monotone" dataKey="warns" stroke="#f59e0b" fillOpacity={1} fill="url(#warnGrad)" name="Warnings" strokeWidth={2} />
                )}
                {(selectedSeverity === 'ALL' || selectedSeverity === 'INFO') && (
                  <Area type="monotone" dataKey="infos" stroke="#38bdf8" fillOpacity={1} fill="url(#infoGrad)" name="Informational" strokeWidth={2} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/60 p-6">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-400">No timeline activity data for current filter</p>
              <button
                onClick={handleResetFilters}
                className="text-xs text-cyan-400 hover:underline mt-1 cursor-pointer"
              >
                Reset filters to view all activity
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Top Error Clusters Table */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Top Error Clusters</h2>
            <p className="text-xs text-slate-400">
              Aggregated deduplicated error signatures and recurring exception patterns
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('explorer', { level: 'FATAL,ERROR', search: '', datePreset: selectedDatePreset, startDate, endDate })}
            className="text-xs text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>View in Explorer</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Node</th>
                <th className="py-2.5 px-3">Stream</th>
                <th className="py-2.5 px-2">Level</th>
                <th className="py-2.5 px-3">Logger Module</th>
                <th className="py-2.5 px-4">Error Signature / Message</th>
                <th className="py-2.5 px-3 text-right">Occurrences</th>
                <th className="py-2.5 px-3 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {(!metrics?.top_errors || metrics.top_errors.length === 0) ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    No critical errors or warning clusters detected in the selected filter scope.
                  </td>
                </tr>
              ) : (
                metrics.top_errors.map((err, idx) => (
                  <tr 
                    key={idx} 
                    onClick={() => handleNavigateToErrorCluster(err)}
                    className="hover:bg-slate-800/50 hover:border-cyan-500/30 transition-all cursor-pointer group"
                    title={`Click to search Log Explorer for: ${err.message}`}
                  >
                    <td className="py-2.5 px-3 text-slate-300 font-sans whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/80 text-[11px]">
                        {err.server_name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-sans whitespace-nowrap">
                      <span className="text-[10px] text-slate-400">
                        {err.filename || 'server.log'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                        err.log_level === 'ERROR' || err.log_level === 'FATAL'
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      }`}>
                        {err.log_level}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 truncate max-w-[160px]" title={err.logger_name}>
                      {err.logger_name || 'Generic'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-200">
                      <span className="line-clamp-1 group-hover:text-cyan-300 transition-colors">
                        {err.message}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-white font-semibold text-[11px] border border-slate-700">
                        {err.count}x
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateToErrorCluster(err);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-600 hover:border-cyan-400 font-sans text-[11px] font-semibold transition-all cursor-pointer shadow-sm"
                        title="Open in Log Explorer"
                      >
                        <span>Explore</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
