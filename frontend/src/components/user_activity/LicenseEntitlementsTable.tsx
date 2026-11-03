import React, { useState } from 'react';
import { 
  Layers, 
  ShieldCheck, 
  Zap, 
  AlertTriangle, 
  RefreshCw, 
  ChevronDown, 
  ChevronRight, 
  Users,
  Download,
  Building2,
  Globe 
} from 'lucide-react';
import { LicenseUsageData, LicenseEntitlementItem } from '../../types';
import { useTimeContext } from '../../context/TimeContext';
import { getAccountType, AccountTypeFilterValue } from '../../utils/accountUtils';
import { AccountTypeBadge } from './AccountTypeBadge';
import { AccountTypeSelector } from './AccountTypeSelector';

export interface LicenseEntitlementsTableProps {
  licenseData: LicenseUsageData | null;
  loading: boolean;
  filteredEntitlements: LicenseEntitlementItem[];
  entitlementTierFilter: 'all' | 'PAID_CONTRACTED' | 'FREE_PLATFORM' | 'PAID_UNLICENSED';
  setEntitlementTierFilter: (tier: 'all' | 'PAID_CONTRACTED' | 'FREE_PLATFORM' | 'PAID_UNLICENSED') => void;
  expandedProductIds: Record<string, boolean>;
  toggleExpandProduct: (productId: number | string) => void;
  onExportCSV?: () => void;
  accountTypeFilter?: AccountTypeFilterValue;
  onAccountTypeChange?: (val: AccountTypeFilterValue) => void;
}

