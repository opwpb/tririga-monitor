import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Server, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft,
  ChevronsRight,
  Eye, 
  AlertTriangle, 
  X, 
  Copy, 
  Check, 
  RefreshCw,
  FileCode,
  CheckSquare,
  Square,
  Shield,
  Layers,
  Sparkles,
  Calendar,
  Clock,
  RotateCcw,
  DownloadCloud,
  ChevronDown,
  ChevronUp,
  Globe,
  GitCommit,
  Activity,
  Zap
} from 'lucide-react';
import { LogEntry, TririgaServer } from '../types';
import { api } from '../services/api';
import { LogCollector } from './LogCollector';
import { useTimeContext } from '../context/TimeContext';
import { getProdServerIds } from '../utils/serverUtils';
import { LinkedRecordChips, extractRecordIdentifiersFromText } from './common/LinkedRecordChips';
import { TririgaRecordInspectorModal } from './common/TririgaRecordInspectorModal';

export interface LogExplorerFilter {
  level?: string;
  levels?: string[];
  serverId?: number;
  serverIds?: number[];
  fileType?: string;
  filename?: string;
  search?: string;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}

interface LogLevelOption {
  value: string;
  label: string;
  description: string;
  badgeClass: string;
  activeClass: string;
  checkColor: string;
}

const LOG_LEVEL_CONFIG: LogLevelOption[] = [
  {
    value: 'FATAL',
    label: 'FATAL',
    description: 'System-critical unrecoverable failure',
    badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-600',
    activeClass: 'bg-rose-950/90 text-rose-200 border-rose-500 shadow-sm shadow-rose-950/50',
    checkColor: 'text-rose-400',
  },
  {
    value: 'ERROR',
    label: 'ERROR',
    description: 'Caught or unhandled runtime errors',
    badgeClass: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    activeClass: 'bg-rose-600 text-white border-rose-400 shadow-sm shadow-rose-600/30',
    checkColor: 'text-white',
  },
  {
    value: 'WARN',
    label: 'WARN',
    description: 'Potential issues, warnings & deprecations',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    activeClass: 'bg-amber-600 text-white border-amber-400 shadow-sm shadow-amber-600/30',
    checkColor: 'text-white',
  },
  {
    value: 'INFO',
    label: 'INFO',
    description: 'Normal operational information',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    activeClass: 'bg-blue-600 text-white border-blue-400 shadow-sm shadow-blue-600/30',
    checkColor: 'text-white',
  },
  {
    value: 'DEBUG',
    label: 'DEBUG',
    description: 'Detailed diagnostic & debug logs',
    badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    activeClass: 'bg-slate-700 text-slate-100 border-slate-500 shadow-sm shadow-slate-700/30',
    checkColor: 'text-cyan-400',
  },
];

const parseInitialLevels = (filter?: LogExplorerFilter | null): string[] => {
  if (filter?.levels && filter.levels.length > 0) {
    return filter.levels;
  }
  if (filter?.level && filter.level !== 'ALL') {
    return filter.level.split(',').map((l) => l.trim().toUpperCase()).filter(Boolean);
  }
  return [];
};

const extractSearchTerms = (query: string): string[] => {
  if (!query || !query.trim()) return [];

  // Normalize quotes (smart/curly quotes to straight quotes)
  const cleaned = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

  // Handle NEAR cross-entry near-concurrency syntax (e.g. "GIS" NEAR "rolled back", GIS NEAR/5s timeout, "GIS" NEAR "Rolled Back")
  const nearMatch = cleaned.match(
    /^\s*(?:["']([^"']+)["']|(.+?))\s+NEAR(?:\s*\/?\s*\d+\s*(?:s|sec|seconds)?)?\s+(?:["']([^"']+)["']|(.+?))\s*$/i
  );
  if (nearMatch) {
    const t1 = (nearMatch[1] || nearMatch[2] || '').trim();
    const t2 = (nearMatch[3] || nearMatch[4] || '').trim();
    return [t1, t2].filter(Boolean);
  }

  const terms: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const term = match[1] || match[2];
    if (term && term.trim()) {
      terms.push(term.trim());
    }
  }
  return terms;
};

