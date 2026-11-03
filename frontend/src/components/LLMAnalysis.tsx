import React, { useState, useEffect, useRef } from 'react';
import { 
  BrainCircuit, 
  Play, 
  MessageSquare, 
  Download, 
  Copy, 
  Check, 
  History, 
  Send, 
  Trash2, 
  RefreshCw, 
  Sparkles, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  Bookmark, 
  Square,
  ChevronDown,
  ChevronUp,
  Activity,
  Calendar,
  Clock,
  FileDown
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, getAuthToken, BASE_URL } from '../services/api';
import { TririgaServer, LLMConfig, AnalysisReport, ChatMessage } from '../types';
import { useTimeContext } from '../context/TimeContext';
import { isProdServer } from '../utils/serverUtils';
import { streamChatQuery } from '../utils/chatStream';
import { 
  exportChatMarkdown, 
  exportChatDocx, 
  exportSingleMessageMarkdown, 
  exportSingleMessageDocx 
} from '../utils/chatExport';

interface LLMAnalysisProps {
  servers: TririgaServer[];
  chatMessages?: ChatMessage[];
  setChatMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isChatStreaming?: boolean;
  setIsChatStreaming?: React.Dispatch<React.SetStateAction<boolean>>;
  chatAbortRef?: React.MutableRefObject<AbortController | null>;
}

