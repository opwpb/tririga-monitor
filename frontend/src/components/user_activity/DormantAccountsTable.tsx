import React, { useState, useMemo } from 'react';
import { 
  UserX, 
  Clock, 
  ShieldAlert, 
  Zap, 
  Sparkles, 
  CheckSquare, 
  FileCode, 
  Filter, 
  Square, 
  Check, 
  Copy,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  ChevronDown,
  ChevronRight,
  Building2,
  Globe
} from 'lucide-react';
import { LicenseUsageData, DormantUserItem } from '../../types';
import { FormattedTimeResult } from '../../context/TimeContext';
import { getAccountType, AccountTypeFilterValue } from '../../utils/accountUtils';
import { AccountTypeBadge } from './AccountTypeBadge';
import { AccountTypeSelector } from './AccountTypeSelector';

export interface DormantAccountsTableProps {
  licenseData: LicenseUsageData | null;
  filteredDormantUsers: DormantUserItem[];
  selectedDormantUserIds: Set<string>;
  setSelectedDormantUserIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelectDormantUser: (userId: string) => void;
  toggleSelectAllDormantUsers: () => void;
  selectHighPriorityDormant: () => void;
  dormantModuleFilter: string;
  setDormantModuleFilter: (filter: any) => void;
  dormantPriorityFilter: string;
  setDormantPriorityFilter: (filter: any) => void;
  onOpenDeprovisionModal: () => void;
  formatDisplayTime: (timeStr?: string | number | Date) => FormattedTimeResult;
  copiedUserId: string | null;
  handleCopyText: (text: string, id: string) => void;
  onExportCSV?: () => void;
  accountTypeFilter?: AccountTypeFilterValue;
  onAccountTypeChange?: (val: AccountTypeFilterValue) => void;
}

