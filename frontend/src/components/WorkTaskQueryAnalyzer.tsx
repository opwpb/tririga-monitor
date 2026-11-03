import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Wrench,
  Flame,
  Clock,
  Lock,
  Layers,
  Search,
  RefreshCw,
  Server,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  BrainCircuit,
  Copy,
  Check,
  Zap,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  FolderTree,
  ListFilter,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Sliders,
  Database,
  ArrowUpDown,
  Filter,
  Activity,
  GitBranch,
  FileCode,
  ShieldAlert,
  Info,
  Calendar,
  X,
  Sparkles
} from 'lucide-react';
import {
  TririgaServer,
  WorkTaskQueryIncident,
  WorkTaskQueryResponse,
  WorkTaskLiveTelemetry,
  WorkflowBottleneckItem,
  WorkTaskRecord
} from '../types';
import { api } from '../services/api';

export type SortColumn = 'record' | 'type' | 'timing' | 'latency' | 'table' | 'workflow' | 'server';
export type SortDirection = 'asc' | 'desc' | 'none';
export type GroupByOption = 'none' | 'record' | 'type' | 'timing' | 'latency' | 'table' | 'workflow' | 'server';

export interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

export interface ColumnFilters {
  record: string;
  type: string;
  timing: string;
  minDuration: string;
  maxDuration: string;
  table: string;
  workflow: string;
  server: string;
}

interface WorkTaskQueryAnalyzerProps {
  servers: TririgaServer[];
  onSendToAI?: (promptText: string) => void;
  onLiveStatusChange?: (isLive: boolean) => void;
}