export const LicenseEntitlementsTable: React.FC<LicenseEntitlementsTableProps> = ({
  licenseData,
  loading,
  filteredEntitlements,
  entitlementTierFilter,
  setEntitlementTierFilter,
  expandedProductIds,
  toggleExpandProduct,
  onExportCSV,
  accountTypeFilter = 'all',
  onAccountTypeChange,
}) => {
  const { formatDisplayTime } = useTimeContext();
  const [assignedUserSort, setAssignedUserSort] = useState<'recency' | 'name_asc' | 'name_desc' | 'id'>('recency');
  const [drawerAccountFilters, setDrawerAccountFilters] = useState<Record<string, AccountTypeFilterValue>>({});

  return (
    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Licence Entitlements vs. Actual Licence Usage Matrix ({filteredEntitlements.length} Products)</span>
          </h2>
          <p className="text-xs text-slate-400">
            Detailed audit comparing paid contract subscriptions, complimentary platform entitlements, and unentitled legacy paid modules.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-slate-400">Compliant</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span className="text-slate-400">Warning (85-99%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400"></span>
            <span className="text-slate-400">Over-Allocated / Unlicensed</span>
          </div>
          {onExportCSV && (
            <button
              type="button"
              onClick={onExportCSV}
              disabled={filteredEntitlements.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium cursor-pointer disabled:opacity-40 transition-colors"
              title="Export license entitlements vs usage to CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-TIER KPI OVERVIEW CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Card 1: Paid Contracted Subscriptions */}
        <div 
          onClick={() => setEntitlementTierFilter(entitlementTierFilter === 'PAID_CONTRACTED' ? 'all' : 'PAID_CONTRACTED')}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            entitlementTierFilter === 'PAID_CONTRACTED' 
              ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-500' 
              : 'bg-slate-950/60 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/80'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>Paid Contract Subscriptions</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              4 Licences
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-xl font-bold font-mono text-white">
                {licenseData?.summary?.paid_contracted_assigned ?? 530}
              </span>
              <span className="text-xs text-slate-400 font-mono ml-1">
                / {licenseData?.summary?.paid_contracted_entitled ?? 1425} Seats
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-rose-400 font-mono">
                {licenseData?.summary?.paid_contracted_over_allocated ?? 2} Over-allocated
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Enterprise (25), Occasional (200), Approvals (200), and Self-Service (1,000 / 200 packs × 5).
          </p>
        </div>

        {/* Card 2: Complimentary / Free Platform Licences */}
        <div 
          onClick={() => setEntitlementTierFilter(entitlementTierFilter === 'FREE_PLATFORM' ? 'all' : 'FREE_PLATFORM')}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            entitlementTierFilter === 'FREE_PLATFORM' 
              ? 'bg-cyan-950/40 border-cyan-500 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500' 
              : 'bg-slate-950/60 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-900/80'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Free / Platform Integrations</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              3 Licences
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-xl font-bold font-mono text-white">
                {licenseData?.summary?.free_platform_assigned ?? 12}
              </span>
              <span className="text-xs text-cyan-400 font-mono ml-1">
                Assignments
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-emerald-400 font-mono">
                Included / Free
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Application Platform (#3017), API Integration (#3021), and Connectors (#3047).
          </p>
        </div>

        {/* Card 3: Unlicensed Paid Modules */}
        <div 
          onClick={() => setEntitlementTierFilter(entitlementTierFilter === 'PAID_UNLICENSED' ? 'all' : 'PAID_UNLICENSED')}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            entitlementTierFilter === 'PAID_UNLICENSED' 
              ? 'bg-rose-950/40 border-rose-500 shadow-lg shadow-rose-950/40 ring-1 ring-rose-500' 
              : 'bg-slate-950/60 border-slate-800 hover:border-rose-500/50 hover:bg-slate-900/80'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Unlicensed Paid Modules (0 Quota)</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
              {licenseData?.summary?.unlicensed_paid_modules_count ?? 5} Modules
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-xl font-bold font-mono text-rose-300">
                {licenseData?.summary?.unlicensed_paid_assigned ?? 5}
              </span>
              <span className="text-xs text-slate-400 font-mono ml-1">
                Assigned (0 Quota)
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-rose-400 font-mono">
                Compliance Notice
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Legacy modules (RE, Facilities, Ops, Projects, TREES) held solely by user @system.
          </p>
        </div>
      </div>

      {/* TIER FILTER PILLS */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs font-semibold text-slate-400">Filter by Tier:</span>
        <button
          onClick={() => setEntitlementTierFilter('all')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            entitlementTierFilter === 'all'
              ? 'bg-cyan-600 text-white font-semibold'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
        >
          All Licences ({licenseData?.license_entitlements?.length ?? 12})
        </button>
        <button
          onClick={() => setEntitlementTierFilter('PAID_CONTRACTED')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            entitlementTierFilter === 'PAID_CONTRACTED'
              ? 'bg-indigo-600 text-white font-semibold'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
        >
          Paid Subscriptions (4)
        </button>
        <button
          onClick={() => setEntitlementTierFilter('FREE_PLATFORM')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            entitlementTierFilter === 'FREE_PLATFORM'
              ? 'bg-cyan-600 text-white font-semibold'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
        >
          Free / Platform (3)
        </button>
        <button
          onClick={() => setEntitlementTierFilter('PAID_UNLICENSED')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            entitlementTierFilter === 'PAID_UNLICENSED'
              ? 'bg-rose-600 text-white font-semibold'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
        >
          Unlicensed Paid Modules ({licenseData?.summary?.unlicensed_paid_modules_count ?? 5})
        </button>
      </div>

      {loading && !licenseData ? (
        <div className="py-16 text-center text-xs text-cyan-400 bg-slate-800/30 rounded-xl border border-slate-800 flex flex-col items-center justify-center gap-2 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
          <p>Calculating license entitlement quotas and active concurrency metrics...</p>
        </div>
      ) : filteredEntitlements.length > 0 ? (
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md border-b border-slate-800">
              <tr>
                <th className="p-3 w-8"></th>
                <th className="p-3">Licence Product Name</th>
                <th className="p-3 w-36">Tier & Category</th>
                <th className="p-3 w-28 text-center">Entitled Quota</th>
                <th className="p-3 w-24 text-center">Assigned Seats</th>
                <th className="p-3 w-24 text-center">Active Concurrency</th>
                <th className="p-3 w-24 text-center">Headroom</th>
                <th className="p-3 w-48">Entitlement Saturation</th>
                <th className="p-3 w-32 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredEntitlements.map((item) => {
                const isExpanded = Boolean(expandedProductIds[String(item.product_id)]);
                const isPaid = item.tier_type === 'PAID_CONTRACTED';
                const isFree = item.tier_type === 'FREE_PLATFORM';
                const isUnlicensed = item.tier_type === 'PAID_UNLICENSED';
                const isOver = item.status === 'over_allocated';
                const isWarn = item.status === 'warning';

                return (
                  <React.Fragment key={item.product_id}>
                    <tr 
                      onClick={() => toggleExpandProduct(item.product_id)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      <td className="p-3 text-center text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </td>
                      <td className="p-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <span>{item.license_name}</span>
                          <span className="text-[10px] font-mono text-slate-500">#{item.product_id}</span>
                        </div>
                        {item.account_type_counts && (item.account_type_counts.internal > 0 || item.account_type_counts.external > 0 || item.account_type_counts.oslc > 0) && (
                          <div className="flex items-center gap-1 mt-1 font-mono text-[9px]">
                            {item.account_type_counts.internal > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20" title={`${item.account_type_counts.internal} Internal Accounts`}>
                                <Building2 className="w-2.5 h-2.5" />
                                <span>{item.account_type_counts.internal} Int</span>
                              </span>
                            )}
                            {item.account_type_counts.external > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20" title={`${item.account_type_counts.external} External Accounts`}>
                                <Globe className="w-2.5 h-2.5" />
                                <span>{item.account_type_counts.external} Ext</span>
                              </span>
                            )}
                            {item.account_type_counts.oslc > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20" title={`${item.account_type_counts.oslc} OSLC / API Integrations`}>
                                <Zap className="w-2.5 h-2.5" />
                                <span>{item.account_type_counts.oslc} OSLC</span>
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-400 text-xs">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            isPaid 
                              ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' 
                              : isFree 
                                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' 
                                : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          }`}>
                            {isPaid ? 'Paid Subscription' : isFree ? 'Free / Platform' : '0 Quota Paid'}
                          </span>
                          <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                            {item.category || 'Standard Product'}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-xs">
                        {isPaid ? (
                          <span className="text-indigo-300 font-bold">{item.entitled_count}</span>
                        ) : isFree ? (
                          <span className="text-cyan-400 font-medium text-[11px]">Free / Inc.</span>
                        ) : (
                          <span className="text-rose-400 font-bold">0 (No Quota)</span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-white text-xs">
                        {item.assigned_count}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-emerald-400 text-xs">
                        {item.active_count}
                      </td>
                      <td className="p-3 text-center font-mono font-semibold text-xs">
                        {isPaid ? (
                          <span className={item.available_count === 0 ? 'text-rose-400' : 'text-slate-300'}>
                            {item.available_count}
                          </span>
                        ) : isFree ? (
                          <span className="text-cyan-400 text-[11px]">Included</span>
                        ) : (
                          <span className="text-rose-400 font-bold">0</span>
                        )}
                      </td>
                      <td className="p-3">
                        {isPaid ? (
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                              <span className={isOver ? 'text-rose-300 font-bold' : isWarn ? 'text-amber-300 font-bold' : 'text-slate-300'}>
                                {item.assigned_utilization_pct}%
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {item.assigned_count} / {item.entitled_count}
                              </span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                              <div 
                                className={`h-2 rounded-full transition-all ${
                                  isOver ? 'bg-rose-500' : isWarn ? 'bg-amber-500' : 'bg-cyan-500'
                                }`} 
                                style={{ width: `${Math.min(100, item.assigned_utilization_pct)}%` }}
                              ></div>
                            </div>
                          </div>
                        ) : isFree ? (
                          <div className="text-[11px] text-cyan-400/90 font-mono">
                            Included Platform Access
                          </div>
                        ) : (
                          <div className="text-[11px] text-rose-400 font-mono font-semibold">
                            100% Unlicensed ({item.assigned_count} seat held)
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border uppercase tracking-wider inline-flex items-center gap-1 ${
                          isOver
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : isWarn
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : isFree
                                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                : isUnlicensed
                                  ? 'bg-rose-500/25 text-rose-300 border-rose-500/50 font-bold'
                                  : item.status === 'under_utilized'
                                    ? 'bg-slate-800 text-slate-400 border-slate-700'
                                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}>
                          {isOver ? 'Over-Allocated' : isWarn ? 'Warning' : isFree ? 'Complimentary' : isUnlicensed ? 'Unlicensed Risk' : item.status === 'under_utilized' ? 'Low Usage' : 'Compliant'}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded User Details for this License */}
                    {isExpanded && (() => {
                      const currentAccountFilter = drawerAccountFilters[String(item.product_id)] || 'all';
                      const allAssigned = item.assigned_users || [];
                      const drawerCounts = {
                        all: allAssigned.length,
                        internal: allAssigned.filter(u => (u.account_type || getAccountType(u)) === 'internal').length,
                        external: allAssigned.filter(u => (u.account_type || getAccountType(u)) === 'external').length,
                        oslc: allAssigned.filter(u => (u.account_type || getAccountType(u)) === 'oslc').length,
                      };

                      const filteredAssignedUsers = allAssigned.filter(u => {
                        if (currentAccountFilter === 'all') return true;
                        const userAccType = u.account_type || getAccountType(u);
                        return userAccType === currentAccountFilter;
                      });

                      const sortedAssignedUsers = [...filteredAssignedUsers].sort((a, b) => {
                        if (assignedUserSort === 'name_asc') {
                          return (a.user_name || '').localeCompare(b.user_name || '');
                        }
                        if (assignedUserSort === 'name_desc') {
                          return (b.user_name || '').localeCompare(a.user_name || '');
                        }
                        if (assignedUserSort === 'id') {
                          const numA = parseInt(String(a.user_id), 10);
                          const numB = parseInt(String(b.user_id), 10);
                          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                          return String(a.user_id || '').localeCompare(String(b.user_id || ''));
                        }

                        // Default: 'recency'
                        // 1. Currently active first
                        if (a.is_active && !b.is_active) return -1;
                        if (!a.is_active && b.is_active) return 1;

                        // 2. Recency of access
                        const dateA = a.last_access_time || a.last_login;
                        const dateB = b.last_access_time || b.last_login;
                        const timeA = dateA ? new Date(dateA).getTime() : 0;
                        const timeB = dateB ? new Date(dateB).getTime() : 0;
                        if (timeA !== timeB) {
                          return timeB - timeA;
                        }

                        // 3. Alphabetical tie-breaker
                        return (a.user_name || '').localeCompare(b.user_name || '');
                      });

                      const activeCountInList = sortedAssignedUsers.filter(u => u.is_active).length;

                      return (
                        <tr className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
                          <td colSpan={9} className="p-4">
                            <div className="space-y-3">
                              <div className="flex flex-col lg:flex-row lg:items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-800 gap-2">
                                <span className="flex items-center gap-2 flex-wrap">
                                  <Users className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                                  <span>Assigned Users for {item.license_name} ({sortedAssignedUsers.length} of {allAssigned.length})</span>
                                  {activeCountInList > 0 && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-bold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                      <span>{activeCountInList} currently active</span>
                                    </span>
                                  )}
                                </span>
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                  <AccountTypeSelector
                                    value={currentAccountFilter}
                                    onChange={(val) => setDrawerAccountFilters(prev => ({ ...prev, [String(item.product_id)]: val }))}
                                    counts={drawerCounts}
                                    size="xs"
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <span>Sort:</span>
                                    <select
                                      value={assignedUserSort}
                                      onChange={(e) => setAssignedUserSort(e.target.value as any)}
                                      className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded px-2 py-0.5 text-[11px] focus:outline-none cursor-pointer"
                                    >
                                      <option value="recency">Logged In First &rarr; Recency</option>
                                      <option value="name_asc">Name (A &rarr; Z)</option>
                                      <option value="name_desc">Name (Z &rarr; A)</option>
                                      <option value="id">User ID</option>
                                    </select>
                                  </div>
                                  <span>Active Concurrency: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{item.active_concurrency_pct}%</strong></span>
                                </div>
                              </div>

                              {sortedAssignedUsers.length > 0 ? (
                                <div className="max-h-80 overflow-y-auto pr-1">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pt-1">
                                    {sortedAssignedUsers.map((usr, uIdx) => {
                                      const accessDate = usr.last_access_time || usr.last_login;
                                      const accessFmt = accessDate ? formatDisplayTime(accessDate) : null;
                                      const accType = usr.account_type || getAccountType(usr);

                                      return (
                                        <div 
                                          key={uIdx} 
                                          className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                                            usr.is_active 
                                              ? 'bg-emerald-50/90 dark:bg-emerald-950/25 border-emerald-300 dark:border-emerald-500/40 shadow-xs ring-1 ring-emerald-400/30' 
                                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2.5 truncate min-w-0">
                                            <div className="relative shrink-0">
                                              <div 
                                                className={`w-2.5 h-2.5 rounded-full ${
                                                  usr.is_active 
                                                    ? 'bg-emerald-500 ring-4 ring-emerald-400/20 animate-pulse' 
                                                    : accessDate 
                                                      ? 'bg-slate-400 dark:bg-slate-500' 
                                                      : 'bg-slate-300 dark:bg-slate-700'
                                                }`} 
                                              />
                                            </div>
                                            <div className="truncate min-w-0">
                                              <div className="flex items-center gap-1.5">
                                                <span className="font-semibold text-slate-900 dark:text-white truncate" title={usr.user_name}>
                                                  {usr.user_name}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono leading-tight">
                                                <AccountTypeBadge type={accType} size="xs" />
                                                {usr.is_active ? (
                                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">Active</span>
                                                ) : accessFmt ? (
                                                  <span className="text-slate-500 dark:text-slate-400 truncate">
                                                    {accessFmt.dayDate || accessFmt.date}
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400 dark:text-slate-500 italic truncate">Never logged in</span>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                          <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-300 shrink-0 ml-2 font-semibold">
                                            #{usr.user_id}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500 italic">No assigned user records matching criteria.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-12 text-center text-xs text-slate-400 bg-slate-850/50 rounded-xl border border-slate-800">
          <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p>No license entitlements match the selected tier and search criteria.</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500 border-t border-slate-800/60">
        <span>Showing {filteredEntitlements.length} product license matrices</span>
        <span>Contract Quotas: Enterprise (25), Occasional (200), Approvals (200), Self-Service (1,000 = 200 × 5)</span>
      </div>
    </div>
  );
};
