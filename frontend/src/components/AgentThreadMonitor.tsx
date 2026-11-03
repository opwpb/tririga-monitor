import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Activity, 
  Cpu, 
  RefreshCw, 
  AlertTriangle, 
  ShieldAlert, 
  Clock, 
  Search, 
  Layers, 
  CheckCircle2, 
  XCircle, 
  Server, 
  Filter, 
  ChevronRight, 
  ChevronDown, 
  Flame, 
  ArrowUpRight,
  Database,
  BrainCircuit,
  Pause,
  Play,
  TrendingUp,
  BarChart2,
  Users,
  Radio,
  Zap
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { TririgaServer, LiveAgentMonitorData, LiveThread } from '../types';
import { api } from '../services/api';
import { startLiveTimer } from '../utils/liveTimer';

export interface TelemetryPoint {
  time: string;
  timestamp: number;
  totalThreads: number;
  runnableThreads: number;
  waitingThreads: number;
  blockedThreads: number;
  dbBlockedThreads: number;
  wfQueueDepth: number;
  lockWaits: number;
  activeBcSessions: number;
}

interface AgentThreadMonitorProps {
  servers: TririgaServer[];
  onSendToAI?: (promptText: string) => void;
  onLiveStatusChange?: (isLive: boolean) => void;
  activeView?: 'agent' | 'thread' | 'all';
  onViewChange?: (view: 'agent' | 'thread' | 'all') => void;
}

