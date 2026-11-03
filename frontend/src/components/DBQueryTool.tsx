import React, { useState, useEffect, useMemo } from 'react';
import { 
  Database, 
  Play, 
  ShieldCheck, 
  ShieldAlert, 
  Download, 
  Copy, 
  Check, 
  BrainCircuit, 
  Server, 
  Clock, 
  RotateCcw, 
  Search, 
  SlidersHorizontal,
  ChevronDown,
  AlertTriangle,
  Info,
  Layers,
  FileCode,
  Lock,
  Zap
} from 'lucide-react';
import { TririgaServer, QueryPreset, QueryResult } from '../types';
import { api } from '../services/api';

interface DBQueryToolProps {
  servers: TririgaServer[];
  onSendToAI?: (promptText: string) => void;
}

export const DBQueryTool: React.FC<DBQueryToolProps> = ({ servers, onSendToAI }) => {
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(() => {
    return servers.length > 0 ? servers[0].id : undefined;
  });
  const [useCustomServer, setUseCustomServer] = useState(false);
  const [customHost, setCustomHost] = useState('');
  const [customPort, setCustomPort] = useState(443);
  const [customProtocol, setCustomProtocol] = useState<'http' | 'https'>('https');
  const [customAdminPath, setCustomAdminPath] = useState('/html/en/default/admin');
  const [customUsername, setCustomUsername] = useState('admin');
  const [customPassword, setCustomPassword] = useState('');

  const [presets, setPresets] = useState<QueryPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('lock_waits');
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT TABNAME, HLD_APPLICATION_HANDLE, HLD_USERID, HLD_CURRENT_STMT_TEXT, LOCK_MODE, REQ_APPLICATION_HANDLE FROM SYSIBMADM.MON_LOCKWAITS'
  );

  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [filterText, setFilterText] = useState('');
  const [copied, setCopied] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (servers.length > 0 && selectedServerId === undefined) {
      setSelectedServerId(servers[0].id);
    }
  }, [servers]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getDbQueryPresets();
        setPresets(data);
      } catch (err) {
        console.error('Failed to load DB query presets:', err);
      }
    })();
  }, []);

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find(p => p.id === presetId);
    if (found) {
      setSqlQuery(found.sql);
      setValidationError(null);
    }
  };

  const handleExecute = async () => {
    if (!sqlQuery.trim()) return;
    setExecuting(true);
    setValidationError(null);

    try {
      const res = await api.executeDbQuery({
        serverId: useCustomServer ? undefined : selectedServerId,
        customHost: useCustomServer ? customHost : undefined,
        customPort: useCustomServer ? customPort : undefined,
        customProtocol: useCustomServer ? customProtocol : undefined,
        customAdminPath: useCustomServer ? customAdminPath : undefined,
        customUsername: useCustomServer ? customUsername : undefined,
        customPassword: useCustomServer ? customPassword : undefined,
        sql: sqlQuery,
      });

      setResult(res);
      if (!res.success && res.error) {
        setValidationError(res.error);
      }
    } catch (err: any) {
      setValidationError(err.message || 'Failed to execute query over HTTP');
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  };

  // Filtered & Sorted Rows
  const processedRows = useMemo(() => {
    if (!result || !result.rows) return [];
    let rows = [...result.rows];

    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      rows = rows.filter(r => 
        Object.values(r).some(val => 
          String(val).toLowerCase().includes(q)
        )
      );
    }

    if (sortColumn) {
      rows.sort((a, b) => {
        const valA = a[sortColumn] ?? '';
        const valB = b[sortColumn] ?? '';
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return sortDirection === 'asc' 
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    return rows;
  }, [result, filterText, sortColumn, sortDirection]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const handleExportCSV = () => {
    if (!result || !result.columns || processedRows.length === 0) return;
    const headers = result.columns.join(',');
    const csvRows = processedRows.map(r => 
      result.columns.map(col => {
        const val = r[col] ?? '';
        const strVal = String(val).replace(/"/g, '""');
        return `"${strVal}"`;
      }).join(',')
    );
    const csvContent = [headers, ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tririga_db2_query_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    if (!result || processedRows.length === 0) return;
    const jsonContent = JSON.stringify(processedRows, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tririga_db2_query_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyClipboard = () => {
    if (!result || processedRows.length === 0) return;
    navigator.clipboard.writeText(JSON.stringify(processedRows, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendResultsToAI = () => {
    if (!onSendToAI || !result) return;
    const sampleRows = processedRows.slice(0, 10);
    const prompt = `I executed a diagnostic DB2 query via the TRIRIGA Admin Console over HTTP:

**Executed SQL Query:**
\`\`\`sql
${sqlQuery}
\`\`\`

**Query Execution Summary:**
- Status: ${result.success ? 'Success' : 'Error'}
- Rows Returned: ${result.row_count}
- Execution Latency: ${result.execution_time_ms}ms

**Sample Result Rows (First ${sampleRows.length} rows):**
\`\`\`json
${JSON.stringify(sampleRows, null, 2)}
\`\`\`

Please provide a technical root cause interpretation of these DB2 query results in relation to TRIRIGA architecture (spec records, lock contention, or workflow queue depth).`;
    onSendToAI(prompt);
  };

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [presetSearch, setPresetSearch] = useState<string>('');

  // Group presets by category
  const categorizedPresets = useMemo(() => {
    const map: Record<string, QueryPreset[]> = {};
    presets.forEach(p => {
      const cat = p.category || 'General Diagnostics';
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    return map;
  }, [presets]);

  const categories = useMemo(() => {
    return Object.keys(categorizedPresets);
  }, [categorizedPresets]);

  const filteredPresets = useMemo(() => {
    let list = presets;
    if (selectedCategory !== 'ALL') {
      list = list.filter(p => (p.category || 'General Diagnostics') === selectedCategory);
    }
    if (presetSearch.trim()) {
      const q = presetSearch.toLowerCase();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.description.toLowerCase().includes(q) ||
        p.sql.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [presets, selectedCategory, presetSearch]);

  const parsePresetName = (name: string) => {
    const match = name.match(/^(.*?)(?:\s*\((.*?)\))?$/);
    if (match) {
      return {
        title: match[1].trim(),
        badge: match[2]?.trim() || null
      };
    }
    return { title: name, badge: null };
  };

  const getCategoryIcon = (category?: string) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('lock') || cat.includes('performance')) return <Lock className="w-3.5 h-3.5 text-amber-400" />;
    if (cat.includes('security') || cat.includes('session')) return <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />;
    if (cat.includes('workflow')) return <Zap className="w-3.5 h-3.5 text-blue-400" />;
    if (cat.includes('catalog')) return <Database className="w-3.5 h-3.5 text-cyan-400" />;
    if (cat.includes('modeler')) return <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />;
    return <Layers className="w-3.5 h-3.5 text-indigo-400" />;
  };

  const activePreset = presets.find(p => p.id === selectedPresetId);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 shadow-xl hero-banner">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner shrink-0">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-white tracking-tight">TRIRIGA DB Queries</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Read-Only Protected
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                HTTPS / Liberty JDBC
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Execute live diagnostic queries directly against the TRIRIGA database over HTTP (Port 443) via the Administrator Console.
            </p>
          </div>
        </div>

        {/* Server & Preset Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setUseCustomServer(prev => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
              useCustomServer 
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm' 
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {useCustomServer ? 'Using Custom Endpoint' : 'Target Registered Node'}
          </button>
        </div>
      </div>

      {/* Target Server Configuration Bar */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
        {!useCustomServer ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 text-indigo-400" />
              <label className="text-xs font-semibold text-slate-300">Target TRIRIGA Server:</label>
              <select
                value={selectedServerId || ''}
                onChange={(e) => setSelectedServerId(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              >
                {servers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.protocol}://{s.host}:{s.port})
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Session Authenticated via TRIRIGA Admin Console</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Protocol</label>
              <select
                value={customProtocol}
                onChange={(e) => setCustomProtocol(e.target.value as 'http' | 'https')}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:border-indigo-500"
              >
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Host / IP</label>
              <input
                type="text"
                value={customHost}
                onChange={(e) => setCustomHost(e.target.value)}
                placeholder="tririga-app.domain.com"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Port</label>
              <input
                type="number"
                value={customPort}
                onChange={(e) => setCustomPort(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Username</label>
              <input
                type="text"
                value={customUsername}
                onChange={(e) => setCustomUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Password</label>
              <input
                type="password"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Preset Diagnostic Selectors */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">TRIRIGA Diagnostic SQL Presets</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {presets.length} Verified Queries
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={presetSearch}
              onChange={(e) => setPresetSearch(e.target.value)}
              placeholder="Search presets by table / keyword..."
              className="w-full pl-8 pr-3 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 placeholder:text-slate-500"
            />
          </div>
        </div>

        {/* Category Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-800">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'category-tab-active shadow-sm ring-1 ring-indigo-400'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/70'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>All Presets</span>
            <span className={`tab-count-badge text-[10px] px-1.5 py-0.5 rounded-full ${
              selectedCategory === 'ALL' ? 'bg-indigo-950/80 text-white' : 'bg-slate-950/70 text-slate-400'
            }`}>
              {presets.length}
            </span>
          </button>
          {categories.map(cat => {
            const count = (categorizedPresets[cat] || []).length;
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'category-tab-active shadow-sm ring-1 ring-indigo-400'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/70'
                }`}
              >
                {getCategoryIcon(cat)}
                <span>{cat}</span>
                <span className={`tab-count-badge text-[10px] px-1.5 py-0.5 rounded-full ${
                  isSelected ? 'bg-indigo-950/80 text-white' : 'bg-slate-950/70 text-slate-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Preset Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 pt-1">
          {filteredPresets.map(p => {
            const isSelected = selectedPresetId === p.id;
            const { title, badge } = parsePresetName(p.name);
            return (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p.id)}
                className={`group text-left p-3 rounded-xl border transition-all relative flex flex-col justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? 'preset-card-selected'
                    : 'bg-slate-800/80 hover:bg-slate-800 text-slate-100 border-slate-700 hover:border-slate-500 shadow-sm preset-card-unselected'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`card-title text-xs font-bold transition-colors leading-snug ${
                    isSelected ? 'text-white' : 'text-slate-100 group-hover:text-indigo-300'
                  }`}>
                    {title}
                  </span>
                  {badge && (
                    <span className={`badge-pill text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 border font-semibold ${
                      isSelected
                        ? 'bg-indigo-700 text-white border-indigo-300/40'
                        : 'bg-slate-950/80 text-cyan-300 border-slate-700/80'
                    }`}>
                      {badge}
                    </span>
                  )}
                </div>

                <div className={`flex items-center justify-between text-[11px] pt-1 border-t ${
                  isSelected ? 'border-indigo-400/40' : 'border-slate-700/50'
                }`}>
                  <span className={`category-label flex items-center gap-1.5 text-[10px] font-medium ${
                    isSelected ? 'text-indigo-100' : 'text-slate-400'
                  }`}>
                    {getCategoryIcon(p.category)}
                    <span>{p.category}</span>
                  </span>
                  {isSelected && (
                    <span className="selected-check text-[10px] font-bold text-emerald-300 flex items-center gap-0.5">
                      <Check className="w-3 h-3" /> Selected
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {filteredPresets.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
            No presets found matching "{presetSearch}".
          </div>
        )}

        {/* Selected Preset Details Banner */}
        {activePreset && (
          <div className="selected-preset-banner text-xs text-indigo-200 bg-indigo-950/40 border border-indigo-500/30 px-3.5 py-2.5 rounded-xl flex items-start sm:items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-2.5">
              <div className="p-1 rounded-md bg-indigo-500/20 text-indigo-400 shrink-0">
                <Info className="w-4 h-4" />
              </div>
              <div>
                <span className="preset-desc-title font-semibold text-white mr-1.5">{activePreset.name}:</span>
                <span className="preset-desc-text text-slate-300">{activePreset.description}</span>
              </div>
            </div>
            <span className="text-[11px] text-slate-400 font-mono hidden md:inline shrink-0">
              Loaded in Editor
            </span>
          </div>
        )}
      </div>

      {/* SQL Editor Area */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-indigo-400" />
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">SQL Query Editor</label>
            <span className="text-[11px] text-slate-400 font-mono">(Ctrl + Enter to Execute)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSqlQuery('')}
              className="px-2.5 py-1 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => handleSelectPreset('lock_waits')}
              className="px-2.5 py-1 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
        </div>

        <div className="relative">
          <textarea
            value={sqlQuery}
            onChange={(e) => {
              setSqlQuery(e.target.value);
              setValidationError(null);
            }}
            onKeyDown={handleKeyDown}
            rows={5}
            placeholder="SELECT * FROM SYSIBMADM.MON_LOCKWAITS WHERE TABNAME = 'T_REQUISITION'"
            className="w-full p-3 font-mono text-xs text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors resize-y leading-relaxed shadow-inner"
            spellCheck={false}
          />
        </div>

        {validationError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Strict DB2 Read-Only Enforcement active (mutating operations blocked)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExecute}
              disabled={executing || !sqlQuery.trim()}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {executing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Executing HTTP Query...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Execute SQL Query</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {result && (
        <div className="p-5 rounded-xl bg-slate-900/95 border border-slate-800 shadow-xl space-y-4">
          {/* Results Summary Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Results</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {result.row_count} {result.row_count === 1 ? 'row' : 'rows'}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                <Clock className="w-3 h-3 text-cyan-400" />
                <span>{result.execution_time_ms}ms</span>
              </div>
              {result.source && (
                <span className="text-[11px] text-slate-400">
                  Source: <span className="font-mono text-slate-300">{result.source}</span>
                </span>
              )}
            </div>

            {/* Actions: Filter, Export, Send to AI */}
            <div className="flex items-center gap-2 flex-wrap">
              {result.columns && result.columns.length > 0 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter results..."
                    className="pl-8 pr-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 w-36 sm:w-48"
                  />
                </div>
              )}

              <button
                onClick={handleExportCSV}
                disabled={processedRows.length === 0}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1 disabled:opacity-40"
                title="Export as CSV"
              >
                <Download className="w-3 h-3" /> CSV
              </button>

              <button
                onClick={handleExportJSON}
                disabled={processedRows.length === 0}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1 disabled:opacity-40"
                title="Export as JSON"
              >
                <Download className="w-3 h-3" /> JSON
              </button>

              <button
                onClick={handleCopyClipboard}
                disabled={processedRows.length === 0}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1 disabled:opacity-40"
                title="Copy rows to clipboard"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>

              {onSendToAI && (
                <button
                  onClick={handleSendResultsToAI}
                  disabled={processedRows.length === 0}
                  className="px-3 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-xs font-semibold border border-cyan-500/40 transition-colors flex items-center gap-1.5 shadow-sm shadow-cyan-500/10 cursor-pointer disabled:opacity-40"
                  title="Send Query & Results to AI Log Analysis Chat"
                >
                  <BrainCircuit className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Send to AI Log Analysis</span>
                </button>
              )}
            </div>
          </div>

          {result.notice && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{result.notice}</span>
            </div>
          )}

          {/* Data Grid Table */}
          {result.columns && result.columns.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] font-semibold border-b border-slate-800 z-10">
                  <tr>
                    <th className="px-3 py-2.5 w-12 text-slate-500">#</th>
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className="px-4 py-2.5 cursor-pointer hover:text-white transition-colors select-none"
                      >
                        <div className="flex items-center gap-1">
                          <span>{col}</span>
                          {sortColumn === col && (
                            <ChevronDown
                              className={`w-3 h-3 text-indigo-400 transition-transform ${
                                sortDirection === 'desc' ? 'rotate-180' : ''
                              }`}
                            />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {processedRows.map((row, idx) => (
                    <tr 
                      key={idx} 
                      className="hover:bg-slate-800/40 transition-colors even:bg-slate-950/30"
                    >
                      <td className="px-3 py-2 text-slate-600 font-sans">{idx + 1}</td>
                      {result.columns.map((col) => {
                        const val = row[col];
                        const isStateCol = col.toUpperCase() === 'SYS_STATE1';
                        const isLockCol = col.toUpperCase() === 'LOCK_MODE';
                        const isSpecCol = col.toUpperCase() === 'SPEC_ID';

                        return (
                          <td key={col} className="px-4 py-2 whitespace-nowrap text-slate-200">
                            {isStateCol ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                {String(val)}
                              </span>
                            ) : isLockCol ? (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold ${
                                String(val) === 'X' || String(val) === 'Z'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {String(val)}
                              </span>
                            ) : isSpecCol ? (
                              <span className="font-bold text-cyan-300">{String(val)}</span>
                            ) : (
                              <span>{String(val !== undefined && val !== null ? val : '')}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-slate-800/80">
              Query executed successfully, but 0 rows were returned.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
