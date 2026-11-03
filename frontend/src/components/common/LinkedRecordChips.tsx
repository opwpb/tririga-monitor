import React, { useState, useEffect, useRef } from 'react';
import { 
  Layers, 
  Zap, 
  ExternalLink, 
  Tag, 
  User, 
  Box, 
  Building2, 
  Wrench, 
  Shield, 
  Mail, 
  Briefcase, 
  MapPin, 
  Copy, 
  Check 
} from 'lucide-react';
import { api } from '../../services/api';

export interface ExtractedItem {
  key: string;
  id: string;
  type: 'spec' | 'workflow' | 'control' | 'user' | 'bo';
  numericId?: number;
  label: string;
  title: string;
  boName?: string;
  moduleName?: string;
  workflowName?: string;
}

export interface ExtractedRecordInfo {
  specIds: number[];
  controlNumbers: string[];
  workflowIds: number[];
  userIds: number[];
  items: ExtractedItem[];
}

export const extractRecordIdentifiersFromText = (text: string): ExtractedRecordInfo => {
  if (!text) {
    return { specIds: [], controlNumbers: [], workflowIds: [], userIds: [], items: [] };
  }

  const specMap = new Map<number, { boName?: string; moduleName?: string }>();
  const controlNumbers = new Set<string>();
  const wfMap = new Map<number, { name?: string; boName?: string; moduleName?: string }>();
  const userIds = new Set<number>();

  // 1. Contextual Workflow Block Extraction: e.g. |Workflow> WFTID=13380752.33 ... Name='triOption - ...' Module='triItem' BO='triOption' ... SO=173112205 ... Mode=S<Workflow| or [Workflow> ...]
  const wfBlockRegex = /[\|\[]Workflow>\s*([^\]\<]+)[\]\<]/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = wfBlockRegex.exec(text)) !== null) {
    const block = blockMatch[1];
    
    const wftMatch = /WFTID\s*=\s*(\d+)(?:\.\d+)?/i.exec(block);
    const nameMatch = /Name\s*=\s*['"]([^'"]+)['"]/i.exec(block);
    const boMatch = /(?:BO|BO_NAME)\s*=\s*['"]([^'"]+)['"]/i.exec(block);
    const modMatch = /(?:Module|ModuleName)\s*=\s*['"]([^'"]+)['"]/i.exec(block);
    const soMatch = /SO\s*=\s*(\d+)/i.exec(block);

    const boName = boMatch ? boMatch[1] : undefined;
    const moduleName = modMatch ? modMatch[1] : undefined;
    const wfName = nameMatch ? nameMatch[1] : undefined;

    if (wftMatch) {
      const wfid = parseInt(wftMatch[1], 10);
      if (wfid >= 1000) {
        wfMap.set(wfid, { name: wfName, boName, moduleName });
      }
    }

    if (soMatch) {
      const soid = parseInt(soMatch[1], 10);
      if (soid >= 1000) {
        specMap.set(soid, { boName, moduleName });
      }
    }
  }

  // 1b. Contextual Event Block Extraction: e.g. |Event> ID=698609979 Name='triCreate' User=136849706 SO=173112205 BO=10006838 BO_NAME='triOption' Module=21119 ModuleName='triItem' <Event|
  const eventBlockRegex = /[\|\[]Event>\s*([^\]\<]+)[\]\<]/gi;
  let evtMatch: RegExpExecArray | null;
  while ((evtMatch = eventBlockRegex.exec(text)) !== null) {
    const block = evtMatch[1];
    const userMatch = /User\s*=\s*(\d+)/i.exec(block);
    const soMatch = /SO\s*=\s*(\d+)/i.exec(block);
    const boMatch = /(?:BO|BO_NAME)\s*=\s*['"]([^'"]+)['"]/i.exec(block);
    const modMatch = /(?:Module|ModuleName)\s*=\s*['"]([^'"]+)['"]/i.exec(block);

    if (userMatch) {
      const uid = parseInt(userMatch[1], 10);
      if (uid >= 1000) {
        userIds.add(uid);
      }
    }

    if (soMatch) {
      const soid = parseInt(soMatch[1], 10);
      if (soid >= 1000) {
        const boName = boMatch ? boMatch[1] : undefined;
        const moduleName = modMatch ? modMatch[1] : undefined;
        specMap.set(soid, { boName, moduleName });
      }
    }
  }

  // 2. Comprehensive Spec ID & Spec Object (SO=...) patterns
  const specPatterns = [
    /\bSO\s*=\s*(\d{5,12})\b/gi,
    /(?:spec_id|specId|spec\s*id|spec\s*#|record_id|recordId|record\s*#|spec\s*ID)\s*[:=]?\s*(\d{5,12})\b/gi,
    /IBS_SPEC\s+WHERE\s+SPEC_ID\s*=\s*(\d{5,12})\b/gi,
    /T_[A-Z0-9_]+\s+WHERE\s+SPEC_ID\s*=\s*(\d{5,12})\b/gi,
    /spec_id=(\d{5,12})\b/gi,
    /record\s+with\s+ID\s+(\d{5,12})\b/gi,
    /specId:\s*(\d{5,12})\b/gi,
    /WFA:id=\d+\s*-\s*(\d{5,12})\b/gi,
  ];

  for (const pattern of specPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      if (val >= 1000 && val <= 99999999999) {
        if (!specMap.has(val)) {
          specMap.set(val, {});
        }
      }
    }
  }

  // 3. User ID patterns: e.g. User=162518900
  const userPatterns = [
    /\bUser\s*=\s*(\d{5,12})\b/gi,
    /\buserId\s*[:=]?\s*(\d{5,12})\b/gi,
    /\buser_id\s*[:=]?\s*(\d{5,12})\b/gi,
  ];

  for (const pattern of userPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      if (val >= 1000 && val <= 99999999999) {
        userIds.add(val);
      }
    }
  }

  // 4. Control Number patterns (e.g. WRK-149204, TASK-58291, WO-39102, BLD-HQ01, PER-1920)
  const ctrlPatterns = [
    /\b(WRK-\d{4,8}|TASK-\d{4,8}|WO-\d{4,8}|BLD-[A-Z0-9_\-]+|FLR-\d{1,3}|SPC-\d{1,5}|AST-[A-Z0-9_\-]+|PER-\d{4,9}|REQ-\d{4,8})\b/gi,
    /triControlNum(?:ber)?\s*[:=]?\s*["']?([A-Z0-9_\-]+)["']?/gi,
  ];

  for (const pattern of ctrlPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const val = (match[1] || '').trim();
      if (val && val.length >= 4) {
        controlNumbers.add(val.toUpperCase());
      }
    }
  }

  // 5. Workflow ID & Template patterns
  const wfPatterns = [
    /\bWFTID\s*=\s*(\d{5,12})(?:\.\d+)?\b/gi,
    /(?:wfTemplateId|wf_template_id|workflow_id|workflow\s*template\s*id|workflow\s*#|wf\s*#|wfTemplate\s*id)\s*[:=]?\s*(\d{5,12})\b/gi,
    /WF_TEMPLATE\s+WHERE\s+WF_TEMPLATE_ID\s*=\s*(\d{5,12})\b/gi,
    /workflow\s+(\d{5,12})/gi,
    /wftemplateid=(\d{5,12})\b/gi,
    /WFIID\s*=\s*(\d{5,15})\b/gi,
  ];

  for (const pattern of wfPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      if (val >= 1000 && val <= 99999999999) {
        if (!wfMap.has(val)) {
          wfMap.set(val, {});
        }
      }
    }
  }

  // Build unified item list
  const items: ExtractedItem[] = [];

  // Users first (for high-visibility actor identification)
  for (const uid of userIds) {
    items.push({
      key: `user-${uid}`,
      id: String(uid),
      type: 'user',
      numericId: uid,
      label: `User #${uid}`,
      title: `TRIRIGA User / Person Spec ID #${uid}`,
      boName: 'triPeople',
      moduleName: 'triPeople',
    });
  }

  // Workflows next
  for (const [wfid, meta] of wfMap.entries()) {
    const wfLabel = meta.name 
      ? `WF #${wfid} (${meta.name.length > 28 ? meta.name.substring(0, 26) + '...' : meta.name})`
      : `WF #${wfid}`;

    items.push({
      key: `wf-${wfid}`,
      id: String(wfid),
      type: 'workflow',
      numericId: wfid,
      label: wfLabel,
      title: `TRIRIGA Workflow Template #${wfid}${meta.name ? `: ${meta.name}` : ''}${meta.boName ? ` (${meta.boName})` : ''}`,
      boName: meta.boName,
      moduleName: meta.moduleName,
      workflowName: meta.name,
    });
  }

  // Control numbers
  for (const ctrl of controlNumbers) {
    items.push({
      key: `ctrl-${ctrl}`,
      id: ctrl,
      type: 'control',
      label: ctrl,
      title: `TRIRIGA Business Record Control Number: ${ctrl}`,
    });
  }

  // Spec IDs / Records
  for (const [sid, meta] of specMap.entries()) {
    // Avoid duplicate chip if it is already displayed as a user
    if (userIds.has(sid)) continue;

    const specLabel = meta.boName && meta.boName !== '-Any-'
      ? `${meta.boName} #${sid}`
      : `Record #${sid}`;

    items.push({
      key: `spec-${sid}`,
      id: String(sid),
      type: 'spec',
      numericId: sid,
      label: specLabel,
      title: `TRIRIGA Record / Spec ID #${sid}${meta.boName ? ` [${meta.boName}]` : ''}`,
      boName: meta.boName,
      moduleName: meta.moduleName,
    });
  }

  return {
    specIds: Array.from(specMap.keys()),
    controlNumbers: Array.from(controlNumbers),
    workflowIds: Array.from(wfMap.keys()),
    userIds: Array.from(userIds),
    items,
  };
};