export const WorkTaskQueryAnalyzer: React.FC<WorkTaskQueryAnalyzerProps> = ({
  servers,
  onSendToAI,
  onLiveStatusChange
}) => {
  // Server Selection
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(() => {
    return servers.length > 0 ? servers[0].id : undefined;
  });

  // View Mode: 'amalgamated' (logs + forensic incidents) | 'live' (DB2 live telemetry) | 'bottlenecks' (workflow tasks)
  const [viewMode, setViewMode] = useState<'amalgamated' | 'live' | 'bottlenecks'>('amalgamated');

  // Backend / Global Filters
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>('ALL');
  const [minDurationMs, setMinDurationMs] = useState<number>(1000);
  const [timeRange, setTimeRange] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Advanced Interactive Column Heading: Sorting, Grouping & Filtering
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: 'none' });
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeFilterPopover, setActiveFilterPopover] = useState<SortColumn | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);

  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    record: '',
    type: 'ALL',
    timing: '',
    minDuration: '',
    maxDuration: '',
    table: 'ALL',
    workflow: '',
    server: 'ALL'
  });

  // Close filter popover on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(event.target as Node)) {
        setActiveFilterPopover(null);
      }
    };
    if (activeFilterPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeFilterPopover]);

  // Compute time bounds from timeRange
  const { startTime, endTime } = useMemo(() => {
    if (timeRange === 'ALL') return { startTime: undefined, endTime: undefined };
    const now = new Date();
    let start: Date;
    if (timeRange === '1H') {
      start = new Date(now.getTime() - 60 * 60 * 1000);
    } else if (timeRange === '24H') {
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (timeRange === '7D') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '30D') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      return { startTime: undefined, endTime: undefined };
    }
    return {
      startTime: start.toISOString(),
      endTime: now.toISOString()
    };
  }, [timeRange]);

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(10);

  // Data States
  const [loading, setLoading] = useState<boolean>(false);
  const [incidentData, setIncidentData] = useState<WorkTaskQueryResponse | null>(null);
  const [liveTelemetry, setLiveTelemetry] = useState<WorkTaskLiveTelemetry | null>(null);
  const [bottlenecks, setBottlenecks] = useState<WorkflowBottleneckItem[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<WorkTaskQueryIncident | null>(null);
  const [selectedRecordDetails, setSelectedRecordDetails] = useState<WorkTaskRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showGlossaryModal, setShowGlossaryModal] = useState<boolean>(false);

  // Synchronize live indicator with parent app
  useEffect(() => {
    if (onLiveStatusChange) {
      onLiveStatusChange(autoRefresh);
    }
  }, [autoRefresh, onLiveStatusChange]);

  // Load Incidents from Amalgamated Logs
  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getWorkTaskQueriesAndContention({
        serverId: selectedServerId,
        issueType: issueTypeFilter,
        minDurationMs: minDurationMs,
        search: searchQuery.trim() || undefined,
        startTime: startTime,
        endTime: endTime,
        page: page,
        pageSize: pageSize
      });
      setIncidentData(res);
    } catch (err) {
      console.error('Failed to load worktask query incidents:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, issueTypeFilter, minDurationMs, searchQuery, startTime, endTime, page, pageSize]);

  // Load Live DB2 Telemetry
  const fetchLiveTelemetry = useCallback(async () => {
    try {
      const res = await api.getWorkTaskLiveTelemetry(selectedServerId);
      setLiveTelemetry(res);
    } catch (err) {
      console.error('Failed to load live worktask telemetry:', err);
    }
  }, [selectedServerId]);

  // Load Workflow Bottlenecks
  const fetchBottlenecks = useCallback(async () => {
    try {
      const res = await api.getWorkTaskWorkflowBottlenecks(selectedServerId);
      setBottlenecks(res.bottlenecks || []);
    } catch (err) {
      console.error('Failed to load workflow bottlenecks:', err);
    }
  }, [selectedServerId]);

  // Initial and reactive load
  useEffect(() => {
    if (viewMode === 'amalgamated') {
      fetchIncidents();
    } else if (viewMode === 'live') {
      fetchLiveTelemetry();
    } else if (viewMode === 'bottlenecks') {
      fetchBottlenecks();
    }
  }, [viewMode, fetchIncidents, fetchLiveTelemetry, fetchBottlenecks]);

  // Periodic Auto-refresh Timer
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (viewMode === 'amalgamated') {
        fetchIncidents();
      } else if (viewMode === 'live') {
        fetchLiveTelemetry();
      }
    }, refreshIntervalSec * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshIntervalSec, viewMode, fetchIncidents, fetchLiveTelemetry]);

  // Handle Inspecting a WorkTask Record
  const handleInspectRecord = async (identifier: string, incident?: WorkTaskQueryIncident) => {
    if (incident) {
      setSelectedIncident(incident);
    }
    setLoadingRecord(true);
    try {
      const rec = await api.getWorkTaskRecord(identifier);
      setSelectedRecordDetails(rec);
    } catch (err) {
      console.error('Failed to load record details:', err);
    } finally {
      setLoadingRecord(false);
    }
  };

  // One-click Copy Handler
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Launch AI Prompt with exact context
  const handleAskAI = (incident: WorkTaskQueryIncident) => {
    if (!onSendToAI) return;
    const taskName = incident.worktask?.name || incident.worktask?.control_number || `Spec ID: ${incident.worktask?.spec_id}`;
    const wfName = incident.workflow?.template_name || 'Workflow Task';
    const wfStep = incident.workflow?.task_step ? ` -> "${incident.workflow.task_step}"` : '';
    const sqlText = incident.sql_statement || 'N/A (Derived from Contention Signature in Log)';
    const primaryTable = (incident.tables_involved && incident.tables_involved.length > 0) ? incident.tables_involved[0] : 'T_TRIWORKTASK';

    const prompt = `Please analyze this TRIRIGA Work Task database performance issue:

**Work Task:** ${taskName} (Control#: \`${incident.worktask?.control_number || 'N/A'}\`, Spec ID: \`${incident.worktask?.spec_id || 'N/A'}\`)
**Incident Type:** ${incident.incident_type} (${incident.severity} Severity)
**Timing & Latency:**
- **Query Started:** ${incident.started_at || 'Calculated from log execution offset'}
- **Query Completed:** ${incident.completed_at || incident.timestamp}
- **Total Execution Duration:** ${incident.duration_formatted || (incident.duration_ms ? `${(incident.duration_ms / 1000).toFixed(2)}s` : 'Active Wait')}
**Target Tables:** ${incident.tables_involved?.join(', ') || 'T_TRIWORKTASK'}
**Executing Workflow Step:** ${wfName}${wfStep}
**System Impact:** ${incident.system_impact || 'Thread contention and queue blocking'}
**Business Impact:** ${incident.business_impact || 'Delays Work Task status updates'}

**SQL Statement:**
\`\`\`sql
${sqlText}
\`\`\`

**Question:**
1. What is the root cause of this query bottleneck / lock contention?
2. How should we optimize the TRIRIGA Workflow and DB2 indexes (e.g. on \`${primaryTable}\`) to eliminate table scans, prevent WFAgent thread starvation, and minimize operational impact?`;

    onSendToAI(prompt);
  };

  // Format Helpers
  const formatDuration = (ms: number | null | undefined, incidentType?: string) => {
    if (ms === null || ms === undefined) {
      return incidentType === 'SLOW_QUERY' ? '< 1.0s' : 'Active Wait';
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
  };

  const getIncidentBadge = (type: string) => {
    switch (type) {
      case 'DEADLOCK':
        return {
          label: 'Deadlock',
          bg: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
          icon: Flame,
          tooltip: 'Deadlock: Two transactions locked resources that each other need in a circular wait graph. DB2 automatically aborted one transaction (SQLCODE -911) with a rollback to break the freeze.'
        };
      case 'LOCK_CONTENTION':
        return {
          label: 'Lock Contention',
          bg: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
          icon: Lock,
          tooltip: 'Lock Contention: Multiple concurrent threads or transactions attempting to modify overlapping records or parent-child association graphs at the same time.'
        };
      case 'SLOW_QUERY':
        return {
          label: 'Slow Query',
          bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          icon: Clock,
          tooltip: 'Slow Query: A SQL statement whose execution duration exceeded standard performance thresholds (>1.0s).'
        };
      case 'TABLE_SCAN':
        return {
          label: 'Table Scan',
          bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          icon: Database,
          tooltip: 'Table Scan: The database reads every single row in the table because no matching index exists for the query filter conditions, consuming high I/O and CPU.'
        };
      default:
        return {
          label: type,
          bg: 'bg-slate-700/40 text-slate-300 border-slate-600',
          icon: Activity,
          tooltip: 'System database operation or workflow execution event.'
        };
    }
  };

  const getSeverityColor = (sev?: string | null) => {
    switch (sev) {
      case 'CRITICAL':
        return 'text-rose-400 font-bold';
      case 'HIGH':
        return 'text-amber-400 font-semibold';
      case 'MEDIUM':
        return 'text-yellow-400';
      default:
        return 'text-slate-400';
    }
  };

  // Extract unique sets for interactive column filter dropdowns
  const availableTables = useMemo(() => {
    const set = new Set<string>();
    (incidentData?.items || []).forEach((inc) => {
      if (inc.tables_involved && inc.tables_involved.length > 0) {
        inc.tables_involved.forEach((t) => set.add(t));
      } else {
        set.add('T_TRIWORKTASK');
      }
    });
    return Array.from(set).sort();
  }, [incidentData?.items]);

  const availableServers = useMemo(() => {
    const set = new Set<string>();
    (incidentData?.items || []).forEach((inc) => {
      if (inc.server_name) set.add(inc.server_name);
    });
    return Array.from(set).sort();
  }, [incidentData?.items]);

  // Sort & Filter Handlers
  const handleToggleSort = (column: SortColumn) => {
    setSortState((prev) => {
      if (prev.column !== column) {
        return { column, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      if (prev.direction === 'desc') {
        return { column: null, direction: 'none' };
      }
      return { column, direction: 'asc' };
    });
  };

  const handleSetSort = (column: SortColumn, direction: SortDirection) => {
    setSortState({ column: direction === 'none' ? null : column, direction });
    setActiveFilterPopover(null);
  };

  const handleClearColumnFilter = (column: SortColumn) => {
    setColumnFilters((prev) => {
      switch (column) {
        case 'record':
          return { ...prev, record: '' };
        case 'type':
          return { ...prev, type: 'ALL' };
        case 'timing':
          return { ...prev, timing: '' };
        case 'latency':
          return { ...prev, minDuration: '', maxDuration: '' };
        case 'table':
          return { ...prev, table: 'ALL' };
        case 'workflow':
          return { ...prev, workflow: '' };
        case 'server':
          return { ...prev, server: 'ALL' };
        default:
          return prev;
      }
    });
  };

  const handleResetAllFiltersAndSort = () => {
    setSortState({ column: null, direction: 'none' });
    setGroupBy('none');
    setCollapsedGroups({});
    setActiveFilterPopover(null);
    setColumnFilters({
      record: '',
      type: 'ALL',
      timing: '',
      minDuration: '',
      maxDuration: '',
      table: 'ALL',
      workflow: '',
      server: 'ALL'
    });
    setIssueTypeFilter('ALL');
    setMinDurationMs(1000);
    setTimeRange('ALL');
    setSearchQuery('');
    setPage(1);
  };

  const isColumnFiltered = (col: SortColumn): boolean => {
    switch (col) {
      case 'record':
        return columnFilters.record.trim().length > 0;
      case 'type':
        return columnFilters.type !== 'ALL';
      case 'timing':
        return columnFilters.timing.trim().length > 0;
      case 'latency':
        return columnFilters.minDuration !== '' || columnFilters.maxDuration !== '';
      case 'table':
        return columnFilters.table !== 'ALL';
      case 'workflow':
        return columnFilters.workflow.trim().length > 0;
      case 'server':
        return columnFilters.server !== 'ALL';
      default:
        return false;
    }
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (columnFilters.record.trim()) count++;
    if (columnFilters.type !== 'ALL') count++;
    if (columnFilters.timing.trim()) count++;
    if (columnFilters.minDuration || columnFilters.maxDuration) count++;
    if (columnFilters.table !== 'ALL') count++;
    if (columnFilters.workflow.trim()) count++;
    if (columnFilters.server !== 'ALL') count++;
    if (sortState.column && sortState.direction !== 'none') count++;
    if (groupBy !== 'none') count++;
    if (searchQuery.trim()) count++;
    if (issueTypeFilter !== 'ALL') count++;
    if (timeRange !== 'ALL') count++;
    return count;
  }, [columnFilters, sortState, groupBy, searchQuery, issueTypeFilter, timeRange]);

  // Client-side Filter & Sort Pipeline
  const processedIncidents = useMemo(() => {
    if (!incidentData?.items) return [];

    let items = [...incidentData.items];

    // Column Filter: Record
    if (columnFilters.record.trim()) {
      const q = columnFilters.record.toLowerCase().trim();
      items = items.filter((inc) => {
        const cnum = inc.worktask?.control_number?.toLowerCase() || '';
        const name = inc.worktask?.name?.toLowerCase() || '';
        const spec = inc.worktask?.spec_id ? String(inc.worktask.spec_id) : '';
        return cnum.includes(q) || name.includes(q) || spec.includes(q);
      });
    }

    // Column Filter: Type
    if (columnFilters.type !== 'ALL') {
      items = items.filter((inc) => inc.incident_type === columnFilters.type);
    }

    // Column Filter: Timing
    if (columnFilters.timing.trim()) {
      const q = columnFilters.timing.toLowerCase().trim();
      items = items.filter((inc) => {
        const s = (inc.started_at || '').toLowerCase();
        const e = (inc.completed_at || inc.timestamp || '').toLowerCase();
        return s.includes(q) || e.includes(q);
      });
    }

    // Column Filter: Latency Duration
    if (columnFilters.minDuration && !isNaN(Number(columnFilters.minDuration))) {
      const minD = Number(columnFilters.minDuration);
      items = items.filter((inc) => (inc.duration_ms ?? 0) >= minD);
    }
    if (columnFilters.maxDuration && !isNaN(Number(columnFilters.maxDuration))) {
      const maxD = Number(columnFilters.maxDuration);
      items = items.filter((inc) => (inc.duration_ms ?? 0) <= maxD);
    }

    // Column Filter: Target Table
    if (columnFilters.table !== 'ALL') {
      items = items.filter((inc) => {
        if (inc.tables_involved && inc.tables_involved.length > 0) {
          return inc.tables_involved.includes(columnFilters.table);
        }
        return columnFilters.table === 'T_TRIWORKTASK';
      });
    }

    // Column Filter: Workflow
    if (columnFilters.workflow.trim()) {
      const q = columnFilters.workflow.toLowerCase().trim();
      items = items.filter((inc) => {
        const tname = inc.workflow?.template_name?.toLowerCase() || '';
        const tstep = inc.workflow?.task_step?.toLowerCase() || '';
        return tname.includes(q) || tstep.includes(q);
      });
    }

    // Column Filter: Server
    if (columnFilters.server !== 'ALL') {
      items = items.filter((inc) => inc.server_name === columnFilters.server);
    }

    // Sorting
    if (sortState.column && sortState.direction !== 'none') {
      const isAsc = sortState.direction === 'asc';
      const factor = isAsc ? 1 : -1;

      items.sort((a, b) => {
        switch (sortState.column) {
          case 'record': {
            const idA = a.worktask?.control_number || (a.worktask?.spec_id ? String(a.worktask.spec_id) : a.worktask?.name || '');
            const idB = b.worktask?.control_number || (b.worktask?.spec_id ? String(b.worktask.spec_id) : b.worktask?.name || '');
            return idA.localeCompare(idB) * factor;
          }
          case 'type': {
            const typeWeight: Record<string, number> = {
              DEADLOCK: 4,
              LOCK_CONTENTION: 3,
              TABLE_SCAN: 2,
              SLOW_QUERY: 1
            };
            const wA = typeWeight[a.incident_type] || 0;
            const wB = typeWeight[b.incident_type] || 0;
            if (wA !== wB) return (wA - wB) * factor;
            return a.incident_type.localeCompare(b.incident_type) * factor;
          }
          case 'timing': {
            const timeA = a.started_at || a.timestamp || '';
            const timeB = b.started_at || b.timestamp || '';
            return timeA.localeCompare(timeB) * factor;
          }
          case 'latency': {
            const durA = a.duration_ms ?? 0;
            const durB = b.duration_ms ?? 0;
            if (durA !== durB) return (durA - durB) * factor;
            const timeA = a.started_at || a.timestamp || '';
            const timeB = b.started_at || b.timestamp || '';
            return timeA.localeCompare(timeB) * factor;
          }
          case 'table': {
            const tblA = (a.tables_involved && a.tables_involved[0]) || 'T_TRIWORKTASK';
            const tblB = (b.tables_involved && b.tables_involved[0]) || 'T_TRIWORKTASK';
            return tblA.localeCompare(tblB) * factor;
          }
          case 'workflow': {
            const wfA = (a.workflow?.template_name || '') + (a.workflow?.task_step || '');
            const wfB = (b.workflow?.template_name || '') + (b.workflow?.task_step || '');
            return wfA.localeCompare(wfB) * factor;
          }
          case 'server': {
            const srvA = a.server_name || '';
            const srvB = b.server_name || '';
            if (srvA !== srvB) return srvA.localeCompare(srvB) * factor;
            return (a.timestamp || '').localeCompare(b.timestamp || '');
          }
          default:
            return 0;
        }
      });
    }

    return items;
  }, [incidentData?.items, columnFilters, sortState]);

  // Grouping Structure & Pipeline
  interface IncidentGroup {
    key: string;
    title: string;
    badgeBg?: string;
    icon?: any;
    items: WorkTaskQueryIncident[];
    maxDurationMs: number;
    avgDurationMs: number;
  }

  const groupedIncidents = useMemo<IncidentGroup[]>(() => {
    if (groupBy === 'none') {
      return [
        {
          key: 'all',
          title: 'All Incidents',
          items: processedIncidents,
          maxDurationMs: Math.max(0, ...processedIncidents.map((i) => i.duration_ms || 0)),
          avgDurationMs:
            processedIncidents.length > 0
              ? processedIncidents.reduce((acc, i) => acc + (i.duration_ms || 0), 0) / processedIncidents.length
              : 0
        }
      ];
    }

    const map = new Map<string, WorkTaskQueryIncident[]>();

    processedIncidents.forEach((inc) => {
      let groupKey = 'Other';
      switch (groupBy) {
        case 'record':
          groupKey =
            inc.worktask?.control_number ||
            (inc.worktask?.spec_id ? `Spec ID: ${inc.worktask.spec_id}` : inc.worktask?.name || 'Unassociated Log Incident');
          break;
        case 'type':
          groupKey = inc.incident_type || 'OTHER';
          break;
        case 'latency': {
          const dur = inc.duration_ms || 0;
          if (dur >= 30000) groupKey = 'Critical Latency (> 30s)';
          else if (dur >= 5000) groupKey = 'High Latency (5s - 30s)';
          else if (dur >= 1000) groupKey = 'Moderate Latency (1s - 5s)';
          else groupKey = 'Sub-second / Active Wait (< 1s)';
          break;
        }
        case 'timing': {
          const timeStr = inc.started_at || inc.completed_at || inc.timestamp || '';
          if (timeStr.length >= 13) {
            groupKey = `${timeStr.substring(0, 13)}:00 Hour Window`;
          } else {
            groupKey = 'Unscheduled / Unknown Timing';
          }
          break;
        }
        case 'table':
          groupKey = inc.tables_involved && inc.tables_involved.length > 0 ? inc.tables_involved[0] : 'T_TRIWORKTASK';
          break;
        case 'workflow':
          groupKey = inc.workflow?.template_name || 'Direct Transaction (No Named WF)';
          break;
        case 'server':
          groupKey = inc.server_name || 'Cluster Node';
          break;
      }

      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)!.push(inc);
    });

    const groups: IncidentGroup[] = [];
    map.forEach((items, key) => {
      const maxDur = Math.max(0, ...items.map((i) => i.duration_ms || 0));
      const avgDur = items.length > 0 ? items.reduce((acc, i) => acc + (i.duration_ms || 0), 0) / items.length : 0;

      let badgeBg = 'bg-slate-700/40 text-slate-300 border-slate-600';
      let icon = undefined;

      if (groupBy === 'type') {
        const b = getIncidentBadge(key);
        badgeBg = b.bg;
        icon = b.icon;
      }

      groups.push({
        key,
        title: key,
        items,
        maxDurationMs: maxDur,
        avgDurationMs: avgDur,
        badgeBg,
        icon
      });
    });

    // Sort groups by total incident count descending
    groups.sort((a, b) => b.items.length - a.items.length);
    return groups;
  }, [processedIncidents, groupBy]);

  const handleToggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExpandAllGroups = () => {
    setCollapsedGroups({});
  };

  const handleCollapseAllGroups = () => {
    const allCollapsed: Record<string, boolean> = {};
    groupedIncidents.forEach((g) => {
      allCollapsed[g.key] = true;
    });
    setCollapsedGroups(allCollapsed);
  };

  // Render Table Column Header Helper with Sort, Filter Popover & Grouping
  const renderColumnHeader = (
    columnKey: SortColumn,
    label: string,
    widthClass?: string,
    alignRight?: boolean
  ) => {
    const isSorted = sortState.column === columnKey && sortState.direction !== 'none';
    const isFiltered = isColumnFiltered(columnKey);
    const isGroupedByThis = groupBy === columnKey;
    const isPopoverOpen = activeFilterPopover === columnKey;

    return (
      <th
        className={`py-3 px-3.5 select-none relative group/head ${widthClass || ''} ${
          isSorted ? 'bg-amber-500/10 text-amber-300' : 'text-slate-400'
        }`}
      >
        <div className={`flex items-center justify-between gap-1.5 ${alignRight ? 'justify-end' : ''}`}>
          {/* Header Title with Click-to-Sort */}
          <button
            type="button"
            onClick={() => handleToggleSort(columnKey)}
            className="flex items-center gap-1 hover:text-slate-200 transition-colors text-left font-semibold uppercase tracking-wider text-[10px] focus:outline-hidden"
            title={`Click to sort by ${label} (${sortState.column === columnKey ? sortState.direction : 'neutral'})`}
          >
            <span>{label}</span>
            {isSorted ? (
              sortState.direction === 'asc' ? (
                <ArrowUp className="w-3 h-3 text-amber-400 shrink-0" />
              ) : (
                <ArrowDown className="w-3 h-3 text-amber-400 shrink-0" />
              )
            ) : (
              <ArrowUpDown className="w-2.5 h-2.5 text-slate-600 group-hover/head:text-slate-400 transition-colors shrink-0" />
            )}
          </button>

          {/* Filter & Group Popover Trigger */}
          <div className="flex items-center gap-0.5">
            {isGroupedByThis && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-0.5" title="Grouped by this column" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveFilterPopover(isPopoverOpen ? null : columnKey);
              }}
              className={`p-1 rounded transition-all focus:outline-hidden ${
                isFiltered || isPopoverOpen
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
              title={`Filter, sort or group by ${label}`}
              aria-label={`Column options for ${label}`}
            >
              <Filter className={`w-3 h-3 ${isFiltered ? 'fill-amber-400 text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Dropdown Filter Popover */}
        {isPopoverOpen && (
          <div
            ref={filterPopoverRef}
            onClick={(e) => e.stopPropagation()}
            className="absolute z-50 top-full left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 space-y-3 font-sans normal-case text-xs text-slate-200 animate-fade-in"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-slate-100 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span>{label} Options</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveFilterPopover(null)}
                className="text-slate-400 hover:text-slate-100 p-0.5 rounded hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Sort Actions */}
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Sort Order</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSetSort(columnKey, 'asc')}
                  className={`px-2 py-1 rounded text-xs flex items-center justify-center gap-1 border transition-all ${
                    sortState.column === columnKey && sortState.direction === 'asc'
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  }`}
                >
                  <ArrowUp className="w-3 h-3" />
                  <span>Ascending</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetSort(columnKey, 'desc')}
                  className={`px-2 py-1 rounded text-xs flex items-center justify-center gap-1 border transition-all ${
                    sortState.column === columnKey && sortState.direction === 'desc'
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  }`}
                >
                  <ArrowDown className="w-3 h-3" />
                  <span>Descending</span>
                </button>
              </div>
            </div>

            {/* Group By Action */}
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Grouping</div>
              <button
                type="button"
                onClick={() => {
                  setGroupBy(groupBy === columnKey ? 'none' : columnKey);
                  setActiveFilterPopover(null);
                }}
                className={`w-full px-2.5 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 border transition-all ${
                  groupBy === columnKey
                    ? 'bg-indigo-500 text-white font-bold border-indigo-400 shadow-md'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>{groupBy === columnKey ? 'Remove Grouping' : `Group by ${label}`}</span>
              </button>
            </div>

            {/* Column-Specific Filter Inputs */}
            <div className="space-y-1.5 border-t border-slate-800 pt-2">
              <div className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Filter Values</div>

              {columnKey === 'record' && (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={columnFilters.record}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, record: e.target.value }))}
                    placeholder="Search Control#, Name, Spec ID..."
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              )}

              {columnKey === 'type' && (
                <div className="space-y-1">
                  <select
                    value={columnFilters.type}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, type: e.target.value }))}
                    className="w-full px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="ALL">All Types</option>
                    <option value="SLOW_QUERY">Slow Queries Only</option>
                    <option value="LOCK_CONTENTION">Lock Contentions Only</option>
                    <option value="DEADLOCK">Deadlocks Only</option>
                    <option value="TABLE_SCAN">Table Scans Only</option>
                  </select>
                </div>
              )}

              {columnKey === 'timing' && (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={columnFilters.timing}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, timing: e.target.value }))}
                    placeholder="Search time (e.g. 14:30 or 2026-09)..."
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              )}

              {columnKey === 'latency' && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={columnFilters.minDuration}
                      onChange={(e) => setColumnFilters((p) => ({ ...p, minDuration: e.target.value }))}
                      placeholder="Min ms (e.g. 1000)"
                      className="w-1/2 px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500 font-mono"
                    />
                    <input
                      type="number"
                      value={columnFilters.maxDuration}
                      onChange={(e) => setColumnFilters((p) => ({ ...p, maxDuration: e.target.value }))}
                      placeholder="Max ms"
                      className="w-1/2 px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500 font-mono"
                    />
                  </div>
                </div>
              )}

              {columnKey === 'table' && (
                <div className="space-y-1">
                  <select
                    value={columnFilters.table}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, table: e.target.value }))}
                    className="w-full px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="ALL">All Target Tables</option>
                    {availableTables.map((tbl) => (
                      <option key={tbl} value={tbl}>
                        {tbl}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {columnKey === 'workflow' && (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={columnFilters.workflow}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, workflow: e.target.value }))}
                    placeholder="Search Workflow name or task step..."
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              )}

              {columnKey === 'server' && (
                <div className="space-y-1">
                  <select
                    value={columnFilters.server}
                    onChange={(e) => setColumnFilters((p) => ({ ...p, server: e.target.value }))}
                    className="w-full px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="ALL">All Nodes</option>
                    {availableServers.map((srv) => (
                      <option key={srv} value={srv}>
                        {srv}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Popover Footer */}
            <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-[11px]">
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => handleClearColumnFilter(columnKey)}
                  className="text-rose-400 hover:text-rose-300 font-medium flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear Filter</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveFilterPopover(null)}
                className="ml-auto px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </th>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center shadow-md shadow-amber-500/10">
              <Wrench className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-100">WorkTask Slow Query &amp; Lock Contention Profiler</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase">
                  triWorkTask Intelligence
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Isolate specific work tasks and workflow steps causing high execution latency, full table scans, and DB2 lock contentions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end">
            {/* Terminology Guide Button */}
            <button
              onClick={() => setShowGlossaryModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-amber-300 hover:text-amber-200 transition-all shadow-xs"
              title="Open database &amp; architecture terminology glossary"
            >
              <Info className="w-3.5 h-3.5 text-amber-400" />
              <span>Terminology Guide</span>
            </button>

            {/* Server Selector */}
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedServerId || ''}
                onChange={(e) => setSelectedServerId(e.target.value ? Number(e.target.value) : undefined)}
                className="bg-transparent text-slate-200 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value="" className="bg-slate-900">All Cluster Nodes</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900">
                    {s.name} ({s.host})
                  </option>
                ))}
              </select>
            </div>

            {/* Auto Refresh Toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                autoRefresh
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
              title={autoRefresh ? 'Live Auto-refresh active (every 10s)' : 'Live Auto-refresh paused'}
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>{autoRefresh ? 'Live Monitoring' : 'Paused'}</span>
            </button>

            {/* Manual Refresh Button */}
            <button
              onClick={() => {
                if (viewMode === 'amalgamated') fetchIncidents();
                else if (viewMode === 'live') fetchLiveTelemetry();
                else fetchBottlenecks();
              }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* KPI Strip with Tooltips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-800/80">
          <div
            className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 hover:border-slate-700 transition-colors cursor-help"
            title="Total WorkTask related queries, lock contentions, and deadlocks detected across cluster logs"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <span>Total Incidents</span>
                <Info className="w-2.5 h-2.5 text-slate-500" />
              </span>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="text-xl font-bold text-slate-100 mt-1">
              {incidentData?.metrics?.total_incidents ?? 0}
            </div>
          </div>

          <div
            className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 hover:border-cyan-500/30 transition-colors cursor-help"
            title="Slow Queries: SQL statements whose execution duration exceeded the 1.0s performance threshold"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-cyan-400 flex items-center gap-1">
                <span>Slow Queries (&gt;1s)</span>
                <Info className="w-2.5 h-2.5 text-cyan-500/70" />
              </span>
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-xl font-bold text-cyan-300 mt-1">
              {incidentData?.metrics?.slow_queries_count ?? 0}
            </div>
          </div>

          <div
            className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 hover:border-amber-500/30 transition-colors cursor-help"
            title="Lock Contentions: Occurrences where threads entered an Active Lock Wait state waiting for other transactions to release exclusive locks on WorkTask tables"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
                <span>Lock Contentions</span>
                <Info className="w-2.5 h-2.5 text-amber-500/70" />
              </span>
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-amber-300 mt-1">
              {incidentData?.metrics?.lock_contentions_count ?? 0}
            </div>
          </div>

          <div
            className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 hover:border-rose-500/30 transition-colors cursor-help"
            title="Deadlocks (SQLCODE -911): Cyclical lock wait dependencies where DB2 automatically aborted and rolled back the transaction to break the freeze"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-rose-400 flex items-center gap-1">
                <span>Deadlocks</span>
                <Info className="w-2.5 h-2.5 text-rose-500/70" />
              </span>
              <Flame className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-xl font-bold text-rose-300 mt-1">
              {incidentData?.metrics?.deadlocks_count ?? 0}
            </div>
          </div>

          <div
            className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 col-span-2 sm:col-span-1 hover:border-yellow-500/30 transition-colors cursor-help"
            title="Peak Latency: The highest single query execution duration or lock wait time recorded in the current filter window"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <span>Peak Latency</span>
                <Info className="w-2.5 h-2.5 text-yellow-500/70" />
              </span>
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
            </div>
            <div className="text-xl font-bold text-yellow-300 mt-1">
              {incidentData?.metrics?.max_latency_ms ? `${(incidentData.metrics.max_latency_ms / 1000).toFixed(2)}s` : '0.0s'}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation View Tabs & Search Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* View Switcher */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
          <button
            onClick={() => { setViewMode('amalgamated'); setPage(1); }}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              viewMode === 'amalgamated'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Correlated Incidents
          </button>
          <button
            onClick={() => setViewMode('live')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all flex items-center gap-1.5 ${
              viewMode === 'live'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Live DB2 &amp; Locks</span>
            {liveTelemetry?.has_active_locks && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            )}
          </button>
          <button
            onClick={() => setViewMode('bottlenecks')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              viewMode === 'bottlenecks'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Workflow Bottlenecks
          </button>
        </div>

        {/* Search & Threshold Filter (for amalgamated view) */}
        {viewMode === 'amalgamated' && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Filter */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
              <Filter className="w-3 h-3 text-slate-400 mr-1.5" />
              <select
                value={issueTypeFilter}
                onChange={(e) => { setIssueTypeFilter(e.target.value); setPage(1); }}
                className="bg-transparent text-slate-200 focus:outline-hidden cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900">All Incident Types</option>
                <option value="SLOW_QUERY" className="bg-slate-900">Slow Queries Only</option>
                <option value="LOCK_CONTENTION" className="bg-slate-900">Lock Contentions Only</option>
                <option value="DEADLOCK" className="bg-slate-900">Deadlocks Only</option>
                <option value="TABLE_SCAN" className="bg-slate-900">Table Scans</option>
              </select>
            </div>

            {/* Time Window Filter */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
              <Calendar className="w-3 h-3 text-slate-400 mr-1.5" />
              <select
                value={timeRange}
                onChange={(e) => { setTimeRange(e.target.value); setPage(1); }}
                className="bg-transparent text-slate-200 focus:outline-hidden cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900">Time: All History</option>
                <option value="1H" className="bg-slate-900">Last 1 Hour</option>
                <option value="24H" className="bg-slate-900">Last 24 Hours</option>
                <option value="7D" className="bg-slate-900">Last 7 Days</option>
                <option value="30D" className="bg-slate-900">Last 30 Days</option>
              </select>
            </div>

            {/* Min Latency Filter */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
              <Clock className="w-3 h-3 text-slate-400 mr-1.5" />
              <select
                value={minDurationMs}
                onChange={(e) => { setMinDurationMs(Number(e.target.value)); setPage(1); }}
                className="bg-transparent text-slate-200 focus:outline-hidden cursor-pointer"
              >
                <option value="0" className="bg-slate-900">Min Latency: All</option>
                <option value="500" className="bg-slate-900">&gt; 500 ms</option>
                <option value="1000" className="bg-slate-900">&gt; 1.0 s</option>
                <option value="5000" className="bg-slate-900">&gt; 5.0 s</option>
                <option value="30000" className="bg-slate-900">&gt; 30.0 s</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchIncidents(); }}
                placeholder="Search WRK-xxx, SQL, table..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-hidden focus:border-amber-500/60"
              />
            </div>
          </div>
        )}
      </div>

      {/* VIEW 1: Correlated Incidents Table with Advanced Sort, Filter & Grouping */}
      {viewMode === 'amalgamated' && (
        <div className="space-y-2">
          {/* Table Header Controls Toolbar: Group By, Page Size & Active Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
            {/* Left: Grouping Controls */}
            <div className="flex items-center flex-wrap gap-2.5 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                <FolderTree className="w-3.5 h-3.5 text-amber-400" />
                <span>Group By:</span>
              </div>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                className="bg-slate-950 border border-slate-800 text-slate-200 px-2.5 py-1 rounded-lg text-xs focus:outline-hidden focus:border-amber-500 cursor-pointer font-medium"
              >
                <option value="none">No Grouping (Flat Table)</option>
                <option value="type">Group by Incident Type</option>
                <option value="latency">Group by Latency Tier</option>
                <option value="timing">Group by Execution Time Window</option>
                <option value="table">Group by Target Table</option>
                <option value="workflow">Group by Workflow Step</option>
                <option value="server">Group by Server / Node</option>
                <option value="record">Group by Work Task Record</option>
              </select>

              {groupBy !== 'none' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleExpandAllGroups}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={handleCollapseAllGroups}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                  >
                    Collapse All
                  </button>
                </div>
              )}
            </div>

            {/* Right: Items counter, Page size & Reset */}
            <div className="flex items-center flex-wrap gap-2 text-xs">
              <span className="text-slate-400 font-mono text-[11px]">
                Showing <strong className="text-slate-200">{processedIncidents.length}</strong> of{' '}
                <strong className="text-slate-200">{incidentData?.items?.length || 0}</strong> loaded
              </span>

              {/* Page Size Selector */}
              <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-transparent text-slate-200 focus:outline-hidden cursor-pointer"
                >
                  <option value="25" className="bg-slate-900">25</option>
                  <option value="50" className="bg-slate-900">50</option>
                  <option value="100" className="bg-slate-900">100</option>
                  <option value="250" className="bg-slate-900">250</option>
                </select>
              </div>

              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetAllFiltersAndSort}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px] font-medium transition-all"
                  title="Reset all column filters, sorts, and grouping"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset All ({activeFiltersCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Active Filter Chips Strip */}
          {activeFiltersCount > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 px-1 py-0.5 text-[11px]">
              <span className="text-slate-500 font-mono text-[10px] uppercase">Active:</span>
              {sortState.column && (
                <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  <span>Sort: {sortState.column} ({sortState.direction})</span>
                  <X
                    className="w-3 h-3 hover:text-white cursor-pointer"
                    onClick={() => setSortState({ column: null, direction: 'none' })}
                  />
                </span>
              )}
              {groupBy !== 'none' && (
                <span className="inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  <span>Group: {groupBy}</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => setGroupBy('none')} />
                </span>
              )}
              {columnFilters.record && (
                <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full">
                  <span>Record: "{columnFilters.record}"</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('record')} />
                </span>
              )}
              {columnFilters.type !== 'ALL' && (
                <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                  <span>Type: {columnFilters.type}</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('type')} />
                </span>
              )}
              {columnFilters.timing && (
                <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full">
                  <span>Timing: "{columnFilters.timing}"</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('timing')} />
                </span>
              )}
              {(columnFilters.minDuration || columnFilters.maxDuration) && (
                <span className="inline-flex items-center gap-1 bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 px-2 py-0.5 rounded-full">
                  <span>
                    Latency: {columnFilters.minDuration || '0'}ms - {columnFilters.maxDuration || '∞'}ms
                  </span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('latency')} />
                </span>
              )}
              {columnFilters.table !== 'ALL' && (
                <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full">
                  <span>Table: {columnFilters.table}</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('table')} />
                </span>
              )}
              {columnFilters.workflow && (
                <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full">
                  <span>Workflow: "{columnFilters.workflow}"</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('workflow')} />
                </span>
              )}
              {columnFilters.server !== 'ALL' && (
                <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full">
                  <span>Server: {columnFilters.server}</span>
                  <X className="w-3 h-3 hover:text-white cursor-pointer" onClick={() => handleClearColumnFilter('server')} />
                </span>
              )}
            </div>
          )}

          {/* Incidents Data Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold tracking-wider uppercase text-[10px]">
                    {renderColumnHeader('record', 'Work Task Record', 'w-1/5')}
                    {renderColumnHeader('type', 'Type', 'w-28')}
                    {renderColumnHeader('timing', 'Timing', 'w-32')}
                    {renderColumnHeader('latency', 'Latency', 'w-28')}
                    {renderColumnHeader('table', 'Target Table(s) & Impact', 'w-1/4')}
                    {renderColumnHeader('workflow', 'Workflow Step', 'w-1/5')}
                    {renderColumnHeader('server', 'Server / Node', 'w-24')}
                    <th className="py-3 px-3 text-right uppercase text-[10px]">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/60">
                  {groupedIncidents.length > 0 && processedIncidents.length > 0 ? (
                    groupedIncidents.map((group) => {
                      const isCollapsed = collapsedGroups[group.key] || false;
                      const GroupIcon = group.icon || FolderTree;

                      return (
                        <React.Fragment key={group.key}>
                          {/* Group Header Row (Rendered when groupBy is active) */}
                          {groupBy !== 'none' && (
                            <tr
                              onClick={() => handleToggleGroupCollapse(group.key)}
                              className="bg-slate-950/90 hover:bg-slate-800/60 border-y border-slate-800 transition-colors cursor-pointer select-none"
                            >
                              <td colSpan={8} className="py-2 px-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2.5">
                                    <button
                                      type="button"
                                      className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                                      aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                                    >
                                      {isCollapsed ? (
                                        <ChevronRight className="w-4 h-4 text-amber-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-amber-400" />
                                      )}
                                    </button>
                                    <GroupIcon className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span className="font-bold text-slate-100 text-xs">
                                      {group.title}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                                      {group.items.length} {group.items.length === 1 ? 'incident' : 'incidents'}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3 text-[11px] font-mono">
                                    <span className="text-slate-400">
                                      Peak: <strong className="text-yellow-300">{formatDuration(group.maxDurationMs)}</strong>
                                    </span>
                                    <span className="text-slate-400">
                                      Avg: <strong className="text-cyan-300">{formatDuration(group.avgDurationMs)}</strong>
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}

                          {/* Group Incidents Rows */}
                          {!isCollapsed &&
                            group.items.map((inc) => {
                              const badge = getIncidentBadge(inc.incident_type);
                              const BadgeIcon = badge.icon;
                              const recordIdentifier =
                                inc.worktask?.control_number ||
                                (inc.worktask?.spec_id ? String(inc.worktask.spec_id) : String(inc.id));

                              return (
                                <tr
                                  key={inc.id}
                                  className={`hover:bg-slate-800/40 transition-colors group cursor-pointer ${
                                    groupBy !== 'none' ? 'bg-slate-900/40' : ''
                                  }`}
                                  onClick={() => handleInspectRecord(recordIdentifier, inc)}
                                >
                                  {/* Work Task Control & Name */}
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                                        {inc.worktask?.control_number ||
                                          (inc.worktask?.spec_id ? `Spec ID: ${inc.worktask.spec_id}` : 'Log Incident')}
                                      </span>
                                      <span
                                        className="text-slate-200 font-medium truncate max-w-[180px]"
                                        title={inc.worktask?.name || inc.worktask?.status || '-'}
                                      >
                                        {inc.worktask?.name ||
                                          (inc.worktask?.status ? `Status: ${inc.worktask.status}` : '-')}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
                                      <span>Spec ID: {inc.worktask?.spec_id || 'N/A'}</span>
                                      <span>•</span>
                                      <span className={getSeverityColor(inc.severity)}>
                                        {inc.worktask?.status || 'Unspecified'}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Incident Type */}
                                  <td className="py-3 px-3">
                                    <span
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.bg}`}
                                    >
                                      <BadgeIcon className="w-3 h-3" />
                                      <span>{badge.label}</span>
                                    </span>
                                  </td>

                                  {/* Timing */}
                                  <td className="py-3 px-3 min-w-[120px] font-mono text-[11px]">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 text-[10px]">Start:</span>
                                        <span className="text-slate-300 font-medium">
                                          {inc.started_at ? inc.started_at.substring(11, 23) : '-'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 text-[10px]">End:</span>
                                        <span className="text-slate-400">
                                          {inc.completed_at
                                            ? inc.completed_at.substring(11, 23)
                                            : inc.timestamp?.substring(11, 19)}
                                        </span>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Latency */}
                                  <td className="py-3 px-3 min-w-[110px]">
                                    <div
                                      className={`font-mono font-bold text-xs ${
                                        (inc.duration_ms || 0) >= 30000
                                          ? 'text-rose-400'
                                          : (inc.duration_ms || 0) >= 5000
                                          ? 'text-amber-400'
                                          : (inc.duration_ms || 0) >= 1000
                                          ? 'text-yellow-300'
                                          : 'text-emerald-400'
                                      }`}
                                    >
                                      {inc.duration_formatted || formatDuration(inc.duration_ms, inc.incident_type)}
                                    </div>
                                    {inc.duration_ms !== null && inc.duration_ms !== undefined && (
                                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                        {Math.round(inc.duration_ms).toLocaleString()} ms
                                      </div>
                                    )}
                                  </td>

                                  {/* SQL & Tables & Impact */}
                                  <td className="py-3 px-4 max-w-[300px]">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {inc.tables_involved && inc.tables_involved.length > 0 ? (
                                        inc.tables_involved.map((tbl, idx) => (
                                          <span
                                            key={idx}
                                            className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-300 border border-slate-700"
                                          >
                                            {tbl}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-300 border border-slate-700">
                                          T_TRIWORKTASK
                                        </span>
                                      )}
                                    </div>
                                    {inc.sql_statement ? (
                                      <p className="font-mono text-[10px] text-slate-400 truncate mt-1" title={inc.sql_statement}>
                                        {inc.sql_statement}
                                      </p>
                                    ) : (
                                      <div className="mt-1">
                                        <span className="text-[10px] font-medium text-indigo-300 block truncate">
                                          {inc.cross_referenced_context?.inferred_subsystem || 'Subsystem Contention'}
                                        </span>
                                        <p
                                          className="text-[10px] text-slate-400 truncate"
                                          title={
                                            inc.cross_referenced_context?.root_cause_diagnosis || inc.raw_message
                                          }
                                        >
                                          {inc.cross_referenced_context?.root_cause_diagnosis || inc.raw_message}
                                        </p>
                                      </div>
                                    )}
                                    {inc.system_impact && (
                                      <div
                                        className="mt-1 text-[10px] text-amber-300/90 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded truncate"
                                        title={inc.system_impact}
                                      >
                                        <span className="text-amber-400 font-bold">Impact: </span>
                                        {inc.system_impact}
                                      </div>
                                    )}
                                  </td>

                                  {/* Workflow */}
                                  <td className="py-3 px-4 max-w-[220px]">
                                    <div
                                      className="text-slate-200 font-medium truncate"
                                      title={inc.workflow?.template_name || '-'}
                                    >
                                      {inc.workflow?.template_name || '-'}
                                    </div>
                                    {inc.workflow?.task_step ? (
                                      <div
                                        className="text-[10px] text-slate-400 truncate flex items-center gap-1 mt-0.5"
                                        title={inc.workflow.task_step}
                                      >
                                        <ChevronRight className="w-3 h-3 text-amber-500 shrink-0" />
                                        <span>{inc.workflow.task_step}</span>
                                      </div>
                                    ) : null}
                                  </td>

                                  {/* Server */}
                                  <td className="py-3 px-3 text-slate-400 text-[11px] whitespace-nowrap">
                                    <div>{inc.server_name}</div>
                                    <div className="text-[10px] text-slate-500">
                                      {inc.timestamp?.substring(11, 19)} UTC
                                    </div>
                                  </td>

                                  {/* Actions */}
                                  <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => handleAskAI(inc)}
                                        className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 transition-all flex items-center justify-center shadow-xs"
                                        title="Ask AI Assistant to Analyze &amp; Fix"
                                        aria-label="Ask AI Assistant"
                                      >
                                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                      </button>
                                      <button
                                        onClick={() => handleInspectRecord(recordIdentifier, inc)}
                                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] transition-all"
                                        title="View Record &amp; Remediation Plan"
                                      >
                                        Inspect
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
                          <span className="text-sm font-medium text-slate-400">
                            No slow queries or lock contentions detected for current filter.
                          </span>
                          <span className="text-xs text-slate-600">
                            Try adjusting your column filters or threshold criteria above.
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {incidentData && incidentData.total_pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 bg-slate-950/60 border-t border-slate-800 text-xs text-slate-400">
                <div>
                  Showing page <span className="font-bold text-slate-200">{incidentData.page}</span> of{' '}
                  <span className="font-bold text-slate-200">{incidentData.total_pages}</span> ({incidentData.total} incidents total)
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={page >= incidentData.total_pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: Live DB2 Performance & Contention View */}
      {viewMode === 'live' && (
        <div className="space-y-4">
          {/* Connection Error Banner if live telemetry is unreachable */}
          {liveTelemetry?.success === false && (
            <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 flex items-start gap-3 text-rose-300 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-200 font-semibold">Live DB2 Agent Monitor Unreachable: </strong>
                <span>{liveTelemetry.error || 'The TRIRIGA Admin Console endpoint is not responding or credentials are unverified for this cluster node.'}</span>
              </div>
            </div>
          )}

          {/* Live Lock Waits on WorkTask Tables */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-slate-200">Active WorkTask Lock Contentions (SYSIBMADM.MON_LOCKWAITS)</h2>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                liveTelemetry?.lock_contentions && liveTelemetry.lock_contentions.length > 0
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}>
                {liveTelemetry?.lock_contentions?.length ?? 0} Active Lock Waits
              </span>
            </div>

            {liveTelemetry?.lock_contentions && liveTelemetry.lock_contentions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-semibold uppercase text-[10px]">
                      <th className="py-2.5 px-3">Blocked Table</th>
                      <th className="py-2.5 px-3">Lock Mode</th>
                      <th className="py-2.5 px-3">Holding App / User</th>
                      <th className="py-2.5 px-3">Waiting App</th>
                      <th className="py-2.5 px-3">Wait Elapsed</th>
                      <th className="py-2.5 px-3">Holding Statement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {liveTelemetry.lock_contentions.map((lw, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 font-mono text-[11px]">
                        <td className="py-2 px-3 font-bold text-amber-400">{lw.TABNAME || 'T_TRIWORKTASK'}</td>
                        <td className="py-2 px-3 text-rose-400">{lw.LOCK_MODE || 'X'} (Exclusive/Update)</td>
                        <td className="py-2 px-3 text-slate-200">{lw.HLD_USERID || 'WFAgent'} (App: {lw.HLD_APPLICATION_HANDLE || '-'})</td>
                        <td className="py-2 px-3 text-slate-400">App: {lw.REQ_APPLICATION_HANDLE || '-'}</td>
                        <td className="py-2 px-3 text-yellow-300 font-bold">{lw.WAIT_SECS || '0'}s</td>
                        <td className="py-2 px-3 text-slate-400 truncate max-w-xs" title={lw.HLD_CURRENT_STMT_TEXT}>
                          {lw.HLD_CURRENT_STMT_TEXT || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 text-xs">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1.5 opacity-80" />
                <span>Zero active lock contentions on T_TRIWORKTASK or IBS_SPEC_ASSIGNMENTS.</span>
              </div>
            )}
          </div>

          {/* Top Slow Dynamic SQL on WorkTask Tables */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-slate-200">Top Cumulative Dynamic SQL on WorkTask Tables (MON_GET_PKG_CACHE_STMT)</h2>
              </div>
            </div>

            {liveTelemetry?.slow_dynamic_queries && liveTelemetry.slow_dynamic_queries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-semibold uppercase text-[10px]">
                      <th className="py-2.5 px-3">Query Snippet</th>
                      <th className="py-2.5 px-3">Executions</th>
                      <th className="py-2.5 px-3">Avg Latency</th>
                      <th className="py-2.5 px-3">Total Exec Time</th>
                      <th className="py-2.5 px-3">Rows Read</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-[11px]">
                    {liveTelemetry.slow_dynamic_queries.map((q, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 text-slate-200 truncate max-w-sm" title={q.QUERY_SNIPPET}>
                          {q.QUERY_SNIPPET}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{q.NUM_EXECUTIONS ?? '-'}</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">{q.AVG_EXEC_MS ? `${Number(q.AVG_EXEC_MS).toFixed(1)}ms` : '-'}</td>
                        <td className="py-2 px-3 text-slate-300">{q.TOTAL_EXEC_MS ? `${(Number(q.TOTAL_EXEC_MS) / 1000).toFixed(1)}s` : '-'}</td>
                        <td className="py-2 px-3 text-slate-400">{q.ROWS_READ ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 text-xs">
                <span>No cached dynamic SQL queries captured on WorkTask tables yet.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: Workflow Bottlenecks List */}
      {viewMode === 'bottlenecks' && (
        <div className="space-y-4">
          {bottlenecks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bottlenecks.map((b, idx) => (
                <div key={b.workflow_id || idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                        {b.workflow_id ? `WF ID: ${b.workflow_id}` : 'WFAgent Event'}
                      </span>
                      {b.avg_duration_ms ? (
                        <span className="font-mono text-xs font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                          ~{(b.avg_duration_ms / 1000).toFixed(1)}s avg
                        </span>
                      ) : (
                        <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                          {b.occurrences ?? 1} occurrences
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-100">{b.workflow_name || (b.workflow_id ? `Workflow #${b.workflow_id}` : 'Workflow Engine')}</h3>
                    <div className="flex items-center gap-1 text-[11px] text-amber-300/90 font-medium mt-1">
                      <ChevronRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{b.task_step || 'Task Step'} ({b.task_type})</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 bg-slate-950/60 p-2.5 rounded border border-slate-800">
                      <strong className="text-slate-300">Impact: </strong>{b.impact}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="text-[11px] font-semibold text-emerald-400 mb-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Recommended Fix:</span>
                    </div>
                    <p className="text-[11px] text-slate-300 bg-emerald-950/20 border border-emerald-500/30 p-2 rounded">
                      {b.remedy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
              <div className="text-sm font-semibold text-slate-300">No Workflow Engine Bottlenecks Detected</div>
              <div className="text-slate-500 mt-1">All workflow agents and execution steps are running normally without captured deadlock signatures in logs.</div>
            </div>
          )}
        </div>
      )}

      {/* DIAGNOSTIC MODAL: WorkTask Record & Optimization Deep Dive */}
      {selectedRecordDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-5 sm:p-6 space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded border border-amber-500/40">
                    {selectedRecordDetails.control_number || (selectedRecordDetails.spec_id ? `Spec ID: ${selectedRecordDetails.spec_id}` : 'WorkTask Record')}
                  </span>
                  {selectedRecordDetails.spec_id && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      Spec ID: {selectedRecordDetails.spec_id}
                    </span>
                  )}
                  {selectedRecordDetails.is_resolved ? (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      {selectedRecordDetails.status || 'Resolved Spec'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                      Log Reference
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-slate-100 mt-2">
                  {selectedRecordDetails.name || selectedRecordDetails.control_number || `Record Spec #${selectedRecordDetails.spec_id || ''}`}
                </h2>
                {selectedRecordDetails.description && (
                  <p className="text-xs text-slate-400 mt-0.5">{selectedRecordDetails.description}</p>
                )}
              </div>

              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 flex items-center justify-center transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Record Attribute Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Priority</span>
                <div className="font-semibold text-slate-200 mt-0.5">{selectedRecordDetails.priority || 'Not Specified in Log'}</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Assigned Tech</span>
                <div className="font-semibold text-slate-200 mt-0.5">{selectedRecordDetails.assigned_to || 'Not Specified in Log'}</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Location / Building</span>
                <div className="font-semibold text-slate-200 mt-0.5 truncate">{selectedRecordDetails.location || 'Not Specified in Log'}</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Business Object</span>
                <div className="font-semibold text-slate-200 mt-0.5">{selectedRecordDetails.bo_name || 'triWorkTask'}</div>
              </div>
            </div>

            {/* If opened from an incident, display timing, impact, SQL, and recommendation */}
            {selectedIncident && (
              <div className="space-y-4">
                {/* Execution Timing & Duration Strip */}
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Query Started At</span>
                    </span>
                    <div className="font-mono font-semibold text-slate-200 mt-1">
                      {selectedIncident.started_at || 'Calculated from log offset'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Query Completed At</span>
                    </span>
                    <div className="font-mono font-semibold text-slate-200 mt-1">
                      {selectedIncident.completed_at || selectedIncident.timestamp}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                      <Zap className="w-3 h-3 text-yellow-400" />
                      <span>Execution Duration</span>
                    </span>
                    <div className="font-mono font-bold text-amber-300 mt-1">
                      {selectedIncident.duration_formatted || formatDuration(selectedIncident.duration_ms, selectedIncident.incident_type)}
                    </div>
                  </div>
                </div>

                {/* System & Business Impact Card */}
                {(selectedIncident.system_impact || selectedIncident.business_impact) && (
                  <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-3.5 space-y-2 text-xs">
                    <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4" />
                      <span>System &amp; Business Impact Analysis</span>
                    </div>
                    {selectedIncident.system_impact && (
                      <div className="text-slate-300">
                        <strong className="text-amber-300/90 font-semibold">System Impact: </strong>
                        <span>{selectedIncident.system_impact}</span>
                      </div>
                    )}
                    {selectedIncident.business_impact && (
                      <div className="text-slate-300">
                        <strong className="text-amber-300/90 font-semibold">Business Impact: </strong>
                        <span>{selectedIncident.business_impact}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <FileCode className="w-4 h-4 text-amber-400" />
                    <span>Triggering SQL Statement &amp; Execution Trace</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-rose-400">
                    Duration: {selectedIncident.duration_formatted || formatDuration(selectedIncident.duration_ms, selectedIncident.incident_type)}
                  </span>
                </div>

                {selectedIncident.sql_statement ? (
                  <div className="relative bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
                    <code>{selectedIncident.sql_statement}</code>
                    <button
                      onClick={() => handleCopy(selectedIncident.sql_statement || '', 'sql')}
                      className="absolute top-2 right-2 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 border border-slate-700"
                    >
                      {copiedCode === 'sql' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedCode === 'sql' ? 'Copied' : 'Copy SQL'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-950/80 p-3.5 rounded-xl border border-indigo-500/30 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                        <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Cross-Referenced Root Cause Analysis</span>
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                        {selectedIncident.cross_referenced_context?.inferred_subsystem || selectedRecordDetails.inferred_subsystem || 'Core Engine'}
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      {selectedIncident.cross_referenced_context?.root_cause_diagnosis || selectedRecordDetails.root_cause_diagnosis || 'Incident identified from contention and stack trace signatures.'}
                    </p>

                    {/* Sibling thread logs */}
                    {selectedIncident.cross_referenced_context?.correlated_thread_events && selectedIncident.cross_referenced_context.correlated_thread_events.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-800/80">
                        <div className="text-[10px] font-mono text-slate-400 mb-1">
                          Correlated Events on Thread ({selectedIncident.thread_name || 'Worker'}):
                        </div>
                        <div className="space-y-1 font-mono text-[10px]">
                          {selectedIncident.cross_referenced_context.correlated_thread_events.map((ev, idx) => (
                            <div key={idx} className="bg-slate-900/90 p-1.5 rounded border border-slate-800 flex items-start gap-2">
                              <span className="text-amber-400 whitespace-nowrap">{ev.timestamp.substring(11, 19)}</span>
                              <span className="text-slate-500 font-semibold">{ev.logger_name?.split('.').pop()}:</span>
                              <span className="text-slate-300 truncate" title={ev.message_snippet}>{ev.message_snippet}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Remediation DDL Box */}
                {selectedIncident.recommendation && (
                  <div className="bg-emerald-950/20 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <h4 className="text-xs font-bold text-emerald-300">{selectedIncident.recommendation.title}</h4>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 uppercase">
                        {selectedIncident.recommendation.category}
                      </span>
                    </div>

                    {selectedIncident.recommendation.db2_ddl && (
                      <div className="relative bg-slate-950 p-3 rounded-lg border border-emerald-500/30 font-mono text-xs text-emerald-300">
                        <pre className="whitespace-pre-wrap">{selectedIncident.recommendation.db2_ddl}</pre>
                        <button
                          onClick={() => handleCopy(selectedIncident.recommendation?.db2_ddl || '', 'ddl')}
                          className="absolute top-2 right-2 px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px] flex items-center gap-1 border border-emerald-500/50"
                        >
                          {copiedCode === 'ddl' ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedCode === 'ddl' ? 'Copied DDL' : 'Copy DB2 DDL'}</span>
                        </button>
                      </div>
                    )}

                    <div className="space-y-1 text-xs text-slate-300">
                      {selectedIncident.recommendation.action_plan.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-emerald-400 font-bold">•</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Real Historical Log Occurrences for this Record */}
            {selectedRecordDetails.recent_logs && selectedRecordDetails.recent_logs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span>Real Log Entries Mentioning This Record ({selectedRecordDetails.recent_logs.length})</span>
                </h3>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-900/80 text-slate-400 text-[10px] uppercase font-mono">
                        <th className="py-2 px-3">Timestamp</th>
                        <th className="py-2 px-2">Level</th>
                        <th className="py-2 px-3">Log Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {selectedRecordDetails.recent_logs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/30">
                          <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{log.timestamp}</td>
                          <td className="py-1.5 px-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              log.log_level === 'ERROR' || log.log_level === 'FATAL'
                                ? 'bg-rose-500/20 text-rose-400'
                                : log.log_level === 'WARN'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              {log.log_level}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-slate-300 truncate max-w-md" title={log.message}>
                            {log.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              {selectedIncident && (
                <button
                  onClick={() => {
                    handleAskAI(selectedIncident);
                    setSelectedRecordDetails(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Ask AI Assistant for Forensic Analysis</span>
                </button>
              )}
              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold ml-auto transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TERMINOLOGY & ARCHITECTURE GUIDE MODAL */}
      {showGlossaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-5 sm:p-6 space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                  <Info className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">TRIRIGA &amp; DB2 Performance Terminology Guide</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Clear practical definitions of database states, locking behaviors, and TRIRIGA architectural concepts.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowGlossaryModal(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Terms List Grid */}
            <div className="space-y-3.5 text-xs">
              {/* Active Lock Wait */}
              <div className="bg-slate-950/80 border border-amber-500/30 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Active Lock Wait
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">Transaction Freeze / Thread Blocking</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  <strong className="text-amber-400">What it means in practice: </strong>
                  When a TRIRIGA process (like a WFAgent worker or user session) attempts to update or read a record (e.g. in <code className="text-slate-200">T_TRIWORKTASK</code> or <code className="text-slate-200">IBS_SPEC_ASSIGNMENTS</code>), DB2 requests an exclusive lock. If another concurrent transaction is already holding a lock on that row/table, the requesting thread is <strong>paused/frozen</strong> waiting for the holder to commit or rollback.
                </p>
                <div className="bg-slate-900/90 p-2 rounded text-[11px] text-slate-400 font-mono">
                  • <strong>Impact:</strong> The waiting thread cannot process other tasks in the queue, stalling background automation and consuming database connection slots.
                </div>
              </div>

              {/* Deadlock */}
              <div className="bg-slate-950/80 border border-rose-500/30 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/40">
                    Deadlock (SQLCODE -911 / SQLSTATE 40001)
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">Circular Wait Abort &amp; Rollback</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  <strong className="text-rose-400">What it means in practice: </strong>
                  Transaction A holds Lock 1 and waits for Lock 2; simultaneously, Transaction B holds Lock 2 and waits for Lock 1. Because neither can proceed, DB2's background detector automatically aborts one transaction, rolling back all uncommitted work.
                </p>
                <div className="bg-slate-900/90 p-2 rounded text-[11px] text-slate-400 font-mono">
                  • <strong>Remedy:</strong> Enforce consistent ascending lock ordering (<code className="text-slate-200">ORDER BY SPEC_ID ASC</code>) across all workflows modifying child associations.
                </div>
              </div>

              {/* Lock Contention */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    Lock Contention
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">Concurrent Resource Competition</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Occurs when multiple parallel workflow threads or users compete to lock overlapping database rows simultaneously, leading to elevated queue depths and processing delays.
                </p>
              </div>

              {/* Full Table Scan */}
              <div className="bg-slate-950/80 border border-purple-500/30 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-purple-500/20 text-purple-300 border border-purple-500/40">
                    Table Scan (TBSCAN)
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">Un-indexed Database Traversal</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  <strong className="text-purple-300">What it means in practice: </strong>
                  The DB2 engine reads every single page in the table from disk or memory because no index matches the filter columns. This causes high CPU utilization and flushes active cache pages out of the DB2 buffer pool.
                </p>
              </div>

              {/* TRIRIGA Specific Architectural Terms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="font-mono font-bold text-amber-400 text-[11px]">Spec ID (IBS_SPEC)</div>
                  <p className="text-slate-400 text-[11px]">
                    TRIRIGA's internal, immutable numeric primary key (e.g. <code className="text-slate-300">16492132</code>) identifying any Smart Object instance in the database.
                  </p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="font-mono font-bold text-amber-400 text-[11px]">Control Number</div>
                  <p className="text-slate-400 text-[11px]">
                    The human-readable business key (e.g., <code className="text-slate-300">WRK-149204</code>, <code className="text-slate-300">TASK-100234</code>) generated by auto-numbering.
                  </p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="font-mono font-bold text-cyan-400 text-[11px]">WFAgent Threads</div>
                  <p className="text-slate-400 text-[11px]">
                    TRIRIGA's asynchronous workflow agent thread pool that dequeues events from <code className="text-slate-300">WF_EVENT</code> and executes automated logic.
                  </p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1">
                  <div className="font-mono font-bold text-cyan-400 text-[11px]">IBS_SPEC_ASSIGNMENTS</div>
                  <p className="text-slate-400 text-[11px]">
                    The core relational table storing parent-child, task-to-asset, and record association mapping graphs.
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowGlossaryModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer"
              >
                Got It, Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
