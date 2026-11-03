import React from 'react';
import { Building2, Globe, Zap, Users } from 'lucide-react';
import { AccountTypeFilterValue } from '../../utils/accountUtils';

export interface AccountTypeCounts {
  all?: number;
  internal?: number;
  external?: number;
  oslc?: number;
}

interface AccountTypeSelectorProps {
  value: AccountTypeFilterValue;
  onChange: (val: AccountTypeFilterValue) => void;
  counts?: AccountTypeCounts;
  className?: string;
  size?: 'sm' | 'md';
}

export const AccountTypeSelector: React.FC<AccountTypeSelectorProps> = ({
  value,
  onChange,
  counts,
  className = '',
  size = 'md',
}) => {
  const isSm = size === 'sm';
  const paddingClass = isSm ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  const iconSize = isSm ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800 ${className}`}>
      {/* ALL ACCOUNTS */}
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer select-none ${paddingClass} ${
          value === 'all'
            ? 'bg-slate-800 text-white shadow-sm border border-slate-700 font-semibold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
        }`}
        title="Show all account types (Internal, External, and OSLC)"
      >
        <Users className={`${iconSize} ${value === 'all' ? 'text-cyan-400' : 'text-slate-400'}`} />
        <span>All Accounts</span>
        {counts?.all !== undefined && (
          <span className={`px-1.5 py-0.2 rounded-md font-mono text-[10px] ${
            value === 'all' ? 'bg-slate-700 text-cyan-300' : 'bg-slate-900 text-slate-400'
          }`}>
            {counts.all}
          </span>
        )}
      </button>

      {/* INTERNAL ACCOUNTS */}
      <button
        type="button"
        onClick={() => onChange('internal')}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer select-none ${paddingClass} ${
          value === 'internal'
            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold'
            : 'text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/20'
        }`}
        title="Show Internal accounts (Standard company employees and corporate users)"
      >
        <Building2 className={`${iconSize} ${value === 'internal' ? 'text-cyan-400' : 'text-slate-400'}`} />
        <span>Internal</span>
        {counts?.internal !== undefined && (
          <span className={`px-1.5 py-0.2 rounded-md font-mono text-[10px] ${
            value === 'internal' ? 'bg-cyan-500/30 text-cyan-200' : 'bg-slate-900 text-slate-400'
          }`}>
            {counts.internal}
          </span>
        )}
      </button>

      {/* EXTERNAL ACCOUNTS */}
      <button
        type="button"
        onClick={() => onChange('external')}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer select-none ${paddingClass} ${
          value === 'external'
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm font-semibold'
            : 'text-slate-400 hover:text-amber-300 hover:bg-amber-950/20'
        }`}
        title="Show External accounts (Third-party contractors, vendors, partners, suppliers)"
      >
        <Globe className={`${iconSize} ${value === 'external' ? 'text-amber-400' : 'text-slate-400'}`} />
        <span>External</span>
        {counts?.external !== undefined && (
          <span className={`px-1.5 py-0.2 rounded-md font-mono text-[10px] ${
            value === 'external' ? 'bg-amber-500/30 text-amber-200' : 'bg-slate-900 text-slate-400'
          }`}>
            {counts.external}
          </span>
        )}
      </button>

      {/* OSLC / API ACCOUNTS */}
      <button
        type="button"
        onClick={() => onChange('oslc')}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer select-none ${paddingClass} ${
          value === 'oslc'
            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm font-semibold'
            : 'text-slate-400 hover:text-purple-300 hover:bg-purple-950/20'
        }`}
        title="Show OSLC / API integration accounts (Automated web services, REST connectors, service accounts)"
      >
        <Zap className={`${iconSize} ${value === 'oslc' ? 'text-purple-400' : 'text-slate-400'}`} />
        <span>OSLC / API</span>
        {counts?.oslc !== undefined && (
          <span className={`px-1.5 py-0.2 rounded-md font-mono text-[10px] ${
            value === 'oslc' ? 'bg-purple-500/30 text-purple-200' : 'bg-slate-900 text-slate-400'
          }`}>
            {counts.oslc}
          </span>
        )}
      </button>
    </div>
  );
};