export const LLMAnalysis: React.FC<LLMAnalysisProps> = ({ 
  servers,
  chatMessages: propChatMessages,
  setChatMessages: propSetChatMessages,
  isChatStreaming: propIsChatStreaming,
  setIsChatStreaming: propSetIsChatStreaming,
  chatAbortRef: propChatAbortRef,
}) => {
  const { getDateRangeForPreset } = useTimeContext();
  const [activeTab, setActiveTab] = useState<'report' | 'chat' | 'history'>('report');
  
  // LLM Config state
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('llama3');
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Streaming Forensic Report state
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportContent, setReportContent] = useState<string>('');
  const [liveThought, setLiveThought] = useState<string>('');
  const [showThought, setShowThought] = useState<boolean>(true);
  const [statusText, setStatusText] = useState<string>('');
  const [reportCopied, setReportCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);
  const liveThoughtScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll live thinking box when new reasoning tokens stream in
  useEffect(() => {
    if (liveThoughtScrollRef.current) {
      liveThoughtScrollRef.current.scrollTop = liveThoughtScrollRef.current.scrollHeight;
    }
  }, [liveThought, showThought]);

  // Unified Chat state (props or local fallback)
  const [localChatMessages, localSetChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: "Hello! I am your TRIRIGA Log Analysis AI Assistant. You can ask me any questions about errors, workflow timeouts, deadlocks, or connection pool issues found in the amalgamated logs."
    }
  ]);
  const [localIsChatStreaming, localSetIsChatStreaming] = useState(false);
  const localChatAbortRef = useRef<AbortController | null>(null);

  const chatMessages = propChatMessages ?? localChatMessages;
  const setChatMessages = propSetChatMessages ?? localSetChatMessages;
  const isChatStreaming = propIsChatStreaming ?? localIsChatStreaming;
  const setIsChatStreaming = propSetIsChatStreaming ?? localSetIsChatStreaming;
  const chatAbortRef = propChatAbortRef ?? localChatAbortRef;

  const [chatQuery, setChatQuery] = useState('');
  const [chatStatusText, setChatStatusText] = useState<string>('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatThoughtScrollRef = useRef<HTMLDivElement | null>(null);
  const [isExportingChatDocx, setIsExportingChatDocx] = useState(false);
  const [exportingSingleDocxIdx, setExportingSingleDocxIdx] = useState<number | null>(null);
  const [copiedChatIdx, setCopiedChatIdx] = useState<number | null>(null);

  useEffect(() => {
    if (activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    if (chatThoughtScrollRef.current) {
      chatThoughtScrollRef.current.scrollTop = chatThoughtScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatStreaming, activeTab]);

  // Saved Reports History
  const [savedReports, setSavedReports] = useState<AnalysisReport[]>([]);
  const [selectedHistoryReport, setSelectedHistoryReport] = useState<AnalysisReport | null>(null);
  
  // Server Scope state
  const [analysisServerId, setAnalysisServerId] = useState<number | 'all' | 'prod'>('all');

  // Date Filter state (matches LogExplorer & Dashboard)
  const [selectedDatePreset, setSelectedDatePreset] = useState<string>('TODAY');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const getPresetLabel = (preset: string) => {
    switch (preset) {
      case 'ALL': return 'All Time Available';
      case '30M': return 'Last 30 Minutes';
      case '1H': return 'Last 1 Hour';
      case '6H': return 'Last 6 Hours';
      case '24H': return 'Last 24 Hours';
      case 'TODAY': return 'Today (00:00 - 23:59)';
      case '7D': return 'Last 7 Days';
      case '30D': return 'Last 30 Days';
      case 'CUSTOM': return startDate && endDate ? `${startDate} to ${endDate}` : 'Custom Date Range';
      default: return preset;
    }
  };

  const getScopeLabel = () => {
    if (analysisServerId === 'all') return `All Nodes (${servers.length})`;
    if (analysisServerId === 'prod') return 'Production Cluster (prod app1 & prod app2)';
    const found = servers.find(s => s.id === analysisServerId);
    return found ? found.name : 'All System Logs';
  };

  const loadLLMConfig = async () => {
    try {
      const cfg = await api.getActiveLLMConfig();
      setLlmConfig(cfg);
      setSelectedModel(cfg.model_name || 'llama3');
      
      // Auto-discover models
      const disc = await api.discoverModels(cfg.provider, cfg.base_url);
      if (disc.models && disc.models.length > 0) {
        setAvailableModels(disc.models.map(m => m.id));
      }
    } catch {
      // Default fallback
      setLlmConfig({
        id: 1,
        provider: 'ollama',
        base_url: 'http://localhost:11434',
        model_name: 'llama3',
        temperature: 0.2,
        context_window: 32768,
        is_active: 1,
      });
    }
  };

  const loadReports = async () => {
    try {
      const reps = await api.getReports();
      setSavedReports(reps);
    } catch (err) {
      console.error('Failed to load reports:', err);
    }
  };

  useEffect(() => {
    loadLLMConfig();
    loadReports();
  }, []);

  const handleTestLLM = async () => {
    if (!llmConfig) return;
    setTestingLLM(true);
    setLlmStatus(null);
    try {
      const res = await api.testLLM({
        provider: llmConfig.provider,
        base_url: llmConfig.base_url,
        model_name: selectedModel,
      });
      setLlmStatus(res);
    } catch (err: any) {
      setLlmStatus({ success: false, message: err.message || 'LLM ping failed' });
    } finally {
      setTestingLLM(false);
    }
  };

  const handleStopReport = () => {
    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
      reportAbortRef.current = null;
    }
    setIsGenerating(false);
  };

  const handleStopChat = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsChatStreaming(false);
    setChatStatusText('');
  };

  const handleClearChat = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsChatStreaming(false);
    setChatStatusText('');
    setChatMessages([
      {
        role: 'assistant',
        text: "Hello! I am your TRIRIGA Log Analysis Assistant. Ask me anything about errors, workflow deadlocks, OSLC queries, or memory exhaustion across the cluster."
      }
    ]);
  };

  const handleGenerateReport = async () => {
    if (isGenerating) {
      handleStopReport();
    }
    setIsGenerating(true);
    setReportContent('');
    setLiveThought('');
    setStatusText('Connecting to local model in LM Studio / Ollama...');
    setSavedSuccess(false);

    const controller = new AbortController();
    reportAbortRef.current = controller;

    try {
      let serverIdsParam: number[] | undefined = undefined;
      if (analysisServerId === 'prod') {
        const prodServers = servers.filter(isProdServer);
        if (prodServers.length > 0) {
          serverIdsParam = prodServers.map(s => s.id);
        }
      } else if (typeof analysisServerId === 'number') {
        serverIdsParam = [analysisServerId];
      }

      const { start, end } = getDateRangeForPreset(selectedDatePreset, startDate, endDate);
      const token = getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Auth-Token'] = token;
      }

      const response = await fetch(`${BASE_URL}/analysis/stream-report`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: llmConfig?.provider || 'lm_studio',
          base_url: llmConfig?.base_url || 'http://localhost:1234/v1',
          model_name: selectedModel,
          temperature: llmConfig?.temperature || 0.2,
          server_ids: serverIdsParam,
          start_time: start,
          end_time: end,
          date_preset: selectedDatePreset,
          context_window: llmConfig?.context_window || 32768,
        }),
        signal: controller.signal,
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let isDone = false;
      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.replace(/^data:\s*/, '').trim();
            if (dataStr === '[DONE]') {
              setStatusText('');
              isDone = true;
              try { await reader.cancel(); } catch {}
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.status) {
                setStatusText(parsed.status);
              }
              if (parsed.thought) {
                setLiveThought(prev => prev + parsed.thought);
              }
              if (parsed.chunk) {
                setStatusText('');
                setReportContent(prev => prev + parsed.chunk);
              }
            } catch {
              // Raw text chunk fallback
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setReportContent(prev => prev + '\n\n*(Report generation stopped by user)*');
      } else {
        setReportContent(prev => prev + `\n\n**Error during inference:** ${err.message}`);
      }
    } finally {
      setIsGenerating(false);
      reportAbortRef.current = null;
      setStatusText('');
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;

    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }

    const userText = chatQuery;
    setChatQuery('');
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatStreaming(true);
    setChatStatusText('Consulting SQLite & streaming reasoning...');

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      setChatMessages(prev => [...prev, { role: 'assistant', text: '', thought: '' }]);

      let serverIdsParam: number[] | undefined = undefined;
      if (analysisServerId === 'prod') {
        const prodServers = servers.filter(isProdServer);
        if (prodServers.length > 0) {
          serverIdsParam = prodServers.map(s => s.id);
        }
      } else if (typeof analysisServerId === 'number') {
        serverIdsParam = [analysisServerId];
      }

      const { start, end } = getDateRangeForPreset(selectedDatePreset, startDate, endDate);

      await streamChatQuery({
        query: userText,
        provider: llmConfig?.provider || 'lm_studio',
        baseUrl: llmConfig?.base_url || 'http://localhost:1234/v1',
        modelName: selectedModel,
        serverIds: serverIdsParam,
        startTime: start,
        endTime: end,
        datePreset: selectedDatePreset,
        contextWindow: llmConfig?.context_window || 32768,
        signal: controller.signal,
        onStatus: (status) => setChatStatusText(status),
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
            text: updated[lastIdx].text + `\n\n*Error: ${err.message}*`,
          };
          return updated;
        });
      }
    } finally {
      setIsChatStreaming(false);
      chatAbortRef.current = null;
      setChatStatusText('');
    }
  };


  const handleExportChatMd = () => {
    exportChatMarkdown(chatMessages, {
      title: `TRIRIGA AI Chat – ${getScopeLabel()}`,
      scope: getScopeLabel(),
      model: selectedModel || llmConfig?.model_name,
      filename: `TRIRIGA_AI_Chat_${selectedDatePreset}_${Date.now()}`
    });
  };

  const handleExportChatDocx = async () => {
    setIsExportingChatDocx(true);
    try {
      await exportChatDocx(chatMessages, {
        title: `TRIRIGA AI Chat Consultation – ${getScopeLabel()}`,
        scope: getScopeLabel(),
        model: selectedModel || llmConfig?.model_name,
        filename: `TRIRIGA_AI_Chat_${selectedDatePreset}_${Date.now()}`
      });
    } catch (err: any) {
      console.error('Failed to export chat to Word:', err);
      alert(`Failed to export Word document: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExportingChatDocx(false);
    }
  };

  const handleExportSingleMessageMd = (msg: { role: 'user' | 'assistant'; text: string; thought?: string }, idx: number) => {
    const prompt = idx > 0 && chatMessages[idx - 1].role === 'user' ? chatMessages[idx - 1].text : undefined;
    exportSingleMessageMarkdown(msg, {
      prompt,
      title: 'TRIRIGA AI Assistant – Diagnostic Response',
      model: selectedModel || llmConfig?.model_name,
      filename: `TRIRIGA_AI_Response_${Date.now()}`
    });
  };

  const handleExportSingleMessageDocx = async (msg: { role: 'user' | 'assistant'; text: string; thought?: string }, idx: number) => {
    setExportingSingleDocxIdx(idx);
    try {
      const prompt = idx > 0 && chatMessages[idx - 1].role === 'user' ? chatMessages[idx - 1].text : undefined;
      await exportSingleMessageDocx(msg, {
        prompt,
        title: 'TRIRIGA AI Assistant – Diagnostic Response',
        model: selectedModel || llmConfig?.model_name,
        filename: `TRIRIGA_AI_Response_${Date.now()}`
      });
    } catch (err: any) {
      console.error('Failed to export response to Word:', err);
      alert(`Failed to export Word document: ${err.message || 'Unknown error'}`);
    } finally {
      setExportingSingleDocxIdx(null);
    }
  };

  const handleCopyChatMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedChatIdx(idx);
    setTimeout(() => setCopiedChatIdx(null), 2000);
  };

  const copyReport = () => {
    navigator.clipboard.writeText(reportContent);
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  };

  const [exportingDocx, setExportingDocx] = useState(false);

  const handleDownloadMarkdown = () => {
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tririga-log-audit-report-${new Date().toISOString().substring(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportDocx = async () => {
    if (!reportContent) return;
    setExportingDocx(true);
    try {
      const title = `TRIRIGA_Log_Audit_Report_${new Date().toISOString().substring(0, 10)}`;
      await api.exportDocx(title, reportContent);
    } catch (err) {
      console.error('Failed to export Word document:', err);
    } finally {
      setExportingDocx(false);
    }
  };

  const handleSaveCurrentReport = async () => {
    if (!reportContent) return;
    try {
      const serverIdsParam = analysisServerId === 'all' ? undefined : (analysisServerId === 'prod' ? servers.filter(s => ['prod app1', 'prod app2'].includes(s.name.toLowerCase())).map(s => s.id) : [analysisServerId]);
      await api.saveReport({
        title: `TRIRIGA Log Audit (${getPresetLabel(selectedDatePreset)} – ${new Date().toLocaleDateString()})`,
        model_used: selectedModel,
        provider: llmConfig?.provider || 'local',
        severity: reportContent.toUpperCase().includes('CRITICAL') ? 'critical' : (reportContent.toUpperCase().includes('HIGH') ? 'high' : 'medium'),
        summary: reportContent.substring(0, 300) + '...',
        raw_report: reportContent,
        server_ids: serverIdsParam ? JSON.stringify(serverIdsParam) : undefined,
      });
      setSavedSuccess(true);
      await loadReports();
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save report:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Model & Connection Bar */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">AI Analysis</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">
                  {llmConfig?.provider || 'LM Studio'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                  {selectedModel || llmConfig?.model_name || 'local-model'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {((llmConfig?.context_window || 32768) / 1024).toFixed(0)}k Context
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Connected to local endpoint: <code className="text-slate-300">{llmConfig?.base_url || 'http://127.0.0.1:1234/v1'}</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Server Scope Filter */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
              <span className="text-[10px] text-slate-400 font-semibold uppercase">Scope:</span>
              <select
                value={analysisServerId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'all') setAnalysisServerId('all');
                  else if (val === 'prod') setAnalysisServerId('prod');
                  else setAnalysisServerId(parseInt(val));
                }}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-800">All Nodes ({servers.length})</option>
                {servers.some(s => ['prod app1', 'prod app2'].includes(s.name.toLowerCase())) && (
                  <option value="prod" className="bg-slate-800">Production Cluster (prod app1 & prod app2)</option>
                )}
                {servers.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-800">{s.name}</option>
                ))}
              </select>
            </div>

            {/* Date Range Selector (matches LogExplorer & Dashboard) */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[10px] text-slate-400 font-semibold uppercase">Time:</span>
              <select
                value={selectedDatePreset}
                onChange={(e) => setSelectedDatePreset(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-800">All Time Available</option>
                <option value="30M" className="bg-slate-800">Last 30 Minutes</option>
                <option value="1H" className="bg-slate-800">Last 1 Hour</option>
                <option value="6H" className="bg-slate-800">Last 6 Hours</option>
                <option value="24H" className="bg-slate-800">Last 24 Hours</option>
                <option value="TODAY" className="bg-slate-800">Today (00:00 - 23:59)</option>
                <option value="7D" className="bg-slate-800">Last 7 Days</option>
                <option value="30D" className="bg-slate-800">Last 30 Days</option>
                <option value="CUSTOM" className="bg-slate-800">Custom Date Range...</option>
              </select>
            </div>

            {/* Custom Date Inputs if CUSTOM selected */}
            {selectedDatePreset === 'CUSTOM' && (
              <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-700">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                  title="Start Date"
                />
                <span className="text-slate-500 text-xs">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                  title="End Date"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-slate-400" />
              {availableModels.length > 0 ? (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
                >
                  {availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  placeholder="e.g. llama3, mistral"
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono w-36"
                />
              )}
            </div>

            <button
              onClick={handleTestLLM}
              disabled={testingLLM}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingLLM ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Test Ping</span>
            </button>
          </div>
        </div>

        {llmStatus && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
            llmStatus.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }`}>
            {llmStatus.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>{llmStatus.message}</span>
          </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('report')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'report'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Full Log Audit Report</span>
        </button>

        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Interactive Log Chat</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Saved Reports ({savedReports.length})</span>
        </button>
      </div>

      {/* TAB 1: Live Streaming Forensic Audit Report */}
      {activeTab === 'report' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerateReport}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-md shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                <span>{isGenerating ? 'Analysing log files...' : 'Audit log files'}</span>
              </button>
              {isGenerating && (
                <button
                  type="button"
                  onClick={handleStopReport}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold shadow-md shadow-rose-600/10 cursor-pointer transition-all"
                  title="Stop report generation"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs text-slate-300 shadow-sm">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Targeting:</span>
                <strong className="text-cyan-300 font-medium">{getPresetLabel(selectedDatePreset)}</strong>
              </span>
            </div>

            {reportContent && (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyReport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 cursor-pointer"
                >
                  {reportCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{reportCopied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={handleDownloadMarkdown}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 cursor-pointer"
                  title="Download raw Markdown (.md)"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.MD</span>
                </button>
                <button
                  onClick={handleExportDocx}
                  disabled={exportingDocx}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50 transition-all"
                  title="Export styled Microsoft Word Document (.docx)"
                >
                  <FileText className={`w-3.5 h-3.5 ${exportingDocx ? 'animate-spin' : ''}`} />
                  <span>{exportingDocx ? 'Exporting Word...' : 'Export Word (.DOCX)'}</span>
                </button>
                <button
                  onClick={handleSaveCurrentReport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs cursor-pointer"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>{savedSuccess ? 'Saved!' : 'Save Report'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl min-h-[450px]">
            {statusText && (
              <div className="mb-4 p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2 animate-pulse">
                <Activity className="w-4 h-4 text-cyan-400 animate-spin" />
                <span>{statusText}</span>
              </div>
            )}

            {/* Live Thinking / Reasoning Accordion */}
            {liveThought && (
              <div className="mb-5 rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden shadow-inner">
                <div 
                  onClick={() => setShowThought(prev => !prev)}
                  className="flex items-center justify-between px-4 py-2.5 bg-indigo-900/30 cursor-pointer hover:bg-indigo-900/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-indigo-400 animate-pulse" />
                    <span className="text-xs font-semibold text-indigo-200">
                      Model Thinking & Reasoning Process
                    </span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono">
                      {liveThought.length} chars
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-indigo-300">
                    <span>{showThought ? 'Hide reasoning' : 'View reasoning'}</span>
                    {showThought ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </div>
                {showThought && (
                  <div 
                    ref={liveThoughtScrollRef}
                    className="p-4 text-xs font-mono text-indigo-200/90 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed border-t border-indigo-500/20 bg-slate-950/60"
                  >
                    {liveThought}
                  </div>
                )}
              </div>
            )}

            {!reportContent && !isGenerating && !liveThought ? (
              <div className="h-96 flex flex-col items-center justify-center text-center text-slate-500">
                <BrainCircuit className="w-12 h-12 mb-3 opacity-30 text-cyan-400" />
                <h3 className="text-base font-semibold text-slate-300">Ready to Analyze TRIRIGA Server Logs</h3>
                <p className="text-xs text-slate-500 max-w-md mt-1 mb-4">
                  The local LLM will cluster all errors, correlate multi-server incident timelines, and report root causes with actionable remediation steps.
                </p>
                <button
                  onClick={handleGenerateReport}
                  className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-lg shadow-cyan-600/20 transition-all cursor-pointer"
                >
                  Audit log files
                </button>
              </div>
            ) : (
              <div className="prose prose-invert max-w-none prose-sm prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800 prose-headings:text-cyan-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {reportContent}
                </ReactMarkdown>
                {isGenerating && (
                  <div className="flex items-center gap-2 text-xs text-cyan-400 mt-4 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                    <span>Local LLM is streaming diagnosis reasoning...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Interactive Forensic Log Chat */}
      {activeTab === 'chat' && (
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl flex flex-col flex-1 min-h-[500px] h-[calc(100vh-270px)]">
          {/* Active Context Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 mb-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Active Scope:</span>
                <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 font-medium">
                  {getScopeLabel()}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Time Filter:</span>
                <span className="px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-200 font-medium">
                  {getPresetLabel(selectedDatePreset)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleClearChat}
                disabled={chatMessages.length <= 1 && !chatMessages[0]?.text}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 border border-slate-700 hover:border-rose-700/50 text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Clear chat transcript"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Clear</span>
              </button>
              <button
                onClick={handleExportChatMd}
                disabled={chatMessages.filter(m => m.text).length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Export full chat transcript as Markdown (.md)"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Export .MD</span>
              </button>
              <button
                onClick={handleExportChatDocx}
                disabled={chatMessages.filter(m => m.text).length === 0 || isExportingChatDocx}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Export full chat transcript as Word (.docx)"
              >
                <FileDown className={`w-3.5 h-3.5 text-blue-300 ${isExportingChatDocx ? 'animate-spin' : ''}`} />
                <span>{isExportingChatDocx ? 'Exporting Word...' : 'Export Word (.DOCX)'}</span>
              </button>
            </div>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2 min-h-0">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                    <BrainCircuit className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-3 text-xs max-w-4xl leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-cyan-600 text-white rounded-tr-none'
                      : 'bg-slate-800/80 text-slate-200 border border-slate-700/80 rounded-tl-none space-y-2'
                  }`}
                >
                  {/* Thought accordion inside chat message */}
                  {msg.thought && (
                    <details open={!msg.text || isChatStreaming} className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-[11px] p-2">
                      <summary className="font-semibold text-indigo-300 cursor-pointer flex items-center gap-1.5 select-none">
                        <BrainCircuit className="w-3 h-3 text-indigo-400 animate-pulse" />
                        <span>Reasoning Process ({msg.thought.length} chars)</span>
                      </summary>
                      <div 
                        ref={idx === chatMessages.length - 1 ? chatThoughtScrollRef : null}
                        className="mt-2 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-indigo-500/20 pt-2 text-[10px] text-indigo-100/80"
                      >
                        {msg.thought}
                      </div>
                    </details>
                  )}
                  <div className="prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                  {msg.role === 'assistant' && msg.text && (
                    <div className="flex items-center justify-end gap-2 pt-2 mt-2 border-t border-slate-700/50 text-[11px] text-slate-400">
                      <button
                        onClick={() => handleCopyChatMessage(msg.text, idx)}
                        className="flex items-center gap-1 hover:text-slate-200 transition-colors cursor-pointer"
                        title="Copy message text"
                      >
                        {copiedChatIdx === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleExportSingleMessageMd(msg, idx)}
                        className="flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer"
                        title="Export this response as Markdown (.md)"
                      >
                        <FileText className="w-3.5 h-3.5 text-cyan-400" />
                        <span>.MD</span>
                      </button>
                      <button
                        onClick={() => handleExportSingleMessageDocx(msg, idx)}
                        disabled={exportingSingleDocxIdx === idx}
                        className="flex items-center gap-1 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
                        title="Export this response as Word (.docx)"
                      >
                        <FileDown className={`w-3.5 h-3.5 text-blue-400 ${exportingSingleDocxIdx === idx ? 'animate-spin' : ''}`} />
                        <span>.DOCX</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isChatStreaming && (
              <div className="flex items-center gap-2 text-xs text-cyan-400 pl-11 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span>{chatStatusText || 'Searching SQLite FTS5 database and reasoning...'}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSendChat} className="pt-4 border-t border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask a question or issue a new query to interrupt (e.g. 'What caused the lease calculation deadlock?')..."
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
            {isChatStreaming && (
              <button
                type="button"
                onClick={handleStopChat}
                className="px-4 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold shadow-md shadow-rose-600/10 cursor-pointer flex items-center gap-1.5 transition-all shrink-0"
                title="Interrupt response"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            )}
            <button
              type="submit"
              disabled={isChatStreaming || !chatQuery.trim()}
              className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md shadow-cyan-600/20 cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: Saved Reports History */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1 rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3 max-h-[600px] overflow-y-auto">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historical Audit Reports</h3>
              {savedReports.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No reports saved yet.</p>
              ) : (
                savedReports.map((rep) => (
                  <div
                    key={rep.id}
                    onClick={() => setSelectedHistoryReport(rep)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedHistoryReport?.id === rep.id
                        ? 'bg-cyan-950/40 border-cyan-500/60 shadow-sm'
                        : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        rep.severity === 'critical' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {rep.severity}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {rep.created_at?.substring(0, 10)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-200 mt-2 truncate">{rep.title}</p>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{rep.summary}</p>
                  </div>
                ))
              )}
            </div>

            <div className="md:col-span-2 rounded-2xl bg-slate-900/90 border border-slate-800 p-6 min-h-[500px]">
              {selectedHistoryReport ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h2 className="text-base font-bold text-white">{selectedHistoryReport.title}</h2>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Generated by {selectedHistoryReport.model_used} ({selectedHistoryReport.provider}) on {selectedHistoryReport.created_at}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const blob = new Blob([selectedHistoryReport.raw_report], { type: 'text/markdown' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${selectedHistoryReport.title.replace(/\s+/g, '_')}.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 cursor-pointer"
                        title="Download Markdown (.md)"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.MD</span>
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.exportSavedReportDocx(selectedHistoryReport.id, selectedHistoryReport.title);
                          } catch (e) {
                            console.error('Failed to export Word doc:', e);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-xs font-semibold shadow-sm cursor-pointer transition-all"
                        title="Export styled Microsoft Word Document (.docx)"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Export Word (.DOCX)</span>
                      </button>
                    </div>
                  </div>
                  <div className="prose prose-invert max-w-none prose-sm prose-pre:bg-slate-950 prose-headings:text-cyan-300">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedHistoryReport.raw_report}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="h-96 flex flex-col items-center justify-center text-center text-slate-500">
                  <FileText className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-xs">Select a saved report from the left panel to inspect</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
