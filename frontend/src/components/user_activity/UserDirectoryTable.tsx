import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  UserCheck, 
  UserX, 
  Building2, 
  Globe, 
  Search, 
  Download, 
  Copy, 
  Check, 
  RefreshCw, 
  Filter, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Mail, 
  ChevronLeft, 
  ChevronRight, 
  ExternalLink,
  ShieldAlert,
  Sparkles,
  CheckSquare,
  Square
} from 'lucide-react';
import { 
  TririgaUserDirectoryItem, 
  TririgaUserDirectorySummary, 
  TririgaServer 
} from '../../types';
import { api } from '../../services/api';
import { AccountTypeBadge } from './AccountTypeBadge';

interface UserDirectoryTableProps {
  servers: TririgaServer[];
  selectedServerId: number | 'prod_cluster';
  selectedServerInfo: { name: string; isCluster: boolean; host: string };
  onSendToAI?: (prompt: string) => void;
}

type SortField = 'name' | 'user_account' | 'org' | 'email' | 'account_type' | 'status' | 'form_type' | 'last_login' | 'user_id';

export const UserDirectoryTable: React.FC<UserDirectoryTableProps> = ({
  servers,
  selectedServerId,
  selectedServerInfo,
  onSendToAI
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<TririgaUserDirectoryItem[]>([]);
  const [summary, setSummary] = useState<TririgaUserDirectorySummary | null>(null);
  const [organizations, setOrganizations] = useState<string[]>([]);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [accountTypeFilter, setAccountTypeFilter] = useState<'all' | 'internal' | 'external' | 'oslc'>('all');
  const [orgFilter, setOrgFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sorting
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Selection
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string | number>>(new Set());

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Copied states
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Determine actual server ID for API request
  const effectiveServerId = useMemo(() => {
    if (selectedServerId === 'prod_cluster') {
      const prodApp1 = servers.find(s => s.host === '169.50.115.221' || s.name.toLowerCase().includes('prod app1'));
      return prodApp1 ? prodApp1.id : undefined;
    }
    return selectedServerId;
  }, [selectedServerId, servers]);

  const fetchDirectory = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getUserDirectory({
        serverId: effectiveServerId,
        status: statusFilter,
        accountType: accountTypeFilter,
        org: orgFilter !== 'all' ? orgFilter : undefined,
        search: searchQuery.trim() || undefined
      });
      if (res.success) {
        setUsers(res.users || []);
        setSummary(res.summary);
        setOrganizations(res.organizations || []);
        setLastRefreshed(new Date());
      } else {
        setError('Failed to fetch user directory from TRIRIGA server.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error communicating with TRIRIGA database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory();
  }, [effectiveServerId, statusFilter, accountTypeFilter, orgFilter]);

  // Client-side text filter on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase().trim();
    return users.filter(u => 
      u.user_name.toLowerCase().includes(q) ||
      u.user_account.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.organization_clean.toLowerCase().includes(q) ||
      u.organization.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  // Sorting
  const sortedUsers = useMemo(() => {
    const list = [...filteredUsers];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.user_name.localeCompare(b.user_name);
          break;
        case 'user_account':
          cmp = a.user_account.localeCompare(b.user_account);
          break;
        case 'org':
          cmp = a.organization_clean.localeCompare(b.organization_clean);
          break;
        case 'email':
          cmp = a.email.localeCompare(b.email);
          break;
        case 'account_type':
          cmp = a.account_type.localeCompare(b.account_type);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'form_type':
          cmp = a.form_type.localeCompare(b.form_type);
          break;
        case 'last_login':
          cmp = (a.last_login_raw ? Number(a.last_login_raw) : 0) - (b.last_login_raw ? Number(b.last_login_raw) : 0);
          break;
        case 'user_id':
          cmp = Number(a.user_id) - Number(b.user_id);
          break;
        default:
          cmp = 0;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filteredUsers, sortField, sortDirection]);

  // Paginated Users
  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
  const paginatedUsers = useMemo(() => {
    if (pageSize >= 5000) return sortedUsers;
    const start = (currentPage - 1) * pageSize;
    return sortedUsers.slice(start, start + pageSize);
  }, [sortedUsers, currentPage, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 opacity-60 inline-block ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-cyan-400 inline-block ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-cyan-400 inline-block ml-1" />
    );
  };

  const handleCopyText = (text: string, id: string | number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSelectUser = (id: string | number) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUserIds.size === paginatedUsers.length && paginatedUsers.length > 0) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(paginatedUsers.map(u => u.user_id)));
    }
  };

  // Generate and download CSV
  const handleExportCSV = (selectedOnly: boolean = false) => {
    const targetUsers = selectedOnly && selectedUserIds.size > 0
      ? sortedUsers.filter(u => selectedUserIds.has(u.user_id))
      : sortedUsers;

    if (targetUsers.length === 0) return;

    // Build CSV with BOM
    const headers = [
      'Name',
      'Organisation',
      'Organisation Path',
      'Email Address',
      'Username',
      'Account Type',
      'Status',
      'Form Type',
      'Last Login',
      'Days Inactive',
      'User ID'
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = targetUsers.map(u => [
      escapeCsv(u.user_name),
      escapeCsv(u.organization_clean),
      escapeCsv(u.organization),
      escapeCsv(u.email),
      escapeCsv(u.user_account),
      escapeCsv(u.account_type_label),
      escapeCsv(u.status),
      escapeCsv(u.form_type),
      escapeCsv(u.last_login),
      escapeCsv(u.days_inactive !== null && u.days_inactive !== undefined ? u.days_inactive : ''),
      escapeCsv(u.user_id)
    ].join(','));

    const csvContent = '\ufeff' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const statusTag = statusFilter !== 'all' ? `_${statusFilter}` : '';
    const typeTag = accountTypeFilter !== 'all' ? `_${accountTypeFilter}` : '';
    const filename = `TRIRIGA_Users${statusTag}${typeTag}_${dateStr}_${timeStr}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyCsvToClipboard = () => {
    const targetUsers = selectedUserIds.size > 0
      ? sortedUsers.filter(u => selectedUserIds.has(u.user_id))
      : sortedUsers;

    if (targetUsers.length === 0) return;

    const headers = ['Name', 'Organisation', 'Email Address', 'Username', 'Account Type', 'Status', 'Form Type', 'Last Login', 'User ID'];
    const rows = targetUsers.map(u => [
      u.user_name,
      u.organization_clean,
      u.email,
      u.user_account,
      u.account_type_label,
      u.status,
      u.form_type,
      u.last_login,
      u.user_id
    ].join('\t'));

    const tsvContent = [headers.join('\t'), ...rows].join('\n');
    navigator.clipboard.writeText(tsvContent);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2500);
  };

  const resetFilters = () => {
    setStatusFilter('all');
    setAccountTypeFilter('all');
    setOrgFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all' || accountTypeFilter !== 'all' || orgFilter !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Header & Export Actions Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                TRIRIGA User Directory &amp; CSV Export
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  {filteredUsers.length} Users
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live user profiles, organisations, and email addresses directly from TRIRIGA database ({selectedServerInfo.name}).
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchDirectory}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition border border-slate-700/60 disabled:opacity-50 cursor-pointer shadow-sm"
            title="Refresh directory from TRIRIGA database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleCopyCsvToClipboard}
            disabled={sortedUsers.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-xs font-semibold transition border border-slate-700/60 disabled:opacity-50 cursor-pointer shadow-sm hover:border-slate-600"
            title="Copy user table to clipboard (Excel TSV format)"
          >
            {copiedCsv ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300 font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy for Excel</span>
              </>
            )}
          </button>

          {/* Main Download CSV Button */}
          <button
            onClick={() => handleExportCSV(false)}
            disabled={sortedUsers.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950/40 border border-emerald-500/40 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download CSV ({sortedUsers.length})</span>
          </button>

          {selectedUserIds.size > 0 && (
            <button
              onClick={() => handleExportCSV(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-cyan-950/40 border border-cyan-500/40 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Selected ({selectedUserIds.size})</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Users */}
        <div 
          onClick={() => { setStatusFilter('all'); setAccountTypeFilter('all'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            statusFilter === 'all' && accountTypeFilter === 'all'
              ? 'border-cyan-500/50 bg-cyan-950/20 shadow-lg shadow-cyan-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Users</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {summary?.total ?? 0}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">All registered accounts</div>
        </div>

        {/* Active Users */}
        <div 
          onClick={() => { setStatusFilter('active'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            statusFilter === 'active'
              ? 'border-emerald-500/50 bg-emerald-950/20 shadow-lg shadow-emerald-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Users</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {summary?.active ?? 0}
          </div>
          <div className="text-[10px] text-emerald-400/80 mt-1">
            {summary?.total ? `${Math.round(((summary.active || 0) / summary.total) * 100)}% of total` : 'Active status'}
          </div>
        </div>

        {/* Inactive / Retired */}
        <div 
          onClick={() => { setStatusFilter('inactive'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            statusFilter === 'inactive'
              ? 'border-amber-500/50 bg-amber-950/20 shadow-lg shadow-amber-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-amber-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Retired / Inactive</span>
            <UserX className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono">
            {summary?.inactive ?? 0}
          </div>
          <div className="text-[10px] text-amber-400/80 mt-1">
            {summary?.total ? `${Math.round(((summary.inactive || 0) / summary.total) * 100)}% inactive` : 'Retired status'}
          </div>
        </div>

        {/* Internal Employees */}
        <div 
          onClick={() => { setAccountTypeFilter('internal'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            accountTypeFilter === 'internal'
              ? 'border-cyan-500/50 bg-cyan-950/20 shadow-lg shadow-cyan-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-cyan-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Internal Staff</span>
            <Building2 className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-cyan-300 font-mono">
            {summary?.internal ?? 0}
          </div>
          <div className="text-[10px] text-cyan-400/80 mt-1">Corporate &amp; Staff</div>
        </div>

        {/* External Users */}
        <div 
          onClick={() => { setAccountTypeFilter('external'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            accountTypeFilter === 'external'
              ? 'border-amber-500/50 bg-amber-950/20 shadow-lg shadow-amber-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-amber-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">External Users</span>
            <Globe className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 font-mono">
            {summary?.external ?? 0}
          </div>
          <div className="text-[10px] text-amber-400/80 mt-1">Contractors &amp; Vendors</div>
        </div>

        {/* OSLC / API */}
        <div 
          onClick={() => { setAccountTypeFilter('oslc'); }}
          className={`p-3.5 rounded-2xl bg-slate-900/80 border transition-all cursor-pointer ${
            accountTypeFilter === 'oslc'
              ? 'border-purple-500/50 bg-purple-950/20 shadow-lg shadow-purple-950/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-purple-400 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider">OSLC / API</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-300 font-mono">
            {summary?.oslc ?? 0}
          </div>
          <div className="text-[10px] text-purple-400/80 mt-1">System Integrations</div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800 shrink-0">
            <span className="text-[11px] font-semibold text-slate-400 px-2 flex items-center gap-1">
              <Filter className="w-3 h-3 text-cyan-400" /> Status:
            </span>
            <button
              onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Statuses
            </button>
            <button
              onClick={() => { setStatusFilter('active'); setCurrentPage(1); }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'active'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Active Only
            </button>
            <button
              onClick={() => { setStatusFilter('inactive'); setCurrentPage(1); }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                statusFilter === 'inactive'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Retired / Inactive
            </button>
          </div>

          {/* Account Type Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800 shrink-0 overflow-x-auto">
            <span className="text-[11px] font-semibold text-slate-400 px-2">Type:</span>
            <button
              onClick={() => { setAccountTypeFilter('all'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                accountTypeFilter === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => { setAccountTypeFilter('internal'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                accountTypeFilter === 'internal'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3 h-3 text-cyan-400" />
              Internal
            </button>
            <button
              onClick={() => { setAccountTypeFilter('external'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                accountTypeFilter === 'external'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3 h-3 text-amber-400" />
              External
            </button>
            <button
              onClick={() => { setAccountTypeFilter('oslc'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                accountTypeFilter === 'oslc'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-purple-400" />
              OSLC
            </button>
          </div>
        </div>

        {/* Search Input & Organisation Dropdown */}
        <div className="flex flex-col md:flex-row items-center gap-3 pt-1 border-t border-slate-800/80">
          {/* Instant Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Search by user name, username, email address, or organisation..."
              className="w-full pl-10 pr-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>

          {/* Organisation Filter Dropdown */}
          <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
            <label className="text-xs text-slate-400 whitespace-nowrap hidden sm:inline">Organisation:</label>
            <select
              value={orgFilter}
              onChange={e => { setOrgFilter(e.target.value); setCurrentPage(1); }}
              className="px-3 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500/60 transition w-full md:w-64 max-w-xs cursor-pointer truncate"
            >
              <option value="all">All Organisations ({organizations.length})</option>
              {organizations.map(org => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="px-3 py-2 text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-xl transition cursor-pointer whitespace-nowrap shrink-0 border border-cyan-500/20"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Users Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Table Top Status Bar */}
        <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-medium">
              Showing <span className="text-white font-bold">{paginatedUsers.length}</span> of <span className="text-white font-bold">{sortedUsers.length}</span> users
            </span>
            {selectedUserIds.size > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {selectedUserIds.size} selected
              </span>
            )}
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Per page:</span>
            {[25, 50, 100, 5000].map(sz => (
              <button
                key={sz}
                onClick={() => { setPageSize(sz); setCurrentPage(1); }}
                className={`px-2 py-0.5 rounded-md font-mono text-[11px] transition cursor-pointer ${
                  pageSize === sz
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz === 5000 ? 'All' : sz}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
            <p className="text-sm font-medium">Querying live TRIRIGA user directory...</p>
          </div>
        ) : error ? (
          <div className="py-16 px-6 text-center">
            <div className="inline-flex p-3 rounded-full bg-rose-500/10 text-rose-400 mb-3 border border-rose-500/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <p className="text-rose-400 font-semibold text-sm">{error}</p>
            <button
              onClick={fetchDirectory}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : sortedUsers.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <Users className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium text-slate-300">No users match the active filters</p>
            <p className="text-xs text-slate-500 mt-1">Try clearing or adjusting your search criteria</p>
            <button
              onClick={resetFilters}
              className="mt-4 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-950/60 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                  <th className="py-3 px-4 w-10 text-center">
                    <button
                      onClick={toggleSelectAll}
                      className="cursor-pointer text-slate-400 hover:text-white"
                      title={selectedUserIds.size === paginatedUsers.length ? "Deselect all" : "Select all on page"}
                    >
                      {selectedUserIds.size === paginatedUsers.length && paginatedUsers.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                    </button>
                  </th>
                  <th 
                    onClick={() => handleSort('name')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    User Name &amp; Login {renderSortIcon('name')}
                  </th>
                  <th 
                    onClick={() => handleSort('org')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Organisation {renderSortIcon('org')}
                  </th>
                  <th 
                    onClick={() => handleSort('email')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Email Address {renderSortIcon('email')}
                  </th>
                  <th 
                    onClick={() => handleSort('account_type')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Account Type {renderSortIcon('account_type')}
                  </th>
                  <th 
                    onClick={() => handleSort('status')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Status {renderSortIcon('status')}
                  </th>
                  <th 
                    onClick={() => handleSort('form_type')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Form Type {renderSortIcon('form_type')}
                  </th>
                  <th 
                    onClick={() => handleSort('last_login')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none"
                  >
                    Last Login {renderSortIcon('last_login')}
                  </th>
                  <th 
                    onClick={() => handleSort('user_id')}
                    className="py-3 px-4 cursor-pointer hover:text-white transition select-none text-right"
                  >
                    User ID {renderSortIcon('user_id')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {paginatedUsers.map((u) => {
                  const isSelected = selectedUserIds.has(u.user_id);
                  const initials = u.user_name
                    .split(' ')
                    .filter(Boolean)
                    .map(p => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'U';

                  return (
                    <tr 
                      key={u.user_id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isSelected ? 'bg-cyan-950/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleSelectUser(u.user_id)}
                          className="cursor-pointer text-slate-400 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600" />
                          )}
                        </button>
                      </td>

                      {/* Name & Login */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 relative ${
                            u.is_active
                              ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {initials}
                            <span className={`w-2 h-2 rounded-full absolute -bottom-0.5 -right-0.5 border border-slate-900 ${
                              u.is_active ? 'bg-emerald-400' : 'bg-slate-500'
                            }`} />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-100 leading-snug">
                              {u.user_name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <span>{u.user_account}</span>
                              <button
                                onClick={() => handleCopyText(u.user_account, `acc_${u.user_id}`)}
                                className="text-slate-500 hover:text-slate-300 transition"
                                title="Copy username"
                              >
                                {copiedId === `acc_${u.user_id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Organisation */}
                      <td className="py-3 px-4 max-w-xs">
                        <div 
                          className="font-medium text-slate-200 truncate cursor-help"
                          title={u.organization || u.organization_clean}
                        >
                          {u.organization_clean}
                        </div>
                        {u.organization && u.organization !== u.organization_clean && (
                          <div 
                            className="text-[10px] text-slate-500 truncate mt-0.5"
                            title={u.organization}
                          >
                            {u.organization}
                          </div>
                        )}
                      </td>

                      {/* Email Address */}
                      <td className="py-3 px-4">
                        {u.email ? (
                          <div className="flex items-center gap-2 group">
                            <Mail className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
                            <a
                              href={`mailto:${u.email}`}
                              className="text-cyan-300 hover:text-cyan-200 hover:underline truncate max-w-[220px]"
                              title={`Email ${u.email}`}
                            >
                              {u.email}
                            </a>
                            <button
                              onClick={() => handleCopyText(u.email, `mail_${u.user_id}`)}
                              className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition"
                              title="Copy email address"
                            >
                              {copiedId === `mail_${u.user_id}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">No email registered</span>
                        )}
                      </td>

                      {/* Account Type */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <AccountTypeBadge type={u.account_type} />
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                            {u.status}
                          </span>
                        )}
                      </td>

                      {/* Form Type */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-300">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60 text-[11px] text-slate-300">
                          {u.form_type}
                        </span>
                      </td>

                      {/* Last Login */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.last_login !== 'Never' ? (
                          <div>
                            <div className="font-mono text-slate-200 text-[11px]">
                              {u.last_login.split(' ')[0]}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {u.days_inactive !== null && u.days_inactive !== undefined
                                ? u.days_inactive === 0
                                  ? 'Today'
                                  : `${u.days_inactive}d ago`
                                : u.last_login.split(' ')[1] || ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] italic">Never</span>
                        )}
                      </td>

                      {/* User ID */}
                      <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{u.user_id}</span>
                          <button
                            onClick={() => handleCopyText(String(u.user_id), `uid_${u.user_id}`)}
                            className="text-slate-500 hover:text-slate-300 transition"
                            title="Copy TRIRIGA Spec ID"
                          >
                            {copiedId === `uid_${u.user_id}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {sortedUsers.length > 0 && pageSize < 5000 && (
          <div className="px-5 py-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/40 text-xs text-slate-400">
            <div>
              Showing page <span className="font-bold text-white">{currentPage}</span> of <span className="font-bold text-white">{totalPages}</span> ({sortedUsers.length} total users)
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 font-mono text-xs">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5 && currentPage > 3) {
                    pageNum = Math.min(totalPages - 4 + i, currentPage - 2 + i);
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg transition cursor-pointer font-bold ${
                        currentPage === pageNum
                          ? 'bg-cyan-500 text-slate-950 shadow-sm'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
