import React, { useState, useMemo } from 'react';
import { 
  Users, 
  Layers, 
  Clock, 
  RefreshCw, 
  Globe, 
  Copy, 
  Check, 
  UserCheck,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  Globe,
  Zap
} from 'lucide-react';
import { LoggedInUser, LicenseUsageData } from '../../types';
import { FormattedTimeResult } from '../../context/TimeContext';
import { getAccountType, AccountTypeFilterValue } from '../../utils/accountUtils';
import { AccountTypeBadge } from './AccountTypeBadge';
import { AccountTypeSelector } from './AccountTypeSelector';

interface ActiveUsersTableProps {
  filteredLoggedInUsers: LoggedInUser[];
  selectedServerInfo: { name: string; isCluster: boolean; host: string };
  loading: boolean;
  licenseData: LicenseUsageData | null;
  timeMode: 'server' | 'local';
  toggleTimeMode: () => void;
  localTzInfo: { shortTz: string; fullTz: string; offsetStr?: string };
  lastRefreshed: Date | null;
  formatDisplayTime: (isoOrRaw?: string | null) => FormattedTimeResult;
  userFilter: string;
  setActiveTab: (tab: 'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant') => void;
  copiedUserId: string | number | null;
  handleCopyText: (text: string, id: string | number) => void;
  onExportCSV?: () => void;
  accountTypeFilter?: AccountTypeFilterValue;
  onAccountTypeChange?: (val: AccountTypeFilterValue) => void;
}

