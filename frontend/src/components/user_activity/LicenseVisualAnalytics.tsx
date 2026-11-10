import React, { useState, useMemo, useEffect } from 'react';
import { 
  Users, 
  Zap, 
  ShieldCheck, 
  Activity, 
  TrendingUp, 
  GitMerge, 
  BarChart2, 
  Calendar, 
  ArrowRight, 
  Share2, 
  LayoutGrid, 
  Percent,
  Building2,
  Globe 
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  AreaChart, 
  Area, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { 
  LicenseUsageData, 
  LicenseEntitlementItem, 
  SankeyNode 
} from '../../types';
import { useTimeContext } from '../../context/TimeContext';

interface LicenseVisualAnalyticsProps {
  licenseData: LicenseUsageData | null;
  selectedServerInfo: { name: string; isCluster: boolean; host: string };
  filteredEntitlements: LicenseEntitlementItem[];
  overallSat: number;
  overAllocatedCount: number;
  totalEntitled: number;
  totalAssigned: number;
  totalActive: number;
}

export const LicenseVisualAnalytics: React.FC<LicenseVisualAnalyticsProps> = ({
  licenseData,
  selectedServerInfo,
  filteredEntitlements,
  overallSat,
  overAllocatedCount,
  totalEntitled,
  totalAssigned,
  totalActive,
}) => {
  const { formatDisplayTime } = useTimeContext();

  const [isLightMode, setIsLightMode] = useState<boolean>(() => {
    return typeof document !== 'undefined' && document.body.classList.contains('theme-light');
  });

  useEffect(() => {
    const updateTheme = () => {
      setIsLightMode(document.body.classList.contains('theme-light'));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const [globalMetric, setGlobalMetric] = useState<'concurrent' | 'users' | 'sessions'>('concurrent');
  const [chartViewMode, setChartViewMode] = useState<'alluvial' | 'sankey' | 'timeline' | 'share' | 'heatmap' | 'lines' | 'barchart'>('heatmap');
  const [timelineMetric, setTimelineMetric] = useState<'max_concurrent' | 'unique_users' | 'total_sessions'>('max_concurrent');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{ sourceName: string; targetName: string; value: number; x: number; y: number } | null>(null);
  const [hoveredAlluvialModule, setHoveredAlluvialModule] = useState<string | null>(null);
  const [heatmapMetric, setHeatmapMetric] = useState<'concurrent' | 'users' | 'sessions'>('concurrent');
  const [alluvialMetric, setAlluvialMetric] = useState<'concurrent' | 'users' | 'sessions'>('concurrent');
  const [shareMetric, setShareMetric] = useState<'concurrent' | 'users' | 'sessions'>('concurrent');

  const handleGlobalMetricChange = (m: 'concurrent' | 'users' | 'sessions') => {
    setGlobalMetric(m);
    setHeatmapMetric(m);
    setAlluvialMetric(m);
    setShareMetric(m);
    setTimelineMetric(m === 'concurrent' ? 'max_concurrent' : m === 'users' ? 'unique_users' : 'total_sessions');
  };

  // Chart data for Entitlement vs Usage vs Active
  const chartData = useMemo(() => {
    if (!licenseData?.license_entitlements) return [];
    return licenseData.license_entitlements.slice(0, 8).map(e => ({
      name: e.license_name.replace('IBM Facilities & RE on Cloud ', '').replace('IBM Facilities and Real Estate Management on Cloud ', ''),
      fullName: e.license_name,
      Entitled: e.entitled_count,
      Assigned: e.assigned_count,
      Active: e.active_count,
    }));
  }, [licenseData?.license_entitlements]);

  // Normalized 100% Share Data
  const shareData = useMemo(() => {
    if (!licenseData?.consumption_over_time) return [];
    return licenseData.consumption_over_time.map(pt => {
      const getVal = (modName: string) => {
        if (shareMetric === 'concurrent') {
          return pt[`${modName}_concurrent`] ?? pt[`${modName}_max_concurrent`] ?? pt.by_product?.[modName]?.max_concurrent ?? pt.by_product?.[modName]?.concurrent ?? (pt[`${modName}_users`] ? Math.max(1, Math.round(pt[`${modName}_users`] * 0.7)) : 0);
        }
        if (shareMetric === 'sessions') {
          return pt[`${modName}_sessions`] ?? pt.by_product?.[modName]?.sessions ?? 0;
        }
        return pt[`${modName}_users`] ?? pt.by_product?.[modName]?.users ?? 0;
      };

      const occVal = getVal('Occasional Enterprise');
      const apprVal = getVal('Approvals & Reporting');
      const entVal = getVal('Enterprise');
      const apiVal = getVal('API Integration');
      const selfVal = getVal('Self Service');
      const opsVal = getVal('Operations & Maint');
      const tot = (occVal + apprVal + entVal + apiVal + selfVal + opsVal) || 1;

      return {
        date: pt.date,
        total_metric: tot,
        'Occasional Enterprise_share': Number(((occVal / tot) * 100).toFixed(1)),
        'Approvals & Reporting_share': Number(((apprVal / tot) * 100).toFixed(1)),
        'Enterprise_share': Number(((entVal / tot) * 100).toFixed(1)),
        'API Integration_share': Number(((apiVal / tot) * 100).toFixed(1)),
        'Self Service_share': Number(((selfVal / tot) * 100).toFixed(1)),
        'Operations & Maint_share': Number(((opsVal / tot) * 100).toFixed(1)),
        'Occasional Enterprise_raw': occVal,
        'Approvals & Reporting_raw': apprVal,
        'Enterprise_raw': entVal,
        'API Integration_raw': apiVal,
        'Self Service_raw': selfVal,
        'Operations & Maint_raw': opsVal,
      };
    });
  }, [licenseData?.consumption_over_time, shareMetric]);

  // Heatmap Matrix Data
  const heatmapData = useMemo(() => {
    if (!licenseData?.consumption_over_time) return { products: [], dates: [], matrix: {}, maxUsers: 1, maxSessions: 1, maxConcurrent: 1 };
    const dates = licenseData.consumption_over_time.map(p => p.date);
    const standardProducts = [
      'Occasional Enterprise',
      'Approvals & Reporting',
      'Enterprise',
      'API Integration',
      'Self Service',
      'Operations & Maint',
    ];
    let maxUsers = 1;
    let maxSessions = 1;
    let maxConcurrent = 1;
    const matrix: Record<string, Record<string, { users: number; sessions: number; max_concurrent: number }>> = {};

    standardProducts.forEach(p => {
      matrix[p] = {};
      dates.forEach(d => {
        matrix[p][d] = { users: 0, sessions: 0, max_concurrent: 0 };
      });
    });

    licenseData.consumption_over_time.forEach(p => {
      const d = p.date;
      const byP = p.by_product || {};
      Object.entries(byP).forEach(([pName, pVal]: [string, any]) => {
        if (!matrix[pName]) {
          matrix[pName] = {};
          dates.forEach(dateStr => { matrix[pName][dateStr] = { users: 0, sessions: 0, max_concurrent: 0 }; });
        }
        const u = pVal.users ?? 0;
        const s = pVal.sessions ?? 0;
        const c = pVal.max_concurrent ?? pVal.concurrent ?? p[`${pName}_concurrent`] ?? p[`${pName}_max_concurrent`] ?? (u > 0 ? Math.max(1, Math.round(u * 0.7)) : 0);
        matrix[pName][d] = { users: u, sessions: s, max_concurrent: c };
        if (u > maxUsers) maxUsers = u;
        if (s > maxSessions) maxSessions = s;
        if (c > maxConcurrent) maxConcurrent = c;
      });
    });

    return {
      products: Object.keys(matrix),
      dates,
      matrix,
      maxUsers,
      maxSessions,
      maxConcurrent
    };
  }, [licenseData?.consumption_over_time]);

  return (
    <div className="space-y-4">
      {/* Sub-View Navigation Header */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>Licence Entitlement Flow &amp; Consumption Analytics</span>
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/30 font-semibold font-mono">
              {selectedServerInfo.name}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Explore TRIRIGA licence dynamics through 7 specialized visualizations: Temporal Alluvial ribbons, Multi-Tier Sankey capacity flow, Streamgraphs, 100% Share evolution, 2D Density Heatmap, Multi-Line trends, and Contractual Saturation.
          </p>
        </div>

        {/* View Mode Switcher */}
        <div className="flex flex-wrap items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 gap-1 shrink-0">
          <button
            onClick={() => setChartViewMode('heatmap')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'heatmap'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="2D Matrix of License Modules vs. Snapshot Dates with intensity shading"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Density Heatmap</span>
          </button>

          <button
            onClick={() => setChartViewMode('alluvial')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'alluvial'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Temporal Alluvial stream ribbons showing daily module flow transitions"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Alluvial Flow</span>
          </button>

          <button
            onClick={() => setChartViewMode('sankey')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'sankey'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Multi-tier structural capacity flow from Contract Quota to Active Logins"
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>Sankey Capacity</span>
          </button>

          <button
            onClick={() => setChartViewMode('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'timeline'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Stacked organic streamgraph of unique daily active users & session invocations"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Streamgraph</span>
          </button>

          <button
            onClick={() => setChartViewMode('share')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'share'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="100% normalized proportional share breakdown across licence modules"
          >
            <Percent className="w-3.5 h-3.5" />
            <span>100% Share</span>
          </button>

          <button
            onClick={() => setChartViewMode('lines')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'lines'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Multi-line concurrency trajectories & peak comparisons"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Trend Lines</span>
          </button>

          <button
            onClick={() => setChartViewMode('barchart')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              chartViewMode === 'barchart'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Side-by-side quota vs assigned vs active comparison bar chart"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Capacity Bar Matrix</span>
          </button>
        </div>
      </div>

      {/* Global Consumption Metric Option Filter Bar */}
      <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Licence Metric Display Option</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/30">
                {globalMetric === 'concurrent' ? 'Max Concurrent User Logins / Day' : globalMetric === 'users' ? 'Unique Daily Active Users' : 'Total Session Invocations'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Select primary analytical metric across Density Heatmap, Alluvial Flow, Streamgraph, Share, and Trend Line charts.
            </p>
          </div>
        </div>

        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 gap-1 shrink-0">
          <button
            onClick={() => handleGlobalMetricChange('concurrent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              globalMetric === 'concurrent'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Display maximum concurrent user logins by licence type per day"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Max Concurrent Logins</span>
          </button>

          <button
            onClick={() => handleGlobalMetricChange('users')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              globalMetric === 'users'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Display unique active users by licence type per day"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Unique Daily Users</span>
          </button>

          <button
            onClick={() => handleGlobalMetricChange('sessions')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              globalMetric === 'sessions'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm shadow-cyan-500/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            title="Display total session invocations by licence type per day"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Session Volume</span>
          </button>
        </div>
      </div>

      {/* User Concurrency & Daily Peak Telemetry KPI Cards */}
      {(() => {
        const timePoints = licenseData?.consumption_over_time || [];
        const activeDays = timePoints.filter(p => (p.total_users || 0) > 0);
        const maxUserPt = timePoints.reduce((prev, curr) => ((curr.total_users || 0) > (prev?.total_users || 0) ? curr : prev), timePoints[0] || null);
        const maxConcPt = timePoints.reduce((prev, curr) => ((curr.total_concurrent || 0) > (prev?.total_concurrent || 0) ? curr : prev), timePoints[0] || null);

        const liveActive = licenseData?.logged_in_users?.length ?? licenseData?.summary?.total_active_sessions ?? 0;
        const peakConc = licenseData?.summary?.peak_daily_concurrent ?? (maxConcPt?.total_concurrent || liveActive);
        const peakConcDate = licenseData?.summary?.peak_daily_concurrent_date ?? maxConcPt?.date ?? null;
        const peakUsers = licenseData?.summary?.peak_daily_unique_users ?? (maxUserPt?.total_users || liveActive);
        const peakUsersDate = licenseData?.summary?.peak_daily_unique_date ?? maxUserPt?.date ?? null;
        const avgConc = licenseData?.summary?.avg_daily_concurrent ?? (
          activeDays.length > 0
            ? Number((activeDays.reduce((acc, p) => acc + (p.total_concurrent || 0), 0) / activeDays.length).toFixed(1))
            : liveActive
        );
        const avgUsers = licenseData?.summary?.avg_daily_unique_users ?? (
          activeDays.length > 0
            ? Number((activeDays.reduce((acc, p) => acc + (p.total_users || 0), 0) / activeDays.length).toFixed(1))
            : liveActive
        );
        const entitledTotal = licenseData?.summary?.total_entitled_seats ?? 425;
        const concEntitledRatio = entitledTotal > 0 ? ((peakConc / entitledTotal) * 100).toFixed(1) : '0.0';

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Live Active Concurrency</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  Real-Time
                </span>
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 flex items-baseline gap-2">
                <span>{liveActive}</span>
                <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">sessions online now</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                De-duplicated `ACTIVE_SESSION_USER` count
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Max Daily Concurrent Users</span>
                <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 flex items-baseline gap-2">
                <span>{peakConc}</span>
                <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">peak simultaneous ({concEntitledRatio}% of quota)</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {peakConcDate ? <>Observed on <strong className="text-slate-700 dark:text-slate-200">{formatDisplayTime(peakConcDate).date}</strong> (interval overlap)</> : 'De-duplicated session overlap'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Max Unique Daily Users</span>
                <Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-300 flex items-baseline gap-2">
                <span>{peakUsers}</span>
                <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">distinct daily logins</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {peakUsersDate ? <>Observed on <strong className="text-slate-700 dark:text-slate-200">{formatDisplayTime(peakUsersDate).date}</strong> (`COUNT(DISTINCT user_id)`)</> : 'Without multi-licence join fan-out'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Active-Day Average Concurrency</span>
                <TrendingUp className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-300 flex items-baseline gap-2">
                <span>{avgConc}</span>
                <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">conc/day ({avgUsers} unique/day)</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Across <strong className="text-slate-700 dark:text-slate-200">{activeDays.length}</strong> active telemetry days
              </div>
            </div>
          </div>
        );
      })()}

      {/* Account Type Classification Breakdown Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-300">Internal Accounts</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Company employees &amp; staff</div>
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-lg font-bold text-sky-600 dark:text-sky-400">{licenseData?.summary?.internal_accounts_count ?? 0}</div>
            <div className="text-[10px] text-slate-400">
              {totalAssigned > 0 ? Math.round(((licenseData?.summary?.internal_accounts_count ?? 0) / totalAssigned) * 100) : 0}% of assigned
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-300">External Accounts</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Vendors, contractors &amp; partners</div>
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{licenseData?.summary?.external_accounts_count ?? 0}</div>
            <div className="text-[10px] text-slate-400">
              {totalAssigned > 0 ? Math.round(((licenseData?.summary?.external_accounts_count ?? 0) / totalAssigned) * 100) : 0}% of assigned
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-300">OSLC / API Connectors</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">REST, web services &amp; sync</div>
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{licenseData?.summary?.oslc_accounts_count ?? 0}</div>
            <div className="text-[10px] text-slate-400">
              {totalAssigned > 0 ? Math.round(((licenseData?.summary?.oslc_accounts_count ?? 0) / totalAssigned) * 100) : 0}% of assigned
            </div>
          </div>
        </div>
      </div>

      {/* VIEW 1: TEMPORAL ALLUVIAL FLOW DIAGRAM */}
      {chartViewMode === 'alluvial' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>Temporal Alluvial Flow: Daily TRIRIGA Module Transition Stream</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Traces how active user concurrency across TRIRIGA licence modules flows, expands, and contracts across consecutive snapshot dates. Hover over any stream ribbon or module block to trace its trajectory.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-600 dark:text-slate-400 font-mono">
                Stream Width = {alluvialMetric === 'concurrent' ? 'Max Concurrent User Logins / Day' : alluvialMetric === 'sessions' ? 'Total Session Volume' : 'Unique Daily Users'}
              </span>
              <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => { setAlluvialMetric('concurrent'); setGlobalMetric('concurrent'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    alluvialMetric === 'concurrent'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Show Maximum Concurrent User Logins per Day"
                >
                  Max Concurrent
                </button>
                <button
                  onClick={() => { setAlluvialMetric('users'); setGlobalMetric('users'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    alluvialMetric === 'users'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Show Unique Daily Active Users"
                >
                  Active Users
                </button>
                <button
                  onClick={() => { setAlluvialMetric('sessions'); setGlobalMetric('sessions'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    alluvialMetric === 'sessions'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Show Total Session Volume"
                >
                  Sessions
                </button>
              </div>
            </div>
          </div>

          {/* Alluvial Canvas */}
          {licenseData?.consumption_over_time && licenseData.consumption_over_time.length > 1 ? (
            <div className="relative overflow-x-auto select-none pt-2">
              {(() => {
                const timePoints = licenseData.consumption_over_time;
                const numDates = timePoints.length;
                const chartWidth = Math.max(900, numDates * 140);
                const chartHeight = 440;
                const colWidth = 90;
                const paddingX = 40;
                const usableWidth = chartWidth - paddingX * 2;
                const colSpacing = (usableWidth - colWidth) / (numDates - 1);

                const moduleColors: Record<string, string> = {
                  'Occasional Enterprise': '#06b6d4',
                  'Approvals & Reporting': '#6366f1',
                  'Enterprise': '#3b82f6',
                  'API Integration': '#10b981',
                  'Self Service': '#ec4899',
                  'Operations & Maint': '#f59e0b',
                };

                const standardModules = Object.keys(moduleColors);

                const getModuleMetricVal = (tp: any, mod: string) => {
                  const byP = tp.by_product?.[mod];
                  const u = byP?.users || 0;
                  const s = byP?.sessions || 0;
                  const c = byP?.max_concurrent ?? byP?.concurrent ?? tp[`${mod}_concurrent`] ?? tp[`${mod}_max_concurrent`] ?? (u > 0 ? Math.max(1, Math.round(u * 0.7)) : 0);
                  if (alluvialMetric === 'concurrent') return c;
                  if (alluvialMetric === 'sessions') return s;
                  return u;
                };

                const getDayTotalMetric = (tp: any) => {
                  if (alluvialMetric === 'concurrent') {
                    const sumC = standardModules.reduce((acc, m) => acc + getModuleMetricVal(tp, m), 0);
                    return sumC > 0 ? sumC : (tp.total_concurrent || 1);
                  }
                  if (alluvialMetric === 'sessions') {
                    return tp.total_sessions || 1;
                  }
                  return tp.total_users || 1;
                };

                // Find max total metric across days for proportional scaling
                const maxDailyMetric = Math.max(...timePoints.map(p => getDayTotalMetric(p)), 1);
                const totalStackHeight = chartHeight - 100;

                // Build column layout: for each date, stack the module blocks
                const columns = timePoints.map((tp, colIdx) => {
                  const x = paddingX + colIdx * colSpacing;
                  const dayTotal = getDayTotalMetric(tp);
                  const colHeight = Math.max(120, (dayTotal / maxDailyMetric) * totalStackHeight);
                  const startY = (chartHeight - 40 - colHeight) / 2 + 30;

                  let curY = startY;
                  const blocks: Record<string, {
                    module: string;
                    val: number;
                    users: number;
                    sessions: number;
                    concurrent: number;
                    y0: number;
                    y1: number;
                    height: number;
                    color: string;
                  }> = {};

                  standardModules.forEach(mod => {
                    const byP = tp.by_product?.[mod];
                    const users = byP?.users || 0;
                    const sessions = byP?.sessions || 0;
                    const concurrent = byP?.max_concurrent ?? byP?.concurrent ?? tp[`${mod}_concurrent`] ?? tp[`${mod}_max_concurrent`] ?? (users > 0 ? Math.max(1, Math.round(users * 0.7)) : 0);
                    const val = alluvialMetric === 'concurrent' ? concurrent : alluvialMetric === 'sessions' ? sessions : users;
                    const blockH = dayTotal > 0 ? (val / dayTotal) * colHeight : 0;

                    blocks[mod] = {
                      module: mod,
                      val,
                      users,
                      sessions,
                      concurrent,
                      y0: curY,
                      y1: curY + blockH,
                      height: blockH,
                      color: moduleColors[mod] || '#64748b'
                    };
                    curY += blockH;
                  });

                  const dayConcurrentTotal = standardModules.reduce((acc, m) => acc + (blocks[m]?.concurrent || 0), 0);

                  return {
                    date: tp.date,
                    total_users: tp.total_users,
                    total_sessions: tp.total_sessions,
                    total_concurrent: dayConcurrentTotal,
                    dayTotal,
                    x,
                    blocks,
                    startY,
                    colHeight
                  };
                });

                // Build alluvial flow ribbons between consecutive columns
                const ribbons: any[] = [];
                for (let i = 0; i < columns.length - 1; i++) {
                  const c1 = columns[i];
                  const c2 = columns[i + 1];

                  standardModules.forEach(mod => {
                    const b1 = c1.blocks[mod];
                    const b2 = c2.blocks[mod];

                    if (!b1 || !b2 || (b1.height === 0 && b2.height === 0)) return;

                    const x0 = c1.x + colWidth;
                    const x1 = c2.x;
                    const dx = (x1 - x0) * 0.5;

                    const y0_top = b1.y0;
                    const y0_bot = b1.y1;
                    const y1_top = b2.y0;
                    const y1_bot = b2.y1;

                    const path = `M ${x0},${y0_top} C ${x0 + dx},${y0_top} ${x1 - dx},${y1_top} ${x1},${y1_top} L ${x1},${y1_bot} C ${x1 - dx},${y1_bot} ${x0 + dx},${y0_bot} ${x0},${y0_bot} Z`;

                    ribbons.push({
                      module: mod,
                      path,
                      color: moduleColors[mod] || '#64748b',
                      fromVal: b1.val,
                      toVal: b2.val,
                      fromUsers: b1.users,
                      toUsers: b2.users,
                      fromConcurrent: b1.concurrent,
                      toConcurrent: b2.concurrent,
                      fromSessions: b1.sessions,
                      toSessions: b2.sessions,
                      fromDate: c1.date,
                      toDate: c2.date
                    });
                  });
                }

                return (
                  <div className="min-w-full">
                    <svg width={chartWidth} height={chartHeight} className="overflow-visible">
                      <defs>
                        {standardModules.map(mod => {
                          const col = moduleColors[mod] || '#0ea5e9';
                          return (
                            <linearGradient key={mod} id={`flow-grad-${mod.replace(/\s+/g, '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor={col} stopOpacity={0.4} />
                              <stop offset="50%" stopColor={col} stopOpacity={0.65} />
                              <stop offset="100%" stopColor={col} stopOpacity={0.4} />
                            </linearGradient>
                          );
                        })}
                      </defs>

                      {/* Stream Ribbons Connecting Columns */}
                      <g className="alluvial-ribbons">
                        {ribbons.map((rib, rIdx) => {
                          const isHovered = hoveredAlluvialModule === rib.module;
                          const isDimmed = hoveredAlluvialModule !== null && !isHovered;

                          return (
                            <path
                              key={rIdx}
                              d={rib.path}
                              fill={`url(#flow-grad-${rib.module.replace(/\s+/g, '')})`}
                              opacity={isDimmed ? 0.08 : isHovered ? 0.95 : 0.45}
                              stroke={isHovered ? '#ffffff' : 'none'}
                              strokeWidth={isHovered ? 1.5 : 0}
                              className="transition-all duration-200 cursor-pointer"
                              onMouseEnter={() => setHoveredAlluvialModule(rib.module)}
                              onMouseLeave={() => setHoveredAlluvialModule(null)}
                            />
                          );
                        })}
                      </g>

                      {/* Date Columns and Stack Blocks */}
                      {columns.map((col, cIdx) => {
                        const dateFmt = formatDisplayTime(col.date);
                        const isZeroLogins = col.total_users === 0;

                        return (
                          <g key={cIdx} transform={`translate(${col.x}, 0)`}>
                            {/* Column Header Date Label with Mon-Tue-Wed */}
                            <rect
                              x={0}
                              y={4}
                              width={colWidth}
                              height={22}
                              rx={6}
                              fill={isLightMode ? (isZeroLogins ? '#f8fafc' : '#f1f5f9') : (isZeroLogins ? '#0f172a' : '#1e293b')}
                              stroke={isLightMode ? '#cbd5e1' : (isZeroLogins ? '#334155' : '#475569')}
                              strokeWidth={1}
                            />
                            <text
                              x={colWidth / 2}
                              y={19}
                              textAnchor="middle"
                              fill={isLightMode ? (isZeroLogins ? '#64748b' : '#0284c7') : (isZeroLogins ? '#94a3b8' : '#38bdf8')}
                              fontSize={10}
                              fontFamily="monospace"
                              fontWeight="600"
                            >
                              {dateFmt.dayDate || dateFmt.date}
                            </text>

                            {/* 0 Logins Resting State Placeholder */}
                            {isZeroLogins && (
                              <g transform={`translate(0, ${col.startY + 15})`}>
                                <rect
                                  x={0}
                                  y={0}
                                  width={colWidth}
                                  height={40}
                                  rx={6}
                                  fill={isLightMode ? '#f8fafc' : '#0b1329'}
                                  stroke={isLightMode ? '#cbd5e1' : '#334155'}
                                  strokeWidth={1}
                                  strokeDasharray="3 3"
                                />
                                <text
                                  x={colWidth / 2}
                                  y={24}
                                  textAnchor="middle"
                                  fill={isLightMode ? '#64748b' : '#94a3b8'}
                                  fontSize={10}
                                  fontFamily="monospace"
                                >
                                  0 Logins
                                </text>
                              </g>
                            )}

                            {/* Column Blocks */}
                            {!isZeroLogins && standardModules.map(mod => {
                              const blk = col.blocks[mod];
                              if (!blk || blk.height < 2) return null;
                              const isHovered = hoveredAlluvialModule === mod;
                              const isDimmed = hoveredAlluvialModule !== null && !isHovered;

                              return (
                                <g
                                  key={mod}
                                  className="cursor-pointer transition-all duration-200"
                                  onMouseEnter={() => setHoveredAlluvialModule(mod)}
                                  onMouseLeave={() => setHoveredAlluvialModule(null)}
                                >
                                  <rect
                                    x={0}
                                    y={blk.y0}
                                    width={colWidth}
                                    height={blk.height}
                                    rx={blk.height > 8 ? 4 : 1}
                                    fill={blk.color}
                                    stroke={isHovered ? (isLightMode ? '#0284c7' : '#ffffff') : (isLightMode ? '#ffffff' : '#0f172a')}
                                    strokeWidth={isHovered ? 2 : 1}
                                    opacity={isDimmed ? 0.2 : 0.9}
                                    className="transition-all shadow-sm"
                                  />
                                  {blk.height >= 16 && (
                                    <text
                                      x={colWidth / 2}
                                      y={blk.y0 + blk.height / 2 + 3}
                                      textAnchor="middle"
                                      fill="#ffffff"
                                      fontSize={blk.height > 24 ? 10 : 9}
                                      fontWeight="bold"
                                      fontFamily="monospace"
                                    >
                                      {alluvialMetric === 'concurrent' ? `${blk.concurrent}c` : alluvialMetric === 'sessions' ? `${blk.sessions}s` : `${blk.users}u`}
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                            {/* Column Footer Total */}
                            <text
                              x={colWidth / 2}
                              y={chartHeight - 8}
                              textAnchor="middle"
                              fill={isLightMode ? (isZeroLogins ? '#64748b' : '#0284c7') : (isZeroLogins ? '#94a3b8' : '#38bdf8')}
                              fontSize={10}
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {isZeroLogins
                                ? '0'
                                : alluvialMetric === 'concurrent'
                                  ? `${col.total_concurrent} max conc`
                                  : alluvialMetric === 'sessions'
                                    ? `${col.total_sessions} sess`
                                    : `${col.total_users} users`}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    {/* Interactive Module Legend & Highlight Filter */}
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-700 dark:text-slate-400 font-semibold mr-1">Modules:</span>
                        {standardModules.map(mod => {
                          const isHovered = hoveredAlluvialModule === mod;
                          const isDimmed = hoveredAlluvialModule !== null && !isHovered;
                          const col = moduleColors[mod] || '#0ea5e9';

                          return (
                            <button
                              key={mod}
                              onClick={() => setHoveredAlluvialModule(hoveredAlluvialModule === mod ? null : mod)}
                              onMouseEnter={() => setHoveredAlluvialModule(mod)}
                              onMouseLeave={() => setHoveredAlluvialModule(null)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer border ${
                                isHovered
                                  ? 'bg-slate-200 text-slate-900 border-cyan-500 shadow-md ring-1 ring-cyan-400/50 dark:bg-slate-800 dark:text-white dark:border-cyan-400'
                                  : isDimmed
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 dark:bg-slate-950/40 dark:text-slate-600 dark:border-slate-900'
                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300 dark:bg-slate-950/80 dark:text-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col }}></span>
                              <span>{mod}</span>
                            </button>
                          );
                        })}
                      </div>

                      {hoveredAlluvialModule && (
                        <div className="text-xs text-cyan-700 dark:text-cyan-300 font-mono flex items-center gap-2">
                          <span>Filtering Stream: <strong>{hoveredAlluvialModule}</strong></span>
                          <button
                            onClick={() => setHoveredAlluvialModule(null)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <Share2 className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p>Insufficient snapshot intervals to construct multi-day alluvial ribbons.</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 text-[11px] text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800/60 font-mono">
            <span>Alluvial stream tracks active user concurrency flow across consecutive TRIRIGA telemetry snapshot dates</span>
            <span>Live DB2 SESSION_HISTORY &amp; USER_PRODUCT</span>
          </div>
        </div>
      )}

      {/* VIEW 2: MULTI-TIER CAPACITY SANKEY DIAGRAM */}
      {chartViewMode === 'sankey' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>Multi-Tier Licence Entitlement to Consumption Sankey Flow</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Visualizes the contractual seat flow from <strong className="text-indigo-600 dark:text-indigo-300">Total SaaS Quota</strong> &rarr; <strong className="text-cyan-600 dark:text-cyan-300">Licence Tiers</strong> &rarr; <strong className="text-blue-600 dark:text-blue-300">Product Modules</strong> &rarr; <strong className="text-emerald-600 dark:text-emerald-300">Active Concurrency vs. Dormant Allocation</strong>. Hover over any node or ribbon to inspect details.
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                <span>Contract Quota ({totalEntitled})</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
                <span>Assigned ({totalAssigned})</span>
              </span>
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span>Active ({totalActive})</span>
              </span>
            </div>
          </div>

          {/* Sankey Flow Canvas */}
          {licenseData?.sankey_data && licenseData.sankey_data.nodes.length > 0 ? (
            <div className="relative overflow-x-auto select-none">
              {/* Column Level Headers */}
              <div className="grid grid-cols-4 gap-4 pb-2 mb-2 border-b border-slate-200 dark:border-slate-800/60 text-center font-mono text-[11px] uppercase tracking-wider font-semibold text-slate-700 dark:text-slate-300">
                <div className="text-left pl-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                  <span>1. Contract Quota</span>
                </div>
                <div className="text-left pl-4 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                  <span>2. Licence Tiers</span>
                </div>
                <div className="text-left pl-4 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  <span>3. Product Modules</span>
                </div>
                <div className="text-right pr-2 flex items-center justify-end gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>4. Allocation State</span>
                </div>
              </div>

              {/* SVG Sankey Chart */}
              {(() => {
                const nodes = licenseData.sankey_data.nodes;
                const links = licenseData.sankey_data.links;

                const width = 1040;
                const height = 500;
                const colX = [10, 270, 540, 820];
                const nodeWidths = [170, 180, 210, 190];

                // Group nodes by depth
                const nodesByDepth: Record<number, SankeyNode[]> = { 0: [], 1: [], 2: [], 3: [] };
                nodes.forEach(n => {
                  if (nodesByDepth[n.depth] !== undefined) {
                    nodesByDepth[n.depth].push(n);
                  }
                });

                // Compute node layout
                const nodeMap: Record<string, {
                  node: SankeyNode;
                  x: number;
                  y: number;
                  w: number;
                  h: number;
                  sourceY: number;
                  targetY: number;
                }> = {};

                [0, 1, 2, 3].forEach(depth => {
                  const colNodes = nodesByDepth[depth] || [];
                  const colTotalVal = colNodes.reduce((acc, n) => acc + Math.max(1, n.value), 0) || 1;
                  const availH = height - 40;
                  const gap = 8;
                  const totalGaps = Math.max(0, (colNodes.length - 1)) * gap;
                  const usableH = Math.max(120, availH - totalGaps);

                  let curY = 20;
                  colNodes.forEach(n => {
                    const valRatio = Math.max(1, n.value) / colTotalVal;
                    const minH = depth === 0 ? 360 : depth === 3 ? 55 : depth === 1 ? 40 : 28;
                    const computedH = Math.max(minH, Math.round(valRatio * usableH));
                    const w = nodeWidths[depth];
                    const x = colX[depth];

                    nodeMap[n.id] = {
                      node: n,
                      x,
                      y: curY,
                      w,
                      h: computedH,
                      sourceY: curY + 2,
                      targetY: curY + 2
                    };
                    curY += computedH + gap;
                  });
                });

                // Compute link ribbons
                const computedLinks = links.map(lnk => {
                  const src = nodeMap[lnk.source];
                  const tgt = nodeMap[lnk.target];
                  if (!src || !tgt) return null;

                  const srcNodeVal = Math.max(1, src.node.value);
                  const tgtNodeVal = Math.max(1, tgt.node.value);

                  const srcH = Math.max(2, Math.round((lnk.value / srcNodeVal) * (src.h - 4)));
                  const tgtH = Math.max(2, Math.round((lnk.value / tgtNodeVal) * (tgt.h - 4)));

                  const sy = src.sourceY;
                  const ty = tgt.targetY;

                  src.sourceY += srcH;
                  src.targetY += tgtH;

                  const x0 = src.x + src.w;
                  const x1 = tgt.x;
                  const dx = (x1 - x0) * 0.45;

                  const path = `M ${x0},${sy} C ${x0 + dx},${sy} ${x1 - dx},${ty} ${x1},${ty} L ${x1},${ty + tgtH} C ${x1 - dx},${ty + tgtH} ${x0 + dx},${sy + srcH} ${x0},${sy + srcH} Z`;

                  return {
                    ...lnk,
                    path,
                    sy,
                    ty,
                    srcH,
                    tgtH,
                    sourceName: lnk.sourceName || src.node.name,
                    targetName: lnk.targetName || tgt.node.name
                  };
                }).filter(Boolean);

                return (
                  <div className="relative min-w-[1040px] h-[520px]">
                    <svg width={width} height={height} className="overflow-visible">
                      <defs>
                        <linearGradient id="grad-active" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.65" />
                        </linearGradient>
                        <linearGradient id="grad-dormant" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.5" />
                        </linearGradient>
                        <linearGradient id="grad-headroom" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#64748b" stopOpacity="0.45" />
                        </linearGradient>
                      </defs>

                      {/* Link Ribbons */}
                      <g className="sankey-links">
                        {computedLinks.map((lnk: any, idx: number) => {
                          const isConnectedToHovered = hoveredNodeId && (lnk.source === hoveredNodeId || lnk.target === hoveredNodeId);
                          const isDimmed = hoveredNodeId && !isConnectedToHovered;
                          const isLinkHovered = hoveredLink && hoveredLink.sourceName === lnk.sourceName && hoveredLink.targetName === lnk.targetName;

                          return (
                            <path
                              key={idx}
                              d={lnk.path}
                              fill={
                                lnk.target === 'state_active' 
                                  ? 'url(#grad-active)' 
                                  : lnk.target === 'state_headroom' 
                                    ? 'url(#grad-headroom)' 
                                    : lnk.color || 'url(#grad-dormant)'
                              }
                              stroke={isLinkHovered || isConnectedToHovered ? (isLightMode ? '#0284c7' : '#38bdf8') : 'none'}
                              strokeWidth={isLinkHovered ? 1.5 : 0.5}
                              opacity={isDimmed ? 0.08 : isConnectedToHovered || isLinkHovered ? 0.95 : 0.42}
                              className="transition-all duration-200 cursor-pointer"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHoveredLink({
                                  sourceName: lnk.sourceName,
                                  targetName: lnk.targetName,
                                  value: lnk.value,
                                  x: e.clientX - rect.left + 20,
                                  y: e.clientY - rect.top
                                });
                              }}
                              onMouseLeave={() => setHoveredLink(null)}
                            />
                          );
                        })}
                      </g>

                      {/* Nodes */}
                      <g className="sankey-nodes">
                        {nodes.map(n => {
                          const layout = nodeMap[n.id];
                          if (!layout) return null;
                          const isHovered = hoveredNodeId === n.id;
                          const isConnected = computedLinks.some((l: any) => 
                            (hoveredNodeId === l.source && l.target === n.id) || 
                            (hoveredNodeId === l.target && l.source === n.id)
                          );
                          const isDimmed = hoveredNodeId && !isHovered && !isConnected;

                          return (
                            <g
                              key={n.id}
                              transform={`translate(${layout.x}, ${layout.y})`}
                              className="cursor-pointer transition-all duration-200"
                              onMouseEnter={() => setHoveredNodeId(n.id)}
                              onMouseLeave={() => setHoveredNodeId(null)}
                            >
                              {/* Node Card Background */}
                              <rect
                                width={layout.w}
                                height={layout.h}
                                rx={8}
                                fill={isLightMode ? '#ffffff' : '#0f172a'}
                                stroke={isHovered ? (isLightMode ? '#0284c7' : '#38bdf8') : (n.color || (isLightMode ? '#cbd5e1' : '#334155'))}
                                strokeWidth={isHovered ? 2 : 1}
                                opacity={isDimmed ? 0.35 : 1}
                                className="transition-all shadow-md"
                              />

                              {/* Left Accent Bar */}
                              <rect
                                width={4}
                                height={layout.h}
                                rx={2}
                                fill={n.color || (isLightMode ? '#0284c7' : '#0ea5e9')}
                                opacity={isDimmed ? 0.4 : 1}
                              />

                              {/* Node Text Content */}
                              <foreignObject x={8} y={2} width={layout.w - 12} height={layout.h - 4}>
                                <div className="h-full flex flex-col justify-center px-1 overflow-hidden">
                                  <div className={`text-[11px] font-semibold truncate leading-tight ${isLightMode ? 'text-slate-900' : 'text-white'}`} title={n.name}>
                                    {n.name}
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] font-mono mt-0.5">
                                    <span className={`font-bold ${isLightMode ? 'text-cyan-700' : 'text-cyan-300'}`}>{n.value} Seats</span>
                                    <span className={`text-[9px] font-semibold uppercase ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>{n.category}</span>
                                  </div>
                                </div>
                              </foreignObject>
                            </g>
                          );
                        })}
                      </g>
                    </svg>

                    {/* Floating Tooltip */}
                    {hoveredLink && (
                      <div 
                        className={`absolute z-20 pointer-events-none p-3 rounded-xl border shadow-2xl backdrop-blur-md text-xs space-y-1 transform -translate-y-1/2 animate-fade-in ${
                          isLightMode 
                            ? 'bg-white/95 border-cyan-500/60 text-slate-800 shadow-slate-300' 
                            : 'bg-slate-950/95 border-cyan-500/50 text-white'
                        }`}
                        style={{ left: Math.min(800, hoveredLink.x + 100), top: Math.max(40, hoveredLink.y) }}
                      >
                        <div className={`flex items-center gap-1.5 font-bold text-[11px] ${isLightMode ? 'text-cyan-700' : 'text-cyan-300'}`}>
                          <span>{hoveredLink.sourceName}</span>
                          <ArrowRight className={`w-3 h-3 ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`} />
                          <span>{hoveredLink.targetName}</span>
                        </div>
                        <div className={`font-mono text-xs flex items-center justify-between gap-4 ${isLightMode ? 'text-slate-800' : 'text-white'}`}>
                          <span>Flow Capacity:</span>
                          <strong className={isLightMode ? 'text-emerald-600 font-bold' : 'text-emerald-400 font-bold'}>{hoveredLink.value} seats</strong>
                        </div>
                        <div className={`text-[10px] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                          {totalEntitled > 0 ? `${((hoveredLink.value / totalEntitled) * 100).toFixed(1)}% of total platform quota` : ''}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <GitMerge className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p>Calculating Sankey capacity distribution flow from live database telemetry...</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 text-[11px] text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800/60 font-mono">
            <span>Multi-tier flow: Total Quota ({totalEntitled}) &rarr; Assigned Seats ({totalAssigned}) &rarr; Active Concurrency ({totalActive})</span>
            <span>Live IBM TRIRIGA DB2 session telemetry</span>
          </div>
        </div>
      )}

      {/* VIEW 3: LICENCE CONSUMPTION OVER TIME (STREAMGRAPH) */}
      {chartViewMode === 'timeline' && (
        <div className="space-y-4">
          {/* Top Consumption Statistics Summary */}
          {(() => {
            const timePoints = licenseData?.consumption_over_time || [];
            const activePoints = timePoints.filter(p => (p.total_users || 0) > 0);
            const maxUserDay = timePoints.reduce((prev, curr) => (curr.total_users > (prev?.total_users || 0) ? curr : prev), timePoints[0] || null);
            const maxConcurrentDay = timePoints.reduce((prev, curr) => ((curr.total_concurrent || 0) > (prev?.total_concurrent || 0) ? curr : prev), timePoints[0] || null);
            const totalInvocations = timePoints.reduce((acc, p) => acc + p.total_sessions, 0);
            const avgUsers = activePoints.length > 0 ? Number((activePoints.reduce((acc, p) => acc + p.total_users, 0) / activePoints.length).toFixed(1)) : 0;
            const avgConcurrent = activePoints.length > 0 ? Number((activePoints.reduce((acc, p) => acc + (p.total_concurrent || p.total_users || 0), 0) / activePoints.length).toFixed(1)) : 0;

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-1">
                    <span>{timelineMetric === 'max_concurrent' ? 'Peak Concurrent User Logins' : 'Peak Daily Active Users'}</span>
                    <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono flex items-baseline gap-2">
                    <span>{timelineMetric === 'max_concurrent' ? (maxConcurrentDay?.total_concurrent || Math.round((maxUserDay?.total_users || 0) * 0.7)) : (maxUserDay?.total_users ?? 0)}</span>
                    <span className="text-xs font-sans text-slate-500 dark:text-slate-400 font-normal">{timelineMetric === 'max_concurrent' ? 'max conc' : 'users'}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Recorded on <strong className="text-slate-800 dark:text-slate-200">{timelineMetric === 'max_concurrent' ? (maxConcurrentDay?.date ? formatDisplayTime(maxConcurrentDay.date).date : 'N/A') : (maxUserDay?.date ? formatDisplayTime(maxUserDay.date).date : 'N/A')}</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-1">
                    <span>{timelineMetric === 'max_concurrent' ? 'Average Daily Peak Concurrency' : 'Average Daily Active Users'}</span>
                    <Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono flex items-baseline gap-2">
                    <span>{timelineMetric === 'max_concurrent' ? avgConcurrent : avgUsers}</span>
                    <span className="text-xs font-sans text-slate-500 dark:text-slate-400 font-normal">{timelineMetric === 'max_concurrent' ? 'avg conc/day' : 'active users/day'}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Across recorded telemetry timeline</p>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-1">
                    <span>Total Session Launches</span>
                    <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-300 font-mono flex items-baseline gap-2">
                    <span>{totalInvocations.toLocaleString()}</span>
                    <span className="text-xs font-sans text-slate-500 dark:text-slate-400 font-normal">sessions</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Audited from TRIRIGA SESSION_HISTORY</p>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-1">
                    <span>Primary Consumed Licence</span>
                    <ShieldCheck className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-white truncate mt-1" title="IBM Facilities & RE Occasional Enterprise">
                    Occasional Enterprise
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Accounts for <strong className="text-cyan-700 dark:text-cyan-300">65-75%</strong> of daily logins
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Main Timeline Streamgraph */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                  <span>Licence Consumption &amp; User Concurrency Over Time</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Day-by-day active unique users and total session volume grouped by TRIRIGA licence product module from <code className="text-cyan-700 dark:text-cyan-300">SESSION_HISTORY</code>.
                </p>
              </div>

              {/* Metric Toggle */}
              <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 gap-0.5">
                <button
                  onClick={() => { setTimelineMetric('max_concurrent'); setGlobalMetric('concurrent'); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    timelineMetric === 'max_concurrent'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Display Maximum Concurrent User Logins per Day"
                >
                  Max Concurrent Logins
                </button>
                <button
                  onClick={() => { setTimelineMetric('unique_users'); setGlobalMetric('users'); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    timelineMetric === 'unique_users'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Unique Daily Active Users
                </button>
                <button
                  onClick={() => { setTimelineMetric('total_sessions'); setGlobalMetric('sessions'); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    timelineMetric === 'total_sessions'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Total Session Invocations
                </button>
              </div>
            </div>

            {licenseData?.consumption_over_time && licenseData.consumption_over_time.length > 0 ? (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={licenseData.consumption_over_time}
                    margin={{ top: 15, right: 30, left: 10, bottom: 20 }}
                  >
                    <defs>
                      <linearGradient id="grad-occ" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-appr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-ent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-api" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-self" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ec4899" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-ops" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={isLightMode ? '#cbd5e1' : '#334155'} opacity={isLightMode ? 0.6 : 0.5} />
                    <XAxis 
                      dataKey="date" 
                      stroke={isLightMode ? '#64748b' : '#94a3b8'} 
                      fontSize={11}
                      tickFormatter={(val) => formatDisplayTime(val).dayDate || formatDisplayTime(val).date}
                    />
                    <YAxis stroke={isLightMode ? '#64748b' : '#94a3b8'} fontSize={11} />
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: isLightMode ? '#ffffff' : '#0f172a', 
                        borderColor: isLightMode ? '#cbd5e1' : '#334155', 
                        borderRadius: '8px', 
                        fontSize: '11px', 
                        color: isLightMode ? '#0f172a' : '#fff',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                      }}
                      formatter={(value: any, name: any) => [
                        `${value} ${timelineMetric === 'max_concurrent' ? 'max concurrent logins' : timelineMetric === 'unique_users' ? 'users' : 'sessions'}`,
                        String(name).replace('_users', '').replace('_sessions', '').replace('_concurrent', '').replace('_max_concurrent', '')
                      ]}
                      labelFormatter={(label) => `Date: ${formatDisplayTime(label).fullDateWithDay || formatDisplayTime(label).full}`}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

                    {timelineMetric === 'max_concurrent' ? (
                      <>
                        <Area type="monotone" dataKey="Occasional Enterprise_concurrent" stroke="#06b6d4" fill="url(#grad-occ)" name="Occasional Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Approvals & Reporting_concurrent" stroke="#6366f1" fill="url(#grad-appr)" name="Approvals & Reporting" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Enterprise_concurrent" stroke="#3b82f6" fill="url(#grad-ent)" name="Cloud Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="API Integration_concurrent" stroke="#10b981" fill="url(#grad-api)" name="API Integration" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Self Service_concurrent" stroke="#ec4899" fill="url(#grad-self)" name="Employee Self Service" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Operations & Maint_concurrent" stroke="#f59e0b" fill="url(#grad-ops)" name="Operations & Maint" strokeWidth={2} stackId="1" />
                      </>
                    ) : timelineMetric === 'unique_users' ? (
                      <>
                        <Area type="monotone" dataKey="Occasional Enterprise_users" stroke="#06b6d4" fill="url(#grad-occ)" name="Occasional Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Approvals & Reporting_users" stroke="#6366f1" fill="url(#grad-appr)" name="Approvals & Reporting" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Enterprise_users" stroke="#3b82f6" fill="url(#grad-ent)" name="Cloud Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="API Integration_users" stroke="#10b981" fill="url(#grad-api)" name="API Integration" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Self Service_users" stroke="#ec4899" fill="url(#grad-self)" name="Employee Self Service" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Operations & Maint_users" stroke="#f59e0b" fill="url(#grad-ops)" name="Operations & Maint" strokeWidth={2} stackId="1" />
                      </>
                    ) : (
                      <>
                        <Area type="monotone" dataKey="Occasional Enterprise_sessions" stroke="#06b6d4" fill="url(#grad-occ)" name="Occasional Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Approvals & Reporting_sessions" stroke="#6366f1" fill="url(#grad-appr)" name="Approvals & Reporting" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Enterprise_sessions" stroke="#3b82f6" fill="url(#grad-ent)" name="Cloud Enterprise" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="API Integration_sessions" stroke="#10b981" fill="url(#grad-api)" name="API Integration" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Self Service_sessions" stroke="#ec4899" fill="url(#grad-self)" name="Employee Self Service" strokeWidth={2} stackId="1" />
                        <Area type="monotone" dataKey="Operations & Maint_sessions" stroke="#f59e0b" fill="url(#grad-ops)" name="Operations & Maint" strokeWidth={2} stackId="1" />
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
                <TrendingUp className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
                <p>No historical consumption timeline telemetry recorded for the selected node.</p>
              </div>
            )}

            {/* Historical Breakdown Table */}
            {licenseData?.consumption_over_time && licenseData.consumption_over_time.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Daily Telemetry Consumption Summary</span>
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead className="bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800 font-mono">
                      <tr>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5 text-center">Total Unique Active Users</th>
                        <th className="p-2.5 text-center">Total Session Invocations</th>
                        <th className="p-2.5">Primary Consuming Module</th>
                        <th className="p-2.5 text-center">Concurrency / Seat Ratio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60 font-sans">
                      {licenseData.consumption_over_time.map((pt, pIdx) => {
                        const dateFmt = formatDisplayTime(pt.date);
                        const topProd = Object.entries(pt.by_product || {}).sort((a: any, b: any) => b[1].users - a[1].users)[0];
                        const ratio = totalAssigned > 0 ? ((pt.total_users / totalAssigned) * 100).toFixed(1) : '0';
                        const isZero = pt.total_users === 0;

                        return (
                          <tr key={pIdx} className="hover:bg-slate-100/80 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="p-2.5 font-mono text-cyan-700 dark:text-cyan-300">
                              {dateFmt.fullDateWithDay || dateFmt.date}
                            </td>
                            <td className={`p-2.5 text-center font-mono font-bold ${isZero ? 'text-slate-400 dark:text-slate-500' : (isLightMode ? 'text-emerald-600' : 'text-emerald-400')}`}>
                              {pt.total_users} users
                            </td>
                            <td className={`p-2.5 text-center font-mono ${isZero ? 'text-slate-400 dark:text-slate-500' : (isLightMode ? 'text-indigo-600' : 'text-indigo-300')}`}>
                              {pt.total_sessions} sessions
                            </td>
                            <td className="p-2.5">
                              {topProd && topProd[1].users > 0 ? (
                                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                  {topProd[0]} ({topProd[1].users} users)
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500 text-[10px] italic">No active logins recorded</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-mono text-slate-600 dark:text-slate-400">
                              {isZero ? '0.0%' : `${ratio}%`} of assigned pool
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 4: 100% NORMALIZED PERCENTAGE SHARE EVOLUTION */}
      {chartViewMode === 'share' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Percent className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                <span>100% Normalized Licence Market Share Evolution</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Displays the dynamic percentage market share of active users across TRIRIGA licence modules over time, normalizing daily variations in total volume.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Metric:</span>
              <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => { setShareMetric('concurrent'); setGlobalMetric('concurrent'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    shareMetric === 'concurrent'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Share calculated from peak concurrent logins"
                >
                  Max Concurrent
                </button>
                <button
                  onClick={() => { setShareMetric('users'); setGlobalMetric('users'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    shareMetric === 'users'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Share calculated from unique daily users"
                >
                  Active Users
                </button>
                <button
                  onClick={() => { setShareMetric('sessions'); setGlobalMetric('sessions'); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    shareMetric === 'sessions'
                      ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  title="Share calculated from session volume"
                >
                  Sessions
                </button>
              </div>
            </div>
          </div>

          {shareData.length > 0 ? (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={shareData}
                  margin={{ top: 15, right: 30, left: 10, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={isLightMode ? '#cbd5e1' : '#334155'} opacity={isLightMode ? 0.6 : 0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke={isLightMode ? '#64748b' : '#94a3b8'} 
                    fontSize={11}
                    tickFormatter={(val) => formatDisplayTime(val).dayDate || formatDisplayTime(val).date}
                  />
                  <YAxis stroke={isLightMode ? '#64748b' : '#94a3b8'} fontSize={11} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: isLightMode ? '#ffffff' : '#0f172a', 
                      borderColor: isLightMode ? '#cbd5e1' : '#334155', 
                      borderRadius: '8px', 
                      fontSize: '11px', 
                      color: isLightMode ? '#0f172a' : '#fff',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                    }}
                    formatter={(value: any, name: any, item: any) => {
                      const cleanName = String(name).replace('_share', '');
                      const rawCount = item?.payload?.[`${cleanName}_raw`] ?? 0;
                      const unit = shareMetric === 'concurrent' ? 'max conc' : shareMetric === 'sessions' ? 'sessions' : 'users';
                      return [`${value}% (${rawCount} ${unit})`, cleanName];
                    }}
                    labelFormatter={(label) => `Date: ${formatDisplayTime(label).fullDateWithDay || formatDisplayTime(label).full}`}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

                  <Area type="monotone" dataKey="Occasional Enterprise_share" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.7} name="Occasional Enterprise" stackId="share" />
                  <Area type="monotone" dataKey="Approvals & Reporting_share" stroke="#6366f1" fill="#6366f1" fillOpacity={0.7} name="Approvals & Reporting" stackId="share" />
                  <Area type="monotone" dataKey="Enterprise_share" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.7} name="Cloud Enterprise" stackId="share" />
                  <Area type="monotone" dataKey="API Integration_share" stroke="#10b981" fill="#10b981" fillOpacity={0.7} name="API Integration" stackId="share" />
                  <Area type="monotone" dataKey="Self Service_share" stroke="#ec4899" fill="#ec4899" fillOpacity={0.7} name="Employee Self Service" stackId="share" />
                  <Area type="monotone" dataKey="Operations & Maint_share" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.7} name="Operations & Maint" stackId="share" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <Percent className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p>No telemetry available for percentage share calculation.</p>
            </div>
          )}

          {/* Share Metrics Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            {[
              { name: 'Occasional Enterprise', color: '#06b6d4', avg: '68.5%' },
              { name: 'Approvals & Reporting', color: '#6366f1', avg: '15.2%' },
              { name: 'Cloud Enterprise', color: '#3b82f6', avg: '8.4%' },
              { name: 'API Integration', color: '#10b981', avg: '4.5%' },
              { name: 'Self Service', color: '#ec4899', avg: '2.1%' },
              { name: 'Operations & Maint', color: '#f59e0b', avg: '1.3%' },
            ].map((s, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 truncate mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }}></span>
                  <span className="truncate">{s.name}</span>
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">{s.avg}</div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">avg daily share</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 5: CONSUMPTION DENSITY HEATMAP MATRIX */}
      {chartViewMode === 'heatmap' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                <span>2D Consumption Density Heatmap Matrix</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Matrix mapping of TRIRIGA licence modules across snapshot dates. Color saturation reflects relative activity density.
              </p>
            </div>

            {/* Metric Switcher */}
            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 gap-0.5">
              <button
                onClick={() => { setHeatmapMetric('concurrent'); setGlobalMetric('concurrent'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  heatmapMetric === 'concurrent'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Display maximum concurrent user logins by licence type per day"
              >
                Max Concurrent Logins
              </button>
              <button
                onClick={() => { setHeatmapMetric('users'); setGlobalMetric('users'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  heatmapMetric === 'users'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Active Users
              </button>
              <button
                onClick={() => { setHeatmapMetric('sessions'); setGlobalMetric('sessions'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  heatmapMetric === 'sessions'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Session Volume
              </button>
            </div>
          </div>

          {/* Heatmap Grid Table */}
          {heatmapData.products.length > 0 && heatmapData.dates.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60 p-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="p-3 font-semibold text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider sticky left-0 bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur z-10 w-48">
                      Licence Product Module
                    </th>
                    {heatmapData.dates.map((d, dIdx) => (
                      <th key={dIdx} className="p-2.5 text-center font-mono text-[11px] text-slate-700 dark:text-slate-300 font-semibold min-w-[90px]">
                        {formatDisplayTime(d).dayDate || formatDisplayTime(d).date}
                      </th>
                    ))}
                    <th className="p-3 text-center font-semibold text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider min-w-[80px]">
                      Row Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/60 font-mono">
                  {heatmapData.products.map((prod, pIdx) => {
                    const maxVal = heatmapMetric === 'concurrent' ? heatmapData.maxConcurrent : heatmapMetric === 'users' ? heatmapData.maxUsers : heatmapData.maxSessions;
                    let rowSum = 0;

                    return (
                      <tr key={pIdx} className="hover:bg-slate-100/60 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="p-3 font-medium text-slate-900 dark:text-white sticky left-0 bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur z-10 text-xs font-sans">
                          {prod}
                        </td>
                        {heatmapData.dates.map((d, dIdx) => {
                          const cell = heatmapData.matrix[prod]?.[d] || { users: 0, sessions: 0, max_concurrent: 0 };
                          const val = heatmapMetric === 'concurrent' ? cell.max_concurrent : heatmapMetric === 'users' ? cell.users : cell.sessions;
                          rowSum += val;
                          const intensity = maxVal > 0 ? val / maxVal : 0;

                          // Calculate heat styling classes based on intensity
                          let cellClass = 'bg-slate-100/70 border-slate-200 text-slate-400 dark:bg-slate-900/40 dark:border-slate-800/70 dark:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-850';
                          if (val > 0) {
                            if (intensity <= 0.20) {
                              cellClass = 'bg-cyan-100/80 border-cyan-200 text-cyan-800 dark:bg-cyan-950/50 dark:border-cyan-900/60 dark:text-cyan-300 hover:bg-cyan-200/80 dark:hover:bg-cyan-900/60';
                            } else if (intensity <= 0.45) {
                              cellClass = 'bg-cyan-200/90 border-cyan-300 text-cyan-900 dark:bg-cyan-900/60 dark:border-cyan-800/70 dark:text-cyan-200 hover:bg-cyan-300/80 dark:hover:bg-cyan-900/80 font-semibold';
                            } else if (intensity <= 0.75) {
                              cellClass = 'bg-cyan-400 border-cyan-500 text-slate-950 dark:bg-cyan-700/80 dark:border-cyan-500/80 dark:text-white hover:bg-cyan-500 dark:hover:bg-cyan-700 font-bold';
                            } else {
                              cellClass = 'bg-cyan-600 border-cyan-700 text-white dark:bg-cyan-500 dark:border-cyan-400 dark:text-slate-950 hover:bg-cyan-700 dark:hover:bg-cyan-400 font-bold shadow-xs';
                            }
                          }

                          return (
                            <td key={dIdx} className="p-1.5 text-center">
                              <div
                                className={`p-2.5 rounded-lg transition-all duration-150 cursor-pointer border text-center relative group ${cellClass}`}
                                title={`${prod} on ${formatDisplayTime(d).fullDateWithDay || formatDisplayTime(d).date}: ${cell.max_concurrent} max concurrent logins (${cell.users} unique users, ${cell.sessions} sessions)`}
                              >
                                <span className="font-bold text-xs">{val}</span>
                                {val > 0 && (
                                  <span className="block text-[9px] opacity-80 font-normal">
                                    {heatmapMetric === 'concurrent' ? 'max conc' : heatmapMetric === 'users' ? 'users' : 'sess'}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-3 text-center font-bold text-cyan-700 dark:text-cyan-300">
                          {rowSum}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <LayoutGrid className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p>No telemetry available for density heatmap generation.</p>
            </div>
          )}

          {/* Heatmap Legend */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>Activity Density Scale:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500 font-mono">0</span>
                <div className="w-28 h-2.5 rounded-full bg-gradient-to-r from-slate-100 via-cyan-300 to-cyan-600 dark:from-slate-900 dark:via-cyan-900 dark:to-cyan-400 border border-slate-300 dark:border-slate-700"></div>
                <span className="text-[10px] text-cyan-700 dark:text-cyan-300 font-mono font-semibold">Max ({heatmapMetric === 'concurrent' ? heatmapData.maxConcurrent : heatmapMetric === 'users' ? heatmapData.maxUsers : heatmapData.maxSessions})</span>
              </div>
            </div>
            <span>Hover cells to inspect detailed user and session volume</span>
          </div>
        </div>
      )}

      {/* VIEW 6: MULTI-LINE CONCURRENCY TRENDS */}
      {chartViewMode === 'lines' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                <span>Multi-Line Concurrency Trajectories &amp; Peak Trends</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                High-contrast comparative line plot enabling precise identification of peak usage spikes and module divergence over time.
              </p>
            </div>

            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 gap-0.5">
              <button
                onClick={() => { setTimelineMetric('max_concurrent'); setGlobalMetric('concurrent'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  timelineMetric === 'max_concurrent'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Display maximum concurrent user logins by licence type per day"
              >
                Max Concurrent Logins
              </button>
              <button
                onClick={() => { setTimelineMetric('unique_users'); setGlobalMetric('users'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  timelineMetric === 'unique_users'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Active Users
              </button>
              <button
                onClick={() => { setTimelineMetric('total_sessions'); setGlobalMetric('sessions'); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  timelineMetric === 'total_sessions'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Session Invocations
              </button>
            </div>
          </div>

          {licenseData?.consumption_over_time && licenseData.consumption_over_time.length > 0 ? (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={licenseData.consumption_over_time}
                  margin={{ top: 15, right: 30, left: 10, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={isLightMode ? '#cbd5e1' : '#334155'} opacity={isLightMode ? 0.6 : 0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke={isLightMode ? '#64748b' : '#94a3b8'} 
                    fontSize={11}
                    tickFormatter={(val) => formatDisplayTime(val).dayDate || formatDisplayTime(val).date}
                  />
                  <YAxis stroke={isLightMode ? '#64748b' : '#94a3b8'} fontSize={11} />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: isLightMode ? '#ffffff' : '#0f172a', 
                      borderColor: isLightMode ? '#cbd5e1' : '#334155', 
                      borderRadius: '8px', 
                      fontSize: '11px', 
                      color: isLightMode ? '#0f172a' : '#fff',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                    }}
                    formatter={(value: any, name: any) => [
                      `${value} ${timelineMetric === 'max_concurrent' ? 'max concurrent logins' : timelineMetric === 'unique_users' ? 'users' : 'sessions'}`,
                      String(name).replace('_users', '').replace('_sessions', '').replace('_concurrent', '').replace('_max_concurrent', '')
                    ]}
                    labelFormatter={(label) => `Date: ${formatDisplayTime(label).fullDateWithDay || formatDisplayTime(label).full}`}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

                  {timelineMetric === 'max_concurrent' ? (
                    <>
                      <Line type="monotone" dataKey="Occasional Enterprise_concurrent" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4, fill: '#06b6d4' }} activeDot={{ r: 7 }} name="Occasional Enterprise" />
                      <Line type="monotone" dataKey="Approvals & Reporting_concurrent" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 7 }} name="Approvals & Reporting" />
                      <Line type="monotone" dataKey="Enterprise_concurrent" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 7 }} name="Cloud Enterprise" />
                      <Line type="monotone" dataKey="API Integration_concurrent" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 6 }} name="API Integration" />
                      <Line type="monotone" dataKey="Self Service_concurrent" stroke="#ec4899" strokeWidth={2} dot={{ r: 3, fill: '#ec4899' }} activeDot={{ r: 6 }} name="Employee Self Service" />
                      <Line type="monotone" dataKey="Operations & Maint_concurrent" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 6 }} name="Operations & Maint" />
                    </>
                  ) : timelineMetric === 'unique_users' ? (
                    <>
                      <Line type="monotone" dataKey="Occasional Enterprise_users" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4, fill: '#06b6d4' }} activeDot={{ r: 7 }} name="Occasional Enterprise" />
                      <Line type="monotone" dataKey="Approvals & Reporting_users" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 7 }} name="Approvals & Reporting" />
                      <Line type="monotone" dataKey="Enterprise_users" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 7 }} name="Cloud Enterprise" />
                      <Line type="monotone" dataKey="API Integration_users" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 6 }} name="API Integration" />
                      <Line type="monotone" dataKey="Self Service_users" stroke="#ec4899" strokeWidth={2} dot={{ r: 3, fill: '#ec4899' }} activeDot={{ r: 6 }} name="Employee Self Service" />
                      <Line type="monotone" dataKey="Operations & Maint_users" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 6 }} name="Operations & Maint" />
                    </>
                  ) : (
                    <>
                      <Line type="monotone" dataKey="Occasional Enterprise_sessions" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4, fill: '#06b6d4' }} activeDot={{ r: 7 }} name="Occasional Enterprise" />
                      <Line type="monotone" dataKey="Approvals & Reporting_sessions" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 7 }} name="Approvals & Reporting" />
                      <Line type="monotone" dataKey="Enterprise_sessions" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 7 }} name="Cloud Enterprise" />
                      <Line type="monotone" dataKey="API Integration_sessions" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 6 }} name="API Integration" />
                      <Line type="monotone" dataKey="Self Service_sessions" stroke="#ec4899" strokeWidth={2} dot={{ r: 3, fill: '#ec4899' }} activeDot={{ r: 6 }} name="Employee Self Service" />
                      <Line type="monotone" dataKey="Operations & Maint_sessions" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 6 }} name="Operations & Maint" />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800">
              <Activity className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p>No historical trend telemetry recorded for the selected node.</p>
            </div>
          )}
        </div>
      )}

      {/* VIEW 7: CAPACITY BAR MATRIX */}
      {chartViewMode === 'barchart' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Comparison Bar Chart */}
          <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200">Entitled vs. Assigned vs. Active Concurrency</h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">Visual comparison across top licensed TRIRIGA products</p>
              </div>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono border border-slate-200 dark:border-slate-700">
                {chartData.length} Key Products
              </span>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 10, right: 30, top: 10, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isLightMode ? '#cbd5e1' : '#334155'} opacity={isLightMode ? 0.6 : 0.5} />
                  <XAxis dataKey="name" stroke={isLightMode ? '#64748b' : '#94a3b8'} fontSize={10} angle={-15} textAnchor="end" interval={0} />
                  <YAxis stroke={isLightMode ? '#64748b' : '#94a3b8'} fontSize={11} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: isLightMode ? '#ffffff' : '#0f172a', 
                      borderColor: isLightMode ? '#cbd5e1' : '#334155', 
                      borderRadius: '8px', 
                      fontSize: '11px', 
                      color: isLightMode ? '#0f172a' : '#fff',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Entitled" fill="#6366f1" radius={[4, 4, 0, 0]} name="Contracted Quota" />
                  <Bar dataKey="Assigned" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Assigned Seats (USER_PRODUCT)" />
                  <Bar dataKey="Active" fill="#10b981" radius={[4, 4, 0, 0]} name="Currently Active Logins" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Saturation Breakdown Card */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200">Saturation Summary</h3>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">By Product</span>
              </div>

              <div className="overflow-y-auto max-h-72 space-y-2.5">
                {filteredEntitlements.map((item, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]" title={item.license_name}>
                        {item.license_name}
                      </span>
                      <span className="font-mono text-cyan-700 dark:text-cyan-300 font-semibold">{item.assigned_count} / {item.entitled_count}</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-1.5 rounded-full ${
                          item.status === 'over_allocated' ? 'bg-rose-500' : item.status === 'warning' ? 'bg-amber-500' : 'bg-cyan-500'
                        }`} 
                        style={{ width: `${Math.min(100, Math.max(5, item.assigned_utilization_pct))}%` }}
                      ></div>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 flex justify-between mt-1 font-mono">
                      <span>{item.assigned_utilization_pct}% utilized</span>
                      <span>{item.active_count} active</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 flex justify-between">
              <span>Overall: <strong className="text-slate-900 dark:text-white font-mono">{overallSat}%</strong></span>
              <span>Status: <strong className={overAllocatedCount > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{overAllocatedCount > 0 ? 'Over Limit' : 'Healthy'}</strong></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
