import React, { useState, useEffect } from 'react';
import { FileCode, ShieldCheck, Check, Copy } from 'lucide-react';

interface DeprovisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  generatedSQL: string;
  selectedCount: number;
  totalReclaimableCount: number;
}

export const DeprovisionModal: React.FC<DeprovisionModalProps> = ({
  isOpen,
  onClose,
  generatedSQL,
  selectedCount,
  totalReclaimableCount,
}) => {
  const [scriptCopied, setScriptCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const targetCount = selectedCount > 0 ? selectedCount : totalReclaimableCount;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                TRIRIGA SaaS License Deprovisioning &amp; Reclamation SQL Script
              </h3>
              <p className="text-xs text-slate-400">
                Generated for {selectedCount > 0 ? `${selectedCount} Selected Users` : `All ${totalReclaimableCount} High-Priority Dormant Users`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs">
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 font-sans text-xs text-slate-300 space-y-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Execution Guidance for TRIRIGA Administrator</span>
            </div>
            <ol className="list-decimal list-inside text-slate-400 space-y-1 text-[11px] leading-relaxed">
              <li>Copy the SQL script below.</li>
              <li>Log in to the TRIRIGA Admin Console (<code className="text-cyan-300">/html/en/default/admin</code>) and navigate to <strong>Database Query Tool</strong> (or run via your DB2 SQL client).</li>
              <li>Paste and execute the script to de-allocate dormant users from <code className="text-cyan-300">USER_PRODUCT</code>.</li>
              <li>Users will lose product license assignment but their master profile in <code className="text-cyan-300">IBS_SPEC</code> is preserved intact.</li>
            </ol>
          </div>

          {/* Code block */}
          <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-4 max-h-[350px] overflow-y-auto">
            <pre className="text-cyan-300 leading-relaxed font-mono whitespace-pre-wrap">
              {generatedSQL}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 font-sans">
            Targeting: <strong className="text-white">{targetCount}</strong> users across Occasional &amp; Approvals tiers
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(generatedSQL);
                setScriptCopied(true);
                setTimeout(() => setScriptCopied(false), 2500);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold cursor-pointer shadow-md shadow-amber-600/20 transition-all"
            >
              {scriptCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{scriptCopied ? 'Script Copied!' : 'Copy SQL Script'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
