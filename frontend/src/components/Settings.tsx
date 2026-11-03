import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Database, 
  BrainCircuit, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  ShieldAlert,
  Save,
  Cpu,
  Lock,
  Key,
  ShieldCheck,
  Clock,
  Play,
  Pause,
  Zap,
  Server,
  SlidersHorizontal,
  Archive,
  HardDrive,
  Download,
  FileArchive,
  Sparkles,
  RotateCcw,
  AlertCircle,
  Calendar,
  TrendingDown,
  Layers
} from 'lucide-react';
import { 
  LLMConfig, 
  IngestionSchedule, 
  TririgaServer, 
  StorageStats, 
  ArchiveFile, 
  StoragePruneResult, 
  StorageSettings 
} from '../types';
import { api } from '../services/api';
import { ServerManager } from './ServerManager';

interface SettingsProps {
  servers?: TririgaServer[];
  onRefreshAll: () => void;
  onSyncServer?: (serverId: number) => void;
  onNavigateTab?: (tab: string, filter?: any, configServerId?: number) => void;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({ 
  servers = [],
  onRefreshAll,
  onSyncServer,
  onNavigateTab,
  activeSection,
  onSectionChange,
}) => {
  const [localSection, setLocalSection] = useState<string>('servers');
  const currentSection = activeSection || localSection;
  const setCurrentSection = (s: string) => {
    setLocalSection(s);
    if (onSectionChange) onSectionChange(s);
  };

  const [provider, setProvider] = useState<'ollama' | 'lm_studio' | 'openai_compatible'>('ollama');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [modelName, setModelName] = useState('llama3');
  const [temperature, setTemperature] = useState(0.2);
  const [contextWindow, setContextWindow] = useState(32768);
  
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // DB clear state
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);

  // Master Password State
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [isSavingPass, setIsSavingPass] = useState(false);
  const [authMsg, setAuthMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Automated 15-minute Ingestion Schedule State
  const [schedule, setSchedule] = useState<IngestionSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);

