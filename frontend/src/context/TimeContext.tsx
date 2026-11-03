import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';

export type TimeMode = 'server' | 'local';

export interface FormattedTimeResult {
  date: string;
  time: string;
  full: string;
  raw: string;
  alternateFull: string;
  isLocal: boolean;
  mode: TimeMode;
  tzBadge: string;
  dayName: string;
  dayDate: string;
  fullDateWithDay: string;
}

export interface DateRangeResult {
  start?: string;
  end?: string;
}

export interface TimeContextValue {
  timeMode: TimeMode;
  setTimeMode: (mode: TimeMode) => void;
  toggleTimeMode: () => void;
  localTzInfo: {
    fullTz: string;
    shortTz: string;
    offsetStr: string;
  };
  formatDisplayTime: (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ) => FormattedTimeResult;
  formatShortTimestamp: (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ) => string;
  formatDateWithDay: (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ) => string;
  getDateRangeForPreset: (
    preset: string,
    customStart?: string,
    customEnd?: string,
    overrideMode?: TimeMode,
    customStartTime?: string,
    customEndTime?: string
  ) => DateRangeResult;
}

const TimeContext = createContext<TimeContextValue | undefined>(undefined);

const TIME_STORAGE_KEY = 'tririga_time_display_mode';
const LEGACY_STORAGE_KEY = 'tririga_log_time_mode';