interface LinkedRecordChipsProps {
  text: string;
  onOpenRecord?: (identifier: string, workflowId?: number | null) => void;
  onFilterLogsByRecord?: (identifier: string) => void;
  className?: string;
  maxChips?: number;
}

// Client-side in-memory resolution caches for instant sub-millisecond hover response
const CLIENT_SPEC_CACHE = new Map<string, any>();
const CLIENT_WF_CACHE = new Map<number, any>();

export const LinkedRecordChips: React.FC<LinkedRecordChipsProps> = ({
  text,
  onOpenRecord,
  onFilterLogsByRecord,
  className = '',
  maxChips,
}) => {
  const { items } = extractRecordIdentifiersFromText(text);

  const [hoveredItem, setHoveredItem] = useState<ExtractedItem | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const [popoverData, setPopoverData] = useState<{ spec?: any; wf?: any; loading: boolean; error?: string | null }>({
    loading: false
  });
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const hoverTimeoutRef = React.useRef<any>(null);
  const closeTimeoutRef = React.useRef<any>(null);
  const activeReqIdRef = React.useRef<number>(0);

  if (items.length === 0) {
    return null;
  }

  const visibleItems = maxChips ? items.slice(0, maxChips) : items;
  const remainingCount = maxChips && items.length > maxChips ? items.length - maxChips : 0;

  const copyToClipboard = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleMouseEnterChip = (item: ExtractedItem, el: HTMLElement) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    const reqId = ++activeReqIdRef.current;

    hoverTimeoutRef.current = setTimeout(async () => {
      const rect = el.getBoundingClientRect();
      const popupWidth = 360;
      const popupHeight = 240;

      // Calculate horizontal positioning with viewport boundaries
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - popupWidth - 16);
      }

      // Determine whether to place above or below the chip
      const placeAbove = rect.top > popupHeight + 20;
      const top = placeAbove ? rect.top - 8 : rect.bottom + 8;

      setPopoverPos({ top, left, placeAbove });
      setHoveredItem(item);

      // Check client cache first
      if (item.type === 'workflow' && item.numericId) {
        if (CLIENT_WF_CACHE.has(item.numericId)) {
          setPopoverData({ wf: CLIENT_WF_CACHE.get(item.numericId), loading: false });
          return;
        }
      } else {
        const cacheKey = item.id;
        if (CLIENT_SPEC_CACHE.has(cacheKey)) {
          setPopoverData({ spec: CLIENT_SPEC_CACHE.get(cacheKey), loading: false });
          return;
        }
      }

      // Fetch live data from TRIRIGA DB via API with 3.5s timeout safety
      setPopoverData({ loading: true, error: null });

      const fetchPromise = item.type === 'workflow' && item.numericId
        ? api.resolveWorkflow(item.numericId)
        : api.resolveRecordIdentifier(item.id, false);

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Resolution timed out')), 3500)
      );

      try {
        const res: any = await Promise.race([fetchPromise, timeoutPromise]);
        if (activeReqIdRef.current === reqId) {
          if (item.type === 'workflow' && item.numericId) {
            CLIENT_WF_CACHE.set(item.numericId, res);
            setPopoverData({ wf: res, loading: false });
          } else {
            CLIENT_SPEC_CACHE.set(item.id, res);
            setPopoverData({ spec: res, loading: false });
          }
        }
      } catch (err: any) {
        if (activeReqIdRef.current === reqId) {
          setPopoverData({ loading: false, error: err.message || 'Record not found in TRIRIGA' });
        }
      }
    }, 120);
  };

  const handleMouseLeaveChip = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    closeTimeoutRef.current = setTimeout(() => {
      setHoveredItem(null);
      setPopoverPos(null);
    }, 220);
  };

  const handleMouseEnterPopover = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleMouseLeavePopover = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setHoveredItem(null);
      setPopoverPos(null);
    }, 180);
  };

  return (
    <>
      <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
        {visibleItems.map((item) => {
          let chipStyle = "bg-indigo-100 hover:bg-indigo-200 text-indigo-950 border-indigo-400 hover:border-indigo-500 dark:bg-indigo-950/80 dark:hover:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-500/50";
          let IconComp = Tag;

          if (item.type === 'user') {
            chipStyle = "bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-400 hover:border-amber-500 dark:bg-amber-950/80 dark:hover:bg-amber-900 dark:text-amber-200 dark:border-amber-500/50";
            IconComp = User;
          } else if (item.type === 'control') {
            chipStyle = "bg-cyan-100 hover:bg-cyan-200 text-cyan-950 border-cyan-400 hover:border-cyan-500 dark:bg-cyan-950/80 dark:hover:bg-cyan-900 dark:text-cyan-200 dark:border-cyan-500/50";
            IconComp = Layers;
          } else if (item.type === 'workflow') {
            chipStyle = "bg-purple-100 hover:bg-purple-200 text-purple-950 border-purple-400 hover:border-purple-500 dark:bg-purple-950/80 dark:hover:bg-purple-900 dark:text-purple-200 dark:border-purple-500/50";
            IconComp = Zap;
          }

          return (
            <button
              key={item.key}
              type="button"
              onMouseEnter={(e) => handleMouseEnterChip(item, e.currentTarget)}
              onMouseLeave={handleMouseLeaveChip}
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenRecord) {
                  onOpenRecord(item.id, item.numericId);
                } else if (onFilterLogsByRecord) {
                  onFilterLogsByRecord(item.id);
                }
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold border text-[10px] font-mono shadow-sm cursor-pointer transition-all hover:scale-105 active:scale-95 ${chipStyle}`}
              title={item.title}
            >
              <IconComp className="w-3 h-3 shrink-0 opacity-80" />
              <span className="font-bold">{item.label}</span>
            </button>
          );
        })}

        {remainingCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 text-[10px] font-mono font-semibold">
            +{remainingCount} more
          </span>
        )}
      </div>

      {/* Floating Mouseover Popup */}
      {hoveredItem && popoverPos && (
        <div
          onMouseEnter={handleMouseEnterPopover}
          onMouseLeave={handleMouseLeavePopover}
          style={{
            position: 'fixed',
            top: popoverPos.placeAbove ? undefined : `${popoverPos.top}px`,
            bottom: popoverPos.placeAbove ? `${window.innerHeight - popoverPos.top}px` : undefined,
            left: `${popoverPos.left}px`,
            zIndex: 99999,
          }}
          className="w-[370px] max-w-[calc(100vw-32px)] bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl border border-slate-300 dark:border-cyan-500/60 p-3.5 animate-scale-in text-xs font-sans pointer-events-auto backdrop-blur-md"
        >
          {popoverData.loading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-slate-500 dark:text-slate-400">
              <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium">Querying TRIRIGA DB2...</span>
            </div>
          ) : popoverData.wf && popoverData.wf.is_resolved !== false ? (
            /* Workflow Popover */
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white text-xs leading-tight">
                      {popoverData.wf.template_name || `Workflow #${popoverData.wf.wf_id}`}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      WF_TEMPLATE ID: {popoverData.wf.wf_id}
                    </div>
                  </div>
                </div>
                {popoverData.wf.event_name && (
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 dark:bg-purple-900/60 dark:text-purple-200 text-[10px] font-mono font-bold shrink-0">
                    {popoverData.wf.event_name}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {popoverData.wf.bo_name && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-[10px] text-slate-600 dark:text-slate-300 block font-semibold">Business Object</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{popoverData.wf.bo_name}</span>
                  </div>
                )}
                {popoverData.wf.execution_mode && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-[10px] text-slate-600 dark:text-slate-300 block font-semibold">Execution Mode</span>
                    <span className="font-semibold text-emerald-800 dark:text-emerald-400">{popoverData.wf.execution_mode}</span>
                  </div>
                )}
              </div>

              {popoverData.wf.description && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono">
                  {popoverData.wf.description}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(popoverData.wf.wf_id), 'id')}
                  className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 font-medium"
                >
                  <Copy className="w-3 h-3" />
                  {copiedField === 'id' ? 'Copied!' : 'Copy WF ID'}
                </button>
                {onFilterLogsByRecord && (
                  <button
                    type="button"
                    onClick={() => onFilterLogsByRecord(String(popoverData.wf.wf_id))}
                    className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-400 hover:underline font-semibold"
                  >
                    Filter Logs
                  </button>
                )}
              </div>
            </div>
          ) : popoverData.spec && popoverData.spec.is_resolved !== false ? (
            /* Spec / Record Popover */
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    popoverData.spec.module_name === 'triPeople' || popoverData.spec.email
                      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                      : popoverData.spec.module_name === 'triTask' || popoverData.spec.task_type
                        ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                        : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                  }`}>
                    {popoverData.spec.module_name === 'triPeople' || popoverData.spec.email ? (
                      <User className="w-4 h-4" />
                    ) : popoverData.spec.module_name === 'triTask' || popoverData.spec.task_type ? (
                      <Wrench className="w-4 h-4" />
                    ) : (
                      <Tag className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white text-xs leading-tight">
                      {popoverData.spec.spec_name || `Record #${popoverData.spec.spec_id}`}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      {popoverData.spec.control_number && <span>Ctrl: {popoverData.spec.control_number}</span>}
                      {popoverData.spec.spec_id && <span>Spec ID: {popoverData.spec.spec_id}</span>}
                    </div>
                  </div>
                </div>
                {popoverData.spec.status && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 dark:bg-emerald-950/80 dark:text-emerald-300 text-[10px] font-mono font-bold shrink-0">
                    {popoverData.spec.status}
                  </span>
                )}
              </div>

              {/* Attributes List */}
              <div className="space-y-1.5 text-[11px]">
                {popoverData.spec.email && (
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email:
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(popoverData.spec.email, 'email')}
                      className="font-mono text-cyan-700 dark:text-cyan-300 hover:underline flex items-center gap-1 font-semibold"
                    >
                      {popoverData.spec.email}
                      {copiedField === 'email' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-2.5 h-2.5 opacity-60" />}
                    </button>
                  </div>
                )}

                {popoverData.spec.job_title && (
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> Title:
                    </span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{popoverData.spec.job_title}</span>
                  </div>
                )}

                {popoverData.spec.department && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60 text-[10px]">
                    <span className="text-slate-600 dark:text-slate-300 block font-semibold">Organization:</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200 truncate block">{popoverData.spec.department}</span>
                  </div>
                )}

                {popoverData.spec.task_type && (
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">Task Type:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{popoverData.spec.task_type}</span>
                  </div>
                )}

                {popoverData.spec.priority && (
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">Priority:</span>
                    <span className="font-semibold text-amber-700 dark:text-amber-300">{popoverData.spec.priority}</span>
                  </div>
                )}

                {popoverData.spec.location && (
                  <div className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/60 text-[10px]">
                    <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1 font-semibold">
                      <MapPin className="w-3 h-3" /> Location:
                    </span>
                    <span className="text-slate-800 dark:text-slate-200 block truncate">{popoverData.spec.location}</span>
                  </div>
                )}

                {popoverData.spec.description && (
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded border border-slate-200 dark:border-slate-700/60 text-[10px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-20 overflow-y-auto font-mono">
                    {popoverData.spec.description}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => copyToClipboard(popoverData.spec.control_number || String(popoverData.spec.spec_id), 'id')}
                  className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 font-medium"
                >
                  <Copy className="w-3 h-3" />
                  {copiedField === 'id' ? 'Copied!' : 'Copy ID'}
                </button>
                {onFilterLogsByRecord && (
                  <button
                    type="button"
                    onClick={() => onFilterLogsByRecord(popoverData.spec.control_number || String(popoverData.spec.spec_id))}
                    className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-400 hover:underline font-semibold"
                  >
                    Filter Logs
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2 space-y-2 text-center">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {hoveredItem?.type === 'workflow' ? 'Workflow Template' : 'TRIRIGA Record'} #{hoveredItem?.id}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                No active database record found in IBS_SPEC or WF_TEMPLATE for this identifier (may be a transaction ID or temporary event).
              </p>
              {onFilterLogsByRecord && (
                <button
                  type="button"
                  onClick={() => onFilterLogsByRecord(hoveredItem?.id || '')}
                  className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
                >
                  Filter Logs for #{hoveredItem?.id}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
