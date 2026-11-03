import React from 'react';

export interface CardSparklineProps {
  data: number[];
  color: string;
  height?: number;
  unit?: string;
  width?: number;
  showFooter?: boolean;
}

export const CardSparkline: React.FC<CardSparklineProps> = ({
  data,
  color,
  height = 24,
  unit,
  width = 100,
  showFooter = true,
}) => {
  if (!data || data.length === 0) return null;
  const points = data.length === 1 ? [data[0], data[0]] : data;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const diff = max - min;
  const range = diff === 0 ? (max === 0 ? 1 : max * 0.2) : diff;

  const padding = 2;
  const usableHeight = Math.max(4, height - padding * 2);

  const coordinates = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${coordinates.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const gradId = `spark-${color.replace('#', '')}-${points.length}-${Math.round(min)}-${Math.round(max)}`;

  const latest = points[points.length - 1];
  const first = points[0];
  const delta = latest - first;

  return (
    <div className="w-full mt-2 pt-1.5 border-t border-slate-800/80">
      {showFooter && (
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5 font-mono">
          <span className="text-[9px] uppercase tracking-wider text-slate-500 font-sans">Cadence</span>
          <span className="text-slate-400">
            {latest}{unit ? ` ${unit}` : ''}
            {points.length > 2 && (
              <span className={`ml-1 ${delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                ({delta > 0 ? `+${delta}` : `${delta}`})
              </span>
            )}
          </span>
        </div>
      )}
      <svg className="w-full overflow-visible" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.length > 0 && (
          <circle
            cx={coordinates[coordinates.length - 1].split(',')[0]}
            cy={coordinates[coordinates.length - 1].split(',')[1]}
            r="2"
            fill={color}
          />
        )}
      </svg>
    </div>
  );
};
