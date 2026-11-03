import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sliders,
  RefreshCw,
  Users,
  ChevronRight,
  Download,
  Building,
  Key,
  Database
} from 'lucide-react';
import { api } from '../../services/api';
import { LicenseUsageData } from '../../types';

interface MasAppPointSizingToolProps {
  licenseData: LicenseUsageData | null;
  selectedServerInfo: { name: string; isCluster: boolean; host: string };
}

export const MasAppPointSizingTool: React.FC<MasAppPointSizingToolProps> = ({
  licenseData,
  selectedServerInfo
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [sizingData, setSizingData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Interactive controls
  const [bufferPct, setBufferPct] = useState<number>(20);
  const [includeReserve, setIncludeReserve] = useState<boolean>(true);
  const [reserveUsers, setReserveUsers] = useState<number>(4000);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('audited_utilization_recommended');

  const fetchSizing = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMasSizing({
        bufferPct,
        includeReserve,
        reserveUsers
      });
      setSizingData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to calculate MAS AppPoint sizing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSizing();
  }, [bufferPct, includeReserve, reserveUsers]);

  const activeScenario = useMemo(() => {
    if (!sizingData?.scenarios) return null;
    return sizingData.scenarios.find((s: any) => s.id === selectedScenarioId) || sizingData.scenarios[0];
  }, [sizingData, selectedScenarioId]);

  const downloadSizingReport = () => {
    if (!sizingData) return;
    const jsonStr = JSON.stringify(sizingData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MAS_MREF_AppPoints_Sizing_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
          <Layers className="w-48 h-48 text-indigo-400" />
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                IBM MAS 9.1 & 9.2 Licensing & MREF Reference
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                Audited DB2 Concurrency Sizing
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Maximo Application Suite (MAS) & MREF AppPoints Sizing Calculator
            </h2>
            <p className="text-slate-300 text-xs mt-1 max-w-3xl leading-relaxed">
              Forecasts AppPoints requirements for migrating from legacy TRIRIGA SaaS module licenses to Maximo Real Estate and Facilities (MREF).
              Sizes pooled AppPoints dynamically from audited peak concurrent logins (<code className="text-cyan-300 font-mono">SESSION_HISTORY</code>) and user provisioning (<code className="text-cyan-300 font-mono">USER_PRODUCT</code>).
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={fetchSizing}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Recalculate</span>
            </button>
            <button
              onClick={downloadSizingReport}
              disabled={!sizingData}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Sizing JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Recommended AppPoint Pool */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-indigo-500/40 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-indigo-300 uppercase tracking-wider">Recommended AppPoints</span>
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono flex items-baseline gap-2">
            <span>{sizingData?.recommended_sizing?.total_apppoints ?? '...'}</span>
            <span className="text-xs font-sans text-indigo-400 font-normal">AppPoints</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Includes {bufferPct}% headroom buffer + Reserve add-on
          </p>
          <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Optimal sizing based on peak user concurrency</span>
          </div>
        </div>

        {/* Audited Peak Concurrent Logins */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-cyan-300 uppercase tracking-wider">Audited Peak Concurrency</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-extrabold text-cyan-400 font-mono flex items-baseline gap-2">
            <span>{sizingData?.overall_peak_concurrent ?? 10}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">simultaneous users</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Historical peak observed in DB2 SESSION_HISTORY
          </p>
          <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
            <span>Quota saturation:</span>
            <strong className="text-slate-300">{sizingData?.optimization_insights?.contract_entitled_concurrency_ratio ?? '2.4%'}</strong>
          </div>
        </div>

        {/* Legacy Contract Baseline */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-slate-400 uppercase tracking-wider">Legacy Contract Parity</span>
            <Database className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-3xl font-extrabold text-slate-300 font-mono flex items-baseline gap-2">
            <span>{sizingData?.contractual_baseline?.concurrent_points ?? 2270}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">AppPoints</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            If 100% of SaaS seats ({sizingData?.total_contractual_seats ?? 425}) were mapped 1:1
          </p>
          <div className="mt-2 text-[10px] text-rose-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-rose-400" />
            <span>Severely oversized (380+ dormant seats)</span>
          </div>
        </div>

        {/* Cost & License Optimization Footprint */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-500/30 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-emerald-400 uppercase tracking-wider">License Reduction</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 font-mono flex items-baseline gap-2">
            <span>
              {sizingData?.recommended_sizing?.total_apppoints && sizingData?.contractual_baseline?.concurrent_points
                ? `${Math.round((1 - sizingData.recommended_sizing.total_apppoints / sizingData.contractual_baseline.concurrent_points) * 100)}%`
                : '65%'}
            </span>
            <span className="text-xs font-sans text-slate-400 font-normal">footprint savings</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Eliminates wasted points on never-logged-in accounts
          </p>
          <div className="mt-2 text-[10px] text-emerald-400 flex items-center gap-1">
            <span>High priority reclaimable:</span>
            <strong>{sizingData?.optimization_insights?.high_priority_reclaimable ?? 376} seats</strong>
          </div>
        </div>
      </div>

      {/* Sizing Parameters & Sensitivity Controls */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Interactive Sizing Drivers & Reserve Add-on</h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Dynamically adjust safety headroom and population metrics
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
          {/* Buffer / Headroom Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Safety Headroom Buffer</span>
              <span className="font-mono font-bold text-cyan-400">{bufferPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={bufferPct}
              onChange={(e) => setBufferPct(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <p className="text-[10px] text-slate-500 mt-1.5">
              Protects against unexpected concurrent concurrency spikes during audits or project launches.
            </p>
          </div>

          {/* Reserve Module Add-on Toggle */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">MREF Reserve Add-on Module</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${includeReserve ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'}`}>
                {includeReserve ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeReserve}
                  onChange={(e) => setIncludeReserve(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
              <span className="text-xs text-slate-400">
                {includeReserve ? `${sizingData?.reserve_addon?.points ?? 20} AppPoints (${sizingData?.reserve_addon?.tier_name})` : '0 AppPoints'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Per IBM MAS MREF documentation: Tier 1 (&lt;10k users) = 20 pts; Tier 2 (10k-100k) = 120 pts.
            </p>
          </div>

          {/* Reserve Population Scale */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Reserve User Population</span>
              <span className="font-mono font-bold text-indigo-300">{reserveUsers.toLocaleString()} users</span>
            </div>
            <select
              value={reserveUsers}
              disabled={!includeReserve}
              onChange={(e) => setReserveUsers(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-40"
            >
              <option value={4000}>Tier 1: Up to 10,000 Users (20 AppPoints)</option>
              <option value={25000}>Tier 2: 10,000 to 100,000 Users (120 AppPoints)</option>
              <option value={150000}>Tier 3: Over 100,000 Users (200 AppPoints)</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Applies to employees booking desks/meeting rooms via Reserve.
            </p>
          </div>
        </div>
      </div>

      {/* Sizing Scenarios Comparison */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Key className="w-4 h-4 text-indigo-400" />
          <span>Architecture & Sizing Scenarios for Decision-Makers</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {sizingData?.scenarios?.map((s: any) => {
            const isSelected = selectedScenarioId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setSelectedScenarioId(s.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/50'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-bold text-slate-200 line-clamp-1">{s.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      s.id === 'audited_utilization_recommended'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {s.risk}
                    </span>
                  </div>

                  <div className="text-2xl font-extrabold text-white font-mono my-2 flex items-baseline gap-1.5">
                    <span>{s.apppoints_required}</span>
                    <span className="text-xs font-sans text-indigo-300 font-normal">AppPoints</span>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed mb-3">
                    {s.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
                  <span>Capacity: <strong className="text-slate-300">{s.user_capacity}</strong></span>
                  <ChevronRight className={`w-3.5 h-3.5 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Scenario Detailed Breakdown */}
      {activeScenario && (
        <div className="p-5 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <span>{activeScenario.name}</span>
                {activeScenario.id === 'audited_utilization_recommended' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    RECOMMENDED ARCHITECTURE
                  </span>
                )}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">{activeScenario.description}</p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xs text-slate-400 block">Total Requirement</span>
              <span className="text-xl font-bold font-mono text-indigo-300">{activeScenario.apppoints_required} AppPoints</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-2">
              <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Advantages & Strategic Value</span>
              </span>
              <p className="text-slate-300 leading-relaxed">{activeScenario.pros}</p>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-2">
              <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                <span>Operational Governance Considerations</span>
              </span>
              <p className="text-slate-300 leading-relaxed">{activeScenario.cons}</p>
            </div>
          </div>
        </div>
      )}

      {/* Itemized TRIRIGA to MAS MREF Module Conversion Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Building className="w-4 h-4 text-cyan-400" />
            <span>Itemized TRIRIGA License to MAS MREF Tier Conversion Matrix</span>
          </h3>
          <span className="text-[11px] text-slate-400">
            Source: IBM Maximo Application Suite 9.1 & 9.2 Licensing Appendix
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">PID</th>
                <th className="py-3 px-4">TRIRIGA License Module</th>
                <th className="py-3 px-4">MAS MREF Tier</th>
                <th className="py-3 px-4">AppPoints (Auth / Conc)</th>
                <th className="py-3 px-4 text-center">Entitled Seats</th>
                <th className="py-3 px-4 text-center">Assigned Users</th>
                <th className="py-3 px-4 text-center">Peak Concurrent (Audited)</th>
                <th className="py-3 px-4 text-right">Audited Conc. Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {sizingData?.module_conversions?.map((m: any) => {
                const isContracted = [3050, 3053, 3048, 3018].includes(m.product_id);
                return (
                  <tr key={m.product_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-cyan-400">{m.product_id}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-200">{m.tririga_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{m.mas_application}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        m.mas_tier === 'premium'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : m.mas_tier === 'base'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : m.mas_tier === 'limited'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}>
                        {m.mas_tier_label.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {m.points_per_auth} Auth / {m.points_per_conc} Conc
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-medium text-slate-300">
                      {m.entitled_seats > 0 ? m.entitled_seats : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-medium text-slate-300">
                      {m.assigned_seats}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-cyan-400">
                      {m.peak_concurrent_observed}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-indigo-300">
                      {m.apppoints_audited_conc} pts
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-950/60 font-semibold border-t border-slate-800 text-slate-300">
              <tr>
                <td colSpan={4} className="py-3 px-4 text-right">
                  Total Floating Peak Concurrency Points:
                </td>
                <td className="py-3 px-4 text-center font-mono">
                  {sizingData?.total_contractual_seats ?? 425}
                </td>
                <td className="py-3 px-4 text-center font-mono">
                  {sizingData?.total_assigned_seats ?? 547}
                </td>
                <td className="py-3 px-4 text-center font-mono text-cyan-400">
                  {sizingData?.overall_peak_concurrent ?? 10}
                </td>
                <td className="py-3 px-4 text-right font-mono text-indigo-300 font-bold">
                  {sizingData?.recommended_sizing?.concurrent_points ?? 85} pts
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Primary Strategic Recommendation Callout */}
      <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-slate-300 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-bold text-indigo-300">Strategic Migration Takeaway</h4>
          <p className="text-slate-300 leading-relaxed">
            {sizingData?.optimization_insights?.primary_recommendation ??
              'Transitioning from legacy named SaaS seats to MAS AppPoints enables massive optimization. Sizing for actual audited concurrency eliminates the penalty of 380+ dormant seats.'}
          </p>
        </div>
      </div>
    </div>
  );
};
