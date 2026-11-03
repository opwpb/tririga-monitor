import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { LogExplorer, type LogExplorerFilter } from './components/LogExplorer';
import { LockScreen } from './components/LockScreen';
import { TabLoadingSkeleton } from './components/common/TabLoadingSkeleton';
import { TririgaServer, DashboardMetrics, IngestionSchedule, ChatMessage } from './types';
import { api, setAuthToken } from './services/api';
import { streamChatQuery } from './utils/chatStream';

// Code-split heavy views to reduce initial bundle size and load on demand
const LLMAnalysis = React.lazy(() => import('./components/LLMAnalysis').then(m => ({ default: m.LLMAnalysis })));
const DBQueryTool = React.lazy(() => import('./components/DBQueryTool').then(m => ({ default: m.DBQueryTool })));
const AgentThreadMonitor = React.lazy(() => import('./components/AgentThreadMonitor').then(m => ({ default: m.AgentThreadMonitor })));
const OperationsHub = React.lazy(() => import('./components/OperationsHub').then(m => ({ default: m.OperationsHub })));
const ServerConfigComparison = React.lazy(() => import('./components/ServerConfigComparison').then(m => ({ default: m.ServerConfigComparison })));
const WorkTaskQueryAnalyzer = React.lazy(() => import('./components/WorkTaskQueryAnalyzer').then(m => ({ default: m.WorkTaskQueryAnalyzer })));
const UserActivity = React.lazy(() => import('./components/UserActivity').then(m => ({ default: m.UserActivity })));
const Settings = React.lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const ChatSidebar = React.lazy(() => import('./components/ChatSidebar').then(m => ({ default: m.ChatSidebar })));

// Startup console announcement
if (typeof window !== 'undefined') {
  console.log(
    '%c TRIRIGA Admin Dashboard %c v1.0.0 %c Live telemetry & console logging active',
    'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px; border: 1px solid #38bdf8;',
    'background: #0284c7; color: #ffffff; font-weight: bold; padding: 4px 8px;',
    'color: #94a3b8; padding-left: 8px;'
  );
}

