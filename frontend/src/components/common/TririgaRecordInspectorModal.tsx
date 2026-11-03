import React, { useState, useEffect } from 'react';
import { 
  X, 
  Layers, 
  Sparkles, 
  Search, 
  Check, 
  Copy, 
  FileText, 
  AlertTriangle, 
  User, 
  MapPin, 
  Tag, 
  Zap,
  RefreshCw,
  Mail,
  Briefcase,
  Building,
  Building2,
  Wrench,
  Cpu,
  ShieldCheck,
  ExternalLink,
  Workflow,
  Lock,
  Clock
} from 'lucide-react';
import { api } from '../../services/api';
import { TririgaResolvedSpec, TririgaResolvedWorkflow } from '../../types';

interface TririgaRecordInspectorModalProps {
  identifier: string | null;
  workflowId?: number | null;
  onClose: () => void;
  onFilterLogsByRecord?: (identifier: string) => void;
  onSendToAI?: (prompt: string) => void;
  onInspectWorkTask?: (identifier: string) => void;
}

export const TririgaRecordInspectorModal: React.FC<TririgaRecordInspectorModalProps> = ({
  identifier,
  workflowId,
  onClose,
  onFilterLogsByRecord,
  onSendToAI,
  onInspectWorkTask,
}) => {
  const [record, setRecord] = useState<TririgaResolvedSpec | null>(null);
  const [workflow, setWorkflow] = useState<TririgaResolvedWorkflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Explicit on-demand log scanning state
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [scanningLogs, setScanningLogs] = useState(false);
  const [associatedLogs, setAssociatedLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!identifier && !workflowId) return;

    let isMounted = true;
    const fetchMetadataFast = async () => {
      setLoading(true);
      setError(null);
      setLogsLoaded(false);
      setAssociatedLogs([]);

      try {
        if (identifier) {
          // Instant sub-millisecond metadata resolution (does not scan 2.6GB logs)
          const resolved = await api.resolveRecordIdentifier(identifier, false);
          if (isMounted) {
            setRecord(resolved);
          }
        }

        if (workflowId) {
          try {
            const wfData = await api.resolveWorkflow(workflowId);
            if (isMounted) setWorkflow(wfData);
          } catch (wfErr) {
            console.warn('Failed to resolve workflow template:', wfErr);
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to resolve record metadata');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchMetadataFast();
    return () => {
      isMounted = false;
    };
  }, [identifier, workflowId]);

  const handleScanLogsOnDemand = async () => {
    const targetId = identifier || (record?.control_number) || (record?.spec_id ? String(record.spec_id) : null);
    if (!targetId) return;

    setScanningLogs(true);
    try {
      const res = await api.getRecordAssociatedLogs(targetId, 25);
      setAssociatedLogs(res.logs || []);
      setLogsLoaded(true);
    } catch (err: any) {
      console.error('Log scan error:', err);
      setLogsLoaded(true);
    } finally {
      setScanningLogs(false);
    }
  };

  const copyText = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isPersonRecord = record?.module_name === 'triPeople' || record?.bo_name === 'triPeople' || !!record?.email;
  const isWorkTaskRecord = record?.module_name === 'triTask' || record?.bo_name === 'triWorkTask' || !!record?.task_type || (record?.control_number && record.control_number.startsWith('WRK-'));
  const isLocationRecord = record?.module_name === 'triLocation' || ['triBuilding', 'triFloor', 'triSpace'].includes(record?.bo_name || '');
  const isAssetRecord = record?.module_name === 'triAsset' || ['triAsset', 'triBuildingSystem'].includes(record?.bo_name || '');

  const handleSendToAI = () => {
    if (!record && !workflow) return;
    const lines = [
      `Please analyze this linked TRIRIGA record & runtime context:`,
      ``,
      `--- TRIRIGA Business Record ---`,
      `Control Number: ${record?.control_number || 'N/A'}`,
      `Spec ID: ${record?.spec_id || 'N/A'}`,
      `Human Readable Name: ${record?.spec_name || 'N/A'}`,
      `Module / BO: ${record?.module_name || 'N/A'} -> ${record?.bo_name || 'N/A'}`,
      `Status: ${record?.status || 'N/A'}`,
    ];

    if (record?.email) lines.push(`Email Address: ${record.email}`);
    if (record?.job_title) lines.push(`Job Title: ${record.job_title}`);
    if (record?.department) lines.push(`Department: ${record.department}`);
    if (record?.task_type) lines.push(`Task Type: ${record.task_type}`);
    if (record?.priority) lines.push(`Priority: ${record.priority}`);
    if (record?.location) lines.push(`Location: ${record.location}`);
    if (record?.assigned_to) lines.push(`Assigned To: ${record.assigned_to}`);
    if (record?.asset_name) lines.push(`Asset: ${record.asset_name}`);
    if (record?.description) lines.push(`Description: ${record.description}`);

    if (workflow) {
      lines.push(
        ``,
        `--- Linked Workflow Template Details ---`,
        `Template ID: ${workflow.wf_id}`,
        `Template Name: ${workflow.template_name || 'N/A'}`,
        `Module / BO: ${workflow.module_name || 'N/A'} -> ${workflow.bo_name || 'N/A'}`,
        `Trigger Event: ${workflow.event_name || 'N/A'}`,
        `Execution Mode: ${workflow.execution_mode || 'N/A'}`,
        `Locking Strategy: ${workflow.locking_strategy || 'N/A'}`,
        `Description: ${workflow.description || 'N/A'}`
      );
    }

    if (associatedLogs && associatedLogs.length > 0) {
      lines.push(
        ``,
        `--- Associated Log Entries across Cluster (${associatedLogs.length} entries) ---`
      );
      associatedLogs.slice(0, 5).forEach((log: any, idx: number) => {
        lines.push(
          `[${idx + 1}] [${log.timestamp}] [${log.log_level}] [${log.server_name || 'Cluster'}] ${log.logger_name || ''}: ${log.message}`
        );
      });
    }

    lines.push(
      ``,
      `Please provide:`,
      `1. Record Root Cause & Subsystem Impact`,
      `2. Transaction / Workflow lock contention risk analysis`,
      `3. Recommended remediation steps in TRIRIGA Application Platform`
    );

    if (onSendToAI) {
      onSendToAI(lines.join('\n'));
      onClose();
    }
  };

  if (!identifier && !workflowId) return null;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-cyan-500/50 p-6 shadow-2xl flex flex-col justify-between space-y-4 animate-scale-in text-slate-900 dark:text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-inner ${
              isPersonRecord 
                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                : isWorkTaskRecord
                  ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400'
                  : isLocationRecord
                    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                    : isAssetRecord
                      ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400'
                      : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400'
            }`}>
              {isPersonRecord ? (
                <User className="w-5 h-5" />
              ) : isWorkTaskRecord ? (
                <Wrench className="w-5 h-5" />
              ) : isLocationRecord ? (
                <Building2 className="w-5 h-5" />
              ) : isAssetRecord ? (
                <Cpu className="w-5 h-5" />
              ) : workflowId ? (
                <Zap className="w-5 h-5" />
              ) : (
                <Layers className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  {isPersonRecord 
                    ? 'TRIRIGA User & Person Inspector' 
                    : isWorkTaskRecord 
                      ? 'TRIRIGA WorkTask Inspector'
                      : isLocationRecord
                        ? 'TRIRIGA Location Inspector'
                        : isAssetRecord
                          ? 'TRIRIGA Asset Inspector'
                          : workflowId && !identifier
                            ? 'TRIRIGA Workflow Template Inspector'
                            : 'TRIRIGA Record Inspector'
                  }
                </span>
                {record?.control_number && (
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-900 border border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40 text-xs font-mono font-bold">
                    {record.control_number}
                  </span>
                )}
                {record?.spec_id && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 text-[11px] font-mono font-semibold">
                    Spec #{record.spec_id}
                  </span>
                )}
                {workflowId && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40 text-[11px] font-mono font-semibold">
                    WF #{workflowId}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Instant business record & workflow engine template identification
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="overflow-y-auto space-y-4 pr-1 text-xs max-h-[calc(90vh-140px)]">
          {loading ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400 mx-auto" />
              <p className="text-xs">Resolving TRIRIGA record metadata...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 text-rose-900 dark:text-rose-300 space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Resolution Notice</span>
              </div>
              <p className="text-xs text-rose-800 dark:text-rose-200/90">{error}</p>
            </div>
          ) : (
            <>
              {/* Record Summary Banner */}
              {record && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-3.5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                          {isPersonRecord 
                            ? 'Full Human Name & Profile' 
                            : isWorkTaskRecord 
                              ? 'Work Task Title'
                              : isLocationRecord
                                ? 'Location Name'
                                : isAssetRecord
                                  ? 'Asset Name'
                                  : 'Business Record Name'
                          }
                        </span>
                        {record.is_resolved && (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.2 rounded bg-cyan-100 text-cyan-900 border border-cyan-300 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-500/50 text-[10px] font-bold">
                            <ShieldCheck className="w-3 h-3 text-cyan-700 dark:text-cyan-400" />
                            VERIFIED
                          </span>
                        )}
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                        {record.spec_name || record.control_number || `Spec ID #${record.spec_id || identifier}`}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {record.module_name && (
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30 text-[11px] font-mono font-semibold">
                          {record.module_name}
                        </span>
                      )}
                      {record.bo_name && (
                        <span className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-900 border border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30 text-[11px] font-mono font-semibold">
                          {record.bo_name}
                        </span>
                      )}
                      {record.status && (
                        <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${
                          record.status.toLowerCase().includes('active') || record.status.toLowerCase().includes('operational')
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                            : record.status.toLowerCase().includes('progress')
                              ? 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                              : 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                        }`}>
                          {record.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* #1 PERSON SPECIFIC CARD */}
                  {isPersonRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 font-sans">
                      {record.email && (
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30">
                          <div className="flex items-center gap-2 truncate">
                            <Mail className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                            <div className="truncate">
                              <span className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-400 block">Email Address</span>
                              <a 
                                href={`mailto:${record.email}`} 
                                className="text-xs text-amber-950 dark:text-amber-200 font-semibold hover:underline truncate block"
                              >
                                {record.email}
                              </a>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyText(record.email!, 'email')}
                            className="p-1 rounded bg-amber-200/60 hover:bg-amber-300 dark:bg-amber-900/50 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200 transition-colors cursor-pointer shrink-0"
                            title="Copy email address"
                          >
                            {copiedField === 'email' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}

                      {record.job_title && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <Briefcase className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Job Title</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-semibold">{record.job_title}</span>
                          </div>
                        </div>
                      )}

                      {record.department && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <Building className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Department</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-semibold">{record.department}</span>
                          </div>
                        </div>
                      )}

                      {record.location && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <MapPin className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Primary Location</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-semibold">{record.location}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* #2 WORK TASK SPECIFIC DETAILS */}
                  {isWorkTaskRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 font-sans">
                      {record.task_type && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-50/80 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-500/30">
                          <Wrench className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] uppercase font-bold text-cyan-800 dark:text-cyan-400 block">Task Type</span>
                            <span className="text-xs text-cyan-950 dark:text-cyan-200 font-bold">{record.task_type}</span>
                          </div>
                        </div>
                      )}

                      {record.priority && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <Tag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Priority</span>
                            <span className={`text-xs font-bold ${
                              record.priority === 'Critical' 
                                ? 'text-rose-600 dark:text-rose-400' 
                                : record.priority === 'High' 
                                  ? 'text-amber-600 dark:text-amber-400' 
                                  : 'text-slate-800 dark:text-slate-200'
                            }`}>
                              {record.priority}
                            </span>
                          </div>
                        </div>
                      )}

                      {record.assigned_to && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Assigned To</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.assigned_to}</span>
                          </div>
                        </div>
                      )}

                      {record.location && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Location</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.location}</span>
                          </div>
                        </div>
                      )}

                      {record.asset_name && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/30 col-span-1 sm:col-span-2">
                          <Cpu className="w-3.5 h-3.5 text-indigo-700 dark:text-indigo-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] uppercase font-bold text-indigo-800 dark:text-indigo-400 block">Linked Asset</span>
                            <span className="text-xs text-indigo-950 dark:text-indigo-200 font-bold">{record.asset_name}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* #3 LOCATION SPECIFIC DETAILS */}
                  {isLocationRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 font-sans">
                      {record.control_number && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/30">
                          <Building2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-400 block">Location Code</span>
                            <span className="text-xs text-emerald-950 dark:text-emerald-200 font-mono font-bold">{record.control_number}</span>
                          </div>
                        </div>
                      )}

                      {record.location && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Physical Location</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.location}</span>
                          </div>
                        </div>
                      )}

                      {record.assigned_to && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Organization</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.assigned_to}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* #4 ASSET SPECIFIC DETAILS */}
                  {isAssetRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 font-sans">
                      {record.control_number && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50/80 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-500/30">
                          <Cpu className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] uppercase font-bold text-blue-800 dark:text-blue-400 block">Asset Tag</span>
                            <span className="text-xs text-blue-950 dark:text-blue-200 font-mono font-bold">{record.control_number}</span>
                          </div>
                        </div>
                      )}

                      {record.location && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Plant Location</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.location}</span>
                          </div>
                        </div>
                      )}

                      {record.assigned_to && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Maintained By</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.assigned_to}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* General Record fallback if not Person, WorkTask, Location, Asset */}
                  {!isPersonRecord && !isWorkTaskRecord && !isLocationRecord && !isAssetRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 font-sans">
                      {record.assigned_to && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Assigned / Modified By</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.assigned_to}</span>
                          </div>
                        </div>
                      )}
                      {record.location && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Location Context</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.location}</span>
                          </div>
                        </div>
                      )}
                      {record.priority && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <Tag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Priority</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.priority}</span>
                          </div>
                        </div>
                      )}
                      {record.task_type && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <Tag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase font-bold">Record Class</span>
                            <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">{record.task_type}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {record.description && (
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                      {record.description}
                    </div>
                  )}
                </div>
              )}

              {/* #5 WORKFLOW ENGINE TEMPLATE DETAILS (All 5 Details) */}
              {(workflow || (record?.associated_workflows && record.associated_workflows.length > 0)) && (
                <div className="p-4 rounded-xl bg-purple-50 dark:bg-gradient-to-r dark:from-indigo-950/60 dark:via-slate-900 dark:to-purple-950/50 border border-purple-300 dark:border-indigo-500/50 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-200 dark:bg-indigo-500/30 flex items-center justify-center text-purple-800 dark:text-indigo-300">
                        <Workflow className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-bold text-purple-950 dark:text-indigo-200">
                        TRIRIGA Workflow Engine Template Specification
                      </span>
                    </div>
                    {workflow?.is_resolved && (
                      <span className="px-2 py-0.5 rounded bg-purple-200 text-purple-900 border border-purple-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30 text-[10px] font-mono font-bold">
                        VERIFIED TEMPLATE
                      </span>
                    )}
                  </div>

                  {workflow ? (
                    <div className="p-3.5 rounded-xl bg-white dark:bg-slate-950 border border-purple-200 dark:border-indigo-500/30 space-y-3">
                      {/* 1. Template Name & 2. Template ID */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-2.5">
                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-purple-700 dark:text-indigo-400 block">1. Template Name</span>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            {workflow.template_name || `Workflow Template #${workflow.wf_id}`}
                          </h4>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">2. Template ID</span>
                          <span className="px-2.5 py-1 rounded bg-purple-100 dark:bg-indigo-950/80 text-purple-900 dark:text-indigo-300 border border-purple-300 dark:border-indigo-500/40 text-xs font-mono font-bold">
                            WF #{workflow.wf_id}
                          </span>
                        </div>
                      </div>

                      {/* 3. Module & BO, 4. Trigger Event, 5. Execution Mode & Locking Strategy */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">3. Module & BO</span>
                          <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {workflow.module_name || 'triTask'} → {workflow.bo_name || 'triWorkTask'}
                          </span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">4. Trigger Event</span>
                          <span className="text-xs font-mono font-semibold text-purple-700 dark:text-purple-300">
                            {workflow.event_name || 'Pre-Create / Save'}
                          </span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">5. Mode & Locking</span>
                          <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 block truncate">
                            {workflow.execution_mode || 'Synchronous (In-Transaction)'}
                          </span>
                          {workflow.locking_strategy && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono block">
                              Lock: {workflow.locking_strategy}
                            </span>
                          )}
                        </div>
                      </div>

                      {workflow.description && (
                        <div className="p-2.5 rounded-lg bg-purple-50/50 dark:bg-slate-900/60 border border-purple-100 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                          {workflow.description}
                        </div>
                      )}
                    </div>
                  ) : record?.associated_workflows ? (
                    <div className="space-y-1.5">
                      {record.associated_workflows.map((wf) => (
                        <div key={wf.id} className="p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-purple-200 dark:border-indigo-500/20 flex items-center justify-between">
                          <span className="text-xs text-slate-800 dark:text-slate-200 font-semibold">{wf.name}</span>
                          <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-indigo-950 text-purple-900 dark:text-indigo-300 text-[10px] font-mono font-bold">
                            ID: {wf.id}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {/* On-Demand Correlated Cluster Logs Section */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                      Correlated Cluster Logs
                    </span>
                  </div>
                  {onFilterLogsByRecord && (
                    <button
                      type="button"
                      onClick={() => {
                        onFilterLogsByRecord(record?.control_number || String(record?.spec_id || identifier));
                        onClose();
                      }}
                      className="text-[11px] text-cyan-700 hover:text-cyan-900 dark:text-cyan-400 dark:hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Search className="w-3 h-3" />
                      <span>Filter in Log Explorer</span>
                    </button>
                  )}
                </div>

                {!logsLoaded && !scanningLogs ? (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                    <div className="space-y-0.5 text-left">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Optional Cluster Log Scan</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Scan the 2.6GB database for all cluster log entries referencing this record
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleScanLogsOnDemand}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer shrink-0"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>Scan Cluster Logs</span>
                    </button>
                  </div>
                ) : scanningLogs ? (
                  <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-cyan-600 dark:text-cyan-400 mx-auto" />
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Scanning cluster database for references to {identifier || record?.control_number}...
                    </p>
                  </div>
                ) : associatedLogs.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Found {associatedLogs.length} matching log entries:</span>
                      <button
                        type="button"
                        onClick={handleScanLogsOnDemand}
                        className="text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-2.5 h-2.5" /> Rescan
                      </button>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {associatedLogs.map((log: any, idx: number) => (
                        <div 
                          key={idx} 
                          className="p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1 font-mono hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-600 dark:text-slate-300">{log.timestamp}</span>
                              <span className={`px-1.5 py-0.2 rounded font-bold border ${
                                log.log_level === 'ERROR' || log.log_level === 'FATAL'
                                  ? 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30'
                                  : log.log_level === 'WARN'
                                    ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30'
                                    : 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                              }`}>
                                {log.log_level}
                              </span>
                              {log.server_name && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px]">
                                  {log.server_name}
                                </span>
                              )}
                            </div>
                            {log.filename && <span className="text-slate-400">{log.filename}</span>}
                          </div>
                          <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text font-sans line-clamp-2">
                            {log.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 text-center text-slate-500 text-xs">
                    No direct cluster log entries found referencing this identifier.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 flex-wrap">
            {record?.email && (
              <button
                type="button"
                onClick={() => copyText(record.email!, 'email-foot')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:hover:bg-amber-900 dark:text-amber-200 text-xs border border-amber-300 dark:border-amber-500/40 cursor-pointer transition-colors"
                title="Copy Email"
              >
                {copiedField === 'email-foot' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Mail className="w-3.5 h-3.5" />}
                <span>{copiedField === 'email-foot' ? 'Copied' : record.email}</span>
              </button>
            )}
            {record?.control_number && (
              <button
                type="button"
                onClick={() => copyText(record.control_number!, 'ctrl')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs border border-slate-300 dark:border-slate-700 cursor-pointer transition-colors"
                title="Copy Control Number"
              >
                {copiedField === 'ctrl' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'ctrl' ? 'Copied' : record.control_number}</span>
              </button>
            )}
            {record?.spec_id && (
              <button
                type="button"
                onClick={() => copyText(String(record.spec_id), 'spec')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs border border-slate-300 dark:border-slate-700 cursor-pointer transition-colors"
                title="Copy Spec ID"
              >
                {copiedField === 'spec' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'spec' ? 'Copied' : `Spec #${record.spec_id}`}</span>
              </button>
            )}
            {workflow?.wf_id && (
              <button
                type="button"
                onClick={() => copyText(String(workflow.wf_id), 'wf')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:hover:bg-purple-900 dark:text-purple-200 text-xs border border-purple-300 dark:border-purple-500/40 cursor-pointer transition-colors"
                title="Copy Workflow Template ID"
              >
                {copiedField === 'wf' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'wf' ? 'Copied' : `WF #${workflow.wf_id}`}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onInspectWorkTask && record?.control_number && isWorkTaskRecord && (
              <button
                type="button"
                onClick={() => {
                  onInspectWorkTask(record.control_number!);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                Inspect WorkTask Contention
              </button>
            )}
            {onSendToAI && (
              <button
                type="button"
                onClick={handleSendToAI}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-cyan-950/40 cursor-pointer transition-all hover:scale-105 active:scale-95"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Ask AI to Analyze</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
