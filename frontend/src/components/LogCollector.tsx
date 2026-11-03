import React, { useState, useEffect, useCallback } from 'react';
import { 
  DownloadCloud, 
  Upload, 
  Terminal, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Server, 
  FileText,
  Layers,
  ArrowRight,
  Clock,
  Play,
  Pause,
  Zap
} from 'lucide-react';
import { api, getAuthToken, BASE_URL } from '../services/api';
import { TririgaServer, IngestionSchedule } from '../types';

interface LogCollectorProps {
  servers: TririgaServer[];
  onRefresh: () => void;
  onNavigateTab: (tab: string) => void;
}

export const LogCollector: React.FC<LogCollectorProps> = ({
  servers,
  onRefresh,
  onNavigateTab,
}) => {
  const [selectedServerId, setSelectedServerId] = useState<number | 'all'>('all');
  const [isSyncing, setIsSyncing] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [uploadServerId, setUploadServerId] = useState<number>(servers[0]?.id || 1);
  const [uploadFileType, setUploadFileType] = useState<string>('server');
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Automated 15-minute ingestion schedule state
  const [schedule, setSchedule] = useState<IngestionSchedule | null>(null);
  const [scheduleActionLoading, setScheduleActionLoading] = useState(false);
  const [nowTimestamp, setNowTimestamp] = useState(Date.now());

  const fetchSchedule = useCallback(async () => {
    try {
      const data = await api.getIngestionSchedule();
      setSchedule(data);
    } catch (err) {
      console.error('Failed to load schedule:', err);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
    const interval = setInterval(fetchSchedule, 10000);
    const clockInterval = setInterval(() => setNowTimestamp(Date.now()), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(clockInterval);
    };
  }, [fetchSchedule]);

  const handleToggleSchedule = async () => {
    if (!schedule) return;
    setScheduleActionLoading(true);
    try {
      const updated = await api.updateIngestionSchedule({ is_enabled: !schedule.is_enabled });
      setSchedule(updated);
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    } finally {
      setScheduleActionLoading(false);
    }
  };

  const handleChangeInterval = async (minutes: number) => {
    setScheduleActionLoading(true);
    try {
      const updated = await api.updateIngestionSchedule({ interval_minutes: minutes });
      setSchedule(updated);
    } catch (err) {
      console.error('Failed to change interval:', err);
    } finally {
      setScheduleActionLoading(false);
    }
  };

  const handleTriggerRunNow = async () => {
    setScheduleActionLoading(true);
    setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Manual scheduled harvest override triggered across all nodes...`]);
    try {
      const res = await api.triggerScheduledIngestionNow();
      if (res.schedule) setSchedule(res.schedule);
      setTerminalLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Scheduled harvest complete: ${res.result?.summary || 'Logs ingested.'}`
      ]);
      onRefresh();
    } catch (err: any) {
      setTerminalLogs(prev => [...prev, `[ERROR] Scheduled harvest failed: ${err.message}`]);
    } finally {
      setScheduleActionLoading(false);
    }
  };

  const getNextRunDisplay = () => {
    if (!schedule?.is_enabled) return 'Paused';
    if (!schedule?.next_run_at) return 'Pending...';
    try {
      const cleanStr = schedule.next_run_at.replace('Z', '+00:00');
      const targetTime = new Date(cleanStr).getTime();
      const diffSec = Math.max(0, Math.floor((targetTime - nowTimestamp) / 1000));
      if (diffSec === 0) return 'Running now...';
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return `in ${m}m ${s < 10 ? '0' : ''}${s}s`;
    } catch {
      return schedule.next_run_at;
    }
  };

  const startSync = async () => {
    setIsSyncing(true);
    setTerminalLogs([`[${new Date().toLocaleTimeString()}] Initializing log harvest and amalgamation pipeline...`]);

    if (selectedServerId === 'all') {
      try {
        for (const s of servers) {
          setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Connecting to node '${s.name}'...`]);
          const res = await api.syncServer(s.id);
          setTerminalLogs(prev => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] Node '${s.name}' sync complete: Ingested ${res.total_entries} logs (${res.total_errors} errors, ${res.total_warns} warnings).`
          ]);
        }
        setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] All servers successfully harvested and indexed into SQLite.`]);
        onRefresh();
      } catch (err: any) {
        setTerminalLogs(prev => [...prev, `[ERROR] Sync failed: ${err.message}`]);
      } finally {
        setIsSyncing(false);
      }
    } else {
      // Stream single server progress via SSE
      const s = servers.find(srv => srv.id === selectedServerId);
      const serverName = s ? s.name : `Server #${selectedServerId}`;
      setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Subscribing to live event stream for '${serverName}'...`]);

      const token = getAuthToken();
      const streamUrl = token 
        ? `${BASE_URL}/collector/stream-sync/${selectedServerId}?token=${encodeURIComponent(token)}` 
        : `${BASE_URL}/collector/stream-sync/${selectedServerId}`;
      const eventSource = new EventSource(streamUrl);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.message}`]);
          if (data.status === 'complete') {
            eventSource.close();
            setIsSyncing(false);
            onRefresh();
          }
        } catch {
          setTerminalLogs(prev => [...prev, event.data]);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsSyncing(false);
        onRefresh();
      };
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus(null);
    try {
      const res = await api.uploadLogFile(uploadServerId, uploadFileType, file);
      setUploadStatus({
        success: true,
        message: `Uploaded '${file.name}' successfully. Parsed ${res.entries_ingested} lines (${res.errors} errors, ${res.warns} warnings).`
      });
      onRefresh();
    } catch (err: any) {
      setUploadStatus({
        success: false,
        message: err.message || 'Failed to upload log file'
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Log Harvesting & Ingestion Engine</h1>
        <p className="text-slate-400 text-xs mt-0.5">
          Trigger automated multi-server log extraction or upload manual TRIRIGA logs for instant SQLite indexing.
        </p>
      </div>

      {/* 15-Minute Automated Ingestion Panel */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-slate-800 p-5 shadow-sm space-y-4 hero-banner ingestion-engine-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
              schedule?.is_running
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400 animate-pulse shadow-lg shadow-cyan-500/20'
                : schedule?.is_enabled
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white ingestion-panel-title">Automated Log Ingestion Engine</h2>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                  schedule?.is_running
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
                    : schedule?.is_enabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {schedule?.is_running ? 'Harvesting Now' : schedule?.is_enabled ? `Active (${schedule.interval_minutes}m)` : 'Paused'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 ingestion-panel-desc">
                Background worker automatically harvests active TRIRIGA cluster logs every {schedule?.interval_minutes || 15} minutes and indexes them into SQLite FTS5.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Cadence Selector */}
            <div className="cadence-selector flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700 text-xs">
              {[5, 15, 30, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => handleChangeInterval(mins)}
                  disabled={scheduleActionLoading}
                  className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition-all cursor-pointer ${
                    schedule?.interval_minutes === mins
                      ? 'bg-cyan-600 text-white shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title={`Set auto-harvest cadence to ${mins} minutes`}
                >
                  {mins}m
                </button>
              ))}
            </div>

            {/* Toggle Pause / Resume */}
            <button
              onClick={handleToggleSchedule}
              disabled={scheduleActionLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                schedule?.is_enabled
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700 pause-resume-btn'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm'
              }`}
            >
              {schedule?.is_enabled ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Enable</span>
                </>
              )}
            </button>

            {/* Run Ingestion Now */}
            <button
              onClick={handleTriggerRunNow}
              disabled={scheduleActionLoading || schedule?.is_running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Zap className={`w-3.5 h-3.5 ${scheduleActionLoading || schedule?.is_running ? 'animate-spin' : ''}`} />
              <span>Run Now</span>
            </button>
          </div>
        </div>

        {/* Telemetry Chips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800/80 text-xs">
          <div className="telemetry-chip bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
            <span className="telemetry-chip-label text-[10px] uppercase font-mono text-slate-500 tracking-wider block">Next Scheduled Ingestion</span>
            <span className="telemetry-chip-value text-white font-semibold font-mono mt-0.5 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${schedule?.is_enabled ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`}></span>
              {getNextRunDisplay()}
            </span>
          </div>

          <div className="telemetry-chip bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
            <span className="telemetry-chip-label text-[10px] uppercase font-mono text-slate-500 tracking-wider block">Last Harvest Completed</span>
            <span className="telemetry-chip-value text-slate-300 font-mono mt-0.5 block truncate">
              {schedule?.last_run_at ? new Date(schedule.last_run_at).toLocaleString() : 'No prior execution logged'}
            </span>
          </div>

          <div className="telemetry-chip bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
            <span className="telemetry-chip-label text-[10px] uppercase font-mono text-slate-500 tracking-wider block">Last Cycle Summary</span>
            <span className="telemetry-chip-summary text-slate-300 text-[11px] mt-0.5 block truncate" title={schedule?.last_summary || ''}>
              {schedule?.last_summary || 'Waiting for first scheduled harvest cycle.'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sync Controls Card */}
        <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <DownloadCloud className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Automated Log Harvesting</h2>
          </div>

          <p className="text-xs text-slate-400">
            Select target TRIRIGA cluster nodes to download active log files (`server.log`, `security.log`, `workflow.log`, `datapool.log`, `gc.log`).
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Cluster Server</label>
              <select
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="all">⚡ All Configured TRIRIGA Servers ({servers.length})</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.protocol}://{s.host})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={startSync}
              disabled={isSyncing || servers.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs shadow-md shadow-cyan-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Harvesting Logs...' : 'Start Extraction & Amalgamation'}</span>
            </button>
          </div>

          {/* Manual File Upload section */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-semibold text-slate-200">Manual Log File Ingestion</h3>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Assign to Server</label>
              <select
                value={uploadServerId}
                onChange={(e) => setUploadServerId(parseInt(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Log Type</label>
              <select
                value={uploadFileType}
                onChange={(e) => setUploadFileType(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs"
              >
                <option value="server">Standard Server Log (server.log)</option>
                <option value="security">Security / Auth Log (security.log)</option>
                <option value="workflow">Workflow Engine Log (workflow.log)</option>
                <option value="datapool">Database Connection Pool Log (datapool.log)</option>
                <option value="gc">JVM Garbage Collection (gc.log)</option>
              </select>
            </div>

            <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl cursor-pointer bg-slate-800/30 transition-colors">
              <Upload className="w-6 h-6 text-slate-400 mb-1" />
              <span className="text-xs font-medium text-slate-300">Click to upload .log file</span>
              <span className="text-[10px] text-slate-500">Supports multi-line stack traces</span>
              <input type="file" accept=".log,.txt,.out" onChange={handleFileUpload} className="hidden" />
            </label>

            {uploadStatus && (
              <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                uploadStatus.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
                {uploadStatus.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{uploadStatus.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Terminal & Extraction Stream */}
        <div className="lg:col-span-2 rounded-xl bg-slate-950 border border-slate-800 p-4 shadow-xl flex flex-col justify-between font-mono">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div className="flex space-x-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                </div>
                <span className="text-xs text-slate-400 font-sans font-medium ml-2">Ingestion Terminal Feed</span>
              </div>
              <span className="text-[10px] text-slate-500 font-sans">
                {isSyncing ? 'Live Stream Active' : 'Ready'}
              </span>
            </div>

            <div className="h-96 overflow-y-auto space-y-1 text-xs text-slate-300 pr-2">
              {terminalLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 font-sans">
                  <Terminal className="w-8 h-8 mb-2 opacity-40" />
                  <p>Terminal output will stream live during log extraction</p>
                  <p className="text-[11px] text-slate-500 mt-1">Click "Start Extraction" or upload a log file above</p>
                </div>
              ) : (
                terminalLogs.map((log, index) => (
                  <div key={index} className="flex gap-2">
                    <span className="text-cyan-400 select-none">&gt;</span>
                    <span className={log.includes('ERROR') ? 'text-rose-400' : log.includes('complete') ? 'text-emerald-400' : 'text-slate-300'}>
                      {log}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between font-sans text-xs">
            <span className="text-slate-500">Indexed via SQLite FTS5 Full-Text Engine</span>
            <button
              onClick={() => onNavigateTab('explorer')}
              className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-medium"
            >
              <span>View Server Logs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
