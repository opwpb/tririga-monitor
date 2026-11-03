import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Zap, 
  Clock, 
  Database, 
  Cpu, 
  HardDrive, 
  AlertTriangle, 
  CheckCircle2, 
  X, 
  RefreshCw,
  RotateCcw,
  Activity,
  Layers,
  ArrowDownCircle
} from 'lucide-react';
import { api } from '../services/api';

interface PerfModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PerfModal: React.FC<PerfModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [clientTiming, setClientTiming] = useState<{
    dns: number;
    tcp: number;
    ttfb: number;
    domReady: number;
    pageLoad: number;
  } | null>(null);

  // Read Navigation Timing API
  const readClientTiming = () => {
    try {
      const perfEntries = performance.getEntriesByType('navigation');
      if (perfEntries && perfEntries.length > 0) {
        const nav = perfEntries[0] as PerformanceNavigationTiming;
        setClientTiming({
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcp: Math.round(nav.connectEnd - nav.connectStart),
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          pageLoad: Math.round(nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : performance.now()),
        });
      } else if (window.performance && window.performance.timing) {
        const t = window.performance.timing;
        setClientTiming({
          dns: Math.max(0, t.domainLookupEnd - t.domainLookupStart),
          tcp: Math.max(0, t.connectEnd - t.connectStart),
          ttfb: Math.max(0, t.responseStart - t.requestStart),
          domReady: Math.max(0, t.domContentLoadedEventEnd - t.navigationStart),
          pageLoad: Math.max(0, t.loadEventEnd > 0 ? t.loadEventEnd - t.navigationStart : Date.now() - t.navigationStart),
        });
      }
    } catch {
      // Fallback
    }
  };

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      readClientTiming();
      const res = await api.getPerfMetrics();
      setData(res);
    } catch (err) {
      console.error('Failed to load performance metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResetMetrics = async () => {
    setLoading(true);
    try {
      await api.resetPerfMetrics();
      await fetchMetrics();
    } catch (err) {
      console.error('Failed to reset performance metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMetrics();
    }
  }, [isOpen]);

  // Support ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] overflow-y-auto p-4 sm:p-6 flex items-start sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="relative w-full max-w-3xl my-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-6 text-slate-100 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Performance Diagnostics & Bottleneck Monitor
              </h2>
              <p className="text-xs text-slate-400">
                End-to-end real-time latency inspection across browser, network, FastAPI, and SQLite.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetMetrics}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-rose-300 transition-colors text-xs font-medium cursor-pointer border border-slate-700/60"
              title="Reset latency statistics to measure fresh performance"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Stats</span>
            </button>
            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer border border-slate-700/60"
              title="Refresh Diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 py-4 pr-1">
          {/* Client Navigation Timing Row */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Browser Navigation & Page Load Breakdown</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-500 uppercase">DNS Lookup</span>
                <p className="text-sm font-bold text-slate-200 mt-0.5">{clientTiming?.dns ?? 0} ms</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-500 uppercase">TCP Connect</span>
                <p className="text-sm font-bold text-slate-200 mt-0.5">{clientTiming?.tcp ?? 0} ms</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-500 uppercase">TTFB (Server)</span>
                <p className="text-sm font-bold text-cyan-400 mt-0.5">{clientTiming?.ttfb ?? 0} ms</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-500 uppercase">DOM Ready</span>
                <p className="text-sm font-bold text-slate-200 mt-0.5">{clientTiming?.domReady ?? 0} ms</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-500 uppercase">Total Load</span>
                <p className={`text-sm font-bold mt-0.5 ${(clientTiming?.pageLoad ?? 0) > 1000 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {clientTiming?.pageLoad ?? 0} ms
                </p>
              </div>
            </div>
          </div>

          {/* Database & Memory KPI Cards */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span>SQLite Engine & System Resources</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Database Size</span>
                <p className="text-sm font-bold text-white mt-0.5">{data?.database?.db_size_mb ?? 0} MB</p>
                <span className="text-[10px] text-slate-400 font-mono">{(data?.database?.total_entries ?? 0).toLocaleString()} logs</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Indexed Read</span>
                <p className="text-sm font-bold text-emerald-400 mt-0.5">{data?.database?.indexed_read_ms ?? 0} ms</p>
                <span className="text-[10px] text-slate-400 font-mono">50 rows (ORDER BY id)</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Full Summary Query</span>
                <p className={`text-sm font-bold mt-0.5 ${(data?.database?.summary_query_ms ?? 0) > 100 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {data?.database?.summary_query_ms ?? 0} ms
                </p>
                <span className="text-[10px] text-slate-400 font-mono">Aggregation scan</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Process Memory</span>
                <p className="text-sm font-bold text-cyan-400 mt-0.5">{data?.memory_rss_mb ?? 0} MB</p>
                <span className="text-[10px] text-slate-400 font-mono">Uptime: {data?.uptime_seconds ?? 0}s</span>
              </div>
            </div>
          </div>

          {/* Bottleneck Advisor */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <h4 className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Active Bottleneck Analysis</span>
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-300">
              {(data?.bottlenecks || []).map((msg: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                  <span>{msg}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Endpoint Latency Breakdown Table */}
          {data?.endpoints && data.endpoints.length > 0 && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>API Route Latencies (Server Processing Time)</span>
                </h3>
                <span className="text-[10px] text-slate-400">
                  <strong>Latest</strong> reflects real-time speed. Click <strong>Reset Stats</strong> to clear old session history.
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2">Endpoint</th>
                      <th className="px-3 py-2 text-right">Calls</th>
                      <th className="px-3 py-2 text-right">Latest</th>
                      <th className="px-3 py-2 text-right">Avg Latency</th>
                      <th className="px-3 py-2 text-right">Min / Max</th>
                      <th className="px-3 py-2 text-right">Slow (&gt;300ms)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 font-mono">
                    {data.endpoints.slice(0, 10).map((ep: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-medium text-slate-200">{ep.endpoint}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{ep.requests}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`font-semibold ${(ep.recent_ms ?? ep.avg_ms) > 200 ? 'text-amber-400' : 'text-cyan-400'}`}>
                            {ep.recent_ms ?? ep.avg_ms} ms
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`font-semibold ${ep.avg_ms > 200 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {ep.avg_ms} ms
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">{ep.min_ms} / {ep.max_ms} ms</td>
                        <td className="px-3 py-2 text-right">
                          {ep.slow_count > 0 ? (
                            <span className="text-rose-400 font-bold">{ep.slow_count}</span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>GZip compression: <strong>ACTIVE</strong> | SQLite Memory Map (256MB): <strong>ACTIVE</strong></span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
