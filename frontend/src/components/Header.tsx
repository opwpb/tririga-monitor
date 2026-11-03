import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Server, 
  Activity, 
  Search, 
  BrainCircuit, 
  Settings as SettingsIcon, 
  DownloadCloud, 
  Database,
  Sun,
  Moon,
  Zap,
  Cpu,
  ShieldCheck,
  SlidersHorizontal,
  Lock,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Globe,
  Sparkles,
  Menu,
  X,
  Wrench
} from 'lucide-react';
import { PerfModal } from './PerfModal';
import { IngestionSchedule } from '../types';
import { useTimeContext } from '../context/TimeContext';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string, section?: string, expandSync?: boolean) => void;
  serverCount: number;
  totalLogs: number;
  errorCount: number;
  isChatOpen: boolean;
  onToggleChat: () => void;
  isChatStreaming?: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  liveTabs?: Record<string, boolean>;
  onLock?: () => void;
  activeSettingsSection?: string;
  onSelectSettingsSection?: (section: string) => void;
  onOpenLogSync?: () => void;
  ingestionSchedule?: IngestionSchedule | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  serverCount,
  totalLogs,
  errorCount,
  isChatOpen,
  onToggleChat,
  isChatStreaming = false,
  theme,
  onToggleTheme,
  liveTabs,
  onLock,
  activeSettingsSection,
  onSelectSettingsSection,
  onOpenLogSync,
  ingestionSchedule,
}) => {
  const [showPerfModal, setShowPerfModal] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServersOpen, setIsServersOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [mobileServersExpanded, setMobileServersExpanded] = useState(false);
  const [mobileSettingsExpanded, setMobileSettingsExpanded] = useState(false);
  const { timeMode, toggleTimeMode, formatDisplayTime, localTzInfo } = useTimeContext();

  const serversBtnRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const serversDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  const [serversMenuPos, setServersMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [settingsMenuPos, setSettingsMenuPos] = useState<{ top: number; right: number } | null>(null);

  const updateServersPos = () => {
    if (serversBtnRef.current) {
      const rect = serversBtnRef.current.getBoundingClientRect();
      setServersMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
      });
    }
  };

  const updateSettingsPos = () => {
    if (settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setSettingsMenuPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
  };

  useEffect(() => {
    if (isServersOpen) updateServersPos();
  }, [isServersOpen]);

  useEffect(() => {
    if (isSettingsOpen) updateSettingsPos();
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isServersOpen && !isSettingsOpen) return;

    const handleScrollOrResize = () => {
      if (isServersOpen) updateServersPos();
      if (isSettingsOpen) updateSettingsPos();
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        isServersOpen &&
        !serversBtnRef.current?.contains(target) &&
        !serversDropdownRef.current?.contains(target)
      ) {
        setIsServersOpen(false);
      }
      if (
        isSettingsOpen &&
        !settingsBtnRef.current?.contains(target) &&
        !settingsDropdownRef.current?.contains(target)
      ) {
        setIsSettingsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsServersOpen(false);
        setIsSettingsOpen(false);
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isServersOpen, isSettingsOpen]);

  const navRef = useRef<HTMLElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkNavScroll = () => {
    if (navRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = navRef.current;
      setCanScrollLeft(scrollLeft > 4);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
    }
  };

  useEffect(() => {
    checkNavScroll();
    const handleResize = () => checkNavScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scrollNav = (direction: 'left' | 'right') => {
    if (navRef.current) {
      navRef.current.scrollBy({
        left: direction === 'left' ? -180 : 180,
        behavior: 'smooth',
      });
      setTimeout(checkNavScroll, 200);
    }
  };

  const formatLastIngestionTime = (isoString?: string | null) => {
    if (!isoString) return null;
    const formatted = formatDisplayTime(isoString);
    if (!formatted.time) return null;
    return formatted.time;
  };

  const lastIngestionTime = formatLastIngestionTime(ingestionSchedule?.last_run_at);

  const isServerTabActive = ['server_config', 'operations', 'agent_activity', 'thread_activity', 'agent_monitor'].includes(activeTab);
  const isServersLive = Boolean(
    liveTabs?.['server_config'] || 
    liveTabs?.['operations'] || 
    liveTabs?.['agent_activity'] || 
    liveTabs?.['thread_activity'] || 
    liveTabs?.['agent_monitor']
  );

  const otherNavItems = [
    { id: 'explorer', label: 'Logs', icon: Search, badge: totalLogs > 0 ? `${(totalLogs / 1000).toFixed(1)}k` : undefined },
    { id: 'worktasks', label: 'WorkTasks & Contention', icon: Wrench, highlight: false },
    { id: 'user_activity', label: 'User Activity', icon: Users, highlight: false },
    { id: 'dbquery', label: 'DB Queries', icon: Database },
    { id: 'analysis', label: 'AI Analysis', icon: BrainCircuit, highlight: true },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
              <Database className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xs sm:text-sm md:text-base text-white tracking-tight leading-tight">
                <span className="inline sm:hidden">Tririga</span>
                <span className="hidden sm:inline">Tririga Monitoring</span>
                <span className="hidden xl:inline"><br />&amp; Log Analysis</span>
              </h1>
            </div>
          </div>

          {/* Navigation Tabs with Scroll Chevrons (Visible on md+ screens) */}
          <div className="hidden md:flex flex-1 items-center min-w-0 relative mx-2">
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scrollNav('left')}
                className="absolute left-0 z-20 h-8 w-6 flex items-center justify-center bg-slate-900/95 hover:bg-slate-800 text-cyan-400 hover:text-white border-y border-r border-slate-700 rounded-r shadow-lg transition-all cursor-pointer"
                title="Scroll navigation left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <nav
              ref={navRef}
              onScroll={checkNavScroll}
              onWheel={(e) => {
                if (e.deltaY !== 0 && navRef.current) {
                  navRef.current.scrollLeft += e.deltaY;
                  checkNavScroll();
                }
              }}
              className="flex-1 flex items-center space-x-1 overflow-x-auto nav-scrollbar py-1 px-1 min-w-0"
            >
            {/* Dashboard Button */}
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`shrink-0 flex items-center gap-1.5 xl:gap-2 px-2.5 py-1.5 xl:px-3 xl:py-2 rounded-lg text-xs xl:text-sm font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
              title="Operational Overview & Global KPIs"
            >
              <Activity className={`w-3.5 h-3.5 xl:w-4 xl:h-4 ${activeTab === 'dashboard' ? 'text-blue-400' : ''}`} />
              <span>Dashboard</span>
            </button>

            {/* Servers Section with Dropdown */}
            <div 
              ref={serversBtnRef}
              className="relative shrink-0"
            >
              <div className={`inline-flex items-stretch rounded-lg transition-all border ${
                isServerTabActive
                  ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border-transparent'
              }`}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isServerTabActive) {
                      setActiveTab('server_config');
                    }
                    setIsServersOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 xl:px-3 xl:py-2 text-xs xl:text-sm font-medium transition-colors rounded-l-lg cursor-pointer"
                  title="TRIRIGA Servers, Health & Runtime Diagnostics"
                >
                  <Server className={`w-3.5 h-3.5 xl:w-4 xl:h-4 ${isServerTabActive ? 'text-cyan-400' : ''}`} />
                  <span>Servers</span>
                  {isServersLive && (
                    <span 
                      className="relative flex h-2 w-2 ml-0.5" 
                      title="Live background telemetry active on server monitoring"
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-emerald-500/50 shadow-sm"></span>
                    </span>
                  )}
                </button>
                <div className={`w-px my-1 ${isServerTabActive ? 'bg-slate-700 dark:bg-slate-700' : 'bg-slate-700/40'}`} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsServersOpen(prev => {
                      if (!prev) setIsSettingsOpen(false);
                      return !prev;
                    });
                  }}
                  className="px-1.5 flex items-center justify-center rounded-r-lg hover:bg-slate-700/40 transition-colors cursor-pointer"
                  title="Servers Navigation Menu"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isServersOpen ? 'rotate-180 text-cyan-400' : ''}`} />
                </button>
              </div>

              {/* Servers Dropdown Menu - Portaled outside nav to prevent overflow clipping */}
              {isServersOpen && serversMenuPos && createPortal(
                <div 
                  ref={serversDropdownRef}
                  style={{ top: `${serversMenuPos.top}px`, left: `${serversMenuPos.left}px` }}
                  className="settings-dropdown servers-dropdown fixed w-72 rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/60 py-1.5 z-50 animate-fade-in backdrop-blur-xl"
                >
                  <div className="px-3.5 py-2 flex items-center justify-between border-b border-slate-800">
                    <span className="settings-dropdown-header text-[11px] font-bold uppercase tracking-widest text-slate-400">Server Operations</span>
                    <span className="settings-dropdown-hub text-[9px] font-semibold uppercase tracking-wider text-cyan-400 font-mono">Cluster Hub</span>
                  </div>

                  {/* Server Health */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('operations');
                      setIsServersOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'operations' ? 'settings-dropdown-item-active bg-cyan-500/10' : 'hover:bg-slate-800'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'operations' ? 'text-cyan-300' : 'text-white'
                      }`}>Server Health</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Scorecard, GC telemetry &amp; lock contention</div>
                    </div>
                    {liveTabs?.['operations'] && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Live monitoring active" />
                    )}
                  </button>

                  {/* Agent Activity */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('agent_activity');
                      setIsServersOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'agent_activity' ? 'settings-dropdown-item-active bg-cyan-500/10' : 'hover:bg-slate-800'
                    }`}
                  >
                    <Cpu className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'agent_activity' ? 'text-cyan-300' : 'text-white'
                      }`}>Agent Activity</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Workflow agents, event backlog &amp; API sessions</div>
                    </div>
                    {liveTabs?.['agent_activity'] && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Live monitoring active" />
                    )}
                  </button>

                  {/* Thread Activity */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('thread_activity');
                      setIsServersOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'thread_activity' ? 'settings-dropdown-item-active bg-cyan-500/10' : 'hover:bg-slate-800'
                    }`}
                  >
                    <Activity className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'thread_activity' ? 'text-cyan-300' : 'text-white'
                      }`}>Thread Activity</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">JVM worker thread matrix, stack traces &amp; contention</div>
                    </div>
                    {liveTabs?.['thread_activity'] && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Live monitoring active" />
                    )}
                  </button>

                  <div className="border-t border-slate-800 my-1"></div>

                  {/* Server Configuration */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('server_config');
                      setIsServersOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'server_config' ? 'settings-dropdown-item-active bg-cyan-500/10' : 'hover:bg-slate-800'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'server_config' ? 'text-cyan-300' : 'text-white'
                      }`}>Server Configuration</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Node comparison matrix, properties &amp; drift</div>
                    </div>
                  </button>
                </div>,
                document.body
              )}
            </div>

            {/* Other Navigation Tabs */}
            {otherNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isExplorerTab = item.id === 'explorer';
              const isAutoIngestionEnabled = isExplorerTab && Boolean(ingestionSchedule?.is_enabled);
              const isAutoIngestionRunning = isExplorerTab && Boolean(ingestionSchedule?.is_running);
              const isLive = isExplorerTab ? isAutoIngestionEnabled : Boolean(liveTabs?.[item.id]);

              const getTabTitle = () => {
                if (isExplorerTab && isAutoIngestionEnabled) {
                  return `Logs (Auto Ingestion Active: ${ingestionSchedule?.interval_minutes || 15}m cadence${
                    ingestionSchedule?.last_run_at ? ` • Last harvest: ${formatDisplayTime(ingestionSchedule.last_run_at).full}` : ''
                  })`;
                }
                if (isLive) return `${item.label} (Live background monitoring active)`;
                return item.label;
              };

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`shrink-0 flex items-center gap-1.5 xl:gap-2 px-2.5 py-1.5 xl:px-3 xl:py-2 rounded-lg text-xs xl:text-sm font-medium transition-all ${
                    isActive
                      ? item.highlight 
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                        : 'bg-slate-800 text-white border border-slate-700'
                      : item.highlight
                        ? 'text-cyan-400 hover:bg-cyan-950/40 hover:text-cyan-200'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                  title={getTabTitle()}
                >
                  <Icon className={`w-3.5 h-3.5 xl:w-4 xl:h-4 ${isActive ? (item.highlight ? 'text-cyan-300' : 'text-blue-400') : ''}`} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                      {item.badge}
                    </span>
                  )}
                  {/* Green Live Indicator for Auto Ingestion & Live Monitoring */}
                  {isLive && (
                    <span 
                      className="relative flex h-2 w-2 ml-0.5" 
                      title={isAutoIngestionRunning ? "Auto ingestion harvesting now" : isAutoIngestionEnabled ? "Auto log ingestion active" : "Live background activity active"}
                    >
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isAutoIngestionRunning ? 'bg-cyan-400' : 'bg-emerald-400'} opacity-75`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isAutoIngestionRunning ? 'bg-cyan-500 shadow-cyan-500/50' : 'bg-emerald-500 shadow-emerald-500/50'} shadow-sm`}></span>
                    </span>
                  )}
                  {/* Last Ingestion Time Chip on Logs tab */}
                  {isExplorerTab && isAutoIngestionEnabled && lastIngestionTime && (
                    <span 
                      className="hidden 2xl:inline-block ml-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
                      title={`Last log harvest: ${ingestionSchedule?.last_run_at ? formatDisplayTime(ingestionSchedule.last_run_at).full : lastIngestionTime}`}
                    >
                      {lastIngestionTime}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Settings Section with Dropdown */}
            <div 
              ref={settingsBtnRef}
              className="relative shrink-0"
            >
              <div className={`inline-flex items-stretch rounded-lg transition-all border ${
                activeTab === 'settings'
                  ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border-transparent'
              }`}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('settings');
                    setIsSettingsOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 xl:px-3 xl:py-2 text-xs xl:text-sm font-medium transition-colors rounded-l-lg cursor-pointer"
                  title="System Configuration & TRIRIGA Settings"
                >
                  <SettingsIcon className={`w-3.5 h-3.5 xl:w-4 xl:h-4 ${activeTab === 'settings' ? 'text-cyan-400' : ''}`} />
                  <span>Settings</span>
                  {serverCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                      {serverCount}
                    </span>
                  )}
                </button>
                <div className={`w-px my-1 ${activeTab === 'settings' ? 'bg-slate-700 dark:bg-slate-700' : 'bg-slate-700/40'}`} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSettingsOpen(prev => {
                      if (!prev) setIsServersOpen(false);
                      return !prev;
                    });
                  }}
                  className="px-1.5 flex items-center justify-center rounded-r-lg hover:bg-slate-700/40 transition-colors cursor-pointer"
                  title="Settings Navigation Menu"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isSettingsOpen ? 'rotate-180 text-cyan-400' : ''}`} />
                </button>
              </div>

              {/* Settings Dropdown Menu - Portaled outside nav to prevent overflow clipping */}
              {isSettingsOpen && settingsMenuPos && createPortal(
                <div 
                  ref={settingsDropdownRef}
                  style={{ top: `${settingsMenuPos.top}px`, right: `${settingsMenuPos.right}px` }}
                  className="settings-dropdown fixed w-80 rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/60 py-1.5 z-50 animate-fade-in backdrop-blur-xl"
                >
                  <div className="px-3.5 py-2 flex items-center justify-between border-b border-slate-800">
                    <span className="settings-dropdown-header text-[11px] font-bold uppercase tracking-widest text-slate-400">Settings &amp; Utilities</span>
                    <span className="settings-dropdown-hub text-[9px] font-semibold uppercase tracking-wider text-cyan-400 font-mono">Control Center</span>
                  </div>

                  {/* Performance Monitor */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowPerfModal(true);
                      setIsSettingsOpen(false);
                    }}
                    className="settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:bg-slate-800"
                    title="Inspect Real-Time Performance & Bottlenecks"
                  >
                    <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="settings-dropdown-title text-xs font-semibold leading-tight text-white">Performance Monitor</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Real-time latency &amp; API bottlenecks</div>
                    </div>
                    <span className="settings-dropdown-badge px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                      Perf
                    </span>
                  </button>

                  {/* Timezone Mode Switcher */}
                  <button
                    type="button"
                    onClick={() => {
                      toggleTimeMode();
                    }}
                    className="settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:bg-slate-800"
                    title={`Active Time Display: ${timeMode === 'server' ? 'Server Time (UTC origin)' : `Local Time (${localTzInfo.fullTz})`}\nClick to toggle globally.`}
                  >
                    {timeMode === 'server' ? (
                      <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="settings-dropdown-title text-xs font-semibold leading-tight text-white">Time Display Mode</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">
                        {timeMode === 'server' ? 'Server Time (UTC origin)' : `Local Time (${localTzInfo.shortTz})`}
                      </div>
                    </div>
                    <span className={`settings-dropdown-badge px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 border ${
                      timeMode === 'server'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    }`}>
                      {timeMode === 'server' ? 'UTC' : localTzInfo.shortTz}
                    </span>
                  </button>

                  {/* Sync (Renamed from Auto-Sync:) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenLogSync) {
                        onOpenLogSync();
                      } else {
                        setActiveTab('explorer', undefined, true);
                      }
                      setIsSettingsOpen(false);
                    }}
                    className="settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:bg-slate-800"
                    title={
                      ingestionSchedule?.is_enabled
                        ? `Sync active every ${ingestionSchedule.interval_minutes} minutes${
                            ingestionSchedule.last_run_at ? ` (Last: ${formatDisplayTime(ingestionSchedule.last_run_at).full})` : ''
                          }. Click to open Sync in Logs.`
                        : 'Sync paused. Click to open Sync in Logs.'
                    }
                  >
                    <Clock className={`w-4 h-4 shrink-0 ${ingestionSchedule?.is_running ? 'text-cyan-400 animate-spin' : ingestionSchedule?.is_enabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="settings-dropdown-title text-xs font-semibold leading-tight text-white">
                        Sync: {ingestionSchedule?.is_running
                          ? 'Harvesting...'
                          : ingestionSchedule?.is_enabled
                            ? `${ingestionSchedule.interval_minutes}m`
                            : 'Paused'}
                      </div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">
                        {ingestionSchedule?.last_run_at ? `Last harvest: ${formatDisplayTime(ingestionSchedule.last_run_at).full}` : 'Automated log ingestion cadence'}
                      </div>
                    </div>
                    <span className={`settings-dropdown-badge px-2 py-0.5 rounded text-[10px] font-mono font-medium shrink-0 border ${
                      ingestionSchedule?.is_running
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : ingestionSchedule?.is_enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {ingestionSchedule?.is_running ? 'Active' : ingestionSchedule?.is_enabled ? `${ingestionSchedule.interval_minutes}m` : 'Paused'}
                    </span>
                  </button>

                  <div className="border-t border-slate-800 my-1"></div>

                  {/* TRIRIGA Servers */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectSettingsSection) {
                        onSelectSettingsSection('servers');
                      } else {
                        setActiveTab('settings', 'servers');
                      }
                      setIsSettingsOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'settings' && activeSettingsSection === 'servers'
                        ? 'settings-dropdown-item-active bg-cyan-500/10'
                        : 'hover:bg-slate-800'
                    }`}
                  >
                    <Server className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'settings' && activeSettingsSection === 'servers' ? 'text-cyan-300' : 'text-white'
                      }`}>TRIRIGA Servers</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Node profiles, credentials &amp; sync</div>
                    </div>
                    <span className="settings-dropdown-badge px-1.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-800 text-cyan-300 border border-slate-700 shrink-0">
                      {serverCount}
                    </span>
                  </button>

                  {/* Local LLM Setup */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectSettingsSection) {
                        onSelectSettingsSection('llm');
                      } else {
                        setActiveTab('settings', 'llm');
                      }
                      setIsSettingsOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'settings' && activeSettingsSection === 'llm'
                        ? 'settings-dropdown-item-active bg-cyan-500/10'
                        : 'hover:bg-slate-800'
                    }`}
                  >
                    <BrainCircuit className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'settings' && activeSettingsSection === 'llm' ? 'text-cyan-300' : 'text-white'
                      }`}>Local LLM Setup</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Ollama, LM Studio &amp; models</div>
                    </div>
                  </button>

                  {/* Console Security */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectSettingsSection) {
                        onSelectSettingsSection('security');
                      } else {
                        setActiveTab('settings', 'security');
                      }
                      setIsSettingsOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'settings' && activeSettingsSection === 'security'
                        ? 'settings-dropdown-item-active bg-cyan-500/10'
                        : 'hover:bg-slate-800'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'settings' && activeSettingsSection === 'security' ? 'text-cyan-300' : 'text-white'
                      }`}>Master access password</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Console security &amp; authentication</div>
                    </div>
                  </button>

                  {/* Database Storage */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectSettingsSection) {
                        onSelectSettingsSection('storage');
                      } else {
                        setActiveTab('settings', 'storage');
                      }
                      setIsSettingsOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      activeTab === 'settings' && activeSettingsSection === 'storage'
                        ? 'settings-dropdown-item-active bg-cyan-500/10'
                        : 'hover:bg-slate-800'
                    }`}
                  >
                    <Database className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`settings-dropdown-title text-xs font-semibold leading-tight ${
                        activeTab === 'settings' && activeSettingsSection === 'storage' ? 'text-cyan-300' : 'text-white'
                      }`}>SQLite FTS5 maintenance</div>
                      <div className="settings-dropdown-subtitle text-[10px] text-slate-400 leading-snug mt-0.5">Database storage &amp; purge tools</div>
                    </div>
                  </button>

                  <div className="border-t border-slate-800 my-1"></div>

                  {/* View All Settings */}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectSettingsSection) {
                        onSelectSettingsSection('all');
                      } else {
                        setActiveTab('settings', 'all');
                      }
                      setIsSettingsOpen(false);
                    }}
                    className={`settings-dropdown-item w-full flex items-center gap-3 px-3.5 py-2 text-left transition-colors cursor-pointer ${
                      activeTab === 'settings' && activeSettingsSection === 'all'
                        ? 'settings-dropdown-item-active bg-cyan-500/10 text-cyan-300'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                    <span className="settings-dropdown-title text-xs font-medium">View All Settings</span>
                  </button>
                </div>,
                document.body
              )}
            </div>
          </nav>

          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollNav('right')}
              className="absolute right-0 z-20 h-8 w-6 flex items-center justify-center bg-slate-900/95 hover:bg-slate-800 text-cyan-400 hover:text-white border-y border-l border-slate-700 rounded-l shadow-lg transition-all cursor-pointer"
              title="Scroll navigation right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

          {/* Quick Actions Toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Mobile Navigation Menu Toggle (< md) */}
            <button
              onClick={() => setIsMobileNavOpen(prev => !prev)}
              className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer flex md:hidden items-center justify-center"
              title="Toggle Navigation Menu"
              aria-label="Navigation Menu"
            >
              {isMobileNavOpen ? <X className="w-4 h-4 text-cyan-400" /> : <Menu className="w-4 h-4" />}
            </button>

            {/* Day / Night Switcher */}
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer flex items-center justify-center"
              title={theme === 'dark' ? 'Switch to Day / Light Mode' : 'Switch to Night / Dark Mode'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-400 hover:-rotate-12 transition-transform" />
              )}
            </button>

            {/* Lock Console / Logout */}
            {onLock && (
              <button
                onClick={onLock}
                className="p-2 rounded-xl text-slate-300 hover:text-rose-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer flex items-center justify-center"
                title="Lock Console (Logout)"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}

            {/* Persistent AI Chat Toggle - Standard AI Sparkles icon, no text */}
            <button
              onClick={onToggleChat}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center relative ${
                isChatOpen
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/10 header-chat-btn-active'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:border-slate-600 header-chat-btn-inactive'
              }`}
              title={isChatOpen ? "Collapse AI Assistant Sidebar" : "Open AI Assistant Sidebar"}
            >
              <Sparkles className={`w-4 h-4 ${isChatStreaming ? 'text-cyan-400 animate-spin' : isChatOpen ? 'text-cyan-400' : 'text-slate-400'}`} />
              {isChatStreaming && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Slide-Over Navigation Drawer (< md) */}
      {isMobileNavOpen && createPortal(
        <div className="fixed inset-0 z-50 md:hidden flex animate-fade-in">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity cursor-pointer"
            onClick={() => setIsMobileNavOpen(false)}
          />

          {/* Drawer Panel */}
          <div 
            className="relative w-72 sm:w-80 max-w-[85vw] h-full bg-slate-900 border-r border-slate-800 shadow-2xl flex flex-col z-10 animate-slide-right overflow-y-auto select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-md">
                  <Database className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-white tracking-tight">Tririga Console</h2>
                  <p className="text-[10px] text-slate-400 font-mono">Cluster Navigation</p>
                </div>
              </div>
              <button
                onClick={() => setIsMobileNavOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close Menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Nav Items List */}
            <div className="p-3 space-y-1 flex-1 overflow-y-auto">
              {/* Dashboard */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('dashboard');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Activity className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-cyan-400' : 'text-blue-400'}`} />
                <span>Dashboard</span>
              </button>

              {/* Servers & Cluster Submenu */}
              <div className="rounded-xl overflow-hidden border border-slate-800/80 bg-slate-950/40">
                <button
                  type="button"
                  onClick={() => setMobileServersExpanded(prev => !prev)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    isServerTabActive ? 'text-cyan-300' : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Server className={`w-4 h-4 ${isServerTabActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span>Servers &amp; Diagnostics</span>
                    {isServersLive && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    )}
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mobileServersExpanded ? 'rotate-180 text-cyan-400' : 'text-slate-500'}`} />
                </button>

                {mobileServersExpanded && (
                  <div className="p-1 space-y-0.5 border-t border-slate-800/60 bg-slate-900/60 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('server_config');
                        setIsMobileNavOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 cursor-pointer ${
                        activeTab === 'server_config' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Node Configuration &amp; Drift</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('operations');
                        setIsMobileNavOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 cursor-pointer ${
                        activeTab === 'operations' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Server Health &amp; Scorecard</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('agent_activity');
                        setIsMobileNavOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 cursor-pointer ${
                        activeTab === 'agent_activity' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Agent Activity</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('thread_activity');
                        setIsMobileNavOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 cursor-pointer ${
                        activeTab === 'thread_activity' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                      <span>JVM Thread Monitor</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Logs */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('explorer');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'explorer'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Search className={`w-4 h-4 ${activeTab === 'explorer' ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>Logs Timeline</span>
                </div>
                {totalLogs > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {(totalLogs / 1000).toFixed(1)}k
                  </span>
                )}
              </button>

              {/* WorkTasks & Contention */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('worktasks');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'worktasks'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Wrench className={`w-4 h-4 ${activeTab === 'worktasks' ? 'text-amber-400' : 'text-amber-400'}`} />
                <span>WorkTasks &amp; Contention</span>
              </button>

              {/* User Activity */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('user_activity');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'user_activity'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Users className={`w-4 h-4 ${activeTab === 'user_activity' ? 'text-cyan-400' : 'text-emerald-400'}`} />
                <span>User Activity &amp; Licences</span>
              </button>

              {/* DB Queries */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('dbquery');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'dbquery'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Database className={`w-4 h-4 ${activeTab === 'dbquery' ? 'text-cyan-400' : 'text-indigo-400'}`} />
                <span>DB Queries</span>
              </button>

              {/* AI Analysis */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('analysis');
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'analysis'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <BrainCircuit className={`w-4 h-4 ${activeTab === 'analysis' ? 'text-cyan-400' : 'text-purple-400'}`} />
                <span>AI Log Analysis</span>
              </button>

              {/* Settings Submenu */}
              <div className="rounded-xl overflow-hidden border border-slate-800/80 bg-slate-950/40">
                <button
                  type="button"
                  onClick={() => setMobileSettingsExpanded(prev => !prev)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'settings' ? 'text-cyan-300' : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <SettingsIcon className={`w-4 h-4 ${activeTab === 'settings' ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span>Settings &amp; Config</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mobileSettingsExpanded ? 'rotate-180 text-cyan-400' : 'text-slate-500'}`} />
                </button>

                {mobileSettingsExpanded && (
                  <div className="p-1 space-y-0.5 border-t border-slate-800/60 bg-slate-900/60 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setShowPerfModal(true);
                        setIsMobileNavOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Performance Monitor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        toggleTimeMode();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        {timeMode === 'server' ? <Globe className="w-3.5 h-3.5 text-cyan-400" /> : <Clock className="w-3.5 h-3.5 text-indigo-400" />}
                        <span>Time Display</span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-cyan-300 border border-slate-700">
                        {timeMode === 'server' ? 'UTC' : localTzInfo.shortTz}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectSettingsSection) onSelectSettingsSection('servers');
                        else setActiveTab('settings', 'servers');
                        setIsMobileNavOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                    >
                      <Server className="w-3.5 h-3.5 text-cyan-400" />
                      <span>TRIRIGA Server Profiles</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectSettingsSection) onSelectSettingsSection('llm');
                        else setActiveTab('settings', 'llm');
                        setIsMobileNavOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                    >
                      <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Local LLM Setup</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectSettingsSection) onSelectSettingsSection('security');
                        else setActiveTab('settings', 'security');
                        setIsMobileNavOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Master Access Password</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectSettingsSection) onSelectSettingsSection('all');
                        else setActiveTab('settings', 'all');
                        setIsMobileNavOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 flex items-center gap-2 font-medium cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>All System Settings</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/80 text-[11px] text-slate-500 text-center">
              TRIRIGA Multi-Node Console
            </div>
          </div>
        </div>,
        document.body
      )}

      <PerfModal isOpen={showPerfModal} onClose={() => setShowPerfModal(false)} />
    </header>
  );
};