  // Storage & 7-Day Retention State
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [archives, setArchives] = useState<ArchiveFile[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pruneResult, setPruneResult] = useState<StoragePruneResult | null>(null);
  const [selectedRetention, setSelectedRetention] = useState<number>(7);
  const [autoPruneEnabled, setAutoPruneEnabled] = useState<boolean>(true);
  const [compressRawLogs, setCompressRawLogs] = useState<boolean>(true);
  const [storageActionMsg, setStorageActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [restoringFilename, setRestoringFilename] = useState<string | null>(null);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  const loadSchedule = async () => {
    try {
      const s = await api.getIngestionSchedule();
      setSchedule(s);
    } catch (err) {
      console.error('Failed to load schedule:', err);
    }
  };

  const loadStorageData = async (retDays?: number) => {
    setStorageLoading(true);
    try {
      const [stats, settings, archs] = await Promise.all([
        api.getStorageStats(retDays),
        api.getStorageSettings(),
        api.getArchives(),
      ]);
      setStorageStats(stats);
      setStorageSettings(settings);
      setArchives(archs);
      if (retDays === undefined) {
        setSelectedRetention(settings.retention_days || 7);
      }
      setAutoPruneEnabled(settings.auto_prune_enabled);
      setCompressRawLogs(settings.compress_raw_logs);
    } catch (err) {
      console.error('Failed to load storage data:', err);
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadSchedule();
    loadStorageData();
  }, []);

  const handleSaveRetentionSettings = async () => {
    setStorageLoading(true);
    setStorageActionMsg(null);
    try {
      const updated = await api.updateStorageSettings({
        retention_days: selectedRetention,
        auto_prune_enabled: autoPruneEnabled,
        compress_raw_logs: compressRawLogs,
      });
      setStorageSettings(updated);
      setStorageActionMsg({ type: 'success', text: `Storage policy updated: ${selectedRetention}-day retention active.` });
      await loadStorageData(selectedRetention);
      setTimeout(() => setStorageActionMsg(null), 4000);
    } catch (err: any) {
      setStorageActionMsg({ type: 'error', text: err.message || 'Failed to update storage settings' });
    } finally {
      setStorageLoading(false);
    }
  };

  const handleArchiveAndPrune = async () => {
    if (!window.confirm(`Are you sure you want to offload logs older than ${selectedRetention} days into compressed cold storage (.jsonl.gz) and compact the live database?`)) {
      return;
    }
    setPruning(true);
    setPruneResult(null);
    setStorageActionMsg(null);
    try {
      const res = await api.archiveAndPruneLogs({
        retention_days: selectedRetention,
        compress_raw_logs: compressRawLogs,
      });
      setPruneResult(res);
      setStorageActionMsg({ 
        type: 'success', 
        text: res.summary || `Offloaded ${res.archived_entries.toLocaleString()} entries. Reclaimed ${res.bytes_freed_mb} MB.` 
      });
      await loadStorageData(selectedRetention);
      onRefreshAll();
      setTimeout(() => setStorageActionMsg(null), 7000);
    } catch (err: any) {
      setStorageActionMsg({ type: 'error', text: err.message || 'Failed to archive and compact storage' });
    } finally {
      setPruning(false);
    }
  };

  const handleDownloadArchive = async (filename: string) => {
    try {
      await api.downloadArchive(filename);
    } catch (err: any) {
      setStorageActionMsg({ type: 'error', text: `Download failed: ${err.message}` });
    }
  };

  const handleDeleteArchive = async (filename: string) => {
    if (!window.confirm(`Permanently delete archive package ${filename}? This action cannot be undone.`)) {
      return;
    }
    setDeletingFilename(filename);
    try {
      await api.deleteArchive(filename);
      setStorageActionMsg({ type: 'success', text: `Archive ${filename} removed.` });
      await loadStorageData(selectedRetention);
      setTimeout(() => setStorageActionMsg(null), 4000);
    } catch (err: any) {
      setStorageActionMsg({ type: 'error', text: `Delete failed: ${err.message}` });
    } finally {
      setDeletingFilename(null);
    }
  };

  const handleRestoreArchive = async (filename: string) => {
    if (!window.confirm(`Restore log records from ${filename} back into the live SQLite analysis database?`)) {
      return;
    }
    setRestoringFilename(filename);
    try {
      const res = await api.restoreArchive(filename);
      setStorageActionMsg({ 
        type: 'success', 
        text: res.message || `Restored ${(res.restored_entries || 0).toLocaleString()} entries to live database.` 
      });
      await loadStorageData(selectedRetention);
      onRefreshAll();
      setTimeout(() => setStorageActionMsg(null), 6000);
    } catch (err: any) {
      setStorageActionMsg({ type: 'error', text: `Restore failed: ${err.message}` });
    } finally {
      setRestoringFilename(null);
    }
  };

  const handleToggleSchedule = async () => {
    if (!schedule) return;
    setScheduleLoading(true);
    setScheduleMsg(null);
    try {
      const updated = await api.updateIngestionSchedule({ is_enabled: !schedule.is_enabled });
      setSchedule(updated);
      setScheduleMsg(updated.is_enabled ? 'Automated ingestion enabled.' : 'Automated ingestion paused.');
      setTimeout(() => setScheduleMsg(null), 4000);
    } catch (err: any) {
      setScheduleMsg(`Error: ${err.message}`);
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleChangeInterval = async (mins: number) => {
    setScheduleLoading(true);
    setScheduleMsg(null);
    try {
      const updated = await api.updateIngestionSchedule({ interval_minutes: mins });
      setSchedule(updated);
      setScheduleMsg(`Cadence updated to ${mins} minutes.`);
      setTimeout(() => setScheduleMsg(null), 4000);
    } catch (err: any) {
      setScheduleMsg(`Error: ${err.message}`);
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleTriggerRunNow = async () => {
    setScheduleLoading(true);
    setScheduleMsg(null);
    try {
      const res = await api.triggerScheduledIngestionNow();
      if (res.schedule) setSchedule(res.schedule);
      setScheduleMsg(`Scheduled harvest triggered: ${res.result?.summary || 'Completed'}`);
      onRefreshAll();
      setTimeout(() => setScheduleMsg(null), 6000);
    } catch (err: any) {
      setScheduleMsg(`Error: ${err.message}`);
    } finally {
      setScheduleLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const cfg = await api.getActiveLLMConfig();
      if (cfg) {
        setProvider(cfg.provider);
        setBaseUrl(cfg.base_url);
        setModelName(cfg.model_name);
        setTemperature(cfg.temperature);
        setContextWindow(cfg.context_window || 32768);
      }
    } catch (err) {
      console.error('Failed to load LLM settings:', err);
    }
  };

  const handleDiscoverModels = async () => {
    setDiscovering(true);
    setDiscoveredModels([]);
    try {
      const res = await api.discoverModels(provider, baseUrl);
      if (res.models && res.models.length > 0) {
        setDiscoveredModels(res.models.map(m => m.id));
        if (!res.models.some(m => m.id === modelName)) {
          setModelName(res.models[0].id);
        }
      }
    } catch {
      // Ignored
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const res = await api.testLLM({ provider, base_url: baseUrl, model_name: modelName });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection failed' });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.saveLLMConfig({
        provider,
        base_url: baseUrl,
        model_name: modelName,
        temperature,
        context_window: contextWindow,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearDatabase = async () => {
    if (window.confirm('WARNING: Are you sure you want to delete ALL indexed TRIRIGA logs, error indexes, and saved AI reports from SQLite?')) {
      setClearing(true);
      try {
        const res = await api.clearAllLogs();
        setClearMessage(res.message);
        onRefreshAll();
        setTimeout(() => setClearMessage(null), 4000);
      } catch (err: any) {
        setClearMessage(err.message || 'Failed to clear logs');
      } finally {
        setClearing(false);
      }
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!curPass.trim() || !newPass.trim()) return;
    if (newPass.length < 4) {
      setAuthMsg({ type: 'error', text: 'New password must be at least 4 characters long.' });
      return;
    }
    if (newPass !== confirmPass) {
      setAuthMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    setIsSavingPass(true);
    setAuthMsg(null);
    try {
      const res = await api.changePassword(curPass, newPass);
      setAuthMsg({ type: 'success', text: res.message || 'Master password updated successfully.' });
      setCurPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err: any) {
      setAuthMsg({ type: 'error', text: err.message || 'Failed to update master password.' });
    } finally {
      setIsSavingPass(false);
    }
  };

  const sections = [
    { id: 'servers', label: 'TRIRIGA Servers', icon: Server, badge: servers.length },
    { id: 'llm', label: 'Local LLM Setup', icon: BrainCircuit },
    { id: 'ingestion', label: 'Automated Ingestion', icon: Clock, badge: schedule?.is_enabled ? `${schedule.interval_minutes}m` : 'Paused' },
    { id: 'security', label: 'Console Security', icon: ShieldCheck },
    { id: 'storage', label: 'Storage & 7-Day Retention', icon: Database, badge: storageStats ? `${storageStats.live_db_size_mb} MB` : undefined },
    { id: 'all', label: 'All Settings', icon: SlidersHorizontal },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">System Settings & TRIRIGA Management</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Configure TRIRIGA server connections, local LLM inference engines, automated ingestion cadences, and security.
          </p>
        </div>
      </div>

      {/* Section Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isSelected = currentSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setCurrentSection(sec.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20 border border-cyan-500'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
              <span>{sec.label}</span>
              {sec.badge !== undefined && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isSelected ? 'bg-cyan-700/80 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {sec.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TRIRIGA Servers Section */}
      {(currentSection === 'servers' || currentSection === 'all') && (
        <div className="space-y-4">
          {currentSection === 'all' && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <Server className="w-5 h-5 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">TRIRIGA Server Profiles</h2>
            </div>
          )}
          <ServerManager
            servers={servers}
            onRefresh={onRefreshAll}
            onSyncServer={onSyncServer || (() => {})}
            onNavigateTab={onNavigateTab}
          />
        </div>
      )}

      {/* Console Access & Master Password Card */}
      {(currentSection === 'security' || currentSection === 'all') && (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">Console Access & Master Password</h2>
              <p className="text-xs text-slate-400">Protect the TRIRIGA log forensics UI and API with an administrative master password.</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 font-mono">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>Active Protection</span>
          </span>
        </div>

        {authMsg && (
          <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${authMsg.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'}`}>
            {authMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>{authMsg.text}</span>
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={curPass}
                onChange={(e) => setCurPass(e.target.value)}
                placeholder="Current password..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Min 4 chars..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Re-enter..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSavingPass || !curPass.trim() || !newPass.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 cursor-pointer disabled:opacity-50 transition-all"
          >
            <Key className="w-3.5 h-3.5" />
            <span>{isSavingPass ? 'Updating...' : 'Update Master Password'}</span>
          </button>
        </form>
      </div>
      )}

      {/* Local LLM Settings Card */}
      {(currentSection === 'llm' || currentSection === 'all') && (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
          <BrainCircuit className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Local LLM Endpoint Configuration</h2>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Local Provider Type</label>
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as any;
                  setProvider(p);
                  if (p === 'ollama') setBaseUrl('http://localhost:11434');
                  if (p === 'lm_studio') setBaseUrl('http://localhost:1234/v1');
                  if (p === 'openai_compatible') setBaseUrl('http://localhost:8080/v1');
                }}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="ollama">Ollama (Default: http://localhost:11434)</option>
                <option value="lm_studio">LM Studio (Default: http://localhost:1234/v1)</option>
                <option value="openai_compatible">LocalAI / vLLM / Generic OpenAI Compatible</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">API Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">Model Name / Tag</label>
                <button
                  type="button"
                  onClick={handleDiscoverModels}
                  disabled={discovering}
                  className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} />
                  <span>Scan Local Models</span>
                </button>
              </div>

              {discoveredModels.length > 0 ? (
                <select
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                >
                  {discoveredModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="e.g. llama3:latest, mistral:7b, qwen2.5-coder, deepseek-r1"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Temperature ({temperature})</label>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <span className="text-[10px] text-slate-500">Lower values (0.1 - 0.3) produce stricter, factual forensic root causes.</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Context Token Window</label>
              <select
                value={contextWindow}
                onChange={(e) => setContextWindow(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value={32768}>32,768 tokens (Recommended for Full Forensic Cluster Audits)</option>
                <option value={16384}>16,384 tokens (Deep Forensic Diagnostics)</option>
                <option value={8192}>8,192 tokens (Standard)</option>
                <option value={4096}>4,096 tokens (Fast / Low Memory)</option>
              </select>
            </div>
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              testResult.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleTestConnection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Test Connection</span>
            </button>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savedSuccess ? 'Saved Active!' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
      )}

      {/* Automated Log Ingestion Cadence Card */}
      {(currentSection === 'ingestion' || currentSection === 'all') && (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Automated Log Ingestion Cadence</h2>
          </div>
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

        <p className="text-xs text-slate-400">
          The background scheduler periodically contacts all configured TRIRIGA cluster nodes, downloads fresh logs, and indexes them into SQLite FTS5 for real-time AI and forensic exploration.
        </p>

        {scheduleMsg && (
          <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{scheduleMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Harvest Frequency</label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 15, 30, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => handleChangeInterval(mins)}
                  disabled={scheduleLoading}
                  className={`py-2 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer ${
                    schedule?.interval_minutes === mins
                      ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm shadow-cyan-600/20'
                      : 'bg-slate-800 text-slate-400 hover:text-white border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {mins} min{mins === 15 ? ' ★' : ''}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">★ Default 15-minute interval recommended for production stability.</span>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-300">Execution Status</span>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Last Run:</span>
                <span className="text-slate-200">{schedule?.last_run_at ? new Date(schedule.last_run_at).toLocaleTimeString() : 'Pending'}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Next Run:</span>
                <span className="text-cyan-400">{schedule?.is_enabled && schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleTimeString() : 'Paused'}</span>
              </div>
              <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800/80">
                <span>Status:</span>
                <span className="text-slate-300 capitalize">{schedule?.last_status || 'Idle'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={handleToggleSchedule}
            disabled={scheduleLoading}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
              schedule?.is_enabled
                ? 'bg-slate-800 text-amber-300 hover:bg-slate-750 border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm'
            }`}
          >
            {schedule?.is_enabled ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause Automated Ingestion</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Enable Automated Ingestion</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleTriggerRunNow}
            disabled={scheduleLoading || schedule?.is_running}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Zap className={`w-3.5 h-3.5 ${scheduleLoading || schedule?.is_running ? 'animate-spin' : ''}`} />
            <span>Trigger Harvest Cycle Now</span>
          </button>
        </div>
      </div>
      )}

      {/* Tiered Log Storage & 7-Day Retention Console */}
      {(currentSection === 'storage' || currentSection === 'all') && (
      <div className="space-y-6">
        {/* Storage Health & Tier Distribution Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Hot Live Tier Card */}
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 shadow-sm space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Hot Live Tier</h3>
                  <p className="text-[10px] text-slate-400">Active {storageStats?.retention_days || 7}-Day Window</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                SQLite WAL + FTS5
              </span>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-2xl font-bold text-white font-mono">
                  {storageStats ? `${storageStats.live_db_size_mb} MB` : '...'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {storageStats?.total_live_entries.toLocaleString() || '0'} entries
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Oldest Live Log:</span>
                <span className="text-slate-400 font-mono">
                  {storageStats?.oldest_live_log ? new Date(storageStats.oldest_live_log).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Cold Archive Tier Card */}
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 shadow-sm space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Archive className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Cold Compressed Tier</h3>
                  <p className="text-[10px] text-slate-400">&gt; {storageStats?.retention_days || 7} Days Historical</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Gzip JSONL (~90% Ratio)
              </span>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-2xl font-bold text-white font-mono">
                  {storageStats ? `${storageStats.cold_archives_size_mb} MB` : '...'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {storageStats?.archived_records_total.toLocaleString() || '0'} records
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Archive Packages:</span>
                <span className="text-slate-400 font-mono">
                  {storageStats?.archive_packages_count || 0} files (.jsonl.gz)
                </span>
              </div>
            </div>
          </div>

          {/* Raw Log Disk Footprint Card */}
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 shadow-sm space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Raw Logs Storage</h3>
                  <p className="text-[10px] text-slate-400">Downloaded Node Files</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                data/logs/
              </span>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-2xl font-bold text-white font-mono">
                  {storageStats ? `${storageStats.raw_logs_size_mb} MB` : '...'}
                </span>
                <span className="text-xs text-amber-400 font-mono">
                  {storageStats?.offloadable_entries ? `${storageStats.offloadable_entries.toLocaleString()} offloadable` : 'Optimized'}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Last Storage Prune:</span>
                <span className="text-slate-400 font-mono">
                  {storageSettings?.last_pruned_at ? new Date(storageSettings.last_pruned_at).toLocaleDateString() : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Messages */}
        {storageActionMsg && (
          <div className={`p-4 rounded-xl border text-xs flex items-start gap-2.5 ${
            storageActionMsg.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}>
            {storageActionMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
            )}
            <div>{storageActionMsg.text}</div>
          </div>
        )}

        {/* Prune Result Summary Banner if recently pruned */}
        {pruneResult && pruneResult.success && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-cyan-950/30 to-slate-900 border border-emerald-500/30 text-xs space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>Storage Compaction Complete!</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-slate-300 font-mono">
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Archived Records</span>
                <span className="text-white font-bold">{pruneResult.archived_entries.toLocaleString()}</span>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Disk Space Reclaimed</span>
                <span className="text-emerald-400 font-bold">{pruneResult.bytes_freed_mb} MB</span>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Initial DB Size</span>
                <span className="text-slate-400">{pruneResult.initial_db_size_mb} MB</span>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Compacted DB Size</span>
                <span className="text-cyan-400 font-bold">{pruneResult.final_db_size_mb} MB</span>
              </div>
            </div>
          </div>
        )}

        {/* Retention Policy Configuration & Instant Compaction */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
              <div>
                <h2 className="text-sm font-semibold text-white">7-Day Retention & Live Analysis Policy</h2>
                <p className="text-xs text-slate-400">Keep recent logs in high-speed SQLite WAL live tier and auto-offload historical data.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => loadStorageData(selectedRetention)}
              disabled={storageLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 text-xs font-medium cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${storageLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Retention Window Preset Selector */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">Live Retention Window</label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      setSelectedRetention(days);
                      loadStorageData(days);
                    }}
                    disabled={storageLoading || pruning}
                    className={`py-2 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer ${
                      selectedRetention === days
                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm shadow-cyan-600/20'
                        : 'bg-slate-800 text-slate-400 hover:text-white border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {days} Days{days === 7 ? ' ★' : ''}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500 block">
                ★ <strong>7 Days (Recommended)</strong>: Keeps active logs in fast SQLite memory-mapped indexes for live monitoring while offloading historical logs into cold storage.
              </span>
            </div>

            {/* Automation Toggles */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">Automated Background Maintenance</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer p-2 rounded-lg bg-slate-950/40 border border-slate-800/80 hover:border-slate-700">
                  <input
                    type="checkbox"
                    checked={autoPruneEnabled}
                    onChange={(e) => setAutoPruneEnabled(e.target.checked)}
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Run daily 7-day offloading &amp; VACUUM automatically during scheduler cycles</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer p-2 rounded-lg bg-slate-950/40 border border-slate-800/80 hover:border-slate-700">
                  <input
                    type="checkbox"
                    checked={compressRawLogs}
                    onChange={(e) => setCompressRawLogs(e.target.checked)}
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Compress aged raw log files (.log.gz) in <code className="text-cyan-400">data/logs/</code></span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleSaveRetentionSettings}
              disabled={storageLoading || pruning}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer transition-colors"
            >
              <Save className="w-3.5 h-3.5 text-cyan-400" />
              <span>Save Retention Settings</span>
            </button>

            <button
              type="button"
              onClick={handleArchiveAndPrune}
              disabled={pruning || storageLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 via-indigo-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 cursor-pointer disabled:opacity-50 transition-all"
            >
              <Sparkles className={`w-4 h-4 ${pruning ? 'animate-spin' : ''}`} />
              <span>{pruning ? 'Offloading & Compacting...' : `Optimize & Offload Now (> ${selectedRetention} Days)`}</span>
            </button>
          </div>
        </div>

        {/* Cold Archives Catalog & Search Integration */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <FileArchive className="w-5 h-5 text-indigo-400" />
              <div>
                <h2 className="text-sm font-semibold text-white">Cold Storage Archive Packages</h2>
                <p className="text-xs text-slate-400">
                  Compressed historical audit packages in <code className="text-indigo-300">data/archives/</code>. Seamlessly searched on-demand.
                </p>
              </div>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {archives.length} {archives.length === 1 ? 'package' : 'packages'}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-200 text-xs flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <span>
              <strong>Automated Retrieval:</strong> When you filter or search for dates older than 7 days in the Log Explorer or AI Forensics, cold archives are stream-searched automatically within milliseconds.
            </span>
          </div>

          {archives.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-slate-950/40 border border-slate-800 text-slate-400 text-xs space-y-1">
              <Archive className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-300 font-medium">No cold archive packages created yet.</p>
              <p className="text-slate-500">Run "Optimize &amp; Offload Now" above to create your first compressed archive package.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5">Archive Package</th>
                    <th className="px-4 py-2.5">Timeframe</th>
                    <th className="px-4 py-2.5">Servers</th>
                    <th className="px-4 py-2.5 text-right">Entries</th>
                    <th className="px-4 py-2.5 text-right">Errors</th>
                    <th className="px-4 py-2.5 text-right">Compressed Size</th>
                    <th className="px-4 py-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {archives.map((arch) => (
                    <tr key={arch.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-200">
                        <div className="flex items-center gap-2">
                          <FileArchive className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                          <span className="truncate max-w-xs" title={arch.filename}>{arch.filename}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-[11px]">
                        <div>{arch.min_timestamp ? new Date(arch.min_timestamp).toLocaleDateString() : 'N/A'} -</div>
                        <div>{arch.max_timestamp ? new Date(arch.max_timestamp).toLocaleDateString() : 'N/A'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-[11px] truncate max-w-[140px]" title={arch.server_names}>
                        {arch.server_names || 'All Nodes'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200">
                        {arch.entry_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-rose-400">
                        {arch.error_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-cyan-400">
                        {arch.size_kb > 1024 ? `${arch.size_mb} MB` : `${arch.size_kb} KB`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            title="Download compressed .jsonl.gz archive"
                            onClick={() => handleDownloadArchive(arch.filename)}
                            className="p-1.5 rounded hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/80 cursor-pointer transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            title="Restore records to live SQLite database"
                            disabled={restoringFilename === arch.filename}
                            onClick={() => handleRestoreArchive(arch.filename)}
                            className="p-1.5 rounded hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${restoringFilename === arch.filename ? 'animate-spin' : ''}`} />
                          </button>

                          <button
                            type="button"
                            title="Delete archive package"
                            disabled={deletingFilename === arch.filename}
                            onClick={() => handleDeleteArchive(arch.filename)}
                            className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Database Clear Danger Zone Card */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <h2 className="text-sm font-semibold text-white">Full Database Reset (Danger Zone)</h2>
          </div>

          <p className="text-xs text-slate-400">
            Purges all live TRIRIGA logs, error indexes, and saved AI forensic reports from SQLite. Server connections will be preserved.
          </p>

          {clearMessage && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              {clearMessage}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={handleClearDatabase}
              disabled={clearing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>{clearing ? 'Clearing...' : 'Clear All Ingested Logs & AI Reports'}</span>
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
