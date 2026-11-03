import React, { useState, useEffect, useRef } from 'react';
import { 
  BrainCircuit, 
  Send, 
  Square, 
  Trash2, 
  ChevronRight, 
  Cpu, 
  Sparkles,
  X,
  FileDown,
  FileText,
  Copy,
  Check
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../services/api';
import { LLMConfig, ChatMessage } from '../types';
import { streamChatQuery } from '../utils/chatStream';
import { 
  exportChatMarkdown, 
  exportChatDocx, 
  exportSingleMessageMarkdown, 
  exportSingleMessageDocx 
} from '../utils/chatExport';

export type { ChatMessage };

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isChatStreaming: boolean;
  setIsChatStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  chatAbortRef: React.MutableRefObject<AbortController | null>;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  isOpen,
  onClose,
  chatMessages,
  setChatMessages,
  isChatStreaming,
  setIsChatStreaming,
  chatAbortRef,
}) => {
  const [chatQuery, setChatQuery] = useState('');
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('local-model');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isExportingFullDocx, setIsExportingFullDocx] = useState(false);
  const [exportingSingleDocxIdx, setExportingSingleDocxIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const latestThoughtRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadLLM = async () => {
      try {
        const cfg = await api.getActiveLLMConfig();
        setLlmConfig(cfg);
        setSelectedModel(cfg.model_name || 'local-model');
        // Discover models asynchronously in background without blocking mount
        api.discoverModels(cfg.provider, cfg.base_url).then(disc => {
          if (disc?.models && disc.models.length > 0) {
            setAvailableModels(disc.models.map((m: any) => m.id));
          }
        }).catch(() => {});
      } catch {
        setLlmConfig({
          id: 1,
          provider: 'lm_studio',
          base_url: 'http://localhost:1234/v1',
          model_name: 'local-model',
          temperature: 0.2,
          context_window: 32768,
          is_active: 1,
        });
      }
    };
    loadLLM();
  }, []);

  // Auto-scroll when messages or streaming updates
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    if (latestThoughtRef.current) {
      latestThoughtRef.current.scrollTop = latestThoughtRef.current.scrollHeight;
    }
  }, [chatMessages, isChatStreaming]);

  const handleClearHistory = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsChatStreaming(false);
    setChatMessages([
      {
        role: 'assistant',
        text: "Hello! I am your TRIRIGA Log Analysis AI Assistant. You can click on any error entry in the Log Explorer to diagnose it, or ask me directly about issues across your cluster."
      }
    ]);
  };

  const handleStopResponse = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsChatStreaming(false);
  };

  const handleExportFullMd = () => {
    exportChatMarkdown(chatMessages, {
      title: 'IBM TRIRIGA AI Assistant – Chat Transcript',
      model: selectedModel,
      filename: `TRIRIGA_AI_Chat_Transcript_${Date.now()}`
    });
  };

  const handleExportFullDocx = async () => {
    setIsExportingFullDocx(true);
    try {
      await exportChatDocx(chatMessages, {
        title: 'IBM TRIRIGA AI Assistant – Chat Consultation Transcript',
        model: selectedModel,
        filename: `TRIRIGA_AI_Chat_Transcript_${Date.now()}`
      });
    } catch (err: any) {
      console.error('Failed to export chat to Word:', err);
      alert(`Failed to export Word document: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExportingFullDocx(false);
    }
  };

  const handleExportSingleMd = (msg: ChatMessage, idx: number) => {
    const prompt = idx > 0 && chatMessages[idx - 1].role === 'user' ? chatMessages[idx - 1].text : undefined;
    exportSingleMessageMarkdown(msg, {
      prompt,
      title: 'IBM TRIRIGA AI Assistant – Diagnostic Response',
      model: selectedModel,
      filename: `TRIRIGA_AI_Response_${Date.now()}`
    });
  };

  const handleExportSingleDocx = async (msg: ChatMessage, idx: number) => {
    setExportingSingleDocxIdx(idx);
    try {
      const prompt = idx > 0 && chatMessages[idx - 1].role === 'user' ? chatMessages[idx - 1].text : undefined;
      await exportSingleMessageDocx(msg, {
        prompt,
        title: 'IBM TRIRIGA AI Assistant – Diagnostic Response',
        model: selectedModel,
        filename: `TRIRIGA_AI_Response_${Date.now()}`
      });
    } catch (err: any) {
      console.error('Failed to export message to Word:', err);
      alert(`Failed to export Word document: ${err.message || 'Unknown error'}`);
    } finally {
      setExportingSingleDocxIdx(null);
    }
  };

  const handleCopyMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
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

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      setChatMessages(prev => [...prev, { role: 'assistant', text: '', thought: '' }]);

      await streamChatQuery({
        query: userText,
        provider: llmConfig?.provider || 'lm_studio',
        baseUrl: llmConfig?.base_url || 'http://localhost:1234/v1',
        modelName: selectedModel,
        contextWindow: llmConfig?.context_window || 32768,
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
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900 border-l border-slate-800 text-slate-100 shadow-2xl select-text">
      {/* Sidebar Header */}
      <div className="absolute top-0 left-0 right-0 h-12 p-3 border-b border-slate-800 bg-slate-950 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-cyan-500/20">
            <BrainCircuit className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-white truncate">AI Log Analysis</span>
              {isChatStreaming && (
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              {selectedModel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleExportFullMd}
            disabled={chatMessages.filter(m => m.text).length === 0}
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Export Chat as Markdown (.md)"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleExportFullDocx}
            disabled={chatMessages.filter(m => m.text).length === 0 || isExportingFullDocx}
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-300 hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Export Chat as Word (.docx)"
          >
            <FileDown className={`w-3.5 h-3.5 ${isExportingFullDocx ? 'animate-spin text-blue-400' : ''}`} />
          </button>
          <div className="h-4 w-px bg-slate-800 mx-0.5" />
          <button
            onClick={handleClearHistory}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-all cursor-pointer"
            title="Clear Chat History"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title="Close Assistant"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Model Selector Bar */}
      {availableModels.length > 0 && (
        <div className="absolute top-12 left-0 right-0 h-8 px-3 py-1 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-[11px] z-10">
          <span className="text-slate-400 flex items-center gap-1 text-[10px]">
            <Cpu className="w-3 h-3 text-cyan-400" /> Model:
          </span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500 max-w-[140px] truncate"
          >
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Message History List Bounded between Header and Bottom Input Box */}
      <div 
        ref={chatScrollRef} 
        style={{
          position: 'absolute',
          top: availableModels.length > 0 ? '80px' : '48px',
          bottom: '58px',
          left: 0,
          right: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px',
        }}
        className="space-y-3"
      >
        {chatMessages.map((msg, idx) => {
          if (msg.role === 'assistant') {
            return (
              <div key={idx} className="flex gap-2 justify-start">
                <div className="w-5 h-5 rounded bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <BrainCircuit className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="rounded-xl px-3.5 py-2.5 text-xs max-w-[92%] leading-relaxed bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-tl-none shadow-sm select-text space-y-2">
                  {msg.thought && (
                    <details open={!msg.text || isChatStreaming} className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-[10px] p-2">
                      <summary className="font-semibold text-indigo-300 cursor-pointer flex items-center gap-1.5 select-none">
                        <BrainCircuit className="w-3 h-3 text-indigo-400 animate-pulse" />
                        <span>Reasoning Process ({msg.thought.length} chars)</span>
                      </summary>
                      <div 
                        ref={idx === chatMessages.length - 1 ? latestThoughtRef : null}
                        className="mt-1.5 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-indigo-500/20 pt-1.5 text-[10px] text-indigo-100/90 leading-relaxed"
                      >
                        {msg.thought}
                      </div>
                    </details>
                  )}
                  {msg.text ? (
                    <>
                      <div className="prose prose-invert prose-xs max-w-none break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-1.5 mt-1 border-t border-slate-700/50 text-[10px] text-slate-400">
                        <button
                          onClick={() => handleCopyMessage(msg.text, idx)}
                          className="flex items-center gap-1 hover:text-slate-200 transition-colors cursor-pointer"
                          title="Copy answer"
                        >
                          {copiedIdx === idx ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400 font-medium">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleExportSingleMd(msg, idx)}
                          className="flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer"
                          title="Export response as Markdown (.md)"
                        >
                          <FileText className="w-3 h-3 text-cyan-400" />
                          <span>.MD</span>
                        </button>
                        <button
                          onClick={() => handleExportSingleDocx(msg, idx)}
                          disabled={exportingSingleDocxIdx === idx}
                          className="flex items-center gap-1 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
                          title="Export response as Word (.docx)"
                        >
                          <FileDown className={`w-3 h-3 text-blue-400 ${exportingSingleDocxIdx === idx ? 'animate-spin' : ''}`} />
                          <span>.DOCX</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    isChatStreaming && (
                      <div className="flex items-center gap-1.5 text-[11px] text-cyan-400 font-sans animate-pulse pt-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                        <span>{msg.thought ? 'Formulating final answer...' : 'Thinking in LM Studio...'}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          }

          const isLogReq = msg.text && msg.text.includes('Please analyze') && (msg.text.includes('TRIRIGA') || msg.text.includes('log entry') || msg.text.includes('error cluster') || msg.text.includes('selected TRIRIGA'));
          if (isLogReq) {
            const sMatch = msg.text.match(/server ["']?([^"'\n\)]+)["']?/i);
            const serverName = sMatch ? sMatch[1] : 'Cluster Node';
            const lMatch = msg.text.match(/Level:\s*([A-Z]+)/i) || msg.text.match(/\[(FATAL|ERROR|WARN|INFO)\]/i);
            const logLevel = lMatch ? lMatch[1].toUpperCase() : 'ERROR';
            const tMatch = msg.text.match(/Timestamp:\s*([^\n]+)/i);
            const timeStr = tMatch ? tMatch[1].trim() : '';
            const mMatch = msg.text.match(/Log Message:\s*\n([\s\S]+?)(?=\n\n(?:Stack Trace:|Please provide:|$))/i);
            const logMsg = mMatch ? mMatch[1].trim() : (msg.text.length > 200 ? msg.text.substring(0, 180) + '...' : msg.text);
            const hasStack = msg.text.includes('Stack Trace');

            return (
              <div key={idx} className="flex justify-end w-full">
                <div className="w-full rounded-xl bg-slate-900/95 border border-cyan-500/40 p-3 shadow-lg text-xs space-y-2 select-text">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[11px]">
                    <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Log Analysis Request</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${
                      logLevel === 'ERROR' || logLevel === 'FATAL'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : logLevel === 'WARN'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    }`}>
                      {logLevel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-mono">
                    <span className="text-cyan-400 font-medium">Server: {serverName}</span>
                    {timeStr && <span>•</span>}
                    {timeStr && <span>{timeStr}</span>}
                  </div>
                  <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-700/80 font-mono text-[11px] text-slate-100 line-clamp-3 leading-relaxed select-text font-medium">
                    {logMsg}
                  </div>
                  {hasStack && (
                    <div className="text-[10px] text-rose-400/90 flex items-center gap-1.5 font-mono pt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                      <span>Full stack trace attached for AI triage</span>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={idx} className="flex justify-end">
              <div className="rounded-2xl rounded-tr-none px-3.5 py-2 text-xs max-w-[85%] leading-relaxed bg-cyan-700/80 text-white border border-cyan-500/30 shadow-md font-sans select-text">
                {msg.text}
              </div>
            </div>
          );
        })}

        {isChatStreaming && (
          <div className="flex items-center gap-2 text-[10px] text-cyan-400 pl-7 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            <span>Reasoning over cluster logs...</span>
          </div>
        )}
      </div>

      {/* Chat Input Box - Permanently and strictly pinned to bottom */}
      <form 
        onSubmit={handleSendMessage} 
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '58px',
        }}
        className="p-2.5 border-t border-slate-800 bg-slate-950 flex items-center gap-1.5 z-20"
      >
        <input
          type="text"
          placeholder="Ask AI Assistant..."
          value={chatQuery}
          onChange={(e) => setChatQuery(e.target.value)}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-colors font-sans"
        />
        {isChatStreaming && (
          <button
            type="button"
            onClick={handleStopResponse}
            className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold shadow-sm cursor-pointer transition-all shrink-0"
            title="Interrupt AI Response"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        )}
        <button
          type="submit"
          disabled={!chatQuery.trim()}
          className="p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 disabled:opacity-50 cursor-pointer transition-all shrink-0"
          title={isChatStreaming ? 'Interrupt & Send New Query' : 'Send'}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