export const TimeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [timeMode, setTimeModeState] = useState<TimeMode>(() => {
    try {
      const saved = localStorage.getItem(TIME_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      return (saved === 'local' || saved === 'server') ? saved : 'server';
    } catch {
      return 'server';
    }
  });

  const setTimeMode = (mode: TimeMode) => {
    setTimeModeState(mode);
    try {
      localStorage.setItem(TIME_STORAGE_KEY, mode);
      localStorage.setItem(LEGACY_STORAGE_KEY, mode);
    } catch {}
  };

  const toggleTimeMode = () => {
    setTimeMode(timeMode === 'server' ? 'local' : 'server');
  };

  // Local Timezone inspection
  const localTzInfo = useMemo(() => {
    try {
      const d = new Date();
      const offsetMinutes = -d.getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const absOffset = Math.abs(offsetMinutes);
      const hours = Math.floor(absOffset / 60);
      const mins = absOffset % 60;
      const offsetStr = `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

      let fullTz = 'Local';
      let shortTz = offsetStr;
      try {
        const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timeZoneName) {
          fullTz = timeZoneName;
          const parts = timeZoneName.split('/');
          shortTz = parts[parts.length - 1].replace(/_/g, ' ');
        }
      } catch {}

      return { fullTz, shortTz, offsetStr };
    } catch {
      return { fullTz: 'Local', shortTz: 'Local', offsetStr: 'Local' };
    }
  }, []);

  // Format any timestamp to Server Time (UTC) or Local Time
  const formatDisplayTime = (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ): FormattedTimeResult => {
    const activeMode = overrideMode || timeMode;
    if (!ts) {
      return {
        date: '',
        time: '',
        full: '—',
        raw: '',
        alternateFull: '—',
        isLocal: activeMode === 'local',
        mode: activeMode,
        tzBadge: activeMode === 'server' ? 'UTC' : localTzInfo.shortTz,
        dayName: '',
        dayDate: '',
        fullDateWithDay: '',
      };
    }

    try {
      let dateObj: Date;
      let rawStr = '';

      if (ts instanceof Date) {
        dateObj = ts;
        rawStr = ts.toISOString();
      } else if (typeof ts === 'number') {
        dateObj = new Date(ts);
        rawStr = String(ts);
      } else {
        rawStr = String(ts).trim();
        let parseable = rawStr;
        
        // Handle common TRIRIGA DB2 formats like "2026-09-10 23:55:33.247"
        if (parseable.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)) {
          // If no timezone specified, treat as UTC server time
          parseable = parseable.replace(' ', 'T') + 'Z';
        } else if (parseable.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) && !parseable.includes('Z') && !parseable.includes('+')) {
          parseable = parseable + 'Z';
        }
        dateObj = new Date(parseable);
      }

      if (isNaN(dateObj.getTime())) {
        return {
          date: rawStr,
          time: '',
          full: rawStr,
          raw: rawStr,
          alternateFull: rawStr,
          isLocal: activeMode === 'local',
          mode: activeMode,
          tzBadge: activeMode === 'server' ? 'UTC' : localTzInfo.shortTz,
          dayName: '',
          dayDate: rawStr,
          fullDateWithDay: rawStr,
        };
      }

      const pad = (n: number, z = 2) => String(n).padStart(z, '0');

      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // Server (UTC) representation
      const sYear = dateObj.getUTCFullYear();
      const sMonth = pad(dateObj.getUTCMonth() + 1);
      const sDay = pad(dateObj.getUTCDate());
      const sHours = pad(dateObj.getUTCHours());
      const sMins = pad(dateObj.getUTCMinutes());
      const sSecs = pad(dateObj.getUTCSeconds());
      const sMs = pad(dateObj.getUTCMilliseconds(), 3);
      const sWeekday = weekdays[dateObj.getUTCDay()];
      const sMonthName = months[dateObj.getUTCMonth()];
      const sDayDate = `${sWeekday} ${sDay} ${sMonthName}`;
      const sFullDateWithDay = `${sWeekday} ${sDay} ${sMonthName} ${sYear}`;

      const serverDate = `${sYear}-${sMonth}-${sDay}`;
      const serverTime = `${sHours}:${sMins}:${sSecs}`;
      const serverFull = `${serverDate} ${serverTime}.${sMs} UTC`;

      // Local timezone representation
      const lYear = dateObj.getFullYear();
      const lMonth = pad(dateObj.getMonth() + 1);
      const lDay = pad(dateObj.getDate());
      const lHours = pad(dateObj.getHours());
      const lMins = pad(dateObj.getMinutes());
      const lSecs = pad(dateObj.getSeconds());
      const lMs = pad(dateObj.getMilliseconds(), 3);
      const lWeekday = weekdays[dateObj.getDay()];
      const lMonthName = months[dateObj.getMonth()];
      const lDayDate = `${lWeekday} ${lDay} ${lMonthName}`;
      const lFullDateWithDay = `${lWeekday} ${lDay} ${lMonthName} ${lYear}`;

      const localDate = `${lYear}-${lMonth}-${lDay}`;
      const localTime = `${lHours}:${lMins}:${lSecs}`;
      const localFull = `${localDate} ${localTime}.${lMs} (${localTzInfo.shortTz})`;

      if (activeMode === 'local') {
        return {
          date: localDate,
          time: localTime,
          full: localFull,
          raw: rawStr,
          alternateFull: serverFull,
          isLocal: true,
          mode: 'local',
          tzBadge: localTzInfo.shortTz,
          dayName: lWeekday,
          dayDate: lDayDate,
          fullDateWithDay: lFullDateWithDay,
        };
      } else {
        return {
          date: serverDate,
          time: serverTime,
          full: serverFull,
          raw: rawStr,
          alternateFull: localFull,
          isLocal: false,
          mode: 'server',
          tzBadge: 'UTC',
          dayName: sWeekday,
          dayDate: sDayDate,
          fullDateWithDay: sFullDateWithDay,
        };
      }
    } catch {
      const fallbackStr = String(ts);
      return {
        date: fallbackStr,
        time: '',
        full: fallbackStr,
        raw: fallbackStr,
        alternateFull: fallbackStr,
        isLocal: activeMode === 'local',
        mode: activeMode,
        tzBadge: activeMode === 'server' ? 'UTC' : localTzInfo.shortTz,
        dayName: '',
        dayDate: fallbackStr,
        fullDateWithDay: fallbackStr,
      };
    }
  };

  const formatShortTimestamp = (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ): string => {
    const res = formatDisplayTime(ts, overrideMode);
    if (!res.date && !res.time) return '—';
    return `${res.date} ${res.time}`;
  };

  const formatDateWithDay = (
    ts?: string | number | Date | null,
    overrideMode?: TimeMode
  ): string => {
    const res = formatDisplayTime(ts, overrideMode);
    return res.fullDateWithDay || res.date || '—';
  };

  const getDateRangeForPreset = (
    preset: string,
    customStart?: string,
    customEnd?: string,
    overrideMode?: TimeMode,
    customStartTime?: string,
    customEndTime?: string
  ): DateRangeResult => {
    const activeMode = overrideMode || timeMode;
    const now = new Date();

    if (preset === '30M') {
      const past30m = new Date(now.getTime() - 30 * 60 * 1000);
      return { start: past30m.toISOString(), end: now.toISOString() };
    }
    if (preset === '1H') {
      const past1h = new Date(now.getTime() - 60 * 60 * 1000);
      return { start: past1h.toISOString(), end: now.toISOString() };
    }
    if (preset === '6H') {
      const past6h = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      return { start: past6h.toISOString(), end: now.toISOString() };
    }
    if (preset === '24H') {
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { start: past24h.toISOString(), end: now.toISOString() };
    }
    if (preset === '7D') {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start: past7d.toISOString(), end: now.toISOString() };
    }
    if (preset === '30D') {
      const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start: past30d.toISOString(), end: now.toISOString() };
    }
    if (preset === 'TODAY') {
      if (activeMode === 'server') {
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const utcTodayStr = `${yyyy}-${mm}-${dd}`;
        return { start: `${utcTodayStr}T00:00:00.000Z`, end: `${utcTodayStr}T23:59:59.999Z` };
      } else {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        return { start: startOfDay.toISOString(), end: endOfDay.toISOString() };
      }
    }
    if (preset === 'CUSTOM') {
      if (!customStart && !customEnd) return { start: undefined, end: undefined };
      let s: string | undefined = undefined;
      let e: string | undefined = undefined;

      if (customStart) {
        if (customStart.includes('T')) {
          s = new Date(customStart).toISOString();
        } else {
          const startTimeParts = (customStartTime || '00:00:00').split(':').map(Number);
          const hr = !isNaN(startTimeParts[0]) ? startTimeParts[0] : 0;
          const min = !isNaN(startTimeParts[1]) ? startTimeParts[1] : 0;
          const sec = !isNaN(startTimeParts[2]) ? startTimeParts[2] : 0;
          const hh = String(hr).padStart(2, '0');
          const mm = String(min).padStart(2, '0');
          const ss = String(sec).padStart(2, '0');

          if (activeMode === 'server') {
            s = `${customStart}T${hh}:${mm}:${ss}.000Z`;
          } else {
            const [yr, mo, da] = customStart.split('-').map(Number);
            s = new Date(yr, mo - 1, da, hr, min, sec, 0).toISOString();
          }
        }
      }

      if (customEnd) {
        if (customEnd.includes('T')) {
          e = new Date(customEnd).toISOString();
        } else {
          const endTimeParts = (customEndTime || '23:59:59').split(':').map(Number);
          const hr = !isNaN(endTimeParts[0]) ? endTimeParts[0] : 23;
          const min = !isNaN(endTimeParts[1]) ? endTimeParts[1] : 59;
          const sec = !isNaN(endTimeParts[2]) ? endTimeParts[2] : 59;
          const hh = String(hr).padStart(2, '0');
          const mm = String(min).padStart(2, '0');
          const ss = String(sec).padStart(2, '0');

          if (activeMode === 'server') {
            e = `${customEnd}T${hh}:${mm}:${ss}.999Z`;
          } else {
            const [yr, mo, da] = customEnd.split('-').map(Number);
            e = new Date(yr, mo - 1, da, hr, min, sec, 999).toISOString();
          }
        }
      }
      return { start: s, end: e };
    }
    return { start: undefined, end: undefined };
  };

  const value: TimeContextValue = {
    timeMode,
    setTimeMode,
    toggleTimeMode,
    localTzInfo,
    formatDisplayTime,
    formatShortTimestamp,
    formatDateWithDay,
    getDateRangeForPreset,
  };

  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
};

export const useTimeContext = (): TimeContextValue => {
  const ctx = useContext(TimeContext);
  if (!ctx) {
    throw new Error('useTimeContext must be used within a TimeProvider');
  }
  return ctx;
};
