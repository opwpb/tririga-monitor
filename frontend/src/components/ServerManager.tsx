import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  ExternalLink,
  Terminal, 
  Globe, 
  AlertCircle,
  Edit3,
  Layers,
  SlidersHorizontal
} from 'lucide-react';
import { TririgaServer } from '../types';
import { api } from '../services/api';

interface ServerManagerProps {
  servers: TririgaServer[];
  onRefresh: () => void;
  onSyncServer: (serverId: number) => void;
  onNavigateTab?: (tab: string, filter?: any, configServerId?: number) => void;
}

export const ServerManager: React.FC<ServerManagerProps> = ({
  servers,
  onRefresh,
  onSyncServer,
  onNavigateTab,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingServerId, setEditingServerId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<TririgaServer>>({
    name: '',
    cluster_name: '',
    host: '',
    port: 8001,
    protocol: 'http',
    admin_path: '/html/en/default/admin',
    username: 'admin',
    password: '',
    auth_type: 'form',
    remote_log_dir: '/opt/tririga/userfiles/log',
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Keyboard Escape listener for modal dismissal
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleOpenAddModal = () => {
    setEditingServerId(null);
    setFormData({
      name: '',
      cluster_name: '',
      host: '',
      port: 8001,
      protocol: 'https',
      admin_path: '/html/en/default/admin',
      username: 'admin',
      password: '',
      auth_type: 'form',
      remote_log_dir: '/opt/tririga/userfiles/log',
    });
    setTestResult(null);
    setError(null);
    setShowModal(true);
  };

  const handleOpenEditModal = (server: TririgaServer) => {
    setEditingServerId(server.id);
    setFormData({
      id: server.id,
      name: server.name,
      cluster_name: server.cluster_name || '',
      host: server.host,
      port: server.port,
      protocol: server.protocol,
      admin_path: server.admin_path,
      username: server.username || '',
      password: '', // Blank by default; backend preserves existing password if unchanged
      auth_type: server.auth_type || 'form',
      remote_log_dir: server.remote_log_dir || '/opt/tririga/userfiles/log',
    });
    setTestResult(null);
    setError(null);
    setShowModal(true);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testConnection(formData);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.host) {
      setError('Please provide a Server Name and Hostname/IP');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingServerId) {
        await api.updateServer(editingServerId, formData);
        setSuccessMessage(`Updated configuration for ${formData.name}`);
      } else {
        await api.createServer(formData);
        setSuccessMessage(`Added TRIRIGA server ${formData.name}`);
      }
      setTimeout(() => setSuccessMessage(null), 4000);
      setShowModal(false);
      onRefresh();
      setTestResult(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save server');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (window.confirm(`Are you sure you want to remove server "${name}" and all its indexed logs?`)) {
      await api.deleteServer(id);
      onRefresh();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">TRIRIGA Server Profiles</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Configure automated login, cluster group assignments, and credentials for continuous log harvesting.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add TRIRIGA Server</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 shadow-lg animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Servers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {servers.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-12 text-center bg-slate-900/20">
            <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-300">No TRIRIGA Servers Configured</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-5">
              Add your enterprise TRIRIGA environment connections (Admin Console HTTP/HTTPS or SSH) to begin log harvesting.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleOpenAddModal}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium cursor-pointer shadow-md"
              >
                + Add Connection Manually
              </button>
            </div>
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 p-5 shadow-sm transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0">
                      {server.protocol === 'ssh' ? <Terminal className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
                        <span>{server.name}</span>
                      </h3>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {server.protocol}://{server.host}:{server.port}
                      </span>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${
                    server.status === 'online'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : server.status === 'syncing'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse'
                      : server.status === 'error'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {server.status}
                  </span>
                </div>

                {/* Cluster Badge */}
                <div className="my-2">
                  {server.cluster_name ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/15 border border-purple-500/30 text-purple-300">
                      <Layers className="w-3 h-3 text-purple-400" />
                      <span>Cluster: {server.cluster_name}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-slate-500 bg-slate-800/40 border border-slate-800">
                      <span>Standalone Node</span>
                    </span>
                  )}
                </div>

                {/* Metrics stats */}
                <div className="grid grid-cols-3 gap-2 py-2.5 border-y border-slate-800/80 my-2.5 text-center">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase">Files</span>
                    <p className="text-sm font-semibold text-slate-200">{server.files_count || 0}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase">Total Logs</span>
                    <p className="text-sm font-semibold text-slate-200">{server.total_entries || 0}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase">Errors</span>
                    <p className={`text-sm font-semibold ${(server.total_errors || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {server.total_errors || 0}
                    </p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-slate-400">
                  <p className="flex items-center justify-between">
                    <span className="text-slate-500">Auth Method:</span>
                    <span className="font-mono text-[11px] text-slate-300">{server.auth_type} ({server.username || 'N/A'})</span>
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-slate-500">Admin Path:</span>
                    <span className="font-mono text-[11px] text-slate-300 truncate max-w-[170px]" title={server.admin_path}>{server.admin_path}</span>
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-slate-500">Last Synced:</span>
                    <span className="text-[11px] text-slate-300">{server.last_sync_at ? server.last_sync_at.substring(0, 19).replace('T', ' ') : 'Never'}</span>
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-800/60">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onSyncServer(server.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-medium transition-colors cursor-pointer"
                    title="Harvest and index logs from this server"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sync Logs</span>
                  </button>

                  <button
                    onClick={() => handleOpenEditModal(server)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium transition-colors cursor-pointer border border-slate-700"
                    title="Reconfigure server connection, cluster group & credentials"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Edit</span>
                  </button>

                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab('server_config', undefined, server.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-medium transition-colors cursor-pointer border border-cyan-500/20"
                      title="Inspect live machineMain & performanceMain telemetry"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Config & Perf</span>
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(server.id, server.name)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="Remove Server Profile"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Server Modal */}
      {showModal && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
        >
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">
                  {editingServerId ? 'Reconfigure TRIRIGA Server' : 'Add TRIRIGA Server Connection'}
                </h3>
              </div>
              <button 
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveServer} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Server Display Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. prod app1"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* Cluster Assignment */}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                      <span>Cluster Group Name</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal">Optional (e.g. Production Cluster)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Production Cluster"
                      value={formData.cluster_name || ''}
                      onChange={(e) => setFormData({ ...formData, cluster_name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, cluster_name: 'Production Cluster' })}
                      className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 shrink-0 cursor-pointer"
                    >
                      + Prod Cluster
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Servers sharing the same cluster group (e.g. prod app1 & prod app2) are compared in the Cluster Parity & Drift dashboard.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Protocol</label>
                  <select
                    value={formData.protocol || 'https'}
                    onChange={(e) => setFormData({ ...formData, protocol: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="https">HTTPS (Admin Console)</option>
                    <option value="http">HTTP (Admin Console)</option>
                    <option value="ssh">SSH / SFTP (Direct Host)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Port</label>
                  <input
                    type="number"
                    value={formData.port || (formData.protocol === 'https' ? 443 : 80)}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 443 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Host / IP Address</label>
                  <input
                    type="text"
                    required
                    placeholder="169.50.115.221 or tririga-app1.company.internal"
                    value={formData.host || ''}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">IP address or fully qualified hostname of the TRIRIGA application server node.</p>
                </div>

                {formData.protocol !== 'ssh' ? (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Admin Console Path</label>
                    <input
                      type="text"
                      value={formData.admin_path || '/html/en/default/admin'}
                      onChange={(e) => setFormData({ ...formData, admin_path: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                ) : (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Remote Log Directory</label>
                    <input
                      type="text"
                      value={formData.remote_log_dir || '/opt/tririga/userfiles/log'}
                      onChange={(e) => setFormData({ ...formData, remote_log_dir: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
                  <input
                    type="text"
                    placeholder="e.g. system or bradyp"
                    value={formData.username || ''}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {editingServerId ? 'Password (leave blank to keep current)' : 'Password'}
                  </label>
                  <input
                    type="password"
                    placeholder={editingServerId ? '•••••••• (leave blank to keep current)' : '••••••••'}
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Test Connection Output */}
              {testResult && (
                <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                  testResult.success 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                }`}>
                  {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || !formData.host}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>{testing ? 'Testing...' : 'Test Connection'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : (editingServerId ? 'Update Configuration' : 'Save Server')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
