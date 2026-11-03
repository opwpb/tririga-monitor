import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Layers, 
  Clock, 
  Zap, 
  RefreshCw, 
  Server, 
  Search, 
  Download, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle,
  Play,
  Pause,
  ShieldCheck,
  ShieldAlert,
  Activity,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Globe,
  Copy,
  Check,
  Building2,
  FileText,
  UserX,
  FileCode
} from 'lucide-react'; 
import { 
  TririgaServer, 
  LicenseUsageData, 
  LoggedInUser, 
  LicenseEntitlementItem 
} from '../types';
import { api } from '../services/api';
import { useTimeContext } from '../context/TimeContext';
import { CardSparkline } from './common/CardSparkline';
import { segregateServers } from '../utils/serverUtils';
import { AccountTypeFilterValue, getAccountType } from '../utils/accountUtils';
import { AccountTypeSelector } from './user_activity/AccountTypeSelector';
import { DeprovisionModal } from './user_activity/DeprovisionModal';
import { LicenseEntitlementsTable } from './user_activity/LicenseEntitlementsTable';
import { DormantAccountsTable } from './user_activity/DormantAccountsTable';
import { ActiveUsersTable } from './user_activity/ActiveUsersTable';
import { SessionAuditTable } from './user_activity/SessionAuditTable';
import { LicenseVisualAnalytics } from './user_activity/LicenseVisualAnalytics';
import { UserDirectoryTable } from './user_activity/UserDirectoryTable';

interface UserActivityProps {
  servers: TririgaServer[];
  onSendToAI?: (prompt: string) => void;
  onLiveStatusChange?: (isLive: boolean) => void;
  activeSubTab?: 'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant' | 'directory';
  onSubTabChange?: (tab: 'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant' | 'directory') => void;
}