export const AgentThreadMonitor: React.FC<AgentThreadMonitorProps> = ({ 
  servers, 
  onSendToAI, 
  onLiveStatusChange,
  activeView = 'agent',
  onViewChange
}) => {
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(() => {
    return servers.length > 0 ? servers[0].id : undefined;
  });

  const [view, setView] = useState<'agent' | 'thread' | 'all'>(activeView);
  // Graph view mode: 'threads' | 'events_locks' | 'split'
  const [graphMode, setGraphMode] = useState<'threads' | 'events_locks' | 'split'>(
    activeView === 'agent' ? 'events_locks' : activeView === 'thread' ? 'threads' : 'split'
  );

  useEffect(() => {
    if (activeView) {
      setView(activeView);
      if (activeView === 'agent') {
        setGraphMode('events_locks');
      } else if (activeView === 'thread') {
        setGraphMode('threads');
      } else {
        setGraphMode('split');
      }
    }
  }, [activeView]);

  const handleSelectView = (newView: 'agent' | 'thread' | 'all') => {
    setView(newView);
    if (newView === 'agent') {
      setGraphMode('events_locks');
      setSubsystemFilter('ALL');
    } else if (newView === 'thread') {
      setGraphMode('threads');
      setSubsystemFilter('ALL');
    } else {
      setGraphMode('split');
      setSubsystemFilter('ALL');
    }
    onViewChange?.(newView);
  };

  const [monitorData, setMonitorData] = useState<LiveAgentMonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tririga_agent_monitor_interval');
      return saved ? parseInt(saved, 10) : 10;
    } catch {
      return 10;
    }
  });
  const [autoRefreshActive, setAutoRefreshActive] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('tririga_agent_monitor_autorefresh');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // Persist live settings and notify parent
  useEffect(() => {
    try {
      localStorage.setItem('tririga_agent_monitor_autorefresh', String(autoRefreshActive));
      localStorage.setItem('tririga_agent_monitor_interval', String(refreshInterval));
    } catch {}
    onLiveStatusChange?.(autoRefreshActive && refreshInterval > 0);
  }, [autoRefreshActive, refreshInterval, onLiveStatusChange]);

  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [subsystemFilter, setSubsystemFilter] = useState<string>('ALL');
  const [onlyDbBlocked, setOnlyDbBlocked] = useState<boolean>(false);

  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);

  const [sortField, setSortField] = useState<keyof LiveThread>('subsystem');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Real-time telemetry history buffer (up to 30 live samples)
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [showFullGraph, setShowFullGraph] = useState<boolean>(true);

  const fetchLiveData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);

    try {
      const data = await api.getLiveAgentMonitor(selectedServerId);
      setMonitorData(data);
      const now = new Date();
      setLastRefreshedAt(now);

      if (data && data.is_online) {
        const timeLabel = now.toLocaleTimeString('en-GB', { hour12: false });
        const summary = data.threads_summary || { total: 0, runnable: 0, waiting: 0, blocked: 0, db_blocked: 0 };
        const newPoint: TelemetryPoint = {
          time: timeLabel,
          timestamp: now.getTime(),
          totalThreads: summary.total || 0,
          runnableThreads: summary.runnable || 0,
          waitingThreads: summary.waiting || 0,
          blockedThreads: summary.blocked || 0,
          dbBlockedThreads: summary.db_blocked || 0,
          wfQueueDepth: data.wf_event_summary?.total_queued || 0,
          lockWaits: (data.lock_waits || []).length,
          activeBcSessions: data.business_connect_summary?.total_active_bc || 0,
        };

        setHistory((prev) => {
          if (prev.length === 0) {
            const initialPast = {
              ...newPoint,
              time: new Date(now.getTime() - 1000).toLocaleTimeString('en-GB', { hour12: false }),
              timestamp: now.getTime() - 1000,
            };
            return [initialPast, newPoint];
          }
          const next = [...prev, newPoint];
          return next.slice(-30);
        });
      }

      if (!data.is_online && data.error) {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch live agent & thread telemetry');
      setMonitorData((prev) => (prev ? { ...prev, is_online: false, error: err.message } : null));
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    // Reset history when switching target server so traces reflect that specific node
    setHistory([]);
    fetchLiveData();
  }, [selectedServerId]);

  // Unthrottled background auto-refresh timer (stays active across tab navigation and browser minimization)
  useEffect(() => {
    if (!autoRefreshActive || refreshInterval <= 0) return;

    const timer = startLiveTimer(() => {
      fetchLiveData(true);
    }, refreshInterval * 1000);

    return () => {
      timer.stop();
    };
  }, [selectedServerId, autoRefreshActive, refreshInterval]);

  const toggleSort = (field: keyof LiveThread) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const agentThreads = useMemo(() => {
    if (!monitorData?.threads) return [];
    return monitorData.threads.filter(
      (t) => t.subsystem === 'Workflow Agent' || t.subsystem === 'Background Agent'
    );
  }, [monitorData]);

  const runnableAgentCount = useMemo(() => {
    return agentThreads.filter((t) => t.state === 'RUNNABLE').length;
  }, [agentThreads]);

  const waitingThreadsCount = useMemo(() => {
    if (!monitorData?.threads_summary) return 0;
    return monitorData.threads_summary.waiting ?? 0;
  }, [monitorData]);

  const filteredThreads = useMemo(() => {
    if (!monitorData || !monitorData.threads) return [];

    return monitorData.threads
      .filter((t) => {
        if (view === 'agent' && t.subsystem !== 'Workflow Agent' && t.subsystem !== 'Background Agent') {
          return false;
        }
        if (onlyDbBlocked && !t.db_blocked) return false;
        if (stateFilter !== 'ALL' && t.state !== stateFilter) return false;
        if (subsystemFilter !== 'ALL' && t.subsystem !== subsystemFilter) return false;
        if (searchTerm) {
          const s = searchTerm.toLowerCase();
          return (
            t.name.toLowerCase().includes(s) ||
            t.id.toLowerCase().includes(s) ||
            t.subsystem.toLowerCase().includes(s) ||
            t.stack_trace.toLowerCase().includes(s)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        if (typeof valA === 'boolean') {
          return sortAsc ? (valA === valB ? 0 : valA ? -1 : 1) : (valA === valB ? 0 : valA ? 1 : -1);
        }
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });
  }, [monitorData, searchTerm, stateFilter, subsystemFilter, onlyDbBlocked, sortField, sortAsc, view]);

  const activeServer = servers.find((s) => s.id === selectedServerId);

  const handleSendToAIForAnalysis = () => {
    if (!onSendToAI || !monitorData) return;

    const summary = monitorData.threads_summary;
    const bcSummary = monitorData.business_connect_summary;
    const prompt = `[LIVE THREAD & AGENT HEALTH DIAGNOSTIC]
Target Server: ${monitorData.server_name || 'TRIRIGA Node'} (${monitorData.server_host || 'remote'})
Online Status: ${monitorData.is_online ? 'ONLINE (Live Connection Verified)' : 'OFFLINE / UNREACHABLE'}
Total Threads: ${summary.total} (Runnable: ${summary.runnable}, Waiting: ${summary.waiting}, Blocked: ${summary.blocked}, DB-Blocked: ${summary.db_blocked})
Active Business Connect (TBC) Sessions: ${bcSummary?.total_active_bc ?? 0} active sessions
Active Interactive User Sessions: ${bcSummary?.total_active_interactive ?? 0} active sessions
WF_EVENT Queue Depth: ${monitorData.wf_event_summary.total_queued} events queued
Active DB2 Lock Waits: ${monitorData.lock_waits.length} contention events detected

Top Business Connect User Sessions:
${
  bcSummary?.bc_users && bcSummary.bc_users.length > 0
    ? bcSummary.bc_users.slice(0, 5).map((u) => `- Account "${u.user_name}" (${u.full_name}) | ${u.active_sessions} unclosed sessions from ${u.ip_address} on ${u.host_name} (Latest: ${u.latest_login})`).join('\n')
    : 'No active Business Connect sessions detected.'
}
${
  bcSummary?.queued_login_users && bcSummary.queued_login_users.length > 0
    ? `\nQueued Login Workflows by User:\n` + bcSummary.queued_login_users.map((u) => `- User "${u.user_name}" (${u.full_name}): ${u.queued_count} pending login workflows queued`).join('\n')
    : ''
}

Database Blocked Threads Identified:
${
  monitorData.threads
    .filter((t) => t.db_blocked)
    .map((t) => `- Thread ID #${t.id} "${t.name}" [State: ${t.state} | Subsystem: ${t.subsystem}]\n  Stack: ${t.stack_trace.slice(0, 250)}...`)
    .join('\n') || 'None detected.'
}

Top Queued WF_EVENT Categories:
${
  monitorData.wf_event_summary.events
    .slice(0, 5)
    .map((e) => `- ${e.EVENT_NAME || 'Unknown Event'} (Status: ${e.STATUS}): ${e.EVENT_COUNT}`)
    .join('\n') || 'None.'
}

Active Lock Waits:
${
  monitorData.lock_waits
    .slice(0, 5)
    .map((lw) => `- Holding: ${lw.HOLDING_APP || 'App'} | Mode: ${lw.REQ_MODE} | Table: ${lw.BLOCKED_TABLE} | Wait: ${lw.WAIT_SECS}s`)
    .join('\n') || 'No active DB2 lock waits recorded.'
}

Please perform a root cause and concurrency assessment of this live thread telemetry, checking whether any Workflow Agent (WFA) threads or asynchronous queues are starved or deadlocked, and evaluate whether Business Connect session bursts are driving lock escalation on SESSION_HISTORY or thread starvation.`;

    onSendToAI(prompt);
  };

  // --- KPI Card Renderers ---
  const renderTotalThreadsCard = () => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Total JVM Threads
          </span>
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            <Activity className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {monitorData?.threads_summary.total ?? 0}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Runnable: {monitorData?.threads_summary.runnable ?? 0}
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="totalThreadsSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="totalThreads" stroke="#3b82f6" strokeWidth={1.8} fill="url(#totalThreadsSpark)" isAnimationActive={false} />
              <Area type="monotone" dataKey="runnableThreads" stroke="#10b981" strokeWidth={1.2} fill="none" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  const renderDbBlockedCard = () => (
    <div className={`p-4 rounded-xl border shadow-xs transition flex flex-col justify-between ${
      (monitorData?.threads_summary.db_blocked ?? 0) > 0 
        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800' 
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
    }`}>
      <div>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold uppercase tracking-wider ${
            (monitorData?.threads_summary.db_blocked ?? 0) > 0 
              ? 'text-rose-700 dark:text-rose-400' 
              : 'text-slate-500 dark:text-slate-400'
          }`}>
            DB Contention Blocked
          </span>
          <div className={`p-2 rounded-lg ${
            (monitorData?.threads_summary.db_blocked ?? 0) > 0 
              ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 animate-bounce' 
              : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
          }`}>
            {(monitorData?.threads_summary.db_blocked ?? 0) > 0 ? (
              <Flame className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${
            (monitorData?.threads_summary.db_blocked ?? 0) > 0 
              ? 'text-rose-700 dark:text-rose-300' 
              : 'text-slate-900 dark:text-white'
          }`}>
            {monitorData?.threads_summary.db_blocked ?? 0}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Blocked: {monitorData?.threads_summary.blocked ?? 0}
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="dbBlockedSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.5}/>
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="dbBlockedThreads" stroke="#f43f5e" strokeWidth={2} fill="url(#dbBlockedSpark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  const renderAgentThreadsCard = () => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Workflow &amp; Background Agents
          </span>
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
            <Cpu className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {agentThreads.length}
          </span>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
            Runnable: {runnableAgentCount}
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="agentThreadsSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="totalThreads" stroke="#6366f1" strokeWidth={1.8} fill="url(#agentThreadsSpark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  const renderWaitingThreadsCard = () => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Waiting / Idle Workers
          </span>
          <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {waitingThreadsCount}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            State: WAITING
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60 flex items-center text-[11px] text-slate-500 dark:text-slate-400">
        <span>Worker pool standing by for requests</span>
      </div>
    </div>
  );

  const renderBcCard = () => (
    <div className={`p-4 rounded-xl border shadow-xs flex flex-col justify-between ${
      (monitorData?.business_connect_summary?.total_active_bc ?? 0) > 15
        ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-800'
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
    }`}>
      <div>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold uppercase tracking-wider ${
            (monitorData?.business_connect_summary?.total_active_bc ?? 0) > 15
              ? 'text-purple-700 dark:text-purple-300'
              : 'text-slate-500 dark:text-slate-400'
          }`}>
            Business Connect (TBC)
          </span>
          <div className={`p-2 rounded-lg ${
            (monitorData?.business_connect_summary?.total_active_bc ?? 0) > 15
              ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 animate-pulse'
              : 'bg-slate-100 dark:bg-slate-700 text-purple-600 dark:text-purple-400'
          }`}>
            <Radio className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${
            (monitorData?.business_connect_summary?.total_active_bc ?? 0) > 15
              ? 'text-purple-700 dark:text-purple-300'
              : 'text-slate-900 dark:text-white'
          }`}>
            {monitorData?.business_connect_summary?.total_active_bc ?? 0}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Interactive: {monitorData?.business_connect_summary?.total_active_interactive ?? 0}
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="bcSessionsSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a855f7" stopOpacity={0.45}/>
                  <stop offset="100%" stopColor="#a855f7" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="activeBcSessions" stroke="#a855f7" strokeWidth={1.8} fill="url(#bcSessionsSpark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  const renderWfEventCard = () => (
    <div className={`p-4 rounded-xl border shadow-xs flex flex-col justify-between ${
      (monitorData?.wf_event_summary.total_queued ?? 0) > 500 
        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800' 
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
    }`}>
      <div>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold uppercase tracking-wider ${
            (monitorData?.wf_event_summary.total_queued ?? 0) > 500 
              ? 'text-amber-700 dark:text-amber-400' 
              : 'text-slate-500 dark:text-slate-400'
          }`}>
            WF_EVENT Backlog
          </span>
          <div className={`p-2 rounded-lg ${
            (monitorData?.wf_event_summary.total_queued ?? 0) > 500 
              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300' 
              : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
          }`}>
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {monitorData?.wf_event_summary.total_queued ?? 0}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Types: {monitorData?.wf_event_summary.events.length ?? 0}
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="wfQueueSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.45}/>
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="wfQueueDepth" stroke="#f59e0b" strokeWidth={1.8} fill="url(#wfQueueSpark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  const renderLockWaitsCard = () => (
    <div className={`p-4 rounded-xl border shadow-xs flex flex-col justify-between ${
      (monitorData?.lock_waits.length ?? 0) > 0 
        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800' 
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
    }`}>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Active Lock Waits
          </span>
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
            <Database className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${
            (monitorData?.lock_waits.length ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
          }`}>
            {monitorData?.lock_waits.length ?? 0}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            MON_LOCKWAITS
          </span>
        </div>
      </div>
      <div className="h-10 w-full mt-3 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="lockWaitsSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.5}/>
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <YAxis domain={[0, 'auto']} hide />
              <Area type="monotone" dataKey="lockWaits" stroke="#818cf8" strokeWidth={1.8} fill="url(#lockWaitsSpark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
            Collecting live trace...
          </div>
        )}
      </div>
    </div>
  );

  // --- Table Renderers ---
  const renderBcTable = () => (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
          <Radio className="w-4 h-4 text-purple-500" />
          <span>Business Connect (TBC) &amp; API Logins</span>
        </h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          (monitorData?.business_connect_summary?.total_active_bc ?? 0) > 15
            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-bold'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
        }`}>
          {monitorData?.business_connect_summary?.total_active_bc ?? 0} TBC Active
        </span>
      </div>

      {/* Queued Login Workflow Alerts */}
      {monitorData?.business_connect_summary?.queued_login_users && monitorData.business_connect_summary.queued_login_users.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-700 dark:text-amber-300">
            <Zap className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
            <span>Queued WF USER LOGIN Events Detected</span>
          </div>
          <div className="space-y-0.5">
            {monitorData.business_connect_summary.queued_login_users.map((qu, idx) => (
              <div key={idx} className="flex items-center justify-between text-[11px] font-mono">
                <span>User: <strong>{qu.user_name}</strong> ({qu.full_name})</span>
                <span className="font-bold px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100">{qu.queued_count} queued</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-semibold">
            <tr>
              <th className="p-2">User / Account</th>
              <th className="p-2">Client IP &amp; Node</th>
              <th className="p-2 text-right">Sessions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {(!monitorData?.business_connect_summary?.bc_users || monitorData.business_connect_summary.bc_users.length === 0) ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  {loading ? 'Querying ACTIVE_SESSION_USER...' : 'No active Business Connect sessions detected.'}
                </td>
              </tr>
            ) : (
              monitorData.business_connect_summary.bc_users.map((bc, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="p-2">
                    <div className="font-mono font-bold text-purple-700 dark:text-purple-300 text-[11px] flex items-center gap-1">
                      <Radio className="w-2.5 h-2.5 text-purple-500 shrink-0" />
                      <span>{bc.user_name}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[130px]" title={bc.full_name}>
                      {bc.full_name}
                    </div>
                  </td>
                  <td className="p-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    <div>{bc.ip_address || '—'}</div>
                    <div className="text-[10px] text-slate-400">{bc.host_name || 'app'}</div>
                  </td>
                  <td className="p-2 text-right">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${
                      bc.active_sessions > 15
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                        : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                    }`}>
                      {bc.active_sessions}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <span className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          Interactive Human Sessions:
        </span>
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
          {monitorData?.business_connect_summary?.total_active_interactive ?? 0}
        </span>
      </div>
    </div>
  );

  const renderWfEventTable = () => (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-500" />
          <span>WF_EVENT Queue Backlog</span>
        </h3>
        <span className="text-xs font-semibold text-slate-500">
          Total: {monitorData?.wf_event_summary.total_queued ?? 0}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-semibold">
            <tr>
              <th className="p-2">Event Name</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {(!monitorData?.wf_event_summary.events || monitorData.wf_event_summary.events.length === 0) ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  {loading ? 'Querying TRIDATA.WF_EVENT...' : 'No queued events found or table empty.'}
                </td>
              </tr>
            ) : (
              monitorData.wf_event_summary.events.map((ev, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="p-2 font-mono text-[11px] text-slate-900 dark:text-slate-100 truncate max-w-[140px]" title={ev.EVENT_NAME}>
                    {ev.EVENT_NAME || 'triAction'}
                  </td>
                  <td className="p-2 text-center">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {ev.STATUS || 'QUEUED'}
                    </span>
                  </td>
                  <td className="p-2 text-right font-bold text-slate-900 dark:text-white">
                    {ev.EVENT_COUNT}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderLockWaitsTable = () => (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500" />
          <span>Active DB2 Lock Contention</span>
        </h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          (monitorData?.lock_waits.length ?? 0) > 0
            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
        }`}>
          {monitorData?.lock_waits.length ?? 0} Waits
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-semibold">
            <tr>
              <th className="p-2">Table</th>
              <th className="p-2 text-center">Mode</th>
              <th className="p-2 text-right">Wait (s)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {(!monitorData?.lock_waits || monitorData.lock_waits.length === 0) ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  {loading ? 'Checking MON_LOCKWAITS...' : 'No lock contention currently detected in DB2.'}
                </td>
              </tr>
            ) : (
              monitorData.lock_waits.map((lw, idx) => (
                <tr key={idx} className="bg-rose-50/50 dark:bg-rose-950/20">
                  <td className="p-2 font-mono text-[11px] text-rose-700 dark:text-rose-300 font-semibold truncate max-w-[120px]" title={lw.BLOCKED_TABLE}>
                    {lw.BLOCKED_TABLE || 'IBS_SPEC_INCL_EXCL'}
                  </td>
                  <td className="p-2 text-center font-mono text-[10px] text-slate-600 dark:text-slate-300">
                    {lw.REQ_MODE || 'X'}
                  </td>
                  <td className="p-2 text-right font-bold text-rose-600 dark:text-rose-400">
                    {lw.WAIT_SECS !== undefined ? `${lw.WAIT_SECS}s` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderThreadMatrix = (isFullWidth: boolean, agentOnly: boolean = false) => (
    <div className={`${isFullWidth ? 'w-full' : 'lg:col-span-2'} bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col`}>
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/50">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>{agentOnly ? 'Workflow & Background Agent Execution Matrix' : 'JVM Worker Thread Matrix'}</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              {filteredThreads.length} of {agentOnly ? agentThreads.length : (monitorData?.threads.length ?? 0)}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {agentOnly
              ? 'Inspect active asynchronous Workflow Agent executors, background job threads, and stack traces.'
              : 'Inspect thread state transitions, Workflow Agent executors, and stack traces.'}
          </p>
        </div>

        <button
          onClick={() => setOnlyDbBlocked(!onlyDbBlocked)}
          className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            onlyDbBlocked 
              ? 'bg-rose-600 text-white shadow-xs' 
              : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          <Flame className="w-3.5 h-3.5 mr-1 text-amber-300" />
          Only DB Blocked ({monitorData?.threads_summary.db_blocked ?? 0})
        </button>
      </div>

      <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={agentOnly ? "Search agent thread name, ID, or stack..." : "Search thread name, ID, or stack..."}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 text-xs focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <select
          value={subsystemFilter}
          onChange={(e) => setSubsystemFilter(e.target.value)}
          className="bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-blue-500 cursor-pointer"
        >
          {agentOnly ? (
            <>
              <option value="ALL">All Agent Subsystems</option>
              <option value="Workflow Agent">Workflow Agent</option>
              <option value="Background Agent">Background Agent</option>
            </>
          ) : (
            <>
              <option value="ALL">All Subsystems</option>
              <option value="Workflow Agent">Workflow Agent</option>
              <option value="Background Agent">Background Agent</option>
              <option value="Web Container / HTTP">Web Container / HTTP</option>
              <option value="Database / Pool">Database / Pool</option>
              <option value="System / JVM">System / JVM</option>
            </>
          )}
        </select>

        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-blue-500 cursor-pointer"
        >
          <option value="ALL">All States</option>
          <option value="RUNNABLE">RUNNABLE</option>
          <option value="WAITING">WAITING</option>
          <option value="TIMED_WAITING">TIMED_WAITING</option>
          <option value="BLOCKED">BLOCKED</option>
        </select>
      </div>

      <div className="flex-1 overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-300 sticky top-0 font-semibold z-10">
            <tr>
              <th className="p-2.5 w-10 text-center">#</th>
              <th 
                className="p-2.5 cursor-pointer hover:text-blue-600"
                onClick={() => toggleSort('name')}
              >
                Thread Name
              </th>
              <th 
                className="p-2.5 cursor-pointer hover:text-blue-600 w-36"
                onClick={() => toggleSort('subsystem')}
              >
                Subsystem
              </th>
              <th 
                className="p-2.5 cursor-pointer hover:text-blue-600 w-28 text-center"
                onClick={() => toggleSort('state')}
              >
                State
              </th>
              <th 
                className="p-2.5 cursor-pointer hover:text-blue-600 w-24 text-center"
                onClick={() => toggleSort('db_blocked')}
              >
                DB Contention
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {filteredThreads.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  {loading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                      <span>Reading live threads from TRIRIGA Administrator Console...</span>
                    </div>
                  ) : (
                    <span>No threads match the selected criteria or server is offline.</span>
                  )}
                </td>
              </tr>
            ) : (
              filteredThreads.map((t) => {
                const isExpanded = expandedThreadId === t.id;
                return (
                  <React.Fragment key={t.id || t.name}>
                    <tr
                      onClick={() => setExpandedThreadId(isExpanded ? null : t.id)}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition ${
                        t.db_blocked 
                          ? 'bg-rose-50/70 dark:bg-rose-950/20' 
                          : isExpanded 
                            ? 'bg-blue-50/50 dark:bg-blue-950/20' 
                            : ''
                      }`}
                    >
                      <td className="p-2.5 text-center text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 inline text-blue-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 inline" />
                        )}
                      </td>
                      <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100 break-words">
                        <span className="font-mono text-[11px] text-slate-400 mr-2">#{t.id}</span>
                        {t.name}
                      </td>
                      <td className="p-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.subsystem === 'Workflow Agent'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            : t.subsystem === 'Background Agent'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : t.subsystem === 'Web Container / HTTP'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : t.subsystem === 'Database / Pool'
                            ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300'
                            : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {t.subsystem}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.state === 'RUNNABLE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : t.state === 'BLOCKED'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {t.state}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        {t.db_blocked ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 animate-pulse">
                            <Flame className="w-3 h-3 mr-0.5 text-rose-500" />
                            BLOCKED
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Stack Trace Drawer */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="p-0 bg-slate-900 dark:bg-slate-950 text-slate-200">
                          <div className="p-3.5 space-y-2 border-y border-slate-700/80">
                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                              <span className="font-semibold text-cyan-400 flex items-center gap-1">
                                <Activity className="w-3.5 h-3.5" />
                                Thread Stack Trace (#{t.id})
                              </span>
                              {t.db_blocked && (
                                <span className="text-rose-400 font-bold flex items-center gap-1">
                                  <Flame className="w-3.5 h-3.5" />
                                  Identified in DB Contention Wait
                                </span>
                              )}
                            </div>
                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 max-h-60 overflow-y-auto leading-relaxed selection:bg-cyan-500/30">
                              {t.stack_trace || 'No stack trace captured for this worker thread.'}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-lg ${
              view === 'agent' 
                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                : view === 'thread'
                  ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                  : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            }`}>
              {view === 'agent' ? <Cpu className="w-6 h-6" /> : view === 'thread' ? <Activity className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  {view === 'agent' && 'Agent Activity & Workflow Engine'}
                  {view === 'thread' && 'JVM Worker Thread Activity'}
                  {view === 'all' && 'Agent & Thread Activity Diagnostics'}
                </h2>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Live Telemetry Only
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {view === 'agent' && 'Workflow Agents, Background Agents, asynchronous WF_EVENT queue backlogs, and Business Connect API sessions.'}
                {view === 'thread' && 'Direct JVM worker thread inspection, execution states (RUNNABLE/BLOCKED/WAITING), DB contention, and stack traces.'}
                {view === 'all' && 'Comprehensive live monitoring of JVM worker threads, Workflow Agents, event queues, and DB2 lock contention.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View Switcher Pills */}
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-900 text-xs font-medium">
              <button
                type="button"
                onClick={() => handleSelectView('agent')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
                  view === 'agent'
                    ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Agent Activity</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectView('thread')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
                  view === 'thread'
                    ? 'bg-amber-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Thread Activity</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectView('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
                  view === 'all'
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Combined</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-slate-400" />
              <select
                value={selectedServerId || ''}
                onChange={(e) => setSelectedServerId(e.target.value ? Number(e.target.value) : undefined)}
                className="bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 font-medium"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.host})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-lg p-1 space-x-1 text-xs">
              <button
                type="button"
                onClick={() => setAutoRefreshActive(!autoRefreshActive)}
                className={`flex items-center px-2 py-1 rounded font-medium transition ${
                  autoRefreshActive 
                    ? 'bg-blue-600 text-white shadow-xs' 
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
                title={autoRefreshActive ? 'Pause auto-refresh' : 'Resume auto-refresh'}
              >
                {autoRefreshActive ? <Pause className="w-3.5 h-3.5 mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                {autoRefreshActive ? 'Live' : 'Paused'}
              </button>

              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                disabled={!autoRefreshActive}
                className="bg-transparent border-0 text-slate-700 dark:text-slate-200 text-xs font-semibold py-1 pr-2 focus:ring-0 cursor-pointer disabled:opacity-50"
              >
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </div>

            <button
              onClick={() => fetchLiveData(false)}
              disabled={loading}
              className="inline-flex items-center px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 shadow-xs transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-blue-500' : ''}`} />
              Refresh
            </button>

            {onSendToAI && monitorData && (
              <button
                onClick={handleSendToAIForAnalysis}
                className="inline-flex items-center px-3.5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-indigo-700 shadow-xs transition"
              >
                <BrainCircuit className="w-4 h-4 mr-2" />
                AI Concurrency Audit
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 gap-2">
          <div className="flex items-center space-x-2">
            {monitorData?.is_online ? (
              <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                Connected to {monitorData.server_name || activeServer?.name} ({monitorData.server_host || activeServer?.host})
              </span>
            ) : (
              <span className="flex items-center text-rose-600 dark:text-rose-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-rose-500 mr-1.5" />
                Offline / Unreachable
              </span>
            )}
            {monitorData?.total_execution_time_ms !== undefined && (
              <span className="text-slate-400">| Telemetry roundtrip: {monitorData.total_execution_time_ms}ms</span>
            )}
          </div>

          <div>
            {lastRefreshedAt ? (
              <span>Last refreshed: {lastRefreshedAt.toLocaleTimeString('en-GB')}</span>
            ) : (
              <span>Not refreshed yet</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 flex items-start space-x-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Server Telemetry Unavailable</h4>
            <p className="text-xs mt-1">{error}</p>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-2 font-medium">
              Per system policy, simulated fallback data is strictly disabled. Verify that the target TRIRIGA Admin Console endpoint is accessible and administrator credentials in Server Manager are valid.
            </p>
          </div>
        </div>
      )}

      {/* Metric Cards tailored to active view mode */}
      {view === 'agent' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {renderAgentThreadsCard()}
          {renderWfEventCard()}
          {renderBcCard()}
          {renderLockWaitsCard()}
        </div>
      ) : view === 'thread' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {renderTotalThreadsCard()}
          {renderDbBlockedCard()}
          {renderWaitingThreadsCard()}
          {renderLockWaitsCard()}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {renderTotalThreadsCard()}
          {renderDbBlockedCard()}
          {renderBcCard()}
          {renderWfEventCard()}
          {renderLockWaitsCard()}
        </div>
      )}

      {/* Real-time Telemetry Trend Graph Section */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Real-Time Telemetry Trend Graphs
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  {history.length} Live Samples (Rolling Window)
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Continuous live tracking of JVM thread states, DB contention blocks, WF_EVENT queue growth, and table locks.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
              <button
                onClick={() => setGraphMode('split')}
                className={`px-2.5 py-1 rounded-md transition ${
                  graphMode === 'split'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Dual Timeline
              </button>
              <button
                onClick={() => setGraphMode('threads')}
                className={`px-2.5 py-1 rounded-md transition ${
                  graphMode === 'threads'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Threads Focus
              </button>
              <button
                onClick={() => setGraphMode('events_locks')}
                className={`px-2.5 py-1 rounded-md transition ${
                  graphMode === 'events_locks'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Queue &amp; Lock Focus
              </button>
            </div>

            <button
              onClick={() => setShowFullGraph(!showFullGraph)}
              className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium"
            >
              {showFullGraph ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {showFullGraph && (
          <div className="mt-4 space-y-4">
            {history.length < 2 ? (
              <div className="h-44 flex flex-col items-center justify-center text-center p-6 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <BarChart2 className="w-8 h-8 text-slate-400 mb-2 animate-pulse" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Awaiting Live Telemetry Cadence Samples
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                  Real-time trend charts will render automatically as background polling receives live samples from {monitorData?.server_name || 'the connected node'}.
                </p>
              </div>
            ) : graphMode === 'split' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Graph 1: JVM Threads & DB Contention */}
                <div className="p-3.5 bg-slate-50/70 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      JVM Threads: Total vs. DB-Blocked
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Current DB Blocked: {monitorData?.threads_summary.db_blocked ?? 0}
                    </span>
                  </div>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                        <defs>
                          <linearGradient id="areaTotalThreads" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="areaDbBlocked" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.6}/>
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} allowDecimals={false} domain={[0, 'auto']} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', fontSize: '11px', color: '#f8fafc' }}
                        />
                        <Area type="monotone" dataKey="totalThreads" stroke="#3b82f6" strokeWidth={2} fill="url(#areaTotalThreads)" name="Total Threads" isAnimationActive={false} />
                        <Area type="monotone" dataKey="runnableThreads" stroke="#10b981" strokeWidth={1.5} fill="none" name="Runnable" isAnimationActive={false} />
                        <Area type="monotone" dataKey="dbBlockedThreads" stroke="#f43f5e" strokeWidth={2.5} fill="url(#areaDbBlocked)" name="DB Blocked" isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Graph 2: WF_EVENT Queue Depth & DB2 Lock Waits */}
                <div className="p-3.5 bg-slate-50/70 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      WF_EVENT Queue Backlog vs. Active Lock Waits
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Lock Waits: {monitorData?.lock_waits.length ?? 0}
                    </span>
                  </div>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                        <defs>
                          <linearGradient id="areaWfQueue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="areaLocks" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.6}/>
                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} allowDecimals={false} domain={[0, 'auto']} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', fontSize: '11px', color: '#f8fafc' }}
                        />
                        <Area type="monotone" dataKey="wfQueueDepth" stroke="#f59e0b" strokeWidth={2} fill="url(#areaWfQueue)" name="WF_EVENT Queue" isAnimationActive={false} />
                        <Area type="monotone" dataKey="lockWaits" stroke="#818cf8" strokeWidth={2.5} fill="url(#areaLocks)" name="DB2 Lock Waits" isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : graphMode === 'threads' ? (
              /* Full Width Threads Focus Chart */
              <div className="p-4 bg-slate-50/70 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    JVM Thread Telemetry Time Series (Total, Runnable, Waiting, Blocked, DB-Contention)
                  </span>
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-blue-500 font-bold">● Total: {monitorData?.threads_summary.total ?? 0}</span>
                    <span className="text-emerald-500 font-bold">● Runnable: {monitorData?.threads_summary.runnable ?? 0}</span>
                    <span className="text-slate-400">● Waiting: {monitorData?.threads_summary.waiting ?? 0}</span>
                    <span className="text-rose-500 font-bold">● DB-Blocked: {monitorData?.threads_summary.db_blocked ?? 0}</span>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 15, right: 20, left: -5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="fullThreadsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="fullDbBlockedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.6}/>
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', fontSize: '11px', color: '#f8fafc' }} />
                      <Area type="monotone" dataKey="totalThreads" stroke="#3b82f6" strokeWidth={2} fill="url(#fullThreadsGrad)" name="Total Threads" isAnimationActive={false} />
                      <Area type="monotone" dataKey="runnableThreads" stroke="#10b981" strokeWidth={1.8} fill="none" name="Runnable" isAnimationActive={false} />
                      <Area type="monotone" dataKey="waitingThreads" stroke="#94a3b8" strokeWidth={1.5} fill="none" strokeDasharray="3 3" name="Waiting" isAnimationActive={false} />
                      <Area type="monotone" dataKey="dbBlockedThreads" stroke="#f43f5e" strokeWidth={2.5} fill="url(#fullDbBlockedGrad)" name="DB Blocked" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              /* Full Width Queue & Lock Focus Chart */
              <div className="p-4 bg-slate-50/70 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Asynchronous Event Engine (TRIDATA.WF_EVENT) &amp; DB2 Row/Table Lock Contention
                  </span>
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-amber-500 font-bold">● Queue Backlog: {monitorData?.wf_event_summary.total_queued ?? 0}</span>
                    <span className="text-indigo-400 font-bold">● MON_LOCKWAITS: {monitorData?.lock_waits.length ?? 0}</span>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 15, right: 20, left: -5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="fullWfGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="fullLockGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#818cf8" stopOpacity={0.6}/>
                          <stop offset="95%" stopColor="#818cf8" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', fontSize: '11px', color: '#f8fafc' }} />
                      <Area type="monotone" dataKey="wfQueueDepth" stroke="#f59e0b" strokeWidth={2.2} fill="url(#fullWfGrad)" name="WF_EVENT Queue Backlog" isAnimationActive={false} />
                      <Area type="monotone" dataKey="lockWaits" stroke="#818cf8" strokeWidth={2.5} fill="url(#fullLockGrad)" name="DB2 Lock Waits (MON_LOCKWAITS)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Layout tailored to View Mode */}
      {view === 'agent' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {renderWfEventTable()}
            {renderBcTable()}
            {renderLockWaitsTable()}
          </div>
          {renderThreadMatrix(true, true)}
        </div>
      )}

      {view === 'thread' && (
        <div className="space-y-6">
          {renderThreadMatrix(true, false)}
          {(monitorData?.lock_waits?.length ?? 0) > 0 && (
            <div>
              {renderLockWaitsTable()}
            </div>
          )}
        </div>
      )}

      {view === 'all' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {renderThreadMatrix(false, false)}
          <div className="space-y-6">
            {renderBcTable()}
            {renderWfEventTable()}
            {renderLockWaitsTable()}
          </div>
        </div>
      )}
    </div>
  );
};