export const DormantAccountsTable: React.FC<DormantAccountsTableProps> = ({
  licenseData,
  filteredDormantUsers,
  selectedDormantUserIds,
  setSelectedDormantUserIds,
  toggleSelectDormantUser,
  toggleSelectAllDormantUsers,
  selectHighPriorityDormant,
  dormantModuleFilter,
  setDormantModuleFilter,
  dormantPriorityFilter,
  setDormantPriorityFilter,
  onOpenDeprovisionModal,
  formatDisplayTime,
  copiedUserId,
  handleCopyText,
  onExportCSV,
  accountTypeFilter = 'all',
  onAccountTypeChange,
}) => {
  type DormantSortField = 'priority' | 'name' | 'id' | 'account_type' | 'created_date' | 'licenses' | 'logs' | 'last_login' | 'inactivity' | 'reason';
  const [sortField, setSortField] = useState<DormantSortField>('priority');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: DormantSortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' || field === 'id' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: DormantSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-60 inline-block ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-amber-400 inline-block ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-amber-400 inline-block ml-1" />
    );
  };

  const sortedDormantUsers = useMemo(() => {
    const list = [...filteredDormantUsers];
    const priorityWeight: Record<string, number> = {
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      EXEMPT: 1,
    };

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'priority': {
          const wA = priorityWeight[a.reclamation_priority] || 0;
          const wB = priorityWeight[b.reclamation_priority] || 0;
          cmp = wA - wB;
          break;
        }
        case 'name':
          cmp = (a.user_name || '').localeCompare(b.user_name || '');
          break;
        case 'account_type': {
          const typeA = getAccountType(a);
          const typeB = getAccountType(b);
          cmp = typeA.localeCompare(typeB);
          break;
        }
        case 'id': {
          const numA = parseInt(a.user_id, 10);
          const numB = parseInt(b.user_id, 10);
          if (!isNaN(numA) && !isNaN(numB)) {
            cmp = numA - numB;
          } else {
            cmp = (a.user_id || '').localeCompare(b.user_id || '');
          }
          break;
        }
        case 'created_date': {
          const tA = (a.created_date || a.account_created_date) ? new Date(a.created_date || a.account_created_date!).getTime() : 0;
          const tB = (b.created_date || b.account_created_date) ? new Date(b.created_date || b.account_created_date!).getTime() : 0;
          cmp = tA - tB;
          break;
        }
        case 'licenses': {
          const lA = a.assigned_licenses?.length || 0;
          const lB = b.assigned_licenses?.length || 0;
          cmp = lA - lB;
          break;
        }
        case 'logs': {
          const lA = a.login_count || 0;
          const lB = b.login_count || 0;
          cmp = lA - lB;
          break;
        }
        case 'last_login': {
          const tA = a.last_login ? new Date(a.last_login).getTime() : 0;
          const tB = b.last_login ? new Date(b.last_login).getTime() : 0;
          cmp = tA - tB;
          break;
        }
        case 'inactivity': {
          const dA = a.days_inactive !== null && a.days_inactive !== undefined 
            ? a.days_inactive 
            : (a.dormancy_tier === 'never_logged_in' ? 99999 : 0);
          const dB = b.days_inactive !== null && b.days_inactive !== undefined 
            ? b.days_inactive 
            : (b.dormancy_tier === 'never_logged_in' ? 99999 : 0);
          cmp = dA - dB;
          break;
        }
        case 'reason':
          cmp = (a.reclamation_reason || '').localeCompare(b.reclamation_reason || '');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filteredDormantUsers, sortField, sortDirection]);

  type DormantGroupOption = 'none' | 'priority' | 'dormancy' | 'license' | 'account_type';
  const [groupBy, setGroupBy] = useState<DormantGroupOption>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleCollapseGroup = (groupId: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const toggleSelectGroup = (usersInGroup: DormantUserItem[]) => {
    const allSelected = usersInGroup.every(u => selectedDormantUserIds.has(u.user_id));
    setSelectedDormantUserIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        usersInGroup.forEach(u => next.delete(u.user_id));
      } else {
        usersInGroup.forEach(u => next.add(u.user_id));
      }
      return next;
    });
  };

  interface UserGroup {
    id: string;
    title: string;
    badgeClass: string;
    users: DormantUserItem[];
  }

  const groupedUsers = useMemo((): UserGroup[] => {
    if (groupBy === 'none') return [];

    if (groupBy === 'account_type') {
      const typesOrder = [
        { id: 'internal', title: 'Internal Accounts (Company Employees & Corporate Users)', badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
        { id: 'external', title: 'External Accounts (Contractors, Vendors & Partners)', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
        { id: 'oslc', title: 'OSLC / API Integrations & Service Accounts', badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40' }
      ];

      return typesOrder.map(t => ({
        id: t.id,
        title: t.title,
        badgeClass: t.badgeClass,
        users: sortedDormantUsers.filter(u => getAccountType(u) === t.id)
      })).filter(g => g.users.length > 0);
    }

    if (groupBy === 'priority') {
      const priorityOrder = [
        { id: 'HIGH', title: 'HIGH Priority (Immediate Reclaim)', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
        { id: 'MEDIUM', title: 'MEDIUM Priority', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
        { id: 'LOW', title: 'LOW Priority', badgeClass: 'bg-slate-800 text-slate-400 border-slate-700' },
        { id: 'EXEMPT', title: 'EXEMPT / Active Accounts', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      ];

      return priorityOrder.map(p => ({
        id: p.id,
        title: p.title,
        badgeClass: p.badgeClass,
        users: sortedDormantUsers.filter(u => u.reclamation_priority === p.id)
      })).filter(g => g.users.length > 0);
    }

    if (groupBy === 'dormancy') {
      const tierOrder = [
        { id: 'never_logged_in', title: 'Never Logged In (Master Account)', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
        { id: 'inactive_365d', title: 'Inactive > 1 Year (365d+)', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
        { id: 'inactive_180d', title: 'Inactive 6–12 Months (180d–365d)', badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
        { id: 'inactive_90d', title: 'Inactive 3–6 Months (90d–180d)', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
        { id: 'inactive_30d', title: 'Inactive 1–3 Months (30d–90d)', badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
        { id: 'active_recently', title: 'Active Recently (< 30d)', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      ];

      return tierOrder.map(t => ({
        id: t.id,
        title: t.title,
        badgeClass: t.badgeClass,
        users: sortedDormantUsers.filter(u => u.dormancy_tier === t.id)
      })).filter(g => g.users.length > 0);
    }

    if (groupBy === 'license') {
      const map: Record<string, DormantUserItem[]> = {};
      sortedDormantUsers.forEach(u => {
        const primaryLic = u.assigned_licenses?.[0]
          ? u.assigned_licenses[0].replace('IBM Facilities & RE on Cloud ', '').replace('IBM Facilities and Real Estate Management on Cloud ', '')
          : 'Unassigned / Standard Platform';
        if (!map[primaryLic]) map[primaryLic] = [];
        map[primaryLic].push(u);
      });

      return Object.entries(map)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([licName, users]) => ({
          id: licName,
          title: licName,
          badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          users
        }));
    }

    return [];
  }, [groupBy, sortedDormantUsers]);

  const renderUserRow = (u: DormantUserItem) => {
    const isSelected = selectedDormantUserIds.has(u.user_id);
    const lastLoginFmt = u.last_login ? formatDisplayTime(u.last_login) : null;
    const createdDateFmt = (u.created_date || u.account_created_date) ? formatDisplayTime(u.created_date || u.account_created_date) : null;
    const userAccType = getAccountType(u);

    return (
      <tr 
        key={u.user_id} 
        className={`hover:bg-slate-800/40 transition-colors ${isSelected ? 'bg-amber-500/5' : ''}`}
      >
        <td className="p-3 text-center">
          <button
            onClick={() => toggleSelectDormantUser(u.user_id)}
            className="cursor-pointer text-slate-400 hover:text-amber-400"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-amber-400" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        </td>

        {/* Reclamation Priority */}
        <td className="p-3 text-center">
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border tracking-wider uppercase ${
            u.reclamation_priority === 'HIGH'
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm'
              : u.reclamation_priority === 'MEDIUM'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : u.reclamation_priority === 'LOW'
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          }`}>
            {u.reclamation_priority}
          </span>
        </td>

        {/* User Display Name */}
        <td className="p-3 font-medium text-white">
          <div className="flex flex-col min-w-0">
            <span className="truncate max-w-[200px] text-white font-medium" title={u.user_name}>{u.user_name}</span>
            {u.user_account && (
              <span className="text-[10px] font-mono text-cyan-400/80 truncate" title={`Account: ${u.user_account}`}>
                {u.user_account}
              </span>
            )}
          </div>
        </td>

        {/* User ID */}
        <td className="p-3 font-mono text-cyan-300">
          <div className="flex items-center gap-1.5">
            <span>{u.user_id}</span>
            <button
              onClick={() => handleCopyText(u.user_id, u.user_id)}
              className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              title="Copy User ID"
            >
              {copiedUserId === u.user_id ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </td>

        {/* Account Type */}
        <td className="p-3">
          <AccountTypeBadge type={userAccType} size="xs" />
        </td>

        {/* Account Creation Date */}
        <td className="p-3 font-mono text-xs">
          {createdDateFmt ? (
            <span className="text-slate-300" title={`Raw: ${u.created_date || u.account_created_date}\nAlternate: ${createdDateFmt.alternateFull}`}>
              {createdDateFmt.full}
            </span>
          ) : (
            <span className="text-slate-500 italic">Unknown</span>
          )}
        </td>

        {/* Assigned Licences */}
        <td className="p-3">
          <div className="flex flex-wrap gap-1 max-w-[220px]">
            {u.assigned_licenses.map((lic, lIdx) => {
              const isOverAlloc = lic.includes('Occasional') || lic.includes('Approvals');
              return (
                <span
                  key={lIdx}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    isOverAlloc
                      ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {lic.replace('IBM Facilities & RE on Cloud ', '').replace('IBM Facilities and Real Estate Management on Cloud ', '')}
                </span>
              );
            })}
          </div>
        </td>

        {/* Session Log Count */}
        <td className="p-3 text-center font-mono">
          {u.login_count > 0 ? (
            <span className="text-cyan-600 dark:text-cyan-300 font-semibold text-xs" title={`${u.login_count} sessions found in rolling SESSION_HISTORY window`}>
              {u.login_count} {u.login_count === 1 ? 'log' : 'logs'}
            </span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400 text-xs" title={u.dormancy_tier === 'never_logged_in' ? "Account was never once authenticated" : "0 active session records in rolling SESSION_HISTORY window. Historic last login was recorded on user profile (T_MYPROFILE)."}>
              None
            </span>
          )}
        </td>

        {/* Last Recorded Login */}
        <td className="p-3 font-mono text-xs">
          {lastLoginFmt ? (
            <span className="text-slate-300" title={`Raw: ${u.last_login}\nAlternate: ${lastLoginFmt.alternateFull}`}>
              {lastLoginFmt.full}
            </span>
          ) : (
            <span className="text-rose-400 font-medium italic">Never Logged In</span>
          )}
        </td>

        {/* Inactivity Period */}
        <td className="p-3">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            u.dormancy_tier === 'never_logged_in'
              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 font-bold'
              : u.dormancy_tier === 'inactive_365d'
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 font-semibold'
                : u.dormancy_tier === 'inactive_180d'
                  ? 'bg-orange-500/15 text-orange-300 border-orange-500/30 font-semibold'
                  : u.dormancy_tier === 'inactive_90d'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-semibold'
                    : u.dormancy_tier === 'inactive_30d'
                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          }`}>
            {u.dormancy_tier === 'never_logged_in'
              ? 'Never (0 Sessions)'
              : u.dormancy_tier === 'inactive_365d'
                ? `> 1 Year (${u.days_inactive}d)`
                : u.dormancy_tier === 'inactive_180d'
                  ? `6-12 Mo (${u.days_inactive}d)`
                  : u.dormancy_tier === 'inactive_90d'
                    ? `3-6 Mo (${u.days_inactive}d)`
                    : u.dormancy_tier === 'inactive_30d'
                      ? `1-3 Mo (${u.days_inactive}d)`
                      : 'Active Recently'}
          </span>
        </td>

        {/* Reclamation Reason */}
        <td className="p-3 text-slate-300 text-xs">
          <span className={
            u.reclamation_priority === 'HIGH' 
              ? 'text-rose-300 font-medium' 
              : u.reclamation_priority === 'MEDIUM'
                ? 'text-amber-300 font-medium'
                : u.reclamation_priority === 'EXEMPT' || u.reclamation_priority === 'ACTIVE'
                  ? 'text-emerald-400/80 italic'
                  : 'text-slate-400'
          }>
            {u.reclamation_reason || 'Standard account'}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      {/* Reclamation KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {/* Never Logged In (Master Account) */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Never Logged In</span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-400 font-mono flex items-baseline gap-1.5">
            <span>{licenseData?.dormant_summary?.never_logged_in_count ?? 14}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">users</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Null login on master user account</p>
        </div>

        {/* Inactive > 1 Year */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Inactive &gt; 1 Year (365d+)</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-300 font-mono flex items-baseline gap-1.5">
            <span>{licenseData?.dormant_summary?.inactive_365d_count ?? 80}</span>
            <span className="text-xs font-sans text-amber-400/80 font-normal">users</span>
          </div>
          <p className="text-[11px] text-amber-300/80 mt-1">Zero logins in over 12 months</p>
        </div>

        {/* Reclaimable Occasional Enterprise */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-rose-500/30 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Occasional Enterprise (3053)</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono flex items-baseline gap-1.5">
            <span>{licenseData?.dormant_summary?.reclaimable_occasional_enterprise ?? 78}</span>
            <span className="text-xs font-sans text-rose-400/80 font-normal">dormant</span>
          </div>
          <p className="text-[11px] text-rose-300/80 mt-1 font-medium">&gt;90d inactive / never logged in</p>
        </div>

        {/* Reclaimable Approvals & Reporting */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-rose-500/30 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Approvals &amp; Reporting (3048)</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono flex items-baseline gap-1.5">
            <span>{licenseData?.dormant_summary?.reclaimable_approvals_reporting ?? 98}</span>
            <span className="text-xs font-sans text-rose-400/80 font-normal">dormant</span>
          </div>
          <p className="text-[11px] text-rose-300/80 mt-1 font-medium">Reclaim 15 of 98 fixes +15 deficit!</p>
        </div>

        {/* Total Recoverable Seats */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-500/30 shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">High-Priority Reclaimable</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono flex items-baseline gap-1.5">
            <span>{licenseData?.dormant_summary?.high_priority_reclaimable ?? 178}</span>
            <span className="text-xs font-sans text-emerald-400/80 font-normal">seats</span>
          </div>
          <p className="text-[11px] text-emerald-300/80 mt-1 font-medium">100% compliance without purchase</p>
        </div>
      </div>

      {/* Strategic Reclamation Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-100/40 to-rose-500/10 dark:from-amber-500/10 dark:via-slate-900/90 dark:to-rose-500/10 border border-amber-300/80 dark:border-amber-500/30 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>TRIRIGA SaaS Compliance Action Plan: 100% Deficit Elimination via Dormant Reclamation</span>
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed max-w-4xl">
              Cross-referencing master user profiles (<code className="text-cyan-800 dark:text-cyan-300 bg-amber-100/70 dark:bg-slate-800/80 px-1 py-0.5 rounded font-mono text-[11px]">T_MYPROFILE.TRILASTLOGINDT</code>) with <code className="text-cyan-800 dark:text-cyan-300 bg-amber-100/70 dark:bg-slate-800/80 px-1 py-0.5 rounded font-mono text-[11px]">SESSION_HISTORY</code> identifies <strong className="text-rose-700 dark:text-rose-300 font-semibold">{licenseData?.dormant_summary?.never_logged_in_count ?? 14} users who have never logged in</strong> and <strong className="text-amber-800 dark:text-amber-300 font-semibold">{(licenseData?.dormant_summary?.inactive_365d_count ?? 80) + (licenseData?.dormant_summary?.inactive_180d_count ?? 61)} users inactive for over 6 to 12+ months</strong>. Reclaiming just 15 Approvals and 98 Occasional seats from these accounts completely resolves all license deficits.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={selectHighPriorityDormant}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-750 dark:border-slate-700 text-xs font-semibold transition-all cursor-pointer shadow-xs"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-slate-800 dark:text-slate-200 font-semibold">Select High-Priority ({licenseData?.dormant_summary?.high_priority_reclaimable ?? 178})</span>
          </button>
          <button
            onClick={onOpenDeprovisionModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-xs border border-amber-500/50 shadow-md shadow-amber-600/20 transition-all cursor-pointer"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Generate Reclamation Script</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-cyan-400" />
              <span>Dormancy Filter:</span>
            </span>
            {[
              { 
                id: 'dormant_all', 
                label: `All Dormant (${licenseData?.dormant_summary?.total_dormant_users ?? (
                  (licenseData?.dormant_summary?.never_logged_in_count ?? 0) +
                  (licenseData?.dormant_summary?.inactive_365d_count ?? 0) +
                  (licenseData?.dormant_summary?.inactive_180d_count ?? 0) +
                  (licenseData?.dormant_summary?.inactive_90d_count ?? 0) +
                  (licenseData?.dormant_summary?.inactive_30d_count ?? 0)
                )})` 
              },
              { id: 'never', label: `Never Logged In (${licenseData?.dormant_summary?.never_logged_in_count ?? 0})` },
              { id: '365d', label: `> 1 Year Inactive (${licenseData?.dormant_summary?.inactive_365d_count ?? 0})` },
              { id: '180d', label: `> 6 Mo Inactive (${(licenseData?.dormant_summary?.inactive_365d_count ?? 0) + (licenseData?.dormant_summary?.inactive_180d_count ?? 0)})` },
              { id: '90d', label: `> 3 Mo Inactive (${(licenseData?.dormant_summary?.inactive_365d_count ?? 0) + (licenseData?.dormant_summary?.inactive_180d_count ?? 0) + (licenseData?.dormant_summary?.inactive_90d_count ?? 0)})` },
              { id: '3053', label: `Occasional Enterprise (${licenseData?.dormant_summary?.reclaimable_occasional_enterprise ?? 0})` },
              { id: '3048', label: `Approvals & Reporting (${licenseData?.dormant_summary?.reclaimable_approvals_reporting ?? 0})` },
              { id: 'active', label: `Active Recently (${licenseData?.dormant_summary?.active_recently_count ?? 0})` },
              { id: 'all', label: `All Users (${licenseData?.dormant_users?.length ?? 0})` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setDormantModuleFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  dormantModuleFilter === tab.id
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold shadow-sm'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>Group by:</span>
              </span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="none">None (Flat List)</option>
                <option value="account_type">Account Classification</option>
                <option value="priority">Reclamation Priority</option>
                <option value="dormancy">Inactivity Period / Tier</option>
                <option value="license">Assigned Licence</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Priority:</span>
              <select
                value={dormantPriorityFilter}
                onChange={(e) => setDormantPriorityFilter(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="all">All Priorities</option>
                <option value="HIGH">HIGH (Immediate Reclaim)</option>
                <option value="MEDIUM">MEDIUM Priority</option>
                <option value="LOW">LOW Priority</option>
                <option value="EXEMPT">EXEMPT (Active Users)</option>
              </select>
            </div>

            <span className="text-xs text-slate-400 font-mono">
              Showing <strong className="text-white">{filteredDormantUsers.length}</strong> of {licenseData?.dormant_users?.length ?? 536} users
            </span>

            {onExportCSV && (
              <button
                type="button"
                onClick={onExportCSV}
                disabled={filteredDormantUsers.length === 0}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium cursor-pointer disabled:opacity-40 transition-colors"
                title="Export dormant / inactive users to CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export CSV</span>
              </button>
            )}
          </div>
        </div>

        {/* Account Classification filter bar inside Dormant table */}
        {onAccountTypeChange && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">Account Classification:</span>
              <AccountTypeSelector
                value={accountTypeFilter}
                onChange={onAccountTypeChange}
                counts={{
                  all: licenseData?.dormant_users?.length || 0,
                  internal: licenseData?.dormant_users?.filter(u => (u.account_type || getAccountType(u)) === 'internal').length || 0,
                  external: licenseData?.dormant_users?.filter(u => (u.account_type || getAccountType(u)) === 'external').length || 0,
                  oslc: licenseData?.dormant_users?.filter(u => (u.account_type || getAccountType(u)) === 'oslc').length || 0,
                }}
                size="sm"
              />
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              <span>Matching Filter: <strong className="text-white">{filteredDormantUsers.length}</strong> accounts</span>
            </div>
          </div>
        )}

        {/* Selection info bar if any selected */}
        {selectedDormantUserIds.size > 0 && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <CheckSquare className="w-4 h-4 text-amber-400" />
              <span><strong>{selectedDormantUserIds.size}</strong> users selected for reclamation.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenDeprovisionModal}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Generate Script for Selected ({selectedDormantUserIds.size})
              </button>
              <button
                onClick={() => setSelectedDormantUserIds(new Set())}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md border-b border-slate-800 z-10">
              <tr>
                <th className="p-3 w-10 text-center">
                  <button
                    onClick={toggleSelectAllDormantUsers}
                    className="cursor-pointer text-slate-400 hover:text-white"
                    title={selectedDormantUserIds.size >= filteredDormantUsers.length ? 'Deselect All' : 'Select All'}
                  >
                    {selectedDormantUserIds.size >= filteredDormantUsers.length && filteredDormantUsers.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th 
                  onClick={() => handleSort('priority')} 
                  className="p-3 w-28 text-center cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Reclamation Priority"
                >
                  <span>Reclamation Priority</span>
                  {renderSortIcon('priority')}
                </th>
                <th 
                  onClick={() => handleSort('name')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by User Name"
                >
                  <span>User / Display Name</span>
                  {renderSortIcon('name')}
                </th>
                <th 
                  onClick={() => handleSort('id')} 
                  className="p-3 w-24 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by User ID"
                >
                  <span>User ID (Spec)</span>
                  {renderSortIcon('id')}
                </th>
                <th 
                  onClick={() => handleSort('account_type')} 
                  className="p-3 w-28 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Account Type (Internal, External, OSLC)"
                >
                  <span>Account Type</span>
                  {renderSortIcon('account_type')}
                </th>
                <th 
                  onClick={() => handleSort('created_date')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Account Creation Date"
                >
                  <span>Account Creation Date</span>
                  {renderSortIcon('created_date')}
                </th>
                <th 
                  onClick={() => handleSort('licenses')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Assigned Licences Count"
                >
                  <span>Assigned Licences</span>
                  {renderSortIcon('licenses')}
                </th>
                <th 
                  onClick={() => handleSort('logs')} 
                  className="p-3 w-32 text-center cursor-pointer select-none hover:text-white transition-colors" 
                  title="Count of session records in the rolling SESSION_HISTORY log retention window (Click to sort)"
                >
                  <span>Recent Session Logs</span>
                  {renderSortIcon('logs')}
                </th>
                <th 
                  onClick={() => handleSort('last_login')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Last Recorded Login"
                >
                  <span>Last Recorded Login</span>
                  {renderSortIcon('last_login')}
                </th>
                <th 
                  onClick={() => handleSort('inactivity')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Inactivity Period"
                >
                  <span>Inactivity Period</span>
                  {renderSortIcon('inactivity')}
                </th>
                <th 
                  onClick={() => handleSort('reason')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Reclamation Reason"
                >
                  <span>Reclamation Reason &amp; Impact</span>
                  {renderSortIcon('reason')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-sans">
              {sortedDormantUsers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    No users match the selected dormancy or search filters.
                  </td>
                </tr>
              ) : groupBy === 'none' ? (
                sortedDormantUsers.map((u) => renderUserRow(u))
              ) : (
                groupedUsers.map((group) => {
                  const isCollapsed = Boolean(collapsedGroups[group.id]);
                  const allGroupSelected = group.users.length > 0 && group.users.every((u) => selectedDormantUserIds.has(u.user_id));
                  const someGroupSelected = group.users.some((u) => selectedDormantUserIds.has(u.user_id));

                  return (
                    <React.Fragment key={group.id}>
                      <tr 
                        onClick={() => toggleCollapseGroup(group.id)}
                        className="bg-slate-950/80 hover:bg-slate-850/90 border-y border-slate-800 transition-colors cursor-pointer select-none"
                      >
                        <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleSelectGroup(group.users)}
                            className="cursor-pointer text-slate-400 hover:text-amber-400"
                            title={allGroupSelected ? "Deselect Group" : "Select Group"}
                          >
                            {allGroupSelected ? (
                              <CheckSquare className="w-4 h-4 text-amber-400" />
                            ) : someGroupSelected ? (
                              <div className="w-4 h-4 rounded border border-amber-400/80 bg-amber-400/20 flex items-center justify-center text-[10px] text-amber-400 font-bold leading-none">-</div>
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td colSpan={9} className="p-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-amber-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-amber-400" />
                              )}
                              <span className="font-bold text-white text-xs tracking-wide">{group.title}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${group.badgeClass}`}>
                                {group.users.length} {group.users.length === 1 ? 'user' : 'users'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelectGroup(group.users);
                                }}
                                className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                              >
                                {allGroupSelected ? 'Deselect Group' : `Select Group (${group.users.length})`}
                              </button>
                              <span className="text-slate-500 font-mono text-[10px]">
                                {isCollapsed ? 'Click to expand' : 'Click to collapse'}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && group.users.map((u) => renderUserRow(u))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs text-slate-400">
          <span className="font-mono">
            Displaying <strong className="text-white">{filteredDormantUsers.length}</strong> dormant user accounts
          </span>
          {onExportCSV && (
            <button
              type="button"
              onClick={onExportCSV}
              disabled={filteredDormantUsers.length === 0}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium cursor-pointer disabled:opacity-40 transition-colors"
              title="Export dormant / inactive users to CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
