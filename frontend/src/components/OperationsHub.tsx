import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  Layers, 
  Cpu, 
  Database, 
  ShieldAlert, 
  RefreshCw, 
  DownloadCloud, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Zap, 
  Server, 
  BrainCircuit, 
  Flame, 
  FileText, 
  BarChart2, 
  ShieldCheck, 
  Users, 
  ChevronRight
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { 
  TririgaServer, 
  WorkflowTelemetryData, 
  GCTelemetryData, 
  LockContentionData, 
  TableBloatData, 
  DataConnectOMData, 
  LicenseUsageData, 
  ClusterParityData, 
  HealthScorecardData 
} from '../types';
import { api } from '../services/api';
import { startLiveTimer } from '../utils/liveTimer';
import { useTimeContext } from '../context/TimeContext';
import { CardSparkline } from './common/CardSparkline';
import { findPrimaryProdServer } from '../utils/serverUtils';

interface OperationsHubProps {
  servers: TririgaServer[];
  onSendToAI: (promptText: string) => void;
  onNavigateTab?: (tab: string) => void;
  onLiveStatusChange?: (isLive: boolean) => void;
}

export const OperationsHub: React.FC<OperationsHubProps> = ({ servers, onSendToAI, onNavigateTab, onLiveStatusChange }) => {
  const { timeMode, formatDisplayTime, formatShortTimestamp, localTzInfo } = useTimeContext();

  // Default to first prod server or first server
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(() => {
    const prod = findPrimaryProdServer(servers);
    return prod ? prod.id : servers[0]?.id;
  });

  // Keep selectedServerId synchronized when servers load asynchronously
  useEffect(() => {
    if (!selectedServerId && servers.length > 0) {
      const prod = findPrimaryProdServer(servers);
      setSelectedServerId(prod ? prod.id : servers[0].id);
    }
  }, [servers, selectedServerId]);

  const [activeSubTab, setActiveSubTab] = useState<string>('workflow');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingBundle, setDownloadingBundle] = useState<boolean>(false);

  // Auto-refresh state persisted in localStorage
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tririga_operations_autorefresh') === 'true';
    } catch {
      return false;
    }
  });

  // Persist live status and notify parent
  useEffect(() => {
    try {
      localStorage.setItem('tririga_operations_autorefresh', String(autoRefresh));
    } catch {}
    onLiveStatusChange?.(autoRefresh);
  }, [autoRefresh, onLiveStatusChange]);

  // Telemetry State
  const [workflowData, setWorkflowData] = useState<WorkflowTelemetryData | null>(null);
  const [gcData, setGcData] = useState<GCTelemetryData | null>(null);
  const [lockData, setLockData] = useState<LockContentionData | null>(null);
  const [tableBloatData, setTableBloatData] = useState<TableBloatData | null>(null);
  const [dcOmData, setDcOmData] = useState<DataConnectOMData | null>(null);
  const [licenseData, setLicenseData] = useState<LicenseUsageData | null>(null);
  const [parityData, setParityData] = useState<ClusterParityData | null>(null);
  const [scorecardData, setScorecardData] = useState<HealthScorecardData | null>(null);
  // Telemetry rolling history for sparklines
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, number[]>>({});

  const recordSample = useCallback((key: string, value: number) => {
    setTelemetryHistory(prev => {
      const list = prev[key] || [];
      return { ...prev, [key]: [...list, value].slice(-20) };
    });
  }, []);

  const getSparkData = (key: string, currentVal: number): number[] => {
    const history = telemetryHistory[key] || [];
    if (history.length === 0) return [currentVal, currentVal];
    if (history.length === 1) return [history[0], currentVal];
    return history;
  };


  const fetchActiveTabData = useCallback(async (isBackground = false) => {
    const effectiveServerId = selectedServerId || servers.find(s => s.name.toLowerCase().includes('prod'))?.id || servers[0]?.id;
    if (!effectiveServerId && activeSubTab !== 'parity') return;
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      if (activeSubTab === 'workflow') {
        const data = await api.getWorkflowTelemetry(effectiveServerId);
        setWorkflowData(data);
        recordSample('wfQueue', data.wf_event_queue?.total_queued ?? 0);
        recordSample('formulaQueue', data.formula_queue?.depth ?? 0);
        recordSample('wfaThreads', data.wfa_threads?.runnable ?? 0);
        recordSample('activeWf', data.stuck_workflows?.count ?? 0);
      } else if (activeSubTab === 'gc') {
        const data = await api.getGCTelemetry(effectiveServerId);
        setGcData(data);
        recordSample('gcPausesTotal', data.summary?.total_events ?? 0);
        recordSample('gcAvgPause', data.summary?.avg_pause_ms ?? 0);
        recordSample('gcMaxPause', data.summary?.max_pause_ms ?? 0);
        recordSample('gcStwSec', (data.summary as any)?.total_pause_sec ?? 0);
      } else if (activeSubTab === 'locks') {
        const [locks, bloat] = await Promise.all([
          api.getLockContention(effectiveServerId),
          api.getTableBloat(effectiveServerId)
        ]);
        setLockData(locks);
        setTableBloatData(bloat);
        recordSample('lockConflicts', locks.blocker_tree?.length ?? 0);
        const totalWaiters = locks.blocker_tree?.reduce((acc: number, b: any) => acc + (b.waiting_handles?.length || 0), 0) ?? 0;
        recordSample('lockWaiters', totalWaiters);
        recordSample('monitoredTables', bloat.tables?.length ?? 0);
        recordSample('staleStats', bloat.tables?.filter((t: any) => t.is_stale_stats || t.stats_stale)?.length ?? 0);
      } else if (activeSubTab === 'integrations') {
        const data = await api.getDataConnectOM(effectiveServerId);
        setDcOmData(data);
        recordSample('dcJobs', data.dataconnect?.jobs?.length ?? 0);
        const dcProcessed = data.dataconnect?.jobs?.reduce((acc: number, j: any) => acc + (j.PROCESSED_COUNT || 0), 0) ?? 0;
        recordSample('dcProcessed', dcProcessed);
        recordSample('omLogs', data.object_migration?.recent_logs?.length ?? 0);
        recordSample('omErrors', (data.object_migration as any)?.summary?.errors ?? 0);
      } else if (activeSubTab === 'parity') {
        const data = await api.getClusterParity();
        setParityData(data);
      } else if (activeSubTab === 'scorecard') {
        const data = await api.getHealthScorecard(effectiveServerId);
        setScorecardData(data);
        recordSample('healthScore', data.health_score ?? 0);
        recordSample('cardBlocked', data.metrics?.db_blocked_threads ?? 0);
        recordSample('cardWfQueue', data.metrics?.wf_queue_depth ?? 0);
        recordSample('cardErrors', data.metrics?.total_errors ?? 0);
      }
    } catch (err: any) {
      console.error(`Failed to fetch ${activeSubTab} telemetry:`, err);
      if (!isBackground) {
        setError(err.message || `Failed to fetch data for ${activeSubTab}`);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [selectedServerId, activeSubTab, servers]);

  useEffect(() => {
    fetchActiveTabData(false);
  }, [fetchActiveTabData]);

  // Unthrottled background auto-refresh timer (stays active across tab navigation and browser minimization)
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = startLiveTimer(() => {
      fetchActiveTabData(true);
    }, 15000);
    return () => timer.stop();
  }, [autoRefresh, fetchActiveTabData]);

  const handleDownloadBundle = async () => {
    const effectiveServerId = selectedServerId || servers.find(s => s.name.toLowerCase().includes('prod'))?.id || servers[0]?.id;
    setDownloadingBundle(true);
    try {
      await api.downloadDiagnosticBundle(effectiveServerId);
    } catch (err: any) {
      alert(`Failed to download diagnostic bundle: ${err.message}`);
    } finally {
      setDownloadingBundle(false);
    }
  };

  const handleSendWorkflowToAI = (item: any) => {
    const prompt = `Please analyze this long-running TRIRIGA Workflow Instance:
- Template Name: ${item.template_name}
- Template ID: ${item.template_id}
- Instance ID: ${item.instance_id}
- Started Date: ${item.start_date}

What could cause this workflow to hang or fail to complete in the IBM TRIRIGA Workflow Engine, and how should an administrator diagnose whether it is waiting on a lock or an external system?`;
    onSendToAI(prompt);
  };

  const handleSendLockToAI = (blocker: any) => {
    const prompt = `Please perform a forensic root-cause analysis on this DB2 database lock contention in IBM TRIRIGA:
- Blocker Application Handle: ${blocker.blocker_handle}
- User ID: ${blocker.user_id}
- Target Table: ${blocker.table_name}
- Lock Mode: ${blocker.lock_mode}
- Blocker Statement: ${blocker.current_stmt}
- Number of Waiting Handles: ${blocker.waiting_handles?.length || 0}

How should this contention be cleared safely, and what TRIRIGA object or async agent is responsible?`;
    onSendToAI(prompt);
  };

  const selectedServer = servers.find(s => s.id === selectedServerId);

  return (
    <div className="space-y-4">
      {/* Header & Command Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              Server Health Console
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-mono font-medium">
                Live Engine
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Live asynchronous engine monitoring, database contention, GC forensics & cluster parity
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Server Selector */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl px-2.5 py-1 text-xs">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={selectedServerId || ''}
              onChange={(e) => setSelectedServerId(Number(e.target.value))}
              className="bg-transparent text-slate-200 text-xs font-medium focus:outline-none cursor-pointer"
            >
              {servers.map(s => (
                <option key={s.id} value={s.id} className="bg-slate-800 text-white">
                  {s.name} ({s.host}:{s.port})
                </option>
              ))}
            </select>
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
              autoRefresh 
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle 15s auto-refresh"
          >
            <Clock className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{autoRefresh ? 'Live (15s)' : 'Manual'}</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => fetchActiveTabData()}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            title="Refresh current view"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {/* One-Click IBM Support Diagnostic Bundle */}
          <button
            onClick={handleDownloadBundle}
            disabled={downloadingBundle}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50 transition-all"
            title="Generate & Download complete IBM Support Diagnostic Bundle (.ZIP with Word Report, Logs & Thread Dump)"
          >
            <DownloadCloud className={`w-3.5 h-3.5 ${downloadingBundle ? 'animate-spin' : ''}`} />
            <span>{downloadingBundle ? 'Packaging Bundle...' : 'IBM Support Bundle (.ZIP)'}</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs border-b border-slate-800/80">
        {[
          { id: 'workflow', label: 'Workflow & Async Queues', icon: Layers },
          { id: 'gc', label: 'JVM & GC Forensics', icon: Cpu },
          { id: 'locks', label: 'DB Contention & Table Bloat', icon: Database },
          { id: 'integrations', label: 'DataConnect & OM', icon: BarChart2 },
          { id: 'parity', label: 'Cluster Parity & Drift', icon: Server },
          { id: 'scorecard', label: '360° Health Scorecard', icon: ShieldCheck, highlight: true },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? tab.highlight 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Live Data Loading Indicator */}
      {loading && (
        <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
            <span>Querying live TRIRIGA platform telemetry from {selectedServer?.name || 'cluster node'}...</span>
          </div>
          <span className="text-[10px] text-cyan-400 font-mono">Real-time DB2 & JVM</span>
        </div>
      )}

      {/* SUB-TAB 1: Workflow & Async Queues */}
      {activeSubTab === 'workflow' && (
        <div className="space-y-4">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>WF_EVENT Queue Depth</span>
                <Layers className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {workflowData?.wf_event_queue.total_queued ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {workflowData?.wf_event_queue.total_queued === 0 ? 'Queue is clear' : 'Active pending event backlog'}
              </p>
              <CardSparkline 
                data={getSparkData('wfQueue', workflowData?.wf_event_queue.total_queued ?? 0)} 
                color="#06b6d4" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Extended Formula Backlog</span>
                <Zap className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {workflowData?.formula_queue.depth ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {loading && !workflowData
                  ? 'Polling formula queue...'
                  : workflowData?.formula_queue.depth === 0
                  ? 'Queue is clear (EXT_FORMULA_QUEUE)'
                  : workflowData?.formula_queue.depth
                  ? `${workflowData.formula_queue.depth} pending recalculations`
                  : 'Async formula recalculation queue'}
              </p>
              <CardSparkline 
                data={getSparkData('formulaQueue', workflowData?.formula_queue.depth ?? 0)} 
                color="#6366f1" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>WFA Active Threads</span>
                <Cpu className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {workflowData?.wfa_threads.runnable ?? 0} / {workflowData?.wfa_threads.total ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {workflowData?.wfa_threads.blocked ? `${workflowData.wfa_threads.blocked} blocked threads` : 'No threads blocked'}
              </p>
              <CardSparkline 
                data={getSparkData('wfaThreads', workflowData?.wfa_threads.runnable ?? 0)} 
                color="#10b981" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Long-Running Workflows</span>
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {workflowData?.stuck_workflows.count ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Active in WF_INSTANCE
              </p>
            </div>
          </div>

          {/* WF_EVENT Distribution Chart */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span>WF_EVENT Queue Backlog by Event Type</span>
              <span className="text-[11px] text-slate-400 font-normal">Real live TRIRIGA database</span>
            </h2>
            {workflowData?.wf_event_queue.distribution && workflowData.wf_event_queue.distribution.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workflowData.wf_event_queue.distribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                    <XAxis dataKey="event_name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                <p>WF_EVENT queue is completely empty. Asynchronous workflows are operating in real-time steady state.</p>
              </div>
            )}
          </div>

          {/* Stuck / Long Running Workflows Table */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>Active / Long-Running Workflows in WF_INSTANCE</span>
              </h2>
            </div>
            {workflowData?.stuck_workflows.items && workflowData.stuck_workflows.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-2.5">Instance ID</th>
                      <th className="p-2.5">Template ID</th>
                      <th className="p-2.5">Template Name</th>
                      <th className="p-2.5">Started Date</th>
                      <th className="p-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {workflowData.stuck_workflows.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-2.5 font-mono text-cyan-300">{item.instance_id}</td>
                        <td className="p-2.5 font-mono text-slate-400">{item.template_id}</td>
                        <td className="p-2.5 font-medium text-white">{item.template_name}</td>
                        <td className="p-2.5 text-slate-400 font-mono text-xs">{item.start_date ? formatDisplayTime(item.start_date).full : 'N/A'}</td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => handleSendWorkflowToAI(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-[11px] cursor-pointer"
                            title="Analyze this workflow with AI"
                          >
                            <BrainCircuit className="w-3 h-3" />
                            <span>Analyze with AI</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                <p>No stuck or runaway workflows currently detected in WF_INSTANCE.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: JVM & GC Forensics */}
      {activeSubTab === 'gc' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Total GC Pauses</span>
                <Cpu className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {gcData?.summary.total_events ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Parsed from ingested logs</p>
              <CardSparkline 
                data={getSparkData('gcPausesTotal', gcData?.summary.total_events ?? 0)} 
                color="#06b6d4" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Avg Pause Duration</span>
                <Clock className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {gcData?.summary.avg_pause_ms ?? 0} ms
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Mean garbage collection time</p>
              <CardSparkline 
                data={gcData?.events?.slice(-15).map(e => e.pause_ms) || [gcData?.summary.avg_pause_ms ?? 0]} 
                color="#6366f1" 
                unit="ms"
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Max Pause Duration</span>
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {gcData?.summary.max_pause_ms ?? 0} ms
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Peak pause spike</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Stop-The-World (&gt;1s)</span>
                <ShieldAlert className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-rose-400 font-mono">
                {gcData?.summary.stw_pause_count ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Critical STW pause events</p>
            </div>
          </div>

          {/* GC Pause Timeline */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span>GC Pause Duration Timeline (ms)</span>
              <span className="text-[11px] text-slate-400 font-normal">IBM Semeru / J9 verbosegc parser</span>
            </h2>
            {gcData?.has_gc_logs && gcData.events.length > 0 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={gcData.events}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                    <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={10} tickFormatter={(val) => formatShortTimestamp(val)} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit="ms" />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                    <Area type="monotone" dataKey="pause_ms" stroke="#818cf8" fill="#818cf8" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <Cpu className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                <p>{gcData?.message || 'No verbosegc.log or native_stderr.log ingested for this server yet.'}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Add verbosegc.log to your Log Sync & Ingestion target paths to visualize real-time JVM pauses and heap allocations.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: DB Contention & Table Bloat */}
      {activeSubTab === 'locks' && (
        <div className="space-y-4">
          {/* Top Locks KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Active Blocker SPIDs</span>
                <ShieldAlert className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {lockData?.blocker_tree?.length ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {lockData?.blocker_tree?.length === 0 ? 'No blocking locks' : `${lockData?.blocker_tree?.length} active root blockers`}
              </p>
              <CardSparkline 
                data={getSparkData('lockConflicts', lockData?.blocker_tree?.length ?? 0)} 
                color="#f43f5e" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Waiting Requests</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {lockData?.blocker_tree?.reduce((acc, b) => acc + (b.waiting_handles?.length || 0), 0) ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Blocked transactions waiting
              </p>
              <CardSparkline 
                data={getSparkData('lockWaiters', lockData?.blocker_tree?.reduce((acc, b) => acc + (b.waiting_handles?.length || 0), 0) ?? 0)} 
                color="#f59e0b" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Core Tables Monitored</span>
                <Database className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {tableBloatData?.tables?.length ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                High-churn TRIRIGA tables
              </p>
              <CardSparkline 
                data={getSparkData('monitoredTables', tableBloatData?.tables?.length ?? 0)} 
                color="#06b6d4" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Stale DB2 Statistics</span>
                <AlertTriangle className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {tableBloatData?.tables?.filter(t => t.is_stale_stats || (t as any).stats_stale)?.length ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {tableBloatData?.tables?.some(t => t.is_stale_stats || (t as any).stats_stale) ? 'RUNSTATS recommended' : 'All stats up-to-date'}
              </p>
              <CardSparkline 
                data={getSparkData('staleStats', tableBloatData?.tables?.filter(t => t.is_stale_stats || (t as any).stats_stale)?.length ?? 0)} 
                color="#a855f7" 
              />
            </div>
          </div>

          {/* Visual Blocker Tree */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                Active Database Lock Contention Hierarchy (SYSIBMADM.MON_LOCKWAITS)
              </span>
              <span className="text-[11px] text-slate-400 font-normal">Real live lock states</span>
            </h2>

            {lockData?.has_locks && lockData.blocker_tree.length > 0 ? (
              <div className="space-y-3">
                {lockData.blocker_tree.map((blocker, bIdx) => (
                  <div key={bIdx} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-2.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold font-mono">
                          BLOCKER SPID {blocker.blocker_handle}
                        </span>
                        <span className="text-slate-300 font-medium">User: {blocker.user_id}</span>
                        <span className="text-slate-400">• Table: <span className="font-mono text-cyan-300">{blocker.table_name}</span></span>
                        <span className="text-slate-400">• Mode: <span className="font-mono text-amber-300">{blocker.lock_mode}</span></span>
                      </div>
                      <button
                        onClick={() => handleSendLockToAI(blocker)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs cursor-pointer"
                      >
                        <BrainCircuit className="w-3.5 h-3.5" />
                        <span>Analyze Contention</span>
                      </button>
                    </div>

                    {blocker.current_stmt && (
                      <div className="p-2.5 rounded bg-slate-950/80 font-mono text-[11px] text-slate-300 overflow-x-auto">
                        <code>{blocker.current_stmt}</code>
                      </div>
                    )}

                    {/* Waiters */}
                    <div className="pl-4 border-l-2 border-slate-700 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-400">Waiting Applications ({blocker.waiting_handles.length}):</p>
                      {blocker.waiting_handles.map((waiter, wIdx) => (
                        <div key={wIdx} className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800">
                          <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                          <span>Waiting SPID: <span className="font-mono text-amber-300">{waiter.requester_handle}</span></span>
                          <span className="text-slate-500">•</span>
                          <span>Requested Mode: <span className="font-mono text-slate-400">{waiter.requested_mode}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                <p>Zero active lock contentions on database (SYSIBMADM.MON_LOCKWAITS is completely clear).</p>
              </div>
            )}
          </div>

          {/* Core Table Bloat & RUNSTATS Staleness */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span>Core Table Cardinality & RUNSTATS Staleness Audit (SYSCAT.TABLES)</span>
              <span className="text-[11px] text-slate-400 font-normal">Real database metadata</span>
            </h2>
            {tableBloatData?.tables && tableBloatData.tables.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-2.5">Table Name</th>
                      <th className="p-2.5">Row Cardinality</th>
                      <th className="p-2.5">Last Stats Time</th>
                      <th className="p-2.5">Stats Age</th>
                      <th className="p-2.5">Health Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {tableBloatData.tables.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-2.5 font-mono text-cyan-300 font-medium">{t.table_name}</td>
                        <td className="p-2.5 font-mono text-white">{t.cardinality.toLocaleString()}</td>
                        <td className="p-2.5 text-slate-400">{t.stats_time || 'Never Analyzed'}</td>
                        <td className="p-2.5 text-slate-400">{t.stats_age_days !== null ? `${t.stats_age_days} days` : 'N/A'}</td>
                        <td className="p-2.5">
                          {t.is_stale_stats ? (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-medium border border-amber-500/30">
                              Stale Stats (&gt;30d)
                            </span>
                          ) : t.is_high_bloat ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-medium border border-rose-500/30">
                              High Bloat (&gt;5M)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-medium border border-emerald-500/30">
                              Healthy
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <p>Run query or check database permissions to inspect SYSCAT.TABLES.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: DataConnect & Object Migration */}
      {activeSubTab === 'integrations' && (
        <div className="space-y-4">
          {/* Top Integrations KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>DC Batch Jobs</span>
                <Layers className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {dcOmData?.dataconnect?.jobs?.length ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">From DC_JOB staging</p>
              <CardSparkline 
                data={getSparkData('dcJobs', dcOmData?.dataconnect?.jobs?.length ?? 0)} 
                color="#06b6d4" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>DC Processed Records</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {dcOmData?.dataconnect?.jobs?.reduce((acc, j) => acc + (j.PROCESSED_COUNT || 0), 0) ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Batch records ingested</p>
              <CardSparkline 
                data={getSparkData('dcProcessed', dcOmData?.dataconnect?.jobs?.reduce((acc, j) => acc + (j.PROCESSED_COUNT || 0), 0) ?? 0)} 
                color="#10b981" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>OM Package Logs</span>
                <FileText className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {dcOmData?.object_migration?.recent_logs?.length ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">ObjectMigration.log entries</p>
              <CardSparkline 
                data={getSparkData('omLogs', dcOmData?.object_migration?.recent_logs?.length ?? 0)} 
                color="#6366f1" 
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>OM Package Errors</span>
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {(dcOmData?.object_migration as any)?.summary?.errors ?? 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {((dcOmData?.object_migration as any)?.summary?.errors ?? 0) === 0 ? 'No validation failures' : 'Package validation errors'}
              </p>
              <CardSparkline 
                data={getSparkData('omErrors', (dcOmData?.object_migration as any)?.summary?.errors ?? 0)} 
                color="#f43f5e" 
              />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span>DataConnect Batch Staging Jobs (DC_JOB)</span>
              <span className="text-[11px] text-slate-400 font-normal">Real batch staging status</span>
            </h2>
            {dcOmData?.dataconnect.jobs && dcOmData.dataconnect.jobs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-2.5">Job Name</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Processed</th>
                      <th className="p-2.5">Errors</th>
                      <th className="p-2.5">Start Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {dcOmData.dataconnect.jobs.map((j, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-medium text-white">{j.JOB_NAME}</td>
                        <td className="p-2.5 font-mono text-cyan-300">{j.STATUS}</td>
                        <td className="p-2.5 font-mono">{j.PROCESSED_COUNT ?? 0}</td>
                        <td className="p-2.5 font-mono text-rose-400">{j.ERROR_COUNT ?? 0}</td>
                        <td className="p-2.5 text-slate-400">{j.START_TIME}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                <p>No active DataConnect batch jobs currently running in DC_JOB.</p>
              </div>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <h2 className="text-xs font-bold text-slate-200 mb-3 flex items-center justify-between">
              <span>Object Migration Package Logs (ObjectMigration.log)</span>
              <span className="text-[11px] text-slate-400 font-normal">Real package imports</span>
            </h2>
            {dcOmData?.object_migration.recent_logs && dcOmData.object_migration.recent_logs.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {dcOmData.object_migration.recent_logs.map((log, idx) => (
                  <div key={idx} className="p-2.5 rounded bg-slate-950/60 border border-slate-800 text-xs text-slate-300">
                    <span className="text-slate-500 mr-2">[{log.timestamp}]</span>
                    <span className={`font-bold mr-2 ${log.log_level === 'ERROR' ? 'text-rose-400' : 'text-cyan-400'}`}>{log.log_level}</span>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                <FileText className="w-5 h-5 text-slate-500 mx-auto mb-1.5" />
                <p>No Object Migration log entries ingested for this node.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: Cluster Parity & Drift */}
      {activeSubTab === 'parity' && (
        <div className="space-y-4">
          {loading && !parityData ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Auditing TRIRIGA cluster nodes and configuration parity...</p>
              <p className="text-[11px] text-slate-500">Checking JVM ports, Admin Console paths, and log ingestion synchronicity across nodes.</p>
            </div>
          ) : (
            <>
              {parityData?.drift_warnings && parityData.drift_warnings.length > 0 ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Configuration Drift / Workload Skew Detected:</span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    {parityData.drift_warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>Cluster Parity Verified:</strong> All cluster nodes report matching network protocols, ports, and Admin Console endpoints with synchronized activity.
                  </span>
                </div>
              )}

              {/* Clustered Groups (e.g., Production Cluster: prod app1 & prod app2) */}
              {parityData?.clusters && parityData.clusters.filter(c => c.is_clustered).map((cluster, cidx) => (
                <div key={cidx} className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{cluster.name}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {cluster.nodes.length} Clustered Nodes (Active HA)
                          </span>
                        </h2>
                        <p className="text-[11px] text-slate-400">
                          Production high-availability pair sharing application context and balanced log harvesting.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onNavigateTab?.('server_config')}
                        className="text-[11px] text-purple-300 hover:text-purple-200 flex items-center gap-1 cursor-pointer font-medium bg-purple-500/15 hover:bg-purple-500/25 px-2.5 py-1 rounded-lg border border-purple-500/30 transition-colors"
                        title="Open full multi-server configuration parity and diff matrix"
                      >
                        <span>Full Config & Parity Matrix</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => onNavigateTab?.('servers')}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer font-medium"
                      >
                        <span>Manage Nodes</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="p-2.5">Node Name</th>
                          <th className="p-2.5">Host / IP Address</th>
                          <th className="p-2.5">Port</th>
                          <th className="p-2.5">Protocol</th>
                          <th className="p-2.5">Admin Path</th>
                          <th className="p-2.5">Ingested Logs</th>
                          <th className="p-2.5">Error Count</th>
                          <th className="p-2.5">Last Sync</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {cluster.nodes.map((n, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="p-2.5 font-semibold text-white flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                              <span>{n.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                            </td>
                            <td className="p-2.5 font-mono text-cyan-300">{n.host}</td>
                            <td className="p-2.5 font-mono text-slate-300">{n.port}</td>
                            <td className="p-2.5 font-mono uppercase text-slate-300">{n.protocol}</td>
                            <td className="p-2.5 font-mono text-slate-400 truncate max-w-[160px]" title={n.admin_path}>{n.admin_path}</td>
                            <td className="p-2.5 font-mono">{n.total_logs.toLocaleString()}</td>
                            <td className="p-2.5 font-mono text-rose-400 font-semibold">{n.total_errors}</td>
                            <td className="p-2.5 text-slate-400">{n.last_sync_at ? n.last_sync_at.substring(0, 19).replace('T', ' ') : 'Never'}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {n.status || 'configured'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Standalone / Unclustered Servers */}
              {(() => {
                const standaloneNodes = parityData?.clusters?.filter(c => !c.is_clustered).flatMap(c => c.nodes) || [];
                if (standaloneNodes.length === 0) return null;
                return (
                  <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                      <div>
                        <h2 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                          <span>Standalone / Unclustered TRIRIGA Environments</span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            ({standaloneNodes.length} environments)
                          </span>
                        </h2>
                        <p className="text-[11px] text-slate-500">
                          Individual non-clustered environments. To link multiple instances into an HA cluster, assign them a shared Cluster Group in Server Manager.
                        </p>
                      </div>

                      <button
                        onClick={() => onNavigateTab?.('servers')}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-colors cursor-pointer shrink-0"
                      >
                        Assign Clusters in Server Manager
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="p-2.5">Environment</th>
                            <th className="p-2.5">Host:Port</th>
                            <th className="p-2.5">Protocol</th>
                            <th className="p-2.5">Admin Path</th>
                            <th className="p-2.5">Ingested Logs</th>
                            <th className="p-2.5">Error Count</th>
                            <th className="p-2.5">Last Sync</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {standaloneNodes.map((n, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="p-2.5 font-medium text-slate-200">{n.name}</td>
                              <td className="p-2.5 font-mono text-cyan-300">{n.host}:{n.port}</td>
                              <td className="p-2.5 font-mono uppercase text-slate-300">{n.protocol}</td>
                              <td className="p-2.5 font-mono text-slate-400">{n.admin_path}</td>
                              <td className="p-2.5 font-mono">{n.total_logs.toLocaleString()}</td>
                              <td className="p-2.5 font-mono text-rose-400">{n.total_errors}</td>
                              <td className="p-2.5 text-slate-400">{n.last_sync_at ? n.last_sync_at.substring(0, 19).replace('T', ' ') : 'Never'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* No servers at all */}
              {(!parityData?.nodes || parityData.nodes.length === 0) && (
                <div className="py-10 text-center rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
                  <Server className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-300">No TRIRIGA Servers Configured</p>
                  <p className="text-xs text-slate-500 mt-1 mb-4">Add TRIRIGA application servers to monitor cluster parity and configuration drift.</p>
                  <button
                    onClick={() => onNavigateTab?.('servers')}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 cursor-pointer"
                  >
                    Go to Server Manager
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SUB-TAB 7: 360° Health Scorecard */}
      {activeSubTab === 'scorecard' && (
        <div className="space-y-4">
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              {/* Grade Badge */}
              <button
                onClick={() => fetchActiveTabData()}
                disabled={loading}
                title="Click to re-assess TRIRIGA platform health"
                className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center font-extrabold shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:cursor-not-allowed shrink-0 ${
                  scorecardData?.health_grade === 'A' 
                    ? 'bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 shadow-emerald-500/20'
                    : scorecardData?.health_grade === 'B'
                      ? 'bg-blue-500/20 border-2 border-blue-500 text-blue-400 shadow-blue-500/20'
                      : scorecardData?.health_grade === 'C'
                        ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-400 shadow-amber-500/20'
                        : scorecardData?.health_grade === 'D' || scorecardData?.health_grade === 'F'
                          ? 'bg-rose-500/20 border-2 border-rose-500 text-rose-400 shadow-rose-500/20'
                          : 'bg-slate-800 border-2 border-slate-700 text-slate-400 shadow-slate-900/40'
                }`}
              >
                {loading ? (
                  <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
                ) : (
                  <>
                    <span className="text-4xl leading-none">{scorecardData?.health_grade || '-'}</span>
                    <span className="text-[9px] uppercase tracking-wider font-semibold opacity-70 mt-1">Grade</span>
                  </>
                )}
              </button>

              <div>
                <button
                  onClick={() => fetchActiveTabData()}
                  disabled={loading}
                  title="Click to run live TRIRIGA platform health assessment"
                  className="text-left group cursor-pointer disabled:cursor-not-allowed block"
                >
                  <div className="text-xl font-bold text-white flex flex-wrap items-center gap-2.5 group-hover:text-cyan-300 transition-colors">
                    <span>TRIRIGA Platform Health:</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide border transition-all ${
                      loading
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
                        : scorecardData?.status === 'HEALTHY'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 group-hover:border-emerald-500/60'
                          : scorecardData?.status === 'STABLE'
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 group-hover:border-blue-500/60'
                            : scorecardData?.status === 'WARNING'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 group-hover:border-amber-500/60'
                              : scorecardData?.status === 'DEGRADED' || scorecardData?.status === 'CRITICAL'
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 group-hover:border-rose-500/60'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {loading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                          <span>Assessing Live...</span>
                        </>
                      ) : (
                        <>
                          <span>{scorecardData?.status || 'Assessing...'}</span>
                          <RefreshCw className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </>
                      )}
                    </span>
                  </div>
                </button>
                <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                  <span>Overall Score:</span>
                  <span className="font-bold text-white font-mono text-sm">{scorecardData?.health_score ?? (loading ? '...' : 0)}</span> / 100
                  {scorecardData?.timestamp && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      (Assessed at {formatDisplayTime(scorecardData.timestamp).full})
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Target Server: {selectedServer?.name} ({selectedServer?.host}:{selectedServer?.port})
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => fetchActiveTabData()}
                disabled={loading}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-50 transition-all"
                title="Perform live evaluation of DB locks, workflow queue depth, JVM threads, and log errors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Assessing Platform...' : 'Re-assess Platform Health'}</span>
              </button>

              <button
                onClick={handleDownloadBundle}
                disabled={downloadingBundle}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50 transition-all"
              >
                <DownloadCloud className={`w-4 h-4 ${downloadingBundle ? 'animate-spin' : ''}`} />
                <span>{downloadingBundle ? 'Packaging Bundle...' : 'Export Diagnostic Bundle (.ZIP)'}</span>
              </button>
            </div>
          </div>

          {/* Initial Loading Skeleton */}
          {loading && !scorecardData && (
            <div className="p-8 rounded-2xl bg-slate-900/90 border border-cyan-500/30 shadow-xl text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-white">Assessing TRIRIGA Platform Health...</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Evaluating live database lock contention (<code className="text-cyan-300">SYSIBMADM.MON_LOCKWAITS</code>), asynchronous workflow queue depth (<code className="text-cyan-300">TRIDATA.WF_EVENT</code>), JVM thread states, and server error rates.
              </p>
            </div>
          )}

          {/* Assessment Failure Notice */}
          {!loading && !scorecardData && error && (
            <div className="p-8 rounded-2xl bg-slate-900/90 border border-rose-500/30 shadow-xl text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
              <p className="text-sm font-semibold text-rose-300">Health Assessment Incomplete</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">{error}</p>
              <button
                onClick={() => fetchActiveTabData()}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer shadow-lg shadow-cyan-600/20"
              >
                Retry Health Assessment
              </button>
            </div>
          )}

          {/* Health Telemetry Metric Cards */}
          {scorecardData && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Health Score Trend</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {scorecardData?.health_score ?? 0} / 100
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Composite system grade: {scorecardData?.health_grade || '-'}</p>
                  <CardSparkline 
                    data={getSparkData('healthScore', scorecardData?.health_score ?? 0)} 
                    color="#10b981" 
                  />
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>DB Blocked Threads</span>
                    <Database className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {scorecardData?.metrics?.db_blocked_threads ?? 0}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {scorecardData?.metrics?.db_blocked_threads === 0 ? 'Zero lock blocking' : 'JVM threads waiting on DB locks'}
                  </p>
                  <CardSparkline 
                    data={getSparkData('cardBlocked', scorecardData?.metrics?.db_blocked_threads ?? 0)} 
                    color="#f43f5e" 
                  />
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>WF Queue Backlog</span>
                    <Layers className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {scorecardData?.metrics?.wf_queue_depth ?? 0}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {scorecardData?.metrics?.wf_queue_depth === 0 ? 'Queue is clear' : 'Active event backlog'}
                  </p>
                  <CardSparkline 
                    data={getSparkData('cardWfQueue', scorecardData?.metrics?.wf_queue_depth ?? 0)} 
                    color="#f59e0b" 
                  />
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Total Log Errors</span>
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {(scorecardData?.metrics?.total_errors ?? 0).toLocaleString()}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Ingested error & fatal events</p>
                  <CardSparkline 
                    data={getSparkData('cardErrors', scorecardData?.metrics?.total_errors ?? 0)} 
                    color="#f43f5e" 
                  />
                </div>
              </div>

              {/* Deductions & Operational Action Items */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
                <h3 className="text-xs font-bold text-slate-200">Health Deductions & Action Items</h3>
                {scorecardData?.deductions && scorecardData.deductions.length > 0 ? (
                  <div className="space-y-2">
                    {scorecardData.deductions.map((d, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-white">{d.factor}</span>
                          <p className="text-slate-400 text-[11px]">{d.detail}</p>
                        </div>
                        <span className="font-bold font-mono text-rose-400 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                          -{d.penalty} pts
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-slate-400 bg-slate-800/30 rounded-xl border border-slate-800">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                    <p>Zero health deductions. All monitored systems (locks, threads, queues, error rates) are within optimal thresholds.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