export const UserActivity: React.FC<UserActivityProps> = ({
  servers,
  onSendToAI,
  onLiveStatusChange,
  activeSubTab,
  onSubTabChange,
}) => {
  const { timeMode, toggleTimeMode, formatDisplayTime, formatShortTimestamp, formatDateWithDay, localTzInfo } = useTimeContext();

  // Segregate servers into Production vs Non-Production using shared utility
  const { prodServers, nonProdServers } = useMemo(() => {
    return segregateServers(servers);
  }, [servers]);

  // Always default strictly to Production Cluster ('prod_cluster')
  const [selectedServerId, setSelectedServerId] = useState<number | 'prod_cluster'>('prod_cluster');

  const selectedServerInfo = useMemo(() => {
    if (selectedServerId === 'prod_cluster') {
      return { name: 'Production Cluster', isCluster: true, host: 'All Production Nodes (app1 + app2)' };
    }
    const found = servers.find(s => s.id === selectedServerId);
    return found ? { name: found.name, isCluster: false, host: found.host } : { name: `Server #${selectedServerId}`, isCluster: false, host: '' };
  }, [selectedServerId, servers]);

  const [activeTab, setActiveTabState] = useState<'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant' | 'directory'>(activeSubTab || 'logged_in');

  useEffect(() => {
    if (activeSubTab && activeSubTab !== activeTab) {
      setActiveTabState(activeSubTab);
    }
  }, [activeSubTab]);

  const setActiveTab = (tab: 'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant' | 'directory') => {
    setActiveTabState(tab);
    onSubTabChange?.(tab);
  };

  // Dormant / Inactive Licences State
  const [dormantModuleFilter, setDormantModuleFilter] = useState<'dormant_all' | '3053' | '3048' | '3050' | 'never' | '365d' | '180d' | '90d' | '30d' | 'active' | 'all'>('dormant_all');
  const [dormantPriorityFilter, setDormantPriorityFilter] = useState<'all' | 'HIGH' | 'MEDIUM' | 'LOW' | 'EXEMPT'>('all');
  const [selectedDormantUserIds, setSelectedDormantUserIds] = useState<Set<string>>(new Set());
  const [showDeprovisionModal, setShowDeprovisionModal] = useState<boolean>(false);

  // Entitlement Tier Filter State
  const [entitlementTierFilter, setEntitlementTierFilter] = useState<'all' | 'PAID_CONTRACTED' | 'FREE_PLATFORM' | 'PAID_UNLICENSED'>('all');
  
  // Account Type Filter State
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilterValue>('all');

  const [licenseData, setLicenseData] = useState<LicenseUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [expandedProductIds, setExpandedProductIds] = useState<Record<string, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);

  // Live Auto-Refresh State
  const [isLive, setIsLive] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('tririga_user_activity_autorefresh');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Sparkline history buffers
  const [sparkHistory, setSparkHistory] = useState<Record<string, number[]>>({
    licenseSeats: [],
    activeUsers: [],
    entitledSeats: [],
    saturation: [],
  });

  const recordSample = (key: string, value: number) => {
    setSparkHistory(prev => {
      const arr = prev[key] || [];
      const updated = [...arr, value].slice(-15);
      return { ...prev, [key]: updated };
    });
  };

  const getSparkData = (key: string, fallbackValue: number): number[] => {
    const arr = sparkHistory[key];
    if (arr && arr.length >= 2) return arr;
    return [fallbackValue, fallbackValue];
  };

  const fetchTelemetry = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const isCluster = selectedServerId === 'prod_cluster';
      let effectiveServerId: number | undefined = undefined;
      if (!isCluster) {
        effectiveServerId = selectedServerId;
      } else {
        const primaryProd = prodServers.find(s => s.name.toLowerCase().includes('prod app1')) || prodServers[0];
        effectiveServerId = primaryProd ? primaryProd.id : undefined;
      }

      const data = await api.getLicenseUsage(effectiveServerId, isCluster);
      setLicenseData(data);
      setLastRefreshed(new Date());

      const assigned = data.summary?.total_assigned_seats ?? data.license_distribution?.reduce((acc: number, i: any) => acc + (i.count || 0), 0) ?? 0;
      const active = data.logged_in_users ? data.logged_in_users.length : 0;
      const entitled = data.summary?.total_entitled_seats ?? 500;
      const saturation = data.summary?.overall_saturation_pct ?? (entitled > 0 ? (assigned / entitled) * 100 : 0);

      recordSample('licenseSeats', assigned);
      recordSample('activeUsers', active);
      recordSample('entitledSeats', entitled);
      recordSample('saturation', saturation);
    } catch (err: any) {
      console.error('Failed to fetch user activity telemetry:', err);
      if (!isBackground) {
        setError(err.message || 'Failed to fetch user activity data');
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, [selectedServerId]);

  useEffect(() => {
    try {
      localStorage.setItem('tririga_user_activity_autorefresh', String(isLive));
    } catch {}
    if (onLiveStatusChange) {
      onLiveStatusChange(isLive);
    }
  }, [isLive, onLiveStatusChange]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      fetchTelemetry(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [isLive, selectedServerId]);

  const toggleExpandProduct = (id: string | number) => {
    setExpandedProductIds(prev => ({
      ...prev,
      [String(id)]: !prev[String(id)]
    }));
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUserId(id);
    setTimeout(() => setCopiedUserId(null), 2000);
  };

  const handleAskAI = () => {
    if (!onSendToAI) return;
    const summary = licenseData?.summary;
    const totalEntitled = summary?.total_entitled_seats ?? 0;
    const totalAssigned = summary?.total_assigned_seats ?? 0;
    const activeSessions = licenseData?.logged_in_users?.length ?? 0;
    const overAllocated = summary?.over_allocated_count ?? 0;
    const topModules = licenseData?.license_entitlements?.slice(0, 6)
      .map(m => `${m.license_name} (Entitled: ${m.entitled_count}, Assigned: ${m.assigned_count}, Active: ${m.active_count}, Saturation: ${m.assigned_utilization_pct}%)`)
      .join('\n- ') || 'N/A';

    const prompt = `Perform a TRIRIGA License Entitlement vs Usage & Active User Forensic Audit based on live database telemetry:
- Cluster Target: ${selectedServerId === 'prod_cluster' ? 'Production Cluster (All Prod Nodes)' : `Server ID ${selectedServerId}`}
- Total Entitled License Quota: ${totalEntitled} seats
- Total Assigned Seats: ${totalAssigned} users across USER_PRODUCT
- Currently Logged-In Active Users: ${activeSessions} live sessions
- Overall Entitlement Saturation: ${summary?.overall_saturation_pct ?? 0}%
- Over-Allocated Products: ${overAllocated}
- Key Product Entitlements Breakdown:
- ${topModules}

Please evaluate:
1. License compliance and any over-allocated or saturated product modules.
2. Active user concurrency patterns vs named seat entitlements.
3. Recommendations to optimize TRIRIGA product licenses, reclaim dormant user licenses, and adjust timeout policies.`;

    onSendToAI(prompt);
  };

  // Current tab account counts for the selector
  const currentTabAccountCounts = useMemo(() => {
    if (activeTab === 'logged_in') {
      const list = licenseData?.logged_in_users || [];
      return {
        all: list.length,
        internal: list.filter(u => (u.account_type || getAccountType(u)) === 'internal').length,
        external: list.filter(u => (u.account_type || getAccountType(u)) === 'external').length,
        oslc: list.filter(u => (u.account_type || getAccountType(u)) === 'oslc').length,
      };
    }
    if (activeTab === 'dormant') {
      const list = licenseData?.dormant_users || [];
      return {
        all: list.length,
        internal: list.filter(u => (u.account_type || getAccountType(u)) === 'internal').length,
        external: list.filter(u => (u.account_type || getAccountType(u)) === 'external').length,
        oslc: list.filter(u => (u.account_type || getAccountType(u)) === 'oslc').length,
      };
    }
    if (activeTab === 'sessions') {
      const list = licenseData?.recent_sessions || [];
      return {
        all: list.length,
        internal: list.filter(s => (s.account_type || getAccountType(s)) === 'internal').length,
        external: list.filter(s => (s.account_type || getAccountType(s)) === 'external').length,
        oslc: list.filter(s => (s.account_type || getAccountType(s)) === 'oslc').length,
      };
    }
    return {
      all: licenseData?.summary?.total_assigned_seats ?? 0,
      internal: licenseData?.summary?.internal_accounts_count ?? 0,
      external: licenseData?.summary?.external_accounts_count ?? 0,
      oslc: licenseData?.summary?.oslc_accounts_count ?? 0,
    };
  }, [licenseData, activeTab]);

  // Filter currently logged in users (ordered by recency of access)
  const filteredLoggedInUsers = useMemo(() => {
    if (!licenseData?.logged_in_users) return [];
    let list = licenseData.logged_in_users;

    // Filter by account type
    if (accountTypeFilter !== 'all') {
      list = list.filter(u => (u.account_type || getAccountType(u)) === accountTypeFilter);
    }

    if (userFilter.trim()) {
      const q = userFilter.toLowerCase();
      list = list.filter(u => {
        const name = (u.user_name || '').toLowerCase();
        const id = (u.user_id || '').toLowerCase();
        const ip = (u.ip_address || '').toLowerCase();
        const lics = (u.assigned_licenses || []).join(' ').toLowerCase();
        return name.includes(q) || id.includes(q) || ip.includes(q) || lics.includes(q);
      });
    }
    return [...list].sort((a, b) => {
      const timeA = a.last_access_time ? new Date(a.last_access_time).getTime() : (a.login_time ? new Date(a.login_time).getTime() : 0);
      const timeB = b.last_access_time ? new Date(b.last_access_time).getTime() : (b.login_time ? new Date(b.login_time).getTime() : 0);
      return timeB - timeA;
    });
  }, [licenseData?.logged_in_users, userFilter, accountTypeFilter]);

  // Filter historical sessions
  const filteredSessions = useMemo(() => {
    if (!licenseData?.recent_sessions) return [];
    let list = licenseData.recent_sessions;

    if (accountTypeFilter !== 'all') {
      list = list.filter(s => (s.account_type || getAccountType(s)) === accountTypeFilter);
    }

    if (!userFilter.trim()) return list;
    const q = userFilter.toLowerCase();
    return list.filter(sess => {
      const name = String(sess.SPEC_NAME || sess.spec_name || sess.user_name || '').toLowerCase();
      const id = String(sess.USER_ID || sess.user_id || '').toLowerCase();
      const ip = String(sess.IP_ADDRESS || sess.ip_address || '').toLowerCase();
      return name.includes(q) || id.includes(q) || ip.includes(q);
    });
  }, [licenseData?.recent_sessions, userFilter, accountTypeFilter]);

  // Filter entitlements
  const filteredEntitlements = useMemo(() => {
    if (!licenseData?.license_entitlements) return [];
    let list = licenseData.license_entitlements;
    if (entitlementTierFilter !== 'all') {
      list = list.filter(e => e.tier_type === entitlementTierFilter);
    }
    if (accountTypeFilter !== 'all') {
      list = list.filter(e => {
        if (e.account_type_counts && e.account_type_counts[accountTypeFilter] !== undefined) {
          return e.account_type_counts[accountTypeFilter] > 0;
        }
        return (e.assigned_users || []).some(u => (u.account_type || getAccountType(u)) === accountTypeFilter);
      });
    }
    if (!userFilter.trim()) return list;
    const q = userFilter.toLowerCase();
    return list.filter(e => {
      const name = e.license_name.toLowerCase();
      const cat = (e.category || '').toLowerCase();
      const userMatches = (e.assigned_users || []).some(u => u.user_name.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q));
      return name.includes(q) || cat.includes(q) || userMatches || String(e.product_id).includes(q);
    });
  }, [licenseData?.license_entitlements, userFilter, entitlementTierFilter, accountTypeFilter]);

  const exportUsersToCSV = () => {
    if (!filteredLoggedInUsers.length) return;
    const headers = ['User Name', 'User ID', 'Account Type', 'Login Time', 'Client IP', 'Status', 'Assigned Licenses'];
    const rows = filteredLoggedInUsers.map(u => [
      u.user_name,
      u.user_id,
      u.account_type_label || (u.account_type ? u.account_type.toUpperCase() : 'INTERNAL'),
      u.login_time,
      u.ip_address || '127.0.0.1',
      u.is_active ? 'Active' : 'Logged In',
      (u.assigned_licenses || []).join('; ')
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `tririga_active_users_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportEntitlementsToCSV = () => {
    if (!filteredEntitlements.length) return;
    const headers = ['Product ID', 'License Name', 'Category', 'Entitled Seats', 'Assigned Seats', 'Internal Seats', 'External Seats', 'OSLC Seats', 'Active Users', 'Available Seats', 'Utilization %', 'Status'];
    const rows = filteredEntitlements.map(e => [
      e.product_id,
      e.license_name,
      e.category || 'Standard Product',
      e.entitled_count,
      e.assigned_count,
      e.account_type_counts?.internal ?? 0,
      e.account_type_counts?.external ?? 0,
      e.account_type_counts?.oslc ?? 0,
      e.active_count,
      e.available_count,
      `${e.assigned_utilization_pct}%`,
      e.status
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `tririga_license_entitlements_vs_usage_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter dormant / inactive users
  const filteredDormantUsers = useMemo(() => {
    if (!licenseData?.dormant_users) return [];
    let list = licenseData.dormant_users;

    // Filter by account type
    if (accountTypeFilter !== 'all') {
      list = list.filter(u => (u.account_type || getAccountType(u)) === accountTypeFilter);
    }

    // Filter by module / tier
    if (dormantModuleFilter === 'dormant_all') {
      list = list.filter(u => u.dormancy_tier !== 'active_recently');
    } else if (dormantModuleFilter === '3053') {
      list = list.filter(u => u.assigned_pids.includes(3053) && u.dormancy_tier !== 'active_recently');
    } else if (dormantModuleFilter === '3048') {
      list = list.filter(u => u.assigned_pids.includes(3048) && u.dormancy_tier !== 'active_recently');
    } else if (dormantModuleFilter === '3050') {
      list = list.filter(u => u.assigned_pids.includes(3050) && u.dormancy_tier !== 'active_recently');
    } else if (dormantModuleFilter === 'never') {
      list = list.filter(u => u.dormancy_tier === 'never_logged_in');
    } else if (dormantModuleFilter === '365d') {
      list = list.filter(u => u.dormancy_tier === 'inactive_365d');
    } else if (dormantModuleFilter === '180d') {
      list = list.filter(u => u.dormancy_tier === 'inactive_180d' || u.dormancy_tier === 'inactive_365d');
    } else if (dormantModuleFilter === '90d') {
      list = list.filter(u => u.dormancy_tier === 'inactive_90d' || u.dormancy_tier === 'inactive_180d' || u.dormancy_tier === 'inactive_365d');
    } else if (dormantModuleFilter === '30d') {
      list = list.filter(u => u.dormancy_tier === 'inactive_30d');
    } else if (dormantModuleFilter === 'active') {
      list = list.filter(u => u.dormancy_tier === 'active_recently');
    } else if (dormantModuleFilter === 'all') {
      // Show all accounts including active
    }

    // Filter by priority
    if (dormantPriorityFilter !== 'all') {
      list = list.filter(u => u.reclamation_priority === dormantPriorityFilter);
    }

    // Filter by search text
    if (userFilter.trim()) {
      const q = userFilter.toLowerCase();
      list = list.filter(u => {
        const name = (u.user_name || '').toLowerCase();
        const uacc = (u.user_account || '').toLowerCase();
        const id = (u.user_id || '').toLowerCase();
        const lics = (u.assigned_licenses || []).join(' ').toLowerCase();
        const reason = (u.reclamation_reason || '').toLowerCase();
        return name.includes(q) || uacc.includes(q) || id.includes(q) || lics.includes(q) || reason.includes(q);
      });
    }

    return list;
  }, [licenseData?.dormant_users, dormantModuleFilter, dormantPriorityFilter, userFilter, accountTypeFilter]);

  const exportDormantUsersToCSV = () => {
    if (!filteredDormantUsers.length) return;
    const headers = ['User ID', 'User Name', 'Username / Account', 'Account Type', 'Account Creation Date', 'Assigned Licences', 'Product IDs', 'Master Account Last Login', 'Session Last Login', 'Total Sessions Recorded', 'Days Inactive', 'Dormancy Tier', 'Reclamation Priority', 'Reclamation Reason'];
    const rows = filteredDormantUsers.map(u => [
      u.user_id,
      u.user_name,
      u.user_account || 'N/A',
      u.account_type_label || (u.account_type ? u.account_type.toUpperCase() : 'INTERNAL'),
      u.created_date || u.account_created_date || 'N/A',
      (u.assigned_licenses || []).join('; '),
      (u.assigned_pids || []).join('; '),
      u.account_last_login || 'Never Logged In',
      u.session_last_login || 'None in retention window',
      u.login_count,
      u.days_inactive !== null ? u.days_inactive : 'N/A (Never)',
      u.dormancy_tier,
      u.reclamation_priority,
      u.reclamation_reason
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `tririga_dormant_users_reclamation_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelectDormantUser = (uid: string) => {
    setSelectedDormantUserIds(prev => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  const toggleSelectAllDormantUsers = () => {
    if (selectedDormantUserIds.size >= filteredDormantUsers.length && filteredDormantUsers.length > 0) {
      setSelectedDormantUserIds(new Set());
    } else {
      setSelectedDormantUserIds(new Set(filteredDormantUsers.map(u => u.user_id)));
    }
  };

  const selectHighPriorityDormant = () => {
    if (!licenseData?.dormant_users) return;
    const highPriority = licenseData.dormant_users.filter(u => u.reclamation_priority === 'HIGH').map(u => u.user_id);
    setSelectedDormantUserIds(new Set(highPriority));
  };

  // Generate deprovisioning SQL for selected users or all high-priority dormant users
  const generatedDeprovisionSQL = useMemo(() => {
    const targetUsers = selectedDormantUserIds.size > 0
      ? (licenseData?.dormant_users || []).filter(u => selectedDormantUserIds.has(u.user_id))
      : (licenseData?.dormant_users || []).filter(u => u.reclamation_priority === 'HIGH');

    const users3053 = targetUsers.filter(u => u.assigned_pids.includes(3053)).map(u => `'${u.user_id}'`);
    const users3048 = targetUsers.filter(u => u.assigned_pids.includes(3048)).map(u => `'${u.user_id}'`);
    const users3050 = targetUsers.filter(u => u.assigned_pids.includes(3050)).map(u => `'${u.user_id}'`);

    const chunks: string[] = [
      `-- =========================================================================`,
      `-- IBM TRIRIGA SaaS License Deprovisioning & Reclamation Script`,
      `-- Generated: ${new Date().toISOString()}`,
      `-- Cluster Target: ${selectedServerInfo.name}`,
      `-- Total Dormant Users Targeted: ${targetUsers.length}`,
      `-- =========================================================================\n`
    ];

    if (users3053.length > 0) {
      chunks.push(`-- 1. Reclaim Occasional Enterprise Licences (Product ID 3053)`);
      chunks.push(`-- Target: ${users3053.length} dormant seats (Quota is 200, Assigned is 299 -> Resolves +99 over-allocation)`);
      chunks.push(`DELETE FROM USER_PRODUCT`);
      chunks.push(`WHERE PRODUCT_ID = 3053`);
      chunks.push(`  AND USER_ID IN (\n    ${users3053.join(',\n    ')}\n  );\n`);
    }

    if (users3048.length > 0) {
      chunks.push(`-- 2. Reclaim Approvals & Reporting Licences (Product ID 3048)`);
      chunks.push(`-- Target: ${users3048.length} dormant seats (Quota is 200, Assigned is 215 -> Resolves +15 over-allocation)`);
      chunks.push(`DELETE FROM USER_PRODUCT`);
      chunks.push(`WHERE PRODUCT_ID = 3048`);
      chunks.push(`  AND USER_ID IN (\n    ${users3048.join(',\n    ')}\n  );\n`);
    }

    if (users3050.length > 0) {
      chunks.push(`-- 3. Reclaim Enterprise Core Licences (Product ID 3050)`);
      chunks.push(`-- Target: ${users3050.length} dormant seats (Quota is 25, Assigned is 23)`);
      chunks.push(`DELETE FROM USER_PRODUCT`);
      chunks.push(`WHERE PRODUCT_ID = 3050`);
      chunks.push(`  AND USER_ID IN (\n    ${users3050.join(',\n    ')}\n  );\n`);
    }

    chunks.push(`-- Commit the deprovisioning transaction`);
    chunks.push(`COMMIT;`);

    return chunks.join('\n');
  }, [licenseData?.dormant_users, selectedDormantUserIds, selectedServerInfo.name]);

  const summary = licenseData?.summary;
  const totalEntitled = summary?.total_entitled_seats ?? 500;
  const totalAssigned = summary?.total_assigned_seats ?? (licenseData?.license_distribution?.reduce((acc, i) => acc + (i.count || 0), 0) ?? 0);
  const totalActive = licenseData?.logged_in_users ? licenseData.logged_in_users.length : 0;
  const overallSat = summary?.overall_saturation_pct ?? (totalEntitled > 0 ? Math.round((totalAssigned / totalEntitled) * 100) : 0);
  const overAllocatedCount = summary?.over_allocated_count ?? 0;

  return (
    <div className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">User Activity & License Entitlements</h1>
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              <ShieldCheck className="w-3 h-3 text-cyan-400" />
              <span>Production Cluster</span>
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Live Polling</span>
              </span>
            )}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">
            Real-time active user sessions, contractual license entitlement quotas vs. assigned seats from USER_PRODUCT & SESSION_HISTORY across the TRIRIGA Production Cluster.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Server Selector - Defaults to Production Cluster */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value === 'prod_cluster' ? 'prod_cluster' : Number(e.target.value))}
              className="bg-transparent border-none text-white text-xs focus:outline-none cursor-pointer font-medium"
            >
              <optgroup label="Production Cluster (Default)">
                <option value="prod_cluster" className="bg-slate-900 text-emerald-300 font-semibold">
                  ⚡ Production Cluster (All Prod Nodes)
                </option>
                {prodServers.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                    {s.name} ({s.host})
                  </option>
                ))}
              </optgroup>
              {nonProdServers.length > 0 && (
                <optgroup label="Other Environments (Non-Prod)">
                  {nonProdServers.map(s => (
                    <option key={s.id} value={s.id} className="bg-slate-900 text-slate-400">
                      {s.name} ({s.host})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Live Auto-Refresh Toggle */}
          <button
            onClick={() => setIsLive(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isLive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800'
            }`}
            title="Toggle real-time 10-second polling"
          >
            {isLive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isLive ? 'Live: 10s' : 'Auto-Refresh'}</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => fetchTelemetry(false)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium border border-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refresh</span>
          </button>

          {/* User Directory & CSV Export Quick Button */}
          <button
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              activeTab === 'directory'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                : 'bg-slate-900 text-slate-300 hover:text-white border-slate-800'
            }`}
            title="Open TRIRIGA User Directory & CSV Export"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>User Directory (CSV)</span>
          </button>

          {/* Ask AI Assistant */}
          {onSendToAI && (
            <button
              onClick={handleAskAI}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Audit Compliance with AI</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
        </div>
      )}

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Currently Logged In Users */}
        <div 
          onClick={() => setActiveTab('logged_in')}
          className={`p-4 rounded-xl border shadow-md cursor-pointer transition-all ${
            activeTab === 'logged_in' 
              ? 'bg-slate-900/90 border-cyan-500/50 shadow-cyan-500/10' 
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Currently Logged In</span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono flex items-baseline gap-2">
            <span>{totalActive}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">active sessions</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate" title={`Scope: ${selectedServerInfo.name}`}>
            Scope: <strong className="text-slate-300 font-medium">{selectedServerInfo.name}</strong>
          </p>
          <CardSparkline 
            data={getSparkData('activeUsers', totalActive)} 
            color="#10b981" 
          />
        </div>

        {/* Assigned License Seats */}
        <div 
          onClick={() => setActiveTab('entitlements')}
          className={`p-4 rounded-xl border shadow-md cursor-pointer transition-all ${
            activeTab === 'entitlements' 
              ? 'bg-slate-900/90 border-cyan-500/50 shadow-cyan-500/10' 
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Assigned License Seats</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono flex items-baseline gap-2">
            <span>{totalAssigned}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">of {totalEntitled} total</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Users provisioned in USER_PRODUCT</p>
          <CardSparkline 
            data={getSparkData('licenseSeats', totalAssigned)} 
            color="#06b6d4" 
          />
        </div>

        {/* Total Entitled Quota */}
        <div 
          onClick={() => setActiveTab('entitlements')}
          className={`p-4 rounded-xl border shadow-md cursor-pointer transition-all ${
            activeTab === 'entitlements' 
              ? 'bg-slate-900/90 border-cyan-500/50 shadow-cyan-500/10' 
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Contracted Entitlements</span>
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-indigo-300 font-mono flex items-baseline gap-2">
            <span>{totalEntitled}</span>
            <span className="text-xs font-sans text-slate-400 font-normal">seats across {licenseData?.license_distribution?.length ?? 0} modules</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">SaaS Contract Quota ({selectedServerInfo.name})</p>
          <CardSparkline 
            data={getSparkData('entitledSeats', totalEntitled)} 
            color="#6366f1" 
          />
        </div>

        {/* License Saturation & Compliance */}
        <div 
          onClick={() => setActiveTab('entitlements')}
          className={`p-4 rounded-xl border shadow-md cursor-pointer transition-all ${
            activeTab === 'entitlements' 
              ? 'bg-slate-900/90 border-cyan-500/50 shadow-cyan-500/10' 
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-medium">Compliance & Saturation</span>
            {overAllocatedCount > 0 ? (
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div className="text-2xl font-bold font-mono flex items-baseline gap-2">
            <span className={overallSat > 100 ? 'text-rose-400' : overallSat >= 85 ? 'text-amber-400' : 'text-cyan-300'}>
              {overallSat}%
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              overAllocatedCount > 0 
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' 
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            }`}>
              {overAllocatedCount > 0 ? `${overAllocatedCount} Over-Allocated` : 'Compliant'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Total assigned vs entitled capacity</p>
          <CardSparkline 
            data={getSparkData('saturation', overallSat)} 
            color={overallSat > 100 ? '#f43f5e' : overallSat >= 85 ? '#f59e0b' : '#0ea5e9'} 
          />
        </div>
      </div>

      {/* Verified Entitlement Source Callout */}
      <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            <strong className="text-slate-200">Verified Quota Source:</strong> IBM TRIRIGA Cloud SaaS Enterprise Contract Entitlements &amp; DB2 system tables (<code className="text-cyan-300 font-mono text-[11px]">T_TRILICENSE</code>, <code className="text-cyan-300 font-mono text-[11px]">USER_PRODUCT</code>).
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
          <span>Active Scope: <strong className="text-slate-300">{selectedServerInfo.name}</strong></span>
        </div>
      </div>

      {/* Main Navigation Sub-Tabs */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto nav-scrollbar pb-1 w-full xl:w-auto shrink-0">
          <button
            onClick={() => setActiveTab('logged_in')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'logged_in'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Currently Logged In Users</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">
              {totalActive}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('entitlements')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'entitlements'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Licence Entitlements vs. Usage Matrix</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono">
              {licenseData?.license_entitlements?.length ?? 0}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('charts')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'charts'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Entitlement Visual Comparison</span>
          </button>

          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'sessions'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Historical Session Audit</span>
          </button>

          <button
            onClick={() => setActiveTab('dormant')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'dormant'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UserX className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Dormant &amp; Inactive Licences</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold">
              {licenseData?.dormant_summary?.never_logged_in_count ?? 380} Dormant
            </span>
          </button>

          <button
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeTab === 'directory'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>User Directory &amp; CSV</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-bold">
              CSV Export
            </span>
          </button>
        </div>

        {/* Global Account Type Selector and Search */}
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-end">
          <AccountTypeSelector
            value={accountTypeFilter}
            onChange={setAccountTypeFilter}
            counts={currentTabAccountCounts}
            size="sm"
          />
          <div className="relative flex items-center w-full sm:w-64 xl:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
            <input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder={
                activeTab === 'logged_in' 
                  ? 'Search active users, IP, license...' 
                  : activeTab === 'entitlements'
                    ? 'Search licence modules...'
                    : activeTab === 'dormant'
                      ? 'Search dormant users, IDs, licenses...'
                      : 'Filter records...'
              }
              className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 w-full"
            />
          </div>
        </div>
      </div>

      {/* TAB 1: CURRENTLY LOGGED IN USERS */}
      {activeTab === 'logged_in' && (
        <ActiveUsersTable
          filteredLoggedInUsers={filteredLoggedInUsers}
          selectedServerInfo={selectedServerInfo}
          loading={loading}
          licenseData={licenseData}
          timeMode={timeMode}
          toggleTimeMode={toggleTimeMode}
          localTzInfo={localTzInfo}
          lastRefreshed={lastRefreshed}
          formatDisplayTime={formatDisplayTime}
          userFilter={userFilter}
          setActiveTab={setActiveTab}
          copiedUserId={copiedUserId}
          handleCopyText={handleCopyText}
          onExportCSV={exportUsersToCSV}
          accountTypeFilter={accountTypeFilter}
          onAccountTypeChange={setAccountTypeFilter}
          rawUsers={licenseData?.logged_in_users || []}
        />
      )}

      {/* TAB 2: LICENCE ENTITLEMENTS VS USAGE MATRIX */}
      {activeTab === 'entitlements' && (
        <LicenseEntitlementsTable
          licenseData={licenseData}
          loading={loading}
          filteredEntitlements={filteredEntitlements}
          entitlementTierFilter={entitlementTierFilter}
          setEntitlementTierFilter={setEntitlementTierFilter}
          expandedProductIds={expandedProductIds}
          toggleExpandProduct={toggleExpandProduct}
          onExportCSV={exportEntitlementsToCSV}
          accountTypeFilter={accountTypeFilter}
          onAccountTypeChange={setAccountTypeFilter}
        />
      )}


      {/* TAB 3: VISUAL ENTITLEMENT & CONSUMPTION ANALYTICS */}
      {activeTab === 'charts' && (
        <LicenseVisualAnalytics
          licenseData={licenseData}
          selectedServerInfo={selectedServerInfo}
          filteredEntitlements={filteredEntitlements}
          overallSat={overallSat}
          overAllocatedCount={overAllocatedCount}
          totalEntitled={totalEntitled}
          totalAssigned={totalAssigned}
          totalActive={totalActive}
        />
      )}

      {/* TAB 4: HISTORICAL SESSION AUDIT */}
      {activeTab === 'sessions' && (
        <SessionAuditTable
          filteredSessions={filteredSessions}
          formatDisplayTime={formatDisplayTime}
          accountTypeFilter={accountTypeFilter}
          onAccountTypeChange={setAccountTypeFilter}
          rawSessions={licenseData?.recent_sessions || []}
        />
      )}

      {/* TAB 5: DORMANT & INACTIVE LICENCE AUDITOR (RECLAMATION) */}
      {activeTab === 'dormant' && (
        <DormantAccountsTable
          licenseData={licenseData}
          filteredDormantUsers={filteredDormantUsers}
          selectedDormantUserIds={selectedDormantUserIds}
          setSelectedDormantUserIds={setSelectedDormantUserIds}
          toggleSelectDormantUser={toggleSelectDormantUser}
          toggleSelectAllDormantUsers={toggleSelectAllDormantUsers}
          selectHighPriorityDormant={selectHighPriorityDormant}
          dormantModuleFilter={dormantModuleFilter}
          setDormantModuleFilter={setDormantModuleFilter}
          dormantPriorityFilter={dormantPriorityFilter}
          setDormantPriorityFilter={setDormantPriorityFilter}
          onOpenDeprovisionModal={() => setShowDeprovisionModal(true)}
          formatDisplayTime={formatDisplayTime}
          copiedUserId={copiedUserId}
          handleCopyText={handleCopyText}
          onExportCSV={exportDormantUsersToCSV}
          accountTypeFilter={accountTypeFilter}
          onAccountTypeChange={setAccountTypeFilter}
          rawDormantUsers={licenseData?.dormant_users || []}
        />
      )}

      {/* TAB 6: TRIRIGA USER DIRECTORY & CSV EXPORT */}
      {activeTab === 'directory' && (
        <UserDirectoryTable
          servers={servers}
          selectedServerId={selectedServerId}
          selectedServerInfo={selectedServerInfo}
          onSendToAI={onSendToAI}
        />
      )}


      {/* DEPROVISIONING SCRIPT MODAL */}
      <DeprovisionModal
        isOpen={showDeprovisionModal}
        onClose={() => setShowDeprovisionModal(false)}
        generatedSQL={generatedDeprovisionSQL}
        selectedCount={selectedDormantUserIds.size}
        totalReclaimableCount={licenseData?.dormant_summary?.high_priority_reclaimable ?? 376}
      />

    </div>
  );
};
