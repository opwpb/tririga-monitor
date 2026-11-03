import React from 'react';

export function TabLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse p-4">
      {/* Header bar skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 bg-slate-800/80 rounded-lg w-48" />
          <div className="h-4 bg-slate-800/40 rounded-lg w-72" />
        </div>
        <div className="h-9 bg-slate-800/60 rounded-xl w-32" />
      </div>

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 bg-slate-800/40 rounded-xl border border-slate-800/60 p-4 space-y-3">
            <div className="h-4 bg-slate-700/40 rounded w-1/2" />
            <div className="h-8 bg-slate-700/60 rounded w-3/4" />
          </div>
        ))}
      </div>

      {/* Content panel skeleton */}
      <div className="h-96 bg-slate-800/30 rounded-2xl border border-slate-800/60 p-6 space-y-4">
        <div className="h-5 bg-slate-700/40 rounded w-1/3" />
        <div className="h-64 bg-slate-800/20 rounded-xl" />
      </div>
    </div>
  );
}