const highlightMatch = (text: string | null | undefined, query: string): React.ReactNode => {
  if (!text) return text ?? '';
  if (!query || !query.trim()) return text;

  const terms = extractSearchTerms(query);
  if (terms.length === 0) return text;

  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);

  if (escaped.length === 0) return text;

  // Sort longest terms first so nested substrings don't preempt longer matches
  escaped.sort((a, b) => b.length - a.length);

  try {
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;

    return parts.map((part, i) => {
      const isMatch = escaped.some((term) => new RegExp(`^${term}$`, 'i').test(part));
      if (isMatch) {
        return (
          <mark
            key={i}
            className="bg-amber-400/30 text-amber-200 border border-amber-400/40 rounded px-0.5 font-semibold not-italic"
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  } catch {
    return text;
  }
};

const getPaginationItems = (currentPage: number, maxPages: number): (number | string)[] => {
  if (maxPages <= 7) {
    return Array.from({ length: maxPages }, (_, i) => i + 1);
  }
  const items: (number | string)[] = [];
  items.push(1);

  if (currentPage > 4) {
    items.push('...');
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(maxPages - 1, currentPage + 1);

  for (let i = start; i <= end; i++) {
    items.push(i);
  }

  if (currentPage < maxPages - 3) {
    items.push('...');
  }

  items.push(maxPages);
  return items;
};

interface LogExplorerProps {
  servers: TririgaServer[];
  onSendToAI?: (prompt: string) => void;
  initialFilter?: LogExplorerFilter | null;
  onRefreshData?: () => void;
  onNavigateTab?: (tab: string, filter?: any, configServerId?: number) => void;
  syncExpanded?: boolean;
  onToggleSyncExpanded?: (expanded: boolean) => void;
}

export const LogExplorer: React.FC<LogExplorerProps> = ({ 
  servers, 
  onSendToAI, 
  initialFilter,
  onRefreshData,
  onNavigateTab,
  syncExpanded,
  onToggleSyncExpanded,
}) => {
  const [localSyncExpanded, setLocalSyncExpanded] = useState(false);
  const isSyncExpanded = syncExpanded !== undefined ? syncExpanded : localSyncExpanded;
  const toggleSyncExpanded = () => {
    const next = !isSyncExpanded;
    setLocalSyncExpanded(next);
    if (onToggleSyncExpanded) onToggleSyncExpanded(next);
  };
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [jumpPageInput, setJumpPageInput] = useState('');

  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(jumpPageInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      setPage(target);
      setJumpPageInput('');
    }
  };
  
  // Time Context: Global synchronized Server Time (UTC) vs Local Time
  const { timeMode, setTimeMode, localTzInfo, formatDisplayTime, getDateRangeForPreset } = useTimeContext();

  const handleTimeModeChange = (mode: 'server' | 'local') => {
    setTimeMode(mode);
  };
  
  // Filter Options from DB
  const [filterOptions, setFilterOptions] = useState<{
    servers: Array<{ id: number; name: string; host: string; log_count: number }>;
    file_types: Array<{ file_type: string; file_count: number }>;
    filenames: Array<{ filename: string; file_type: string; entry_count: number }>;
    log_levels: Array<{ log_level: string; count: number }>;
  } | null>(null);

  // Active Filters
  const [selectedServers, setSelectedServers] = useState<number[]>(() => {
    if (initialFilter?.serverIds && initialFilter.serverIds.length > 0) {
      return initialFilter.serverIds;
    }
    if (initialFilter?.serverId) {
      return [initialFilter.serverId];
    }
    return getProdServerIds(servers);
  });
  const [selectedLevels, setSelectedLevels] = useState<string[]>(() => {
    return parseInitialLevels(initialFilter);
  });
  const [isLevelDropdownOpen, setIsLevelDropdownOpen] = useState(false);
  const levelDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (levelDropdownRef.current && !levelDropdownRef.current.contains(event.target as Node)) {
        setIsLevelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [selectedFileType, setSelectedFileType] = useState<string>(() => {
    return initialFilter?.fileType !== undefined ? initialFilter.fileType : 'ALL';
  });
  const [selectedFilename, setSelectedFilename] = useState<string>(() => {
    return initialFilter?.filename !== undefined ? initialFilter.filename : 'ALL';
  });
  const [selectedDatePreset, setSelectedDatePreset] = useState<string>(() => {
    return initialFilter?.datePreset !== undefined ? initialFilter.datePreset : 'TODAY';
  });
  const [startDate, setStartDate] = useState<string>(() => {
    return initialFilter?.startDate !== undefined ? initialFilter.startDate : '';
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return initialFilter?.endDate !== undefined ? initialFilter.endDate : '';
  });
  const [startTime, setStartTime] = useState<string>(() => {
    return initialFilter?.startTime !== undefined ? initialFilter.startTime : '';
  });
  const [endTime, setEndTime] = useState<string>(() => {
    return initialFilter?.endTime !== undefined ? initialFilter.endTime : '';
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return initialFilter?.search !== undefined ? initialFilter.search : '';
  });
  const [appliedSearch, setAppliedSearch] = useState<string>(() => {
    return initialFilter?.search !== undefined ? initialFilter.search : '';
  });
  const [loading, setLoading] = useState(false);

  // Initialize selected servers to prod app1 & prod app2 on first load if no explicit initialFilter provided
  const hasInitializedServersRef = React.useRef(false);
  useEffect(() => {
    if (!hasInitializedServersRef.current && servers.length > 0 && !initialFilter?.serverId && !initialFilter?.serverIds) {
      hasInitializedServersRef.current = true;
      const prodIds = getProdServerIds(servers);
      if (prodIds.length > 0) {
        setSelectedServers(prodIds);
      }
    }
  }, [servers, initialFilter]);

  // Synchronize filter when navigating with updated initialFilter while component remains mounted
  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.serverIds && initialFilter.serverIds.length > 0) {
      setSelectedServers(initialFilter.serverIds);
    } else if (initialFilter.serverId) {
      setSelectedServers([initialFilter.serverId]);
    }
    if (initialFilter.levels !== undefined) {
      setSelectedLevels(initialFilter.levels);
    } else if (initialFilter.level !== undefined) {
      setSelectedLevels(parseInitialLevels(initialFilter));
    }
    if (initialFilter.fileType !== undefined) setSelectedFileType(initialFilter.fileType);
    if (initialFilter.filename !== undefined) setSelectedFilename(initialFilter.filename);
    if (initialFilter.datePreset !== undefined) setSelectedDatePreset(initialFilter.datePreset);
    if (initialFilter.startDate !== undefined) setStartDate(initialFilter.startDate);
    if (initialFilter.endDate !== undefined) setEndDate(initialFilter.endDate);
    if (initialFilter.startTime !== undefined) setStartTime(initialFilter.startTime);
    if (initialFilter.endTime !== undefined) setEndTime(initialFilter.endTime);
    if (initialFilter.search !== undefined) {
      setSearchQuery(initialFilter.search);
      setAppliedSearch(initialFilter.search);
    }
    setPage(1);
  }, [initialFilter]);

  const prodIds = getProdServerIds(servers);
  const isDefaultServerSelection = (
    prodIds.length > 0
      ? selectedServers.length === prodIds.length && prodIds.every(id => selectedServers.includes(id))
      : selectedServers.length === 0
  );

  const isFiltered = !isDefaultServerSelection || 
    selectedLevels.length > 0 || 
    selectedFileType !== 'ALL' || 
    selectedFilename !== 'ALL' || 
    appliedSearch !== '' || 
    selectedDatePreset !== 'TODAY' || 
    startDate !== '' || 
    endDate !== '' ||
    startTime !== '' ||
    endTime !== '';

  const handleResetFilters = () => {
    const defaultIds = getProdServerIds(servers);
    setSelectedServers(defaultIds.length > 0 ? defaultIds : []);
    setSelectedLevels([]);
    setSelectedFileType('ALL');
    setSelectedFilename('ALL');
    setSearchQuery('');
    setAppliedSearch('');
    setSelectedDatePreset('TODAY');
    setStartDate('');
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setPage(1);
  };

  const toggleLevelFilter = (level: string) => {
    setPage(1);
    setSelectedLevels(prev =>
      prev.includes(level)
        ? prev.filter(l => l !== level)
        : [...prev, level]
    );
  };

  // Multi-Selection State for AI Analysis
  const [selectedLogIds, setSelectedLogIds] = useState<number[]>([]);
  const [selectedEntriesMap, setSelectedEntriesMap] = useState<Map<number, LogEntry>>(new Map());

  // Inline Expand / Collapse State
  const [expandedLogIds, setExpandedLogIds] = useState<number[]>([]);

  // Selected Log Detail Modal
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [copied, setCopied] = useState(false);

  // Context Timeline Modal State (for Near-Concurrency inspection)
  const [contextModalEntry, setContextModalEntry] = useState<LogEntry | null>(null);
  const [contextLogs, setContextLogs] = useState<(LogEntry & { delta_seconds?: number })[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextWindowSec, setContextWindowSec] = useState(30);

  const openContextModal = async (entry: LogEntry, windowSec: number = 30) => {
    setContextModalEntry(entry);
    setContextWindowSec(windowSec);
    setContextLoading(true);
    try {
      const data = await api.getLogContext(entry.id, windowSec, 50);
      setContextLogs(data.surrounding || []);
    } catch (err) {
      console.error('Failed to fetch context logs:', err);
      setContextLogs([]);
    } finally {
      setContextLoading(false);
    }
  };

  // TRIRIGA Record Inspector Modal State
  const [inspectRecordId, setInspectRecordId] = useState<string | null>(null);
  const [inspectWorkflowId, setInspectWorkflowId] = useState<number | null>(null);

  const openRecordInspector = (id: string, wfId?: number | null) => {
    setInspectRecordId(id);
    setInspectWorkflowId(wfId || null);
  };

  const handleFilterByRecord = (recordId: string) => {
    setSearchQuery(recordId);
    setAppliedSearch(recordId);
    setPage(1);
  };

  // Keyboard Escape listener for modals dismissal
  useEffect(() => {
    if (!selectedEntry && !contextModalEntry && !inspectRecordId && !inspectWorkflowId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedEntry(null);
        setContextModalEntry(null);
        setInspectRecordId(null);
        setInspectWorkflowId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntry, contextModalEntry, inspectRecordId, inspectWorkflowId]);

  const toggleSelectLog = (entry: LogEntry) => {
    setSelectedLogIds(prev => {
      const isSelected = prev.includes(entry.id);
      if (isSelected) {
        setSelectedEntriesMap(map => {
          const next = new Map(map);
          next.delete(entry.id);
          return next;
        });
        return prev.filter(x => x !== entry.id);
      } else {
        setSelectedEntriesMap(map => {
          const next = new Map(map);
          next.set(entry.id, entry);
          return next;
        });
        return [...prev, entry.id];
      }
    });
  };

  const toggleSelectAllOnPage = () => {
    if (logs.length === 0) return;
    const pageIds = logs.map(l => l.id);
    const allSelected = pageIds.every(id => selectedLogIds.includes(id));
    if (allSelected) {
      setSelectedLogIds(prev => prev.filter(id => !pageIds.includes(id)));
      setSelectedEntriesMap(map => {
        const next = new Map(map);
        pageIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedLogIds(prev => Array.from(new Set([...prev, ...pageIds])));
      setSelectedEntriesMap(map => {
        const next = new Map(map);
        logs.forEach(l => next.set(l.id, l));
        return next;
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedLogIds([]);
    setSelectedEntriesMap(new Map());
  };

  const toggleExpand = (id: number) => {
    setExpandedLogIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleExpandAllOnPage = () => {
    const pageIds = logs.map(l => l.id);
    const allExpanded = pageIds.length > 0 && pageIds.every(id => expandedLogIds.includes(id));
    if (allExpanded) {
      setExpandedLogIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setExpandedLogIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const buildAIPromptForLogs = (entries: LogEntry[]) => {
    if (entries.length === 1) {
      const e = entries[0];
      const timeInfo = formatDisplayTime(e.timestamp, 'server');
      const localTimeInfo = formatDisplayTime(e.timestamp, 'local');
      return `Please analyze this TRIRIGA log entry from server "${e.server_name || 'Cluster'}" (${e.filename || e.file_type}):

Timestamp (Server UTC): ${timeInfo.full}
Timestamp (Local ${localTzInfo.shortTz}): ${localTimeInfo.full}
Level: ${e.log_level}
Logger: ${e.logger_name || 'N/A'}
Thread: ${e.thread_name || 'N/A'}

Log Message:
${e.message}
${e.stack_trace ? `\nStack Trace:\n${e.stack_trace}` : ''}

Please consult the database logs for similar, related, or contemporaneous events across the cluster around this timestamp, and provide:
1. Root Cause Summary & Contemporaneous Events
2. Impact on TRIRIGA System & Business Objects
3. Recommended Fix or Actionable Remediation Steps`;
    }

    const lines = entries.map((e, idx) => {
      const timeInfo = formatDisplayTime(e.timestamp, 'server');
      const localTimeInfo = formatDisplayTime(e.timestamp, 'local');
      return `--- Log [${idx + 1}/${entries.length}] ---
Server: ${e.server_name || 'Node'} | File: ${e.filename || e.file_type} | Server Time: ${timeInfo.date} ${timeInfo.time} UTC | Local Time: ${localTimeInfo.date} ${localTimeInfo.time} (${localTzInfo.shortTz}) | Level: ${e.log_level}
Logger: ${e.logger_name || 'N/A'} | Thread: ${e.thread_name || 'N/A'}
Message: ${e.message}
${e.stack_trace ? `Stack Trace Snippet: ${e.stack_trace.substring(0, 300)}...` : ''}`;
    }).join('\n\n');

    return `Please analyze these ${entries.length} selected TRIRIGA log entries across cluster nodes:

${lines}

Please provide:
1. Correlated Root Cause Analysis across these entries
2. Component or Database impact
3. Immediate remediation recommendations`;
  };

  const handleAnalyzeSingle = (entry: LogEntry) => {
    const prompt = buildAIPromptForLogs([entry]);
    if (onSendToAI) {
      onSendToAI(prompt);
    }
  };

  const handleAnalyzeSelectedGroup = () => {
    const selectedEntries = selectedLogIds
      .map(id => selectedEntriesMap.get(id) || logs.find(l => l.id === id))
      .filter((e): e is LogEntry => Boolean(e));
    if (selectedEntries.length === 0) return;
    const prompt = buildAIPromptForLogs(selectedEntries);
    if (onSendToAI) {
      onSendToAI(prompt);
    }
  };

  const loadFilterOptions = async () => {
    try {
      const opts = await api.getFilterOptions();
      setFilterOptions(opts);
    } catch (err) {
      console.error('Failed to load filter options:', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const serverIdsStr = selectedServers.length > 0 ? selectedServers.join(',') : undefined;
      const { start, end } = getDateRangeForPreset(selectedDatePreset, startDate, endDate, undefined, startTime, endTime);
      const data = await api.queryLogs({
        server_ids: serverIdsStr,
        log_level: selectedLevels.length > 0 ? selectedLevels.join(',') : undefined,
        file_type: selectedFileType === 'ALL' ? undefined : selectedFileType,
        filename: selectedFilename === 'ALL' ? undefined : selectedFilename,
        search: appliedSearch || undefined,
        start_time: start,
        end_time: end,
        page,
        page_size: pageSize,
      });
      setLogs(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      console.error('Failed to query logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [page, pageSize, selectedServers, selectedLevels, selectedFileType, selectedFilename, appliedSearch, selectedDatePreset, startDate, endDate, startTime, endTime]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(searchQuery);
    setPage(1);
  };

  const toggleServerFilter = (serverId: number) => {
    setPage(1);
    setSelectedServers(prev => 
      prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'FATAL':
        return 'bg-rose-950/80 text-rose-300 border-rose-600';
      case 'ERROR':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'WARN':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'INFO':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'DEBUG':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getFileTypeBadge = (fileType?: string) => {
    switch (fileType?.toLowerCase()) {
      case 'security':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'workflow':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
      case 'datapool':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'performance':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const cleanLoggerName = (logger?: string) => {
    if (!logger || logger === 'System') return 'System';
    if (logger.includes('Workflow') || logger.includes('workflow')) return 'Workflow.Engine';
    if (logger.includes('security') || logger.includes('auth')) return 'Security.Auth';
    if (logger.includes('datapool') || logger.includes('ConnectionPool') || logger.includes('dataaccess')) return 'DB.DataPool';
    if (logger.includes('oslc') || logger.includes('OSLC')) return 'OSLC.Integration';
    if (logger.includes('ObjectMigration') || logger.includes('migration')) return 'ObjectMigration';
    if (logger.includes('Formula') || logger.includes('formula')) return 'FormulaEngine';
    const parts = logger.split('.');
    return parts.length > 2 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : logger;
  };

  const getLogCategory = (entry: LogEntry) => {
    const msg = (entry.message || '').toLowerCase();
    const st = (entry.stack_trace || '').toLowerCase();
    const file = (entry.filename || entry.file_type || '').toLowerCase();

    if (msg.includes('deadlock') || msg.includes('ora-') || msg.includes('sql') || msg.includes('connectionpool') || msg.includes('timeout') || file.includes('datapool')) {
      return { label: 'Database / SQL', icon: '🗄️', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    }
    if (msg.includes('workflow') || msg.includes('wftemplate') || msg.includes('triworktask') || msg.includes('formula') || file.includes('workflow')) {
      return { label: 'Workflow', icon: '⚡', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' };
    }
    if (msg.includes('login') || msg.includes('auth') || msg.includes('token') || msg.includes('credentials') || msg.includes('session') || file.includes('security')) {
      return { label: 'Security & Auth', icon: '🔒', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
    }
    if (msg.includes('outofmemory') || msg.includes('gc') || msg.includes('heap') || msg.includes('metaspace') || file.includes('gc')) {
      return { label: 'Memory / GC', icon: '🧠', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
    }
    if (msg.includes('oslc') || msg.includes('http') || msg.includes('rest') || msg.includes('endpoint')) {
      return { label: 'API / OSLC', icon: '🌐', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' };
    }
    if (msg.includes('migration') || msg.includes('package') || msg.includes('specclass')) {
      return { label: 'Object Migration', icon: '📦', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    }
    return { label: 'Application', icon: '⚙️', color: 'bg-slate-800 text-slate-300 border-slate-700' };
  };

  const allOnPageSelected = logs.length > 0 && logs.every(l => selectedLogIds.includes(l.id));
  const someOnPageSelected = logs.length > 0 && logs.some(l => selectedLogIds.includes(l.id));
  const allOnPageExpanded = logs.length > 0 && logs.every(l => expandedLogIds.includes(l.id));

  return (
    <div className="space-y-4">
      {/* Collapsible Log Sync & Ingestion Section */}
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm overflow-hidden transition-all">
        <div 
          onClick={toggleSyncExpanded}
          className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition-colors select-none"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">Log Synchronization & Cluster Ingestion</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold font-mono">
                  15m Auto-Sync Active
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Automated 15-minute background ingestion across all {servers.length} nodes, manual harvest triggers & sync journal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSyncExpanded();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all cursor-pointer"
            >
              {isSyncExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Collapse Sync Controls</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Open Log Sync Controls</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isSyncExpanded && (
          <div className="p-5 border-t border-slate-800 bg-slate-950/40 animate-fade-in">
            <LogCollector
              servers={servers}
              onRefresh={onRefreshData || (() => {})}
              onNavigateTab={onNavigateTab}
            />
          </div>
        )}
      </div>

      {/* Header & Comprehensive Multi-Dimensional Filters */}
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Server Logs</h1>
              {isFiltered && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium">Filtered</span>
              )}
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Unified chronological timeline across all TRIRIGA cluster nodes with FTS5 search, date ranges, and multi-server filtering.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Server Time / Local Time Toggle Switch */}
            <div className="flex items-center p-0.5 rounded-lg bg-slate-950/80 border border-slate-800 shadow-inner">
              <button
                type="button"
                onClick={() => handleTimeModeChange('server')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  timeMode === 'server'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Display log timestamps in Server Time (UTC origin recorded by TRIRIGA cluster servers)"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Server Time (UTC)</span>
              </button>
              <button
                type="button"
                onClick={() => handleTimeModeChange('local')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  timeMode === 'local'
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Display log timestamps converted to your browser's Local Time (${localTzInfo.fullTz})`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Local Time <span className="text-[10px] opacity-80 font-mono">({localTzInfo.shortTz})</span></span>
              </button>
            </div>

            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-medium flex items-center gap-1.5 border border-slate-700/80">
              <Calendar className="w-3 h-3 text-cyan-400" />
              <span>
                {selectedDatePreset === 'ALL' 
                  ? 'All Time' 
                  : selectedDatePreset === '30M'
                    ? 'Last 30 Min'
                    : selectedDatePreset === '1H'
                      ? 'Last 1 Hour'
                      : selectedDatePreset === '6H'
                        ? 'Last 6 Hours'
                        : selectedDatePreset === '24H' 
                          ? 'Last 24h' 
                          : selectedDatePreset === 'TODAY' 
                            ? 'Today' 
                            : selectedDatePreset === '7D' 
                              ? 'Last 7 Days' 
                              : selectedDatePreset === '30D' 
                                ? 'Last 30 Days' 
                                : 'Custom Range'}
              </span>
            </span>
            <button
              onClick={toggleExpandAllOnPage}
              className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
            >
              {allOnPageExpanded ? 'Collapse All' : 'Expand All'}
            </button>
            <span className="text-slate-500">•</span>
            <div className="text-slate-400">
              Showing <span className="font-semibold text-white">{logs.length}</span> of <span className="font-semibold text-white">{(total || 0).toLocaleString()}</span> entries
            </div>
          </div>
        </div>

        {/* 1. Server Multi-Select Filter Bar */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Server Node Filter:</span>
            {selectedServers.length > 0 && (
              <button
                onClick={() => setSelectedServers([])}
                className="text-[10px] text-cyan-400 hover:underline ml-2"
              >
                Clear (Show All)
              </button>
            )}
            {isFiltered && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 ml-auto cursor-pointer transition-colors font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset All Filters</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSelectedServers([])}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                selectedServers.length === 0
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/60 hover:text-white'
              }`}
            >
              All Servers ({servers.length})
            </button>
            {servers.map((s) => {
              const isSelected = selectedServers.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleServerFilter(s.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-600 text-white border border-cyan-400 shadow-sm shadow-cyan-500/20'
                      : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-white" /> : <Square className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{s.name}</span>
                  {s.total_entries !== undefined && (
                    <span className="text-[10px] opacity-70 ml-0.5">({s.total_entries})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Log Level Multi-Select Filter Bar */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Log Level Filter:</span>
            {selectedLevels.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedLevels([]);
                  setPage(1);
                }}
                className="text-[10px] text-cyan-400 hover:underline ml-2 cursor-pointer"
              >
                Clear (Show All)
              </button>
            )}
            {selectedLevels.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium font-mono">
                {selectedLevels.length} of {LOG_LEVEL_CONFIG.length} selected
              </span>
            )}
            <div className="flex items-center gap-1.5 ml-auto text-[11px]">
              <span className="text-slate-500 hidden sm:inline">Presets:</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedLevels(['FATAL', 'ERROR']);
                  setPage(1);
                }}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 cursor-pointer transition-colors"
                title="Filter for FATAL and ERROR only"
              >
                Errors & Fatal
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedLevels(['FATAL', 'ERROR', 'WARN']);
                  setPage(1);
                }}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer transition-colors"
                title="Filter for FATAL, ERROR, and WARN"
              >
                Errors & Warns
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedLevels([]);
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                selectedLevels.length === 0
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/60 hover:text-white'
              }`}
            >
              {selectedLevels.length === 0 ? (
                <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>All Levels</span>
            </button>
            {LOG_LEVEL_CONFIG.map((lvl) => {
              const isSelected = selectedLevels.includes(lvl.value);
              const count = filterOptions?.log_levels?.find((l) => l.log_level === lvl.value)?.count;
              return (
                <button
                  key={lvl.value}
                  type="button"
                  onClick={() => toggleLevelFilter(lvl.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border ${
                    isSelected
                      ? lvl.activeClass
                      : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600'
                  }`}
                  title={`${lvl.value}: ${lvl.description}`}
                >
                  {isSelected ? (
                    <CheckSquare className={`w-3.5 h-3.5 ${lvl.checkColor}`} />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span className="font-semibold">{lvl.label}</span>
                  {count !== undefined && (
                    <span className="text-[10px] opacity-75 font-mono ml-0.5">({count.toLocaleString()})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Search and Primary Filters */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80">
          {/* Specific Text, MID & Near-Concurrency Search Input */}
          <form onSubmit={handleSearch} className="flex-1 min-w-[240px]">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-cyan-400 absolute left-3" />
              <input
                type="text"
                placeholder='Query MID, text, SQL error, or near-concurrency: "GIS" NEAR/5s "rolled back"...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-24 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                title='Supports text/MID queries as well as Near-Concurrency temporal queries: "term1" NEAR/10s "term2"'
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setAppliedSearch('');
                    setPage(1);
                  }}
                  className="absolute right-16 p-1 text-slate-400 hover:text-white cursor-pointer"
                  title="Clear text filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-1.5 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
              >
                Filter
              </button>
            </div>
          </form>

          {/* Date Range Selector */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-amber-400" />
            <select
              value={selectedDatePreset}
              onChange={(e) => {
                setSelectedDatePreset(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs cursor-pointer focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Time Available</option>
              <option value="30M">Last 30 Minutes</option>
              <option value="1H">Last 1 Hour</option>
              <option value="6H">Last 6 Hours</option>
              <option value="24H">Last 24 Hours</option>
              <option value="TODAY">Today (00:00 - 23:59)</option>
              <option value="7D">Last 7 Days</option>
              <option value="30D">Last 30 Days</option>
              <option value="CUSTOM">Custom Date Range...</option>
            </select>
          </div>

          {/* Custom Date & Time Inputs if CUSTOM selected */}
          {selectedDatePreset === 'CUSTOM' && (
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-slate-950/80 border border-slate-700/80 shadow-inner">
              {/* Start Date & Time */}
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                  title="Start Date"
                />
                <input
                  type="time"
                  step="1"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setPage(1);
                  }}
                  className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                  title={`Start Time (${timeMode === 'server' ? 'Server UTC' : `Local ${localTzInfo.shortTz}`}) - Optional`}
                />
              </div>

              <span className="text-slate-500 text-xs font-semibold px-0.5">to</span>

              {/* End Date & Time */}
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                  title="End Date"
                />
                <input
                  type="time"
                  step="1"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setPage(1);
                  }}
                  className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                  title={`End Time (${timeMode === 'server' ? 'Server UTC' : `Local ${localTzInfo.shortTz}`}) - Optional`}
                />
              </div>

              {/* Clear Times Action */}
              {(startTime || endTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartTime('');
                    setEndTime('');
                    setPage(1);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-rose-400 cursor-pointer"
                  title="Clear custom time boundaries (defaults to 00:00:00 - 23:59:59)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Log Entry / File Type Filter */}
          <div className="flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-slate-400" />
            <select
              value={selectedFileType}
              onChange={(e) => {
                setSelectedFileType(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs"
            >
              <option value="ALL">All Log Types</option>
              <option value="server">server.log (Core / App)</option>
              <option value="security">security.log (Auth & IP)</option>
              <option value="workflow">workflow / ObjectMigration</option>
              <option value="datapool">datapool.log (DB Pool)</option>
              <option value="performance">performance.log</option>
              <option value="gc">Garbage Collection</option>
            </select>
          </div>

          {/* Specific Filename Filter */}
          {filterOptions?.filenames && filterOptions.filenames.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={selectedFilename}
                onChange={(e) => {
                  setSelectedFilename(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs max-w-[160px] truncate"
              >
                <option value="ALL">All Files ({filterOptions.filenames.length})</option>
                {filterOptions.filenames.map((f, idx) => (
                  <option key={idx} value={f.filename}>
                    {f.filename} ({f.entry_count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Multi-Select Log Level Dropdown with Checkboxes */}
          <div className="relative" ref={levelDropdownRef}>
            <button
              type="button"
              onClick={() => setIsLevelDropdownOpen((prev) => !prev)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                selectedLevels.length > 0
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                  : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700/80'
              }`}
              title="Filter by log levels"
            >
              <Filter className={`w-3.5 h-3.5 ${selectedLevels.length > 0 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>
                {selectedLevels.length === 0
                  ? 'All Levels'
                  : selectedLevels.length === 1
                  ? selectedLevels[0]
                  : `${selectedLevels.length} Levels`}
              </span>
              {selectedLevels.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-cyan-500/30 text-cyan-300 border border-cyan-500/40">
                  {selectedLevels.length}
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isLevelDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isLevelDropdownOpen && (
              <div className="absolute right-0 sm:left-0 sm:right-auto mt-1 w-64 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl z-30 p-2 text-xs animate-fade-in">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 px-1 text-[11px] text-slate-400">
                  <span className="font-semibold uppercase tracking-wider text-slate-300">Select Log Levels</span>
                  {selectedLevels.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLevels([]);
                        setPage(1);
                      }}
                      className="text-cyan-400 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500">All shown</span>
                  )}
                </div>

                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLevels([]);
                      setPage(1);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer text-left ${
                      selectedLevels.length === 0 ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {selectedLevels.length === 0 ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>All Levels</span>
                    </div>
                  </button>

                  {LOG_LEVEL_CONFIG.map((lvl) => {
                    const isSelected = selectedLevels.includes(lvl.value);
                    const count = filterOptions?.log_levels?.find((l) => l.log_level === lvl.value)?.count;
                    return (
                      <button
                        key={lvl.value}
                        type="button"
                        onClick={() => toggleLevelFilter(lvl.value)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer text-left ${
                          isSelected ? 'bg-slate-800/90' : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isSelected ? (
                            <CheckSquare className={`w-3.5 h-3.5 ${lvl.checkColor}`} />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${lvl.badgeClass}`}>
                            {lvl.label}
                          </span>
                        </div>
                        {count !== undefined && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {count.toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-1 px-1">
                  <span className="text-[10px] text-slate-500">Presets:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLevels(['FATAL', 'ERROR']);
                        setPage(1);
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 cursor-pointer"
                    >
                      Errors
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLevels(['FATAL', 'ERROR', 'WARN']);
                        setPage(1);
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer"
                    >
                      Errors+Warn
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              loadFilterOptions();
              fetchLogs();
            }}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 3. Quick MID & Keyword Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
          <span className="text-slate-500 font-medium mr-1">Quick Query Filters:</span>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('MID-');
              setAppliedSearch('MID-');
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/50 cursor-pointer font-mono"
          >
            MID-
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('"GIS" NEAR "rolled back"');
              setAppliedSearch('"GIS" NEAR "rolled back"');
              if (selectedDatePreset === 'TODAY') {
                setSelectedDatePreset('7D');
              }
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-purple-950/50 text-purple-300 border border-purple-500/40 hover:bg-purple-900/60 cursor-pointer font-mono font-semibold flex items-center gap-1"
            title="Search for GIS events near transaction rollbacks on the same server"
          >
            <GitCommit className="w-3 h-3 text-purple-400" />
            <span>"GIS" NEAR "rolled back"</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('deadlock NEAR/10s timeout');
              setAppliedSearch('deadlock NEAR/10s timeout');
              if (selectedDatePreset === 'TODAY') {
                setSelectedDatePreset('7D');
              }
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-purple-950/50 text-purple-300 border border-purple-500/40 hover:bg-purple-900/60 cursor-pointer font-mono font-semibold flex items-center gap-1"
            title="Search for deadlocks within 10s of timeouts on the same server"
          >
            <GitCommit className="w-3 h-3 text-purple-400" />
            <span>deadlock NEAR/10s timeout</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('triWorkTask');
              setAppliedSearch('triWorkTask');
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/50 cursor-pointer font-mono"
          >
            triWorkTask
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('deadlock');
              setAppliedSearch('deadlock');
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-rose-950/40 text-rose-300 border border-rose-500/30 hover:bg-rose-900/50 cursor-pointer font-mono"
          >
            deadlock
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('ORA-');
              setAppliedSearch('ORA-');
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-amber-950/40 text-amber-300 border border-amber-500/30 hover:bg-amber-900/50 cursor-pointer font-mono"
          >
            ORA-
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('OutOfMemory');
              setAppliedSearch('OutOfMemory');
              setPage(1);
            }}
            className="px-2 py-0.5 rounded-md bg-rose-950/40 text-rose-300 border border-rose-500/30 hover:bg-rose-900/50 cursor-pointer font-mono"
          >
            OutOfMemory
          </button>
          {(searchQuery || appliedSearch) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setAppliedSearch('');
                setPage(1);
              }}
              className="ml-auto text-[11px] text-rose-400 hover:underline cursor-pointer"
            >
              Reset Search Filter
            </button>
          )}
        </div>
      </div>

      {/* Selected Batch Actions Bar */}
      {selectedLogIds.length > 0 && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-cyan-950/90 via-slate-900 to-indigo-950/90 border border-cyan-500/40 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-white">
              {selectedLogIds.length} log {selectedLogIds.length === 1 ? 'entry' : 'entries'} selected
            </span>
            <button
              onClick={handleClearSelection}
              className="text-[11px] text-slate-400 hover:text-rose-400 ml-2 cursor-pointer transition-colors"
            >
              Clear Selection
            </button>
          </div>
          <button
            onClick={handleAnalyzeSelectedGroup}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-cyan-500/20 cursor-pointer transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
            <span>Send Selected to AI Log Analysis ({selectedLogIds.length})</span>
          </button>
        </div>
      )}

      {/* Log Entries Table */}
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th 
                  className="py-3 px-3 w-10 text-center cursor-pointer select-none"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).tagName !== 'INPUT') {
                      toggleSelectAllOnPage();
                    }
                  }}
                  title={allOnPageSelected ? "Deselect All on Page" : "Select All on Page"}
                >
                  <input
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = someOnPageSelected && !allOnPageSelected;
                      }
                    }}
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded accent-cyan-500 cursor-pointer align-middle"
                    title={allOnPageSelected ? "Deselect All on Page" : "Select All on Page"}
                  />
                </th>
                <th className="py-3 px-2 w-8 text-center"></th>
                <th className="py-3 px-3 w-44" title={`Currently displaying timestamps in ${timeMode === 'server' ? 'Server Time (UTC origin)' : `Local Time (${localTzInfo.fullTz})`}`}>
                  <div className="flex items-center gap-1.5">
                    {timeMode === 'server' ? <Globe className="w-3 h-3 text-cyan-400" /> : <Clock className="w-3 h-3 text-cyan-400" />}
                    <span>Timestamp ({timeMode === 'server' ? 'Server/UTC' : `Local - ${localTzInfo.shortTz}`})</span>
                  </div>
                </th>
                <th className="py-3 px-2 w-16">Level</th>
                <th className="py-3 px-3 w-36">Server</th>
                <th className="py-3 px-2 w-24">Log Type</th>
                <th className="py-3 px-3 w-48">Logger / Thread</th>
                <th className="py-3 px-4">Message</th>
                <th className="py-3 px-3 w-24 min-w-[96px] text-center sticky right-0 bg-slate-950/95 shadow-[-6px_0_12px_-2px_rgba(0,0,0,0.5)] z-10">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 font-sans">
                    {loading ? 'Fetching amalgamated logs...' : 'No matching log entries found for the selected server and log type filters.'}
                  </td>
                </tr>
              ) : (
                logs.map((entry) => {
                  const isChecked = selectedLogIds.includes(entry.id);
                  const isExpanded = expandedLogIds.includes(entry.id);
                  const timeInfo = formatDisplayTime(entry.timestamp);
                  const category = getLogCategory(entry);
                  const shortLogger = cleanLoggerName(entry.logger_name);

                  return (
                    <React.Fragment key={entry.id}>
                      <tr 
                        className={`transition-colors group cursor-pointer ${isChecked ? 'bg-cyan-950/30 hover:bg-cyan-950/40' : isExpanded ? 'bg-slate-800/50' : 'hover:bg-slate-800/40'}`}
                        onClick={() => toggleExpand(entry.id)}
                      >
                        <td 
                          className="py-2.5 px-3 text-center cursor-pointer select-none" 
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((e.target as HTMLElement).tagName !== 'INPUT') {
                              toggleSelectLog(entry);
                            }
                          }}
                          title={isChecked ? "Deselect log entry" : "Select log entry for AI analysis"}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectLog(entry)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-cyan-500 cursor-pointer align-middle"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center text-slate-400">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(entry.id);
                            }}
                            className="p-1 text-slate-400 hover:text-white transition-transform cursor-pointer"
                            title={isExpanded ? 'Collapse Inline' : 'Expand Inline'}
                          >
                            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90 text-cyan-400' : ''}`} />
                          </button>
                        </td>
                        <td 
                          className="py-2.5 px-3 whitespace-nowrap" 
                          title={`Active (${timeMode === 'server' ? 'Server UTC' : 'Local'}): ${timeInfo.full}\nAlternate (${timeMode === 'server' ? 'Local' : 'Server UTC'}): ${timeInfo.alternateFull}`}
                        >
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white text-xs font-mono font-medium">{timeInfo.time}</span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800/80 text-slate-400 font-mono">
                                {timeMode === 'server' ? 'UTC' : localTzInfo.shortTz}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-sans">{timeInfo.date}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getLevelBadge(entry.log_level)}`}>
                            {entry.log_level}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-sans text-xs truncate max-w-[150px]">
                          <div className="flex items-center gap-1">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/80 text-[11px]" title={entry.server_name}>
                              {entry.server_name}
                            </span>
                            {entry.is_archived && (
                              <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-bold shrink-0" title={`Retrieved from cold archive: ${entry.archive_source || ''}`}>
                                ARCHIVE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap font-sans">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getFileTypeBadge(entry.filename || entry.file_id?.toString())}`}>
                            {entry.filename ? entry.filename.split('-')[0].replace('.log', '') : 'server'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px] truncate max-w-[160px]" title={`${entry.logger_name || 'System'} ${entry.thread_name ? `[${entry.thread_name}]` : ''}`}>
                          <div className="flex items-center gap-1 truncate">
                            <span className="text-slate-300 font-medium">{highlightMatch(shortLogger, appliedSearch)}</span>
                            {entry.thread_name && <span className="text-slate-500 text-[10px]">[{highlightMatch(entry.thread_name, appliedSearch)}]</span>}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-200">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-medium border shrink-0 flex items-center gap-1 ${category.color}`}>
                              <span>{category.icon}</span>
                              <span>{category.label}</span>
                            </span>
                            {entry.correlated_id && (
                              <span 
                                className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono font-semibold shrink-0 flex items-center gap-1 cursor-pointer hover:bg-purple-500/30 transition-colors"
                                title={`Near-concurrency correlated event with #${entry.correlated_id} on ${entry.server_name} (${entry.delta_seconds !== undefined ? (entry.delta_seconds >= 0 ? `+${entry.delta_seconds}s` : `${entry.delta_seconds}s`) : ''}). Click to expand.`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(entry.id);
                                }}
                              >
                                <GitCommit className="w-3 h-3 text-purple-400" />
                                <span>NEAR #{entry.correlated_id} ({entry.delta_seconds !== undefined ? (entry.delta_seconds >= 0 ? `+${entry.delta_seconds}s` : `${entry.delta_seconds}s`) : ''})</span>
                              </span>
                            )}
                            <LinkedRecordChips
                              text={`${entry.message || ''} ${entry.stack_trace || ''}`}
                              onOpenRecord={(id, wfId) => openRecordInspector(id, wfId)}
                              onFilterLogsByRecord={handleFilterByRecord}
                              className="shrink-0"
                              maxChips={2}
                            />
                            <span className="line-clamp-1 text-slate-200 font-sans text-xs">{highlightMatch(entry.message, appliedSearch)}</span>
                            {entry.stack_trace && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/30 font-sans font-medium shrink-0">
                                Stack Trace
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center sticky right-0 bg-slate-900/95 group-hover:bg-slate-800/95 transition-colors shadow-[-6px_0_12px_-2px_rgba(0,0,0,0.5)] z-10 min-w-[96px]">
                          <div className="flex items-center justify-center gap-1.5">
                            {entry.correlated_id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openContextModal(entry, 30);
                                }}
                                className="p-1.5 rounded-lg bg-purple-950/70 border border-purple-500/40 text-purple-300 hover:text-white hover:bg-purple-600 hover:border-purple-400 shadow-sm transition-all cursor-pointer"
                                title="Inspect Surrounding Context Timeline (±30s on this server)"
                              >
                                <Activity className="w-4 h-4 text-purple-300" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAnalyzeSingle(entry);
                              }}
                              className="p-1.5 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-600 hover:border-cyan-400 shadow-sm transition-all cursor-pointer"
                              title="Send this log entry to AI Assistant"
                            >
                              <Sparkles className="w-4 h-4 text-cyan-300 group-hover:text-cyan-200" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEntry(entry);
                              }}
                              className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                              title="View Full Details in Modal"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline Expanded Row Details */}
                      {isExpanded && (
                        <tr className="bg-slate-950/80 border-b border-slate-800/80 animate-fade-in">
                          <td colSpan={9} className="p-4 space-y-3 font-sans">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800 text-xs">
                              <div className="flex flex-wrap items-center gap-2 text-slate-400">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 ${category.color}`}>
                                  <span>{category.icon}</span>
                                  <span>{category.label}</span>
                                </span>
                                {entry.correlated_id && (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center gap-1">
                                    <GitCommit className="w-3 h-3 text-purple-400" />
                                    <span>NEAR Partner #{entry.correlated_id} ({entry.delta_seconds !== undefined ? (entry.delta_seconds >= 0 ? `+${entry.delta_seconds}s` : `${entry.delta_seconds}s`) : ''})</span>
                                  </span>
                                )}
                                <span>•</span>
                                <span className="text-cyan-400 font-medium font-sans">Server: {entry.server_name}</span>
                                <span>•</span>
                                <span 
                                  className="font-mono text-[11px] text-slate-300 flex items-center gap-1"
                                  title={`Active: ${timeInfo.full}\nAlternate: ${timeInfo.alternateFull}`}
                                >
                                  {timeMode === 'server' ? <Globe className="w-3 h-3 text-cyan-400 inline" /> : <Clock className="w-3 h-3 text-cyan-400 inline" />}
                                  <span>Time: {timeInfo.date} {timeInfo.time} ({timeMode === 'server' ? 'Server UTC' : `Local ${localTzInfo.shortTz}`})</span>
                                </span>
                                <span>•</span>
                                <span className="font-mono text-[11px] text-slate-300">File: {entry.filename} (Line {entry.line_number})</span>
                                <span>•</span>
                                <span className="font-mono text-[11px] text-slate-400" title={entry.logger_name}>Logger: {highlightMatch(shortLogger, appliedSearch)}</span>
                                {entry.thread_name && <span className="font-mono text-[11px] text-slate-500">[{highlightMatch(entry.thread_name, appliedSearch)}]</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openContextModal(entry, 30)}
                                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-500/40 text-xs font-semibold shadow-sm cursor-pointer transition-all timeline-window-btn"
                                  title="Inspect surrounding timeline on this server"
                                >
                                  <Activity className="w-3.5 h-3.5 text-purple-300" />
                                  <span>Timeline Window (±30s)</span>
                                </button>
                                <button
                                  onClick={() => handleAnalyzeSingle(entry)}
                                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm cursor-pointer transition-all"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                                  <span>Analyze with AI</span>
                                </button>
                                <button
                                  onClick={() => setSelectedEntry(entry)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 cursor-pointer"
                                >
                                  Modal View
                                </button>
                                <button
                                  onClick={() => toggleExpand(entry.id)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs cursor-pointer"
                                >
                                  Collapse ✕
                                </button>
                              </div>
                            </div>

                            {/* Near-Concurrency Correlated Partner Card */}
                            {entry.correlated_id && (
                              <div className="p-3.5 rounded-xl near-concurrency-card bg-gradient-to-r from-purple-950/50 via-slate-900 to-indigo-950/40 border border-purple-500/40 space-y-2.5 animate-fade-in shadow-lg">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-500/20 pb-2">
                                  <div className="flex items-center gap-2">
                                    <GitCommit className="w-4 h-4 text-purple-400 shrink-0" />
                                    <span className="font-bold text-purple-200 text-xs tracking-wide nc-header-title">
                                      Correlated Near-Concurrency Event (Node: {entry.server_name})
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full bg-purple-500/25 text-purple-200 border border-purple-500/40 text-[10px] font-mono font-bold nc-partner-badge">
                                      Partner #{entry.correlated_id} • Time Delta: {entry.delta_seconds !== undefined ? (entry.delta_seconds >= 0 ? `+${entry.delta_seconds}s` : `${entry.delta_seconds}s`) : ''}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openContextModal(entry, 30)}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold cursor-pointer shadow-sm transition-all"
                                  >
                                    <Activity className="w-3.5 h-3.5" />
                                    <span>Inspect Chronological Context Timeline</span>
                                  </button>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono nc-meta-text">
                                  <span className="text-slate-300 font-semibold">Timestamp: {entry.correlated_timestamp}</span>
                                  {entry.correlated_level && (
                                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${getLevelBadge(entry.correlated_level)}`}>
                                      {entry.correlated_level}
                                    </span>
                                  )}
                                  {entry.correlated_logger && (
                                    <span className="text-slate-400">Logger: {highlightMatch(cleanLoggerName(entry.correlated_logger), appliedSearch)}</span>
                                  )}
                                  {entry.correlated_thread && (
                                    <span className="text-slate-500">[{highlightMatch(entry.correlated_thread, appliedSearch)}]</span>
                                  )}
                                </div>
                                {entry.correlated_message && (
                                  <div className="p-3 rounded-lg bg-slate-950 border border-purple-500/30 text-slate-100 font-mono text-xs whitespace-pre-wrap select-text leading-relaxed nc-msg-box">
                                    {highlightMatch(entry.correlated_message, appliedSearch)}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Linked TRIRIGA Records & Workflows Panel */}
                            {(() => {
                              const combined = `${entry.message || ''} ${entry.stack_trace || ''}`;
                              const ids = extractRecordIdentifiersFromText(combined);
                              if (ids.specIds.length === 0 && ids.controlNumbers.length === 0 && ids.workflowIds.length === 0) return null;

                              return (
                                <div className="p-3.5 rounded-xl bg-slate-100/90 border border-slate-300 dark:bg-slate-900/90 dark:border-cyan-500/40 space-y-2 shadow-sm animate-fade-in">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <Layers className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                                      <span className="text-xs font-bold text-slate-900 dark:text-white">Linked TRIRIGA Business Records & Workflows:</span>
                                    </div>
                                    <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                                      Click any badge to view record details, status, location & correlated logs
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap pt-1">
                                    <LinkedRecordChips
                                      text={combined}
                                      onOpenRecord={(id, wfId) => openRecordInspector(id, wfId)}
                                      onFilterLogsByRecord={handleFilterByRecord}
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                            <div className="space-y-1">
                              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Log Message:</span>
                              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono whitespace-pre-wrap select-text leading-relaxed">
                                {highlightMatch(entry.message, appliedSearch)}
                              </div>
                            </div>

                            {entry.stack_trace && (
                              <div className="space-y-1 pt-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    Exception Stack Trace:
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard(entry.stack_trace || '')}
                                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer font-sans"
                                  >
                                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>{copied ? 'Copied' : 'Copy Stack'}</span>
                                  </button>
                                </div>
                                <pre className="p-3.5 rounded-lg bg-slate-900 border border-rose-950/80 text-rose-300/90 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed max-h-96 select-text">
                                  {highlightMatch(entry.stack_trace, appliedSearch)}
                                </pre>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Comprehensive Pagination Bar */}
        {(() => {
          const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
          const endRecord = Math.min(page * pageSize, total);
          const paginationItems = getPaginationItems(page, Math.max(1, totalPages));

          return (
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 py-3 bg-slate-950/70 border-t border-slate-800 text-xs text-slate-400 select-none">
              {/* Left: Summary & Rows-per-Page selector */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-slate-400 flex items-center gap-1 text-[11px] sm:text-xs">
                  <span>Showing</span>
                  <span className="font-semibold text-white font-mono">{startRecord.toLocaleString()}</span>
                  <span>-</span>
                  <span className="font-semibold text-white font-mono">{endRecord.toLocaleString()}</span>
                  <span>of</span>
                  <span className="font-semibold text-cyan-300 font-mono">{total.toLocaleString()}</span>
                  <span>entries</span>
                </div>

                <div className="flex items-center gap-1.5 pl-3 border-l border-slate-800">
                  <span className="text-[11px] text-slate-400 font-medium">Rows:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 text-xs cursor-pointer focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="25">25 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                    <option value="250">250 / page</option>
                    <option value="500">500 / page</option>
                  </select>
                </div>
              </div>

              {/* Right: Page Navigation Controls & Direct Jump */}
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {/* First Page */}
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 cursor-pointer transition-colors"
                  title="First Page (Page 1)"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>

                {/* Previous Page */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 cursor-pointer transition-colors"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Prev</span>
                </button>

                {/* Numeric Page Buttons */}
                <div className="flex items-center gap-1">
                  {paginationItems.map((item, idx) => {
                    if (item === '...') {
                      return (
                        <span key={`dots-${idx}`} className="px-1.5 py-0.5 text-slate-500 font-mono text-xs select-none">
                          ...
                        </span>
                      );
                    }
                    const pageNum = Number(item);
                    const isCurrent = pageNum === page;
                    return (
                      <button
                        key={`page-${pageNum}`}
                        type="button"
                        onClick={() => setPage(pageNum)}
                        disabled={loading}
                        className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-cyan-600 text-white border border-cyan-400 font-bold shadow-sm shadow-cyan-500/30'
                            : 'bg-slate-800/90 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                {/* Next Page */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 cursor-pointer transition-colors"
                  title="Next Page"
                >
                  <span className="hidden sm:inline text-xs">Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Last Page */}
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, totalPages))}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 cursor-pointer transition-colors"
                  title={`Last Page (Page ${totalPages})`}
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>

                {/* Direct Jump to Page Form */}
                {totalPages > 1 && (
                  <form onSubmit={handleJumpToPage} className="flex items-center gap-1 ml-1.5 pl-2.5 border-l border-slate-800">
                    <span className="text-[11px] text-slate-400 hidden sm:inline">Go to:</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpPageInput}
                      onChange={(e) => setJumpPageInput(e.target.value)}
                      placeholder={String(page)}
                      className="w-12 px-1.5 py-1 text-center font-mono rounded-md bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                      title={`Enter page 1-${totalPages}`}
                    />
                    <button
                      type="submit"
                      disabled={loading || !jumpPageInput}
                      className="px-2 py-1 rounded-md bg-slate-800 hover:bg-cyan-600 hover:text-white hover:border-cyan-500 text-slate-300 border border-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors"
                    >
                      Go
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Log Entry Detail Modal / Drawer */}
      {selectedEntry && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEntry(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
        >
          <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold font-mono border ${getLevelBadge(selectedEntry.log_level)}`}>
                  {selectedEntry.log_level}
                </span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 ${getLogCategory(selectedEntry).color}`}>
                  <span>{getLogCategory(selectedEntry).icon}</span>
                  <span>{getLogCategory(selectedEntry).label}</span>
                </span>
                <span className="text-sm font-semibold text-white">{selectedEntry.server_name}</span>
                <span 
                  className="text-xs text-slate-300 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1.5"
                  title={`Active: ${formatDisplayTime(selectedEntry.timestamp).full}\nAlternate: ${formatDisplayTime(selectedEntry.timestamp).alternateFull}`}
                >
                  {timeMode === 'server' ? <Globe className="w-3 h-3 text-cyan-400" /> : <Clock className="w-3 h-3 text-cyan-400" />}
                  <span>{formatDisplayTime(selectedEntry.timestamp).full}</span>
                </span>
              </div>
              <button 
                onClick={() => setSelectedEntry(null)}
                className="text-slate-400 hover:text-white text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 text-xs font-mono pr-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <span className="text-slate-500 font-sans font-medium">Source File:</span>
                  <p className="text-slate-300 bg-slate-950 p-2 rounded-lg border border-slate-800 truncate" title={`${selectedEntry.filename} (Line ${selectedEntry.line_number})`}>
                    {selectedEntry.filename} (Line {selectedEntry.line_number})
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 font-sans font-medium">Logger & Thread:</span>
                  <p className="text-slate-300 bg-slate-950 p-2 rounded-lg border border-slate-800 truncate" title={selectedEntry.logger_name}>
                    {highlightMatch(cleanLoggerName(selectedEntry.logger_name), appliedSearch)} {selectedEntry.thread_name ? `[${highlightMatch(selectedEntry.thread_name, appliedSearch)}]` : ''}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 font-sans font-medium">Time Reference:</span>
                  <div className="text-slate-300 bg-slate-950 p-1.5 rounded-lg border border-slate-800 text-[10px] space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Server (UTC):</span>
                      <span className="text-white font-semibold">{formatDisplayTime(selectedEntry.timestamp, 'server').date} {formatDisplayTime(selectedEntry.timestamp, 'server').time}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Local ({localTzInfo.shortTz}):</span>
                      <span className="text-cyan-300 font-semibold">{formatDisplayTime(selectedEntry.timestamp, 'local').date} {formatDisplayTime(selectedEntry.timestamp, 'local').time}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 font-sans font-medium">Message:</span>
                <p className="text-slate-100 bg-slate-950 p-3 rounded-lg border border-slate-800 whitespace-pre-wrap">
                  {highlightMatch(selectedEntry.message, appliedSearch)}
                </p>
              </div>

              {/* Linked TRIRIGA Records & Workflows in Modal */}
              {(() => {
                const combined = `${selectedEntry.message || ''} ${selectedEntry.stack_trace || ''}`;
                const ids = extractRecordIdentifiersFromText(combined);
                if (ids.specIds.length === 0 && ids.controlNumbers.length === 0 && ids.workflowIds.length === 0) return null;

                return (
                  <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                        <Layers className="w-4 h-4 text-cyan-400" />
                        <span>Linked TRIRIGA Business Records & Workflows:</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Click badge to inspect record details</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                      <LinkedRecordChips
                        text={combined}
                        onOpenRecord={(id, wfId) => openRecordInspector(id, wfId)}
                        onFilterLogsByRecord={handleFilterByRecord}
                      />
                    </div>
                  </div>
                );
              })()}

              {selectedEntry.stack_trace && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-400 font-sans font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Exception Stack Trace:
                    </span>
                    <button
                      onClick={() => copyToClipboard(selectedEntry.stack_trace || '')}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white font-sans cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy Stack'}</span>
                    </button>
                  </div>
                  <pre className="text-rose-300/90 bg-slate-950 p-3 rounded-lg border border-rose-950 overflow-x-auto text-[11px] leading-relaxed">
                    {highlightMatch(selectedEntry.stack_trace, appliedSearch)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-500 font-sans">Node: {selectedEntry.server_name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const entry = selectedEntry;
                    setSelectedEntry(null);
                    handleAnalyzeSingle(entry);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 cursor-pointer transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Analyze with AI</span>
                </button>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Near-Concurrency Context Timeline Modal */}
      {contextModalEntry && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setContextModalEntry(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in"
        >
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-slate-900 border border-purple-500/50 p-6 shadow-2xl flex flex-col justify-between space-y-4 context-timeline-modal">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white timeline-modal-title">Chronological Context Timeline</span>
                    <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono font-bold timeline-window-badge">
                      ±{contextWindowSec}s on {contextModalEntry.server_name}
                    </span>
                    {contextModalEntry.correlated_id && (
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-bold">
                        Partner Event #{contextModalEntry.correlated_id}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 timeline-modal-sub">
                    Inspecting temporal sequence of events across threads and log files on this node
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-xs timeline-window-selector">
                  <span className="text-slate-400 text-[11px]">Window:</span>
                  {[10, 30, 60, 120].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => openContextModal(contextModalEntry, sec)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors cursor-pointer ${
                        contextWindowSec === sec
                          ? 'bg-purple-600 text-white font-bold'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      ±{sec}s
                    </button>
                  ))}
                </div>
                <button 
                  onClick={() => setContextModalEntry(null)}
                  className="text-slate-400 hover:text-white text-sm p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto space-y-2 pr-2 max-h-[60vh] font-mono text-xs">
              {contextLoading ? (
                <div className="py-16 text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mx-auto" />
                  <p className="text-xs">Fetching chronological timeline window...</p>
                </div>
              ) : contextLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-sans">
                  No other log entries found in this ±{contextWindowSec}s window on {contextModalEntry.server_name}.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {contextLogs.map((item) => {
                    const isAnchor = item.id === contextModalEntry.id;
                    const isPartner = contextModalEntry.correlated_id && item.id === contextModalEntry.correlated_id;
                    const delta = item.delta_seconds !== undefined ? item.delta_seconds : 0;
                    const deltaStr = delta === 0 ? '0.00s (Anchor)' : delta > 0 ? `+${delta.toFixed(2)}s` : `${delta.toFixed(2)}s`;

                    return (
                      <div 
                        key={item.id}
                        className={`p-3 rounded-xl transition-colors space-y-1.5 ${
                          isAnchor 
                            ? 'bg-cyan-950/40 border border-cyan-500/50 my-1 shadow-md timeline-anchor-item' 
                            : isPartner 
                              ? 'bg-purple-950/40 border border-purple-500/50 my-1 shadow-md timeline-partner-item' 
                              : 'hover:bg-slate-800/40 bg-slate-950/30 timeline-regular-item'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              delta === 0
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                : delta > 0
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                            }`}>
                              Δ {deltaStr}
                            </span>
                            <span className="text-slate-300 font-medium">{item.timestamp}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${getLevelBadge(item.log_level)}`}>
                              {item.log_level}
                            </span>
                            <span className="text-slate-400 truncate max-w-[180px]">
                              {cleanLoggerName(item.logger_name)} {item.thread_name ? `[${item.thread_name}]` : ''}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {isAnchor && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-600 text-white shadow-sm">
                                ANCHOR MATCH
                              </span>
                            )}
                            {isPartner && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-600 text-white shadow-sm">
                                CORRELATED PARTNER
                              </span>
                            )}
                            <LinkedRecordChips
                              text={`${item.message || ''} ${item.stack_trace || ''}`}
                              onOpenRecord={(id, wfId) => openRecordInspector(id, wfId)}
                              onFilterLogsByRecord={handleFilterByRecord}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setContextModalEntry(null);
                                setSelectedEntry(item);
                              }}
                              className="text-[11px] text-slate-400 hover:text-cyan-300 cursor-pointer"
                            >
                              Details ↗
                            </button>
                          </div>
                        </div>

                        <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80 text-slate-200 font-mono text-xs whitespace-pre-wrap select-text leading-relaxed timeline-msg-box">
                          {highlightMatch(item.message, appliedSearch)}
                        </div>

                        {item.stack_trace && (
                          <pre className="p-2 rounded bg-slate-950 border border-rose-950/80 text-rose-300/90 text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto timeline-trace-box">
                            {highlightMatch(item.stack_trace, appliedSearch)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-500 font-sans">
                {contextLogs.length} events logged within ±{contextWindowSec}s on {contextModalEntry.server_name}
              </span>
              <button
                type="button"
                onClick={() => setContextModalEntry(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
              >
                Close Timeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRIRIGA Record & Workflow Inspector Modal */}
      {inspectRecordId && (
        <TririgaRecordInspectorModal
          identifier={inspectRecordId}
          workflowId={inspectWorkflowId}
          onClose={() => {
            setInspectRecordId(null);
            setInspectWorkflowId(null);
          }}
          onFilterLogsByRecord={handleFilterByRecord}
          onSendToAI={onSendToAI}
          onInspectWorkTask={(id) => {
            if (onNavigateTab) {
              onNavigateTab('worktasks', { worktaskIdentifier: id });
            }
          }}
        />
      )}
    </div>
  );
};