export function App() {
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [settingsSection, setSettingsSection] = useState<string>('servers');
  const [userActivitySubTab, setUserActivitySubTab] = useState<'logged_in' | 'entitlements' | 'charts' | 'sessions' | 'dormant' | 'directory'>('logged_in');
  const [isSyncExpanded, setIsSyncExpanded] = useState<boolean>(false);
  const [logExplorerFilter, setLogExplorerFilter] = useState<LogExplorerFilter | null>(null);
  const [selectedConfigServerId, setSelectedConfigServerId] = useState<number | undefined>(undefined);
  const [servers, setServers] = useState<TririgaServer[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [schedule, setSchedule] = useState<IngestionSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Live activities tracking for background tasks
  const [liveActivities, setLiveActivities] = useState<Record<string, boolean>>({
    agent_monitor: false,
    agent_activity: false,
    thread_activity: false,
    server_config: false,
    operations: false,
    user_activity: false,
    worktasks: false,
  });

  const handleLiveStatusChange = (tabId: string, isLive: boolean) => {
    setLiveActivities(prev => {
      if (prev[tabId] === isLive) return prev;
      return { ...prev, [tabId]: isLive };
    });
  };

  // Only mount the active tab initially; retain visited tabs across navigation so polling buffers persist once visited
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => {
    return new Set<string>(['dashboard']);
  });

  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });

    // Notify Recharts ResponsiveContainer instances to adjust dimensions when tab is revealed
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const handleNavigateTab = (tab: string, filter?: LogExplorerFilter, configServerId?: number, section?: string) => {
    if (filter !== undefined) {
      setLogExplorerFilter(filter);
    }
    if (configServerId !== undefined) {
      setSelectedConfigServerId(configServerId);
    }
    if (tab === 'servers') {
      setActiveTab('settings');
      setSettingsSection('servers');
      return;
    }
    if (tab === 'collector') {
      setActiveTab('explorer');
      setIsSyncExpanded(true);
      return;
    }
    if (tab === 'user_activity' && section) {
      setUserActivitySubTab(section as any);
    } else if (section !== undefined) {
      setSettingsSection(section);
    }
    setActiveTab(tab);
  };

  // Persistent Chat Sidebar State (Closed by default)
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: "Hello! I am your TRIRIGA Log Analysis Assistant. Ask me anything about errors, workflow deadlocks, OSLC queries, or memory exhaustion across the cluster."
    }
  ]);
  const [isChatStreaming, setIsChatStreaming] = useState<boolean>(false);
  const chatAbortRef = useRef<AbortController | null>(null);

  // Night / Day Mode Theme State (defaults to light mode)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const userSelected = localStorage.getItem('tririga_theme_user_set');
    if (userSelected) {
      return (localStorage.getItem('tririga_theme') as 'dark' | 'light') || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('theme-light');
      document.documentElement.classList.add('theme-light');
      document.documentElement.classList.remove('dark');
    } else {
      document.body.classList.remove('theme-light');
      document.documentElement.classList.remove('theme-light');
      document.documentElement.classList.add('dark');
    }
    localStorage.setItem('tririga_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    localStorage.setItem('tririga_theme_user_set', 'true');
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const checkAuth = async () => {
    try {
      const status = await api.getAuthStatus();
      if (!status.is_enabled || status.authenticated) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    document.title = isAuthenticated ? 'Tririga Monitoring & Log Analysis' : 'Console';
  }, [isAuthenticated]);

  useEffect(() => {
    checkAuth();
    const handleAuthReq = () => {
      setAuthToken(null);
      setIsAuthenticated(false);
    };
    window.addEventListener('tririga_auth_required', handleAuthReq);
    return () => window.removeEventListener('tririga_auth_required', handleAuthReq);
  }, []);

  const handleLock = async () => {
    try {
      await api.logout();
    } catch {}
    setAuthToken(null);
    setIsAuthenticated(false);
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      // 1. Fetch servers immediately so UI Server Node Filter, Server Profiles & target dropdowns populate instantly
      const serversPromise = api.getServers().then(serversData => {
        setServers(serversData);
        return serversData;
      }).catch(err => {
        console.error('Failed to load servers:', err);
        return [];
      });

      // 2. Fetch metrics and schedule concurrently without blocking server listing
      const metricsPromise = api.getMetrics().then(metricsData => {
        setMetrics(metricsData);
        return metricsData;
      }).catch(err => {
        console.error('Failed to load metrics:', err);
        return null;
      });

      const schedulePromise = api.getIngestionSchedule().then(sched => {
        if (sched) setSchedule(sched);
        return sched;
      }).catch(() => null);

      await Promise.all([serversPromise, metricsPromise, schedulePromise]);
    } catch (err) {
      console.error('Failed to load application data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refreshData();
      // Periodically refresh automated ingestion schedule so header status remains live
      const scheduleInterval = setInterval(() => {
        api.getIngestionSchedule()
          .then((s) => setSchedule(s))
          .catch(() => {});
      }, 10000);
      return () => clearInterval(scheduleInterval);
    }
  }, [isAuthenticated]);

  const handleSyncAll = async () => {
    setLoading(true);
    try {
      await api.syncAllServers();
      await refreshData();
    } catch (err) {
      console.error('Failed to sync all servers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncServer = async (serverId: number) => {
    setLoading(true);
    setSyncError(null);
    try {
      await api.syncServer(serverId);
      await refreshData();
    } catch (err: any) {
      console.error('Failed to sync server:', err);
      setSyncError(err.message || 'Failed to sync server. Check credentials or connection.');
      await refreshData();
      setTimeout(() => setSyncError(null), 8000);
    } finally {
      setLoading(false);
    }
  };

  const handleSendToAI = (promptText: string) => {
    setIsChatOpen(true);
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setChatMessages(prev => [...prev, { role: 'user', text: promptText }, { role: 'assistant', text: '' }]);
    setIsChatStreaming(true);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    (async () => {
      try {
        const cfg = await api.getActiveLLMConfig();
        await streamChatQuery({
          query: promptText,
          provider: cfg.provider || 'lm_studio',
          baseUrl: cfg.base_url || 'http://localhost:1234/v1',
          modelName: cfg.model_name || 'local-model',
          contextWindow: cfg.context_window || 32768,
          signal: controller.signal,
          onThought: (thoughtChunk) => {
            setChatMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = {
                ...updated[lastIdx],
                thought: (updated[lastIdx].thought || '') + thoughtChunk,
              };
              return updated;
            });
          },
          onChunk: (textChunk) => {
            setChatMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = {
                ...updated[lastIdx],
                text: updated[lastIdx].text + textChunk,
              };
              return updated;
            });
          },
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setChatMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            updated[lastIdx] = {
              ...updated[lastIdx],
              text: (updated[lastIdx].text ? updated[lastIdx].text + '\n\n' : '') + `**Diagnostic Notice:** ${err.message}`,
            };
            return updated;
          });
        }
      } finally {
        setIsChatStreaming(false);
        chatAbortRef.current = null;
      }
    })();
  };

  // Responsive breakpoint tracking: < 1024px is mobile / tablet
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDesktop = windowWidth >= 1024;

  // Draggable sidebar width state: min 380px wide, up to 45% viewport (capped at 800px)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const minW = 380;
    const maxW = Math.min(800, Math.max(450, window.innerWidth * 0.45));
    try {
      const saved = localStorage.getItem('tririga_chat_sidebar_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minW && parsed <= maxW) return parsed;
      }
    } catch {}
    const defaultW = Math.round(window.innerWidth * 0.28);
    return Math.max(minW, Math.min(defaultW, maxW));
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !isDesktop) return;
      const minW = 380;
      const maxW = Math.min(800, Math.max(450, window.innerWidth * 0.45));
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(minW, Math.min(newWidth, maxW));
      setSidebarWidth(clamped);
      try {
        localStorage.setItem('tririga_chat_sidebar_width', String(clamped));
      } catch {}
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing && isDesktop) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isDesktop]);

  if (!authChecked) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 select-none">
        <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center shadow-md">
          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <span className="text-xs font-mono text-slate-400 tracking-wider">Initialising...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LockScreen
        onUnlock={() => {
          setIsAuthenticated(true);
          refreshData();
        }}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', maxHeight: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} className="bg-slate-950 text-slate-100 select-text transition-colors duration-200">
      <Header
        activeTab={activeTab}
        setActiveTab={(tab, section, expandSync) => {
          if (tab === 'servers') {
            setActiveTab('settings');
            setSettingsSection('servers');
          } else if (tab === 'collector') {
            setActiveTab('explorer');
            setIsSyncExpanded(true);
          } else {
            setActiveTab(tab);
            if (section) setSettingsSection(section);
            if (expandSync !== undefined) setIsSyncExpanded(expandSync);
          }
        }}
        serverCount={servers.length}
        totalLogs={metrics?.summary?.total_entries ?? 0}
        errorCount={metrics?.summary?.total_errors ?? 0}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen(prev => !prev)}
        isChatStreaming={isChatStreaming}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        liveTabs={liveActivities}
        onLock={handleLock}
        activeSettingsSection={settingsSection}
        onSelectSettingsSection={(sec) => {
          setActiveTab('settings');
          setSettingsSection(sec);
        }}
        onOpenLogSync={() => {
          setActiveTab('explorer');
          setIsSyncExpanded(true);
        }}
        ingestionSchedule={schedule}
      />

      <div style={{ flex: '1 1 0%', minHeight: 0, height: 'calc(100vh - 64px)', maxHeight: 'calc(100vh - 64px)', overflow: 'hidden', display: 'flex', flexDirection: 'row', position: 'relative', width: '100%' }}>
        {/* Main Content Area - Scrollable View */}
        <main className="flex-1 h-full overflow-y-auto px-2.5 sm:px-5 lg:px-8 py-3.5 sm:py-6 space-y-4 min-h-0">
          {syncError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between shadow-lg animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400">Sync Error</span>
                <span>{syncError}</span>
              </div>
              <button onClick={() => setSyncError(null)} className="text-slate-400 hover:text-white text-sm ml-4">✕</button>
            </div>
          )}

          {visitedTabs.has('dashboard') && (
            <div hidden={activeTab !== 'dashboard'} style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
              <Dashboard
                metrics={metrics}
                servers={servers}
                onNavigateTab={handleNavigateTab}
                onSyncAll={handleSyncAll}
                loading={loading}
              />
            </div>
          )}

          {visitedTabs.has('server_config') && (
            <div hidden={activeTab !== 'server_config'} style={{ display: activeTab === 'server_config' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <ServerConfigComparison
                  servers={servers}
                  onSendToAI={handleSendToAI}
                  initialServerId={selectedConfigServerId}
                  onLiveStatusChange={(isLive) => handleLiveStatusChange('server_config', isLive)}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('explorer') && (
            <div hidden={activeTab !== 'explorer'} style={{ display: activeTab === 'explorer' ? 'block' : 'none' }}>
              <LogExplorer
                servers={servers}
                onSendToAI={handleSendToAI}
                initialFilter={logExplorerFilter}
                onRefreshData={refreshData}
                onNavigateTab={handleNavigateTab}
                syncExpanded={isSyncExpanded}
                onToggleSyncExpanded={setIsSyncExpanded}
              />
            </div>
          )}

          {(visitedTabs.has('agent_activity') || visitedTabs.has('thread_activity') || visitedTabs.has('agent_monitor')) && (
            <div 
              hidden={activeTab !== 'agent_activity' && activeTab !== 'thread_activity' && activeTab !== 'agent_monitor'} 
              style={{ display: (activeTab === 'agent_activity' || activeTab === 'thread_activity' || activeTab === 'agent_monitor') ? 'block' : 'none' }}
            >
              <Suspense fallback={<TabLoadingSkeleton />}>
                <AgentThreadMonitor
                  servers={servers}
                  onSendToAI={handleSendToAI}
                  activeView={activeTab === 'thread_activity' ? 'thread' : activeTab === 'agent_activity' ? 'agent' : 'all'}
                  onViewChange={(newView) => {
                    if (newView === 'agent') setActiveTab('agent_activity');
                    else if (newView === 'thread') setActiveTab('thread_activity');
                    else setActiveTab('agent_monitor');
                  }}
                  onLiveStatusChange={(isLive) => {
                    handleLiveStatusChange('agent_activity', isLive);
                    handleLiveStatusChange('thread_activity', isLive);
                    handleLiveStatusChange('agent_monitor', isLive);
                  }}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('operations') && (
            <div hidden={activeTab !== 'operations'} style={{ display: activeTab === 'operations' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <OperationsHub 
                  servers={servers} 
                  onSendToAI={handleSendToAI} 
                  onNavigateTab={handleNavigateTab}
                  onLiveStatusChange={(isLive) => handleLiveStatusChange('operations', isLive)}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('worktasks') && (
            <div hidden={activeTab !== 'worktasks'} style={{ display: activeTab === 'worktasks' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <WorkTaskQueryAnalyzer
                  servers={servers}
                  onSendToAI={handleSendToAI}
                  onLiveStatusChange={(isLive) => handleLiveStatusChange('worktasks', isLive)}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('user_activity') && (
            <div hidden={activeTab !== 'user_activity'} style={{ display: activeTab === 'user_activity' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <UserActivity
                  servers={servers}
                  onSendToAI={handleSendToAI}
                  onLiveStatusChange={(isLive) => handleLiveStatusChange('user_activity', isLive)}
                  activeSubTab={userActivitySubTab}
                  onSubTabChange={setUserActivitySubTab}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('dbquery') && (
            <div hidden={activeTab !== 'dbquery'} style={{ display: activeTab === 'dbquery' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <DBQueryTool servers={servers} onSendToAI={handleSendToAI} />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('analysis') && (
            <div hidden={activeTab !== 'analysis'} style={{ display: activeTab === 'analysis' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <LLMAnalysis
                  servers={servers}
                  chatMessages={chatMessages}
                  setChatMessages={setChatMessages}
                  isChatStreaming={isChatStreaming}
                  setIsChatStreaming={setIsChatStreaming}
                  chatAbortRef={chatAbortRef}
                />
              </Suspense>
            </div>
          )}

          {visitedTabs.has('settings') && (
            <div hidden={activeTab !== 'settings'} style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
              <Suspense fallback={<TabLoadingSkeleton />}>
                <Settings 
                  servers={servers}
                  onRefreshAll={refreshData} 
                  onSyncServer={handleSyncServer}
                  onNavigateTab={handleNavigateTab}
                  activeSection={settingsSection}
                  onSectionChange={setSettingsSection}
                />
              </Suspense>
            </div>
          )}

          <footer className="border-t border-slate-900/60 pt-6 pb-2 text-center text-xs text-slate-600">
            <p>IBM TRIRIGA Log Amalgamator & Local LLM Diagnostics SPA • SQLite FTS5 Engine</p>
          </footer>
        </main>

        {/* Mobile & Tablet Slide-Over Chat Modal Sheet (< 1024px) */}
        {isChatOpen && !isDesktop && (
          <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity cursor-pointer"
              onClick={() => setIsChatOpen(false)}
            />
            {/* Slide-over sheet */}
            <div 
              className="relative w-full sm:w-[440px] max-w-full h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col z-10 animate-slide-left overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <Suspense fallback={
                <div className="h-full flex items-center justify-center p-8 text-center text-slate-500 text-xs animate-pulse">
                  Loading AI Assistant...
                </div>
              }>
                <ChatSidebar
                  isOpen={isChatOpen}
                  onClose={() => setIsChatOpen(false)}
                  chatMessages={chatMessages}
                  setChatMessages={setChatMessages}
                  isChatStreaming={isChatStreaming}
                  setIsChatStreaming={setIsChatStreaming}
                  chatAbortRef={chatAbortRef}
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* Desktop Docked Persistent Sidebar (>= 1024px) */}
        {isChatOpen && isDesktop && (
          <aside
            style={{ width: `${sidebarWidth}px`, minWidth: '380px', maxWidth: `${Math.min(800, Math.max(450, windowWidth * 0.45))}px`, height: '100%', maxHeight: '100%', minHeight: 0, position: 'relative', overflow: 'hidden' }}
            className="shrink-0 z-20 shadow-2xl border-l border-slate-800 bg-slate-900"
          >
            {/* Draggable Width Handle on left edge of sidebar */}
            <div
              onMouseDown={() => setIsResizing(true)}
              className={`absolute top-0 left-0 w-2.5 h-full cursor-col-resize hover:bg-cyan-500/80 transition-colors z-30 flex items-center justify-center group ${isResizing ? 'bg-cyan-500 shadow-lg shadow-cyan-500/50' : 'bg-slate-800/40 hover:bg-cyan-500/30'}`}
              title="Drag to adjust chat width (Min 380px, Up to 45% viewport)"
            >
              <div className={`w-0.5 h-8 rounded-full ${isResizing ? 'bg-white' : 'bg-slate-500 group-hover:bg-cyan-200'}`} />
            </div>

            <Suspense fallback={
              <div className="h-full flex items-center justify-center p-8 text-center text-slate-500 text-xs animate-pulse">
                Loading AI Assistant...
              </div>
            }>
              <ChatSidebar
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                chatMessages={chatMessages}
                setChatMessages={setChatMessages}
                isChatStreaming={isChatStreaming}
                setIsChatStreaming={setIsChatStreaming}
                chatAbortRef={chatAbortRef}
              />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;

