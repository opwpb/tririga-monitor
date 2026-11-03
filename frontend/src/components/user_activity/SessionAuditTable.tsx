import React from 'react';
import { Clock } from 'lucide-react';
import { FormattedTimeResult } from '../../context/TimeContext';
import { AccountTypeBadge } from './AccountTypeBadge';
import { AccountTypeSelector } from './AccountTypeSelector';
import { AccountTypeFilterValue, getAccountType } from '../../utils/accountUtils';

interface SessionAuditTableProps {
  filteredSessions: any[];
  formatDisplayTime: (isoOrRaw?: string | null) => FormattedTimeResult;
  accountTypeFilter?: AccountTypeFilterValue;
  onAccountTypeChange?: (val: AccountTypeFilterValue) => void;
  rawSessions?: any[];
}

export const SessionAuditTable: React.FC<SessionAuditTableProps> = ({
  filteredSessions,
  formatDisplayTime,
  accountTypeFilter,
  onAccountTypeChange,
  rawSessions,
}) => {
  const sourceList = rawSessions || filteredSessions;
  const accountCounts = {
    all: sourceList.length,
    internal: sourceList.filter(s => (s.account_type || getAccountType(s)) === 'internal').length,
    external: sourceList.filter(s => (s.account_type || getAccountType(s)) === 'external').length,
    oslc: sourceList.filter(s => (s.account_type || getAccountType(s)) === 'oslc').length,
  };

  return (
    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>Historical Session Audit Log ({filteredSessions.length} records)</span>
          </h2>
          <p className="text-xs text-slate-400">All session audit entries from TRIRIGA SESSION_HISTORY table.</p>
        </div>

        {onAccountTypeChange && accountTypeFilter !== undefined && (
          <div className="flex items-center gap-2">
            <AccountTypeSelector
              value={accountTypeFilter}
              onChange={onAccountTypeChange}
              counts={accountCounts}
              size="xs"
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto max-h-[500px]">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md border-b border-slate-800">
            <tr>
              <th className="p-3">User / Display Name</th>
              <th className="p-3 w-28">User ID</th>
              <th className="p-3 w-28">Account Type</th>
              <th className="p-3">Login Timestamp</th>
              <th className="p-3">Logout Timestamp</th>
              <th className="p-3">Product / Licence</th>
              <th className="p-3 w-24 text-center">Logoff Type</th>
              <th className="p-3 w-24 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 font-sans">
            {filteredSessions.map((sess, idx) => {
              const startFmt = formatDisplayTime(sess.START_TIME || sess.start_time);
              const rawEnd = sess.END_TIME || sess.end_time;
              const endFmt = rawEnd ? formatDisplayTime(rawEnd) : null;
              const accType = sess.account_type || getAccountType(sess);
              return (
                <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3 font-medium text-white">
                    <span className="truncate">{sess.SPEC_NAME || sess.spec_name || sess.user_name || 'Platform User'}</span>
                  </td>
                  <td className="p-3 font-mono text-cyan-300">{sess.USER_ID || sess.user_id}</td>
                  <td className="p-3">
                    <AccountTypeBadge type={accType} size="xs" />
                  </td>
                  <td className="p-3 text-slate-300 font-mono text-xs" title={`Raw: ${sess.START_TIME || sess.start_time}\nAlternate: ${startFmt.alternateFull}`}>
                    {startFmt.full}
                  </td>
                  <td className="p-3 text-slate-400 font-mono text-xs" title={endFmt ? `Raw: ${rawEnd}\nAlternate: ${endFmt.alternateFull}` : 'Active session'}>
                    {endFmt ? endFmt.full : '— (Active)'}
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      {sess.primary_license || (sess.assigned_licenses && sess.assigned_licenses[0]) || (sess.product_id ? `License #${sess.product_id}` : 'Standard Access')}
                    </span>
                  </td>
                  <td className="p-3 text-center font-mono text-[10px] text-slate-400">
                    {sess.LOGOFF_TYPE || sess.logoff_type || (sess.is_active ? 'ACTIVE' : 'NORMAL')}
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      sess.is_active || (!sess.END_TIME && !sess.end_time)
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {sess.is_active || (!sess.END_TIME && !sess.end_time) ? 'Active' : 'Closed'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