export const ActiveUsersTable: React.FC<ActiveUsersTableProps> = ({
  filteredLoggedInUsers,
  selectedServerInfo,
  loading,
  licenseData,
  timeMode,
  toggleTimeMode,
  localTzInfo,
  lastRefreshed,
  formatDisplayTime,
  userFilter,
  setActiveTab,
  copiedUserId,
  handleCopyText,
  onExportCSV,
  accountTypeFilter = 'all',
  onAccountTypeChange,
}) => {
  type ActiveSortField = 'name' | 'id' | 'account_type' | 'login_time' | 'touch_time' | 'host' | 'ip' | 'licenses';
  const [sortField, setSortField] = useState<ActiveSortField>('touch_time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: ActiveSortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' || field === 'id' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: ActiveSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-60 inline-block ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-cyan-400 inline-block ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-cyan-400 inline-block ml-1" />
    );
  };

  const sortedUsers = useMemo(() => {
    const list = [...filteredLoggedInUsers];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
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
          const numA = parseInt(String(a.user_id), 10);
          const numB = parseInt(String(b.user_id), 10);
          if (!isNaN(numA) && !isNaN(numB)) {
            cmp = numA - numB;
          } else {
            cmp = String(a.user_id || '').localeCompare(String(b.user_id || ''));
          }
          break;
        }
        case 'login_time': {
          const tA = a.login_time ? new Date(a.login_time).getTime() : 0;
          const tB = b.login_time ? new Date(b.login_time).getTime() : 0;
          cmp = tA - tB;
          break;
        }
        case 'touch_time': {
          const tA = a.last_access_time ? new Date(a.last_access_time).getTime() : 0;
          const tB = b.last_access_time ? new Date(b.last_access_time).getTime() : 0;
          cmp = tA - tB;
          break;
        }
        case 'host':
          cmp = String(a.host_name || a.host_addr || '').localeCompare(String(b.host_name || b.host_addr || ''));
          break;
        case 'ip':
          cmp = String(a.ip_address || '').localeCompare(String(b.ip_address || ''));
          break;
        case 'licenses': {
          const lA = a.assigned_licenses?.length || 0;
          const lB = b.assigned_licenses?.length || 0;
          cmp = lA - lB;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filteredLoggedInUsers, sortField, sortDirection]);

  // Account counts for active users
  const activeCounts = useMemo(() => {
    const raw = licenseData?.logged_in_users || [];
    return {
      all: raw.length,
      internal: raw.filter(u => getAccountType(u) === 'internal').length,
      external: raw.filter(u => getAccountType(u) === 'external').length,
      oslc: raw.filter(u => getAccountType(u) === 'oslc').length,
    };
  }, [licenseData?.logged_in_users]);

  // Filter recent historical sessions for the empty state preview
  const previewSessions = useMemo(() => {
    if (!licenseData?.recent_sessions) return [];
    let list = licenseData.recent_sessions;
    if (accountTypeFilter !== 'all') {
      list = list.filter(s => (s.account_type || getAccountType(s)) === accountTypeFilter);
    }
    if (userFilter.trim()) {
      const q = userFilter.toLowerCase();
      list = list.filter(s => {
        const name = String(s.SPEC_NAME || s.spec_name || s.user_name || '').toLowerCase();
        const id = String(s.USER_ID || s.user_id || '').toLowerCase();
        return name.includes(q) || id.includes(q);
      });
    }
    return list;
  }, [licenseData?.recent_sessions, accountTypeFilter, userFilter]);

  return (
    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-400" />
            <span>Currently Logged In Platform Users ({filteredLoggedInUsers.length})</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Live from ACTIVE_SESSION_USER
            </span>
          </h2>
          <p className="text-xs text-slate-400">
            Real-time active user sessions on <strong className="text-slate-200">{selectedServerInfo.name}</strong> correlated with assigned licence product entitlements from USER_PRODUCT.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
          <button
            onClick={toggleTimeMode}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer text-xs"
            title="Toggle Server Time (UTC) vs Local Time"
          >
            {timeMode === 'server' ? <Globe className="w-3.5 h-3.5 text-cyan-400" /> : <Clock className="w-3.5 h-3.5 text-indigo-400" />}
            <span>Display: <strong className="text-cyan-300">{timeMode === 'server' ? 'Server (UTC)' : `Local (${localTzInfo.shortTz})`}</strong></span>
          </button>
          <span>
            Refreshed: <strong className="text-white">{lastRefreshed ? formatDisplayTime(lastRefreshed.toISOString()).time : 'Pending'}</strong>
          </span>
          {onExportCSV && (
            <button
              type="button"
              onClick={onExportCSV}
              disabled={filteredLoggedInUsers.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium cursor-pointer disabled:opacity-40 transition-colors"
              title="Export currently logged-in users to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Account Type Filter Quick Pills */}
      {onAccountTypeChange && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">Filter by Account:</span>
            <AccountTypeSelector
              value={accountTypeFilter}
              onChange={onAccountTypeChange}
              counts={activeCounts}
              size="sm"
            />
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            <span>Showing <strong className="text-white">{filteredLoggedInUsers.length}</strong> of {activeCounts.all} active</span>
          </div>
        </div>
      )}

      {loading && !licenseData ? (
        <div className="py-16 text-center text-xs text-emerald-400 bg-slate-800/30 rounded-xl border border-slate-800 flex flex-col items-center justify-center gap-2 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <p>Auditing live user sessions and active logins from TRIRIGA ACTIVE_SESSION_USER...</p>
        </div>
      ) : filteredLoggedInUsers.length > 0 ? (
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md border-b border-slate-800">
              <tr>
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
                  <span>User ID</span>
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
                  onClick={() => handleSort('login_time')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Login Timestamp"
                >
                  <span>Login Timestamp ({timeMode === 'server' ? 'UTC' : localTzInfo.shortTz})</span>
                  {renderSortIcon('login_time')}
                </th>
                <th 
                  onClick={() => handleSort('touch_time')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Last Active Touch"
                >
                  <span>Last Active Touch</span>
                  {renderSortIcon('touch_time')}
                </th>
                <th 
                  onClick={() => handleSort('host')} 
                  className="p-3 w-24 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Node / Host"
                >
                  <span>Node / Host</span>
                  {renderSortIcon('host')}
                </th>
                <th 
                  onClick={() => handleSort('ip')} 
                  className="p-3 w-28 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Client IP"
                >
                  <span>Client IP</span>
                  {renderSortIcon('ip')}
                </th>
                <th 
                  onClick={() => handleSort('licenses')} 
                  className="p-3 cursor-pointer select-none hover:text-white transition-colors"
                  title="Click to sort by Assigned Licences Count"
                >
                  <span>Assigned Licence Entitlements</span>
                  {renderSortIcon('licenses')}
                </th>
                <th className="p-3 w-20 text-center">Session</th>
                <th className="p-3 w-16 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {sortedUsers.map((user, idx) => {
                const loginFmt = formatDisplayTime(user.login_time);
                const touchFmt = formatDisplayTime(user.last_access_time);
                const userAccType = user.account_type || getAccountType(user);

                return (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    {/* User Info */}
                    <td className="p-3 font-medium text-white">
                      <div>
                        <div className="font-semibold text-white leading-tight flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Active Session"></span>
                          <span>{user.user_name}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">Spec #{user.user_id}</div>
                      </div>
                    </td>

                    {/* User ID */}
                    <td className="p-3 font-mono text-cyan-300 text-xs">
                      {user.user_id}
                    </td>

                    {/* Account Type */}
                    <td className="p-3">
                      <AccountTypeBadge type={userAccType} size="xs" />
                    </td>

                    {/* Login Timestamp */}
                    <td className="p-3 font-mono text-slate-300 text-xs" title={`Raw: ${user.login_time}\nAlternate: ${loginFmt.alternateFull}`}>
                      <div>{loginFmt.full}</div>
                    </td>

                    {/* Last Touch Timestamp */}
                    <td className="p-3 font-mono text-slate-400 text-xs" title={`Raw: ${user.last_access_time}\nAlternate: ${touchFmt.alternateFull}`}>
                      <div>{touchFmt.full}</div>
                    </td>

                    {/* Node / Host */}
                    <td className="p-3 font-mono text-xs">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 text-[11px]">
                        {user.host_name || user.host_addr || 'app1'}
                      </span>
                    </td>

                    {/* Client IP */}
                    <td className="p-3 font-mono text-xs text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px]">
                        {user.ip_address || '127.0.0.1'}
                      </span>
                    </td>

                    {/* Assigned Licenses */}
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5 max-w-md">
                        {(user.assigned_licenses && user.assigned_licenses.length > 0) ? (
                          user.assigned_licenses.map((lic, lIdx) => (
                            <span 
                              key={lIdx} 
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                lic.includes('Enterprise') 
                                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                  : lic.includes('Occasional')
                                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                    : lic.includes('Self Service')
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                              title={lic}
                            >
                              {lic.replace('IBM Facilities & RE on Cloud ', '').replace('IBM Facilities and Real Estate Management on Cloud ', '')}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">No specific licence assigned</span>
                        )}
                      </div>
                    </td>

                    {/* Session Status */}
                    <td className="p-3 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30 inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>Active</span>
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleCopyText(`${user.user_name} (ID: ${user.user_id}, Node: ${user.host_name || user.host_addr}, IP: ${user.ip_address}, Logged in: ${loginFmt.full})`, user.user_id)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Copy user details"
                      >
                        {copiedUserId === user.user_id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="py-8 px-6 text-center bg-slate-800/30 rounded-xl border border-slate-800 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <Users className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              {userFilter 
                ? `No active users match "${userFilter}"` 
                : accountTypeFilter !== 'all'
                  ? `No Active ${accountTypeFilter === 'oslc' ? 'OSLC / API' : accountTypeFilter === 'external' ? 'External' : 'Internal'} Sessions Detected`
                  : 'No Active Platform Sessions Detected'
              }
            </h3>
            <p className="text-xs text-slate-400 max-w-md mb-4">
              {userFilter 
                ? 'Try adjusting your search query or clear the filter.'
                : accountTypeFilter !== 'all'
                  ? `Currently, 0 ${accountTypeFilter === 'oslc' ? 'OSLC / API integration accounts' : accountTypeFilter === 'external' ? 'external accounts (vendors, contractors)' : 'internal employee accounts'} have active concurrent sessions on the TRIRIGA application servers.`
                  : 'Currently, 0 users have active concurrent sessions on the TRIRIGA application servers. All user sessions have logged off or expired.'
              }
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveTab('sessions')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>View Historical Session Audit Log</span>
              </button>
              <button
                onClick={() => setActiveTab('entitlements')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Check Licence Entitlements</span>
              </button>
            </div>
          </div>

          {/* Recent Sessions Preview */}
          {licenseData?.recent_sessions && licenseData.recent_sessions.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Most Recent User Sessions (Historical)
                    {accountTypeFilter !== 'all' && (
                      <span className="text-cyan-400 font-mono text-[11px] ml-1">
                        · Filtered to {accountTypeFilter.toUpperCase()} ({previewSessions.length})
                      </span>
                    )}
                  </span>
                </h4>
                <button
                  onClick={() => setActiveTab('sessions')}
                  className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                >
                  View all {licenseData.recent_sessions.length} sessions →
                </button>
              </div>
              {previewSessions.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="p-2.5">User</th>
                        <th className="p-2.5">User ID</th>
                        <th className="p-2.5">Account Type</th>
                        <th className="p-2.5">Login Time</th>
                        <th className="p-2.5">Logout Time</th>
                        <th className="p-2.5">Licence</th>
                        <th className="p-2.5 text-center">Logoff Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {previewSessions.slice(0, 5).map((sess, sIdx) => {
                        const startFmt = formatDisplayTime(sess.start_time || sess.START_TIME);
                        const rawEnd = sess.end_time || sess.END_TIME;
                        const endFmt = rawEnd ? formatDisplayTime(rawEnd) : null;
                        const sType = sess.account_type || getAccountType(sess);
                        return (
                          <tr key={sIdx} className="hover:bg-slate-800/30 transition-colors">
                            <td className="p-2.5 font-medium text-white">{sess.user_name || sess.spec_name || sess.SPEC_NAME}</td>
                            <td className="p-2.5 font-mono text-cyan-300">{sess.user_id || sess.USER_ID}</td>
                            <td className="p-2.5">
                              <AccountTypeBadge type={sType} size="xs" />
                            </td>
                            <td className="p-2.5 font-mono text-slate-300 text-xs" title={`Raw: ${sess.start_time || sess.START_TIME}\nAlternate: ${startFmt.alternateFull}`}>
                              {startFmt.full}
                            </td>
                            <td className="p-2.5 font-mono text-slate-400 text-xs" title={endFmt ? `Raw: ${rawEnd}\nAlternate: ${endFmt.alternateFull}` : 'Active session'}>
                              {endFmt ? endFmt.full : '— (Active)'}
                            </td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                {sess.primary_license || (sess.assigned_licenses && sess.assigned_licenses[0]) || 'Standard Access'}
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                                {sess.logoff_type || sess.LOGOFF_TYPE || 'NORMAL'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400 italic">
                  No historical sessions found matching {accountTypeFilter.toUpperCase()} account type.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500 border-t border-slate-800/60">
        <span>Showing {filteredLoggedInUsers.length} currently active users</span>
        <span>Real-time DB2 live session correlation</span>
      </div>
    </div>
  );
};
