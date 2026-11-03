# TRIRIGA Log Analysis & Forensics SPA — Style & UX Specification

> **Living Style Guide & UX Architecture Reference**  
> Documents the CSS design system, typography, color palette, dark/light theme mechanics, JavaScript layout controllers, Recharts theming, and component UX patterns that power the TRIRIGA Log Analysis & Forensics Single-Page Application (SPA).

---

## 1. Design Philosophy & UX Principles

1. **High-Density Forensic Cockpit**: Designed for enterprise SREs and TRIRIGA platform engineers investigating millions of log lines across multi-server clusters. High data density without visual clutter.
2. **Dark-First with Bulletproof Day Mode**: Defaults to a low-fatigue, slate/cyan dark mode with vibrant status accents. Includes an engineered, high-contrast Day/Light Mode that avoids washed-out text and guarantees crisp legibility (`#0f172a` ink on `#ffffff` surfaces).
3. **Fixed Viewport Shell with Independent Panes**: The outer application window never scrolls (`100vw × 100vh`). Content scrolling is partitioned into dedicated layout regions (resizable sidebar, main content container, data grids).
4. **Immediate Forensic Clarity**: Color is semantic and unambiguous. Errors are crimson/rose, warnings are amber, AI reasoning is indigo, operational metrics are emerald, and active selections are cyan/sky.
5. **High-Contrast Copy & Export**: Custom selection highlights (`::selection`) ensure that selecting and copying stack traces or log lines never obscures timestamps, log levels, or thread names.

---

## 2. Technology & Asset Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | React + TypeScript | 18.3.1 / 5.7.3 | Component architecture & state management |
| **Build & Bundler** | Vite | 6.1.0+ | Fast HMR and Rollup production asset optimization |
| **CSS Engine** | Tailwind CSS | 3.4.17 | Utility-first styling with PostCSS & Autoprefixer |
| **Icons** | Lucide React | 0.475.0 | Clean, modern, unified SVG iconography (14px – 20px) |
| **Data Visualization** | Recharts | 2.15.1 | Responsive Area charts, timelines, and cluster trend graphs |
| **Markdown & Formatting** | React Markdown + Remark GFM | 9.0.3 / 4.0.0 | Rendering AI forensic audit reports and rich chat diagnostics |
| **Class Utilities** | `clsx` + `tailwind-merge` | 2.1.1 / 2.6.0 | Conditional class name resolution |

---

## 3. Typography & Font System

### 3.1 Font Families

```html
<!-- Loaded via Google Fonts in index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

- **Primary UI Font**: `Inter, system-ui, -apple-system, sans-serif`  
  - Font features enabled in CSS: `font-feature-settings: "cv02", "cv03", "cv04", "cv11";` (disambiguates `1`, `I`, `l`, and open zero `0`).
- **Code, Timestamps & Log Font**: `'JetBrains Mono', monospace`  
  - Used for log lines, stack traces, SQL queries, thread IDs, Spec IDs, and LLM reasoning streams.

### 3.2 Typography Scale

| Token / Class | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `text-[10px]` | 10px / 0.625rem | Medium (500) | 1.2 | Badges, character counts, status tags |
| `text-xs` | 12px / 0.75rem | Normal / Semibold | 1.4 | Body text, tables, buttons, inputs, form labels |
| `text-sm` | 14px / 0.875rem | Medium / Semibold | 1.5 | Navigation items, card titles, subheadings |
| `text-base` | 16px / 1.0rem | Semibold (600) | 1.5 | Section headers, modal titles |
| `text-lg` | 18px / 1.125rem | Bold (700) | 1.3 | Top-level application header, main KPI numbers |
| `text-xl` – `text-2xl` | 20px – 24px | Extra Bold (800) | 1.25 | Audit report major headings (`# H1`) |

---

## 4. Color Palette & Theme Tokens

### 4.1 Base Foundation (Dark Mode — Default)

```css
/* Dark Mode Base Tokens */
--bg-root:         #020617; /* Tailwind slate-950 */
--bg-surface:      #0f172a; /* Tailwind slate-900 */
--bg-surface-alt:  #1e293b; /* Tailwind slate-800 */
--border-subtle:   #1e293b; /* Tailwind slate-800 */
--border-medium:   #334155; /* Tailwind slate-700 */
--text-primary:    #f8fafc; /* Tailwind slate-100 / slate-50 */
--text-secondary:  #cbd5e1; /* Tailwind slate-300 (high-contrast overridden) */
--text-muted:      #94a3b8; /* Tailwind slate-400 (high-contrast overridden) */
```

### 4.2 Base Foundation (Light / Day Mode — `.theme-light`)

```css
/* Light Mode Base Tokens */
--bg-root:         #f8fafc; /* Tailwind slate-50 */
--bg-surface:      #ffffff; /* Pure white card surface */
--bg-surface-alt:  #f1f5f9; /* Tailwind slate-100 */
--border-subtle:   #cbd5e1; /* Tailwind slate-300 */
--border-medium:   #94a3b8; /* Tailwind slate-400 */
--text-primary:    #0f172a; /* Tailwind slate-900 (deep black-slate ink) */
--text-secondary:  #1e293b; /* Tailwind slate-800 */
--text-muted:      #334155; /* Tailwind slate-700 */
```

### 4.3 Semantic Severity & Accent Tokens

| Role | Dark Mode Value | Light Mode Value | Tailwind Classes |
| :--- | :--- | :--- | :--- |
| **Primary Brand (Cyan / Sky)** | `#38bdf8` / `#0284c7` | `#0284c7` / `#0369a1` | `text-cyan-400`, `bg-cyan-500/20`, `border-cyan-500/30` |
| **AI Reasoning (Indigo)** | `#818cf8` / `#6366f1` | `#312e81` / `#4f46e5` | `text-indigo-300`, `bg-indigo-950/40`, `border-indigo-500/30` |
| **Error / Critical (Rose)** | `#f43f5e` / `#fb7185` | `#b91c1c` / `#dc2626` | `text-rose-400`, `bg-rose-500/10`, `border-rose-500/20` |
| **Warning / Caution (Amber)**| `#fbbf24` / `#f59e0b` | `#92400e` / `#d97706` | `text-amber-400`, `bg-amber-500/10`, `border-amber-500/20` |
| **Success / Operational (Emerald)**| `#34d399` / `#10b981` | `#047857` / `#059669` | `text-emerald-400`, `bg-emerald-500/10`, `border-emerald-500/20` |
| **Info / Notification (Sky)**| `#38bdf8` / `#0ea5e9` | `#0369a1` / `#0284c7` | `text-sky-400`, `bg-sky-500/10`, `border-sky-500/20` |

### 4.4 High-Contrast Copy & Selection Highlight

```css
/* Vibrant Cyan Selection in Dark Mode */
::selection {
  background-color: #0284c7 !important;
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff !important;
}

/* Crisp Sky-200 with Dark Ink in Light Mode */
body.theme-light ::selection {
  background-color: #bae6fd !important;
  color: #0f172a !important;
  -webkit-text-fill-color: #0f172a !important;
}
```

---

## 5. Layout Architecture & JavaScript Controllers

```
+------------------------------------------------------------------------------------+
|  HEADER (Fixed 64px, z-30, backdrop-blur-md, Logo, Navigation Tabs, Actions)       |
+--------------------------------------------------+---------------------------------+
|  PERSISTENT AI CHAT SIDEBAR                      |  SCROLLABLE MAIN CONTENT        |
|  - Width: Draggable 500px to 25% viewport        |  - Dashboard                    |
|  - Streamed tokens + collapsible reasoning       |  - Server Manager               |
|  - SSE abort controls                            |  - Log Sync & Ingestion         |
|  - Draggable right handle (cursor-col-resize)    |  - Amalgamated Log Explorer     |
|                                                  |  - DB2 SQL Query Tool           |
|                                                  |  - Local LLM Log Analysis       |
|                                                  |  - Settings                     |
+--------------------------------------------------+---------------------------------+
```

### 5.1 Root Fixed Container (`App.tsx`)

```tsx
<div 
  style={{ 
    position: 'fixed', 
    inset: 0, 
    width: '100vw', 
    height: '100vh', 
    maxHeight: '100vh', 
    overflow: 'hidden', 
    display: 'flex', 
    flexDirection: 'column' 
  }} 
  className="bg-slate-950 text-slate-100 select-text transition-colors duration-200"
>
```

### 5.2 Draggable Resizable Sidebar Engine

The chat sidebar is dynamically resizable via window mouse listeners while preventing text selection during dragging:

```typescript
const [sidebarWidth, setSidebarWidth] = useState(() => {
  const minW = 500;
  const maxW = Math.max(500, window.innerWidth * 0.25);
  return Math.max(minW, Math.min(window.innerWidth * 0.25, maxW));
});
const [isResizing, setIsResizing] = useState(false);

useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const minW = 500;
    const maxW = Math.max(500, window.innerWidth * 0.25);
    const clamped = Math.max(minW, Math.min(e.clientX, maxW));
    setSidebarWidth(clamped);
  };
  const handleMouseUp = () => setIsResizing(false);
  if (isResizing) {
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
}, [isResizing]);
```

### 5.3 Theme Toggle Controller

Theme mode defaults to `'light'` (Day Mode) and is persisted in `localStorage` (`tririga_theme`). Explicit user switches are tracked via `tririga_theme_user_set` and synchronized to `classList` on both `document.body` and `document.documentElement`:

```typescript
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
```

---

## 6. UI Component Design Specifications

### 6.1 Header Bar & Navigation

- **Dimensions**: `height: 4rem` (`h-16`), `px-4 sm:px-6 lg:px-8`.
- **Surface**: `bg-slate-900/90 backdrop-blur-md border-b border-slate-800`.
- **Nav Buttons**:
  - Regular Active: `bg-slate-800 text-white border border-slate-700`
  - Inactive: `text-slate-400 hover:bg-slate-800/60 hover:text-slate-200`
  - LLM Analysis (Highlighted Active): `bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10`
  - Badges: `text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700`

### 6.2 Filter Bars & Date Range Selectors

- **Containers**: `rounded-2xl bg-slate-900/80 border border-slate-800 p-4`
- **Date Presets**: `ALL`, `30M`, `1H`, `6H`, `24H`, `TODAY`, `7D`, `30D`, `CUSTOM`
- **Preset Pill Style**:
  - Active: `bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold`
  - Inactive: `bg-slate-800 text-slate-400 border border-slate-700 hover:text-white`
- **Custom Date Inputs**:
  - `bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-1.5 focus:border-cyan-500 focus:outline-none`

### 6.3 Severity Badges & Status Indicators

```tsx
// Error Badge
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
  <ShieldAlert className="w-3 h-3 text-rose-400 animate-pulse" />
  ERROR
</span>

// Warning Badge
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
  <AlertTriangle className="w-3 h-3 text-amber-400" />
  WARN
</span>

// Operational / Healthy
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
  Operational
</span>
```

### 6.4 AI Reasoning & Thought Process Accordion

Used in both the Live Report Generator and Interactive Chat to reveal the model's inner reasoning (`liveThought` / `msg.thought`):

```tsx
<div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden shadow-inner">
  <div 
    onClick={() => setShowThought(prev => !prev)}
    className="flex items-center justify-between px-4 py-2.5 bg-indigo-900/30 cursor-pointer hover:bg-indigo-900/40 transition-colors select-none"
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
    <div className="p-4 text-xs font-mono text-indigo-200/90 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed border-t border-indigo-500/20 bg-slate-950/60">
      {liveThought}
    </div>
  )}
</div>
```

### 6.5 Interactive Chat Bubbles

- **User Message**:
  - Container: `bg-cyan-600 text-white rounded-2xl rounded-tr-none px-4 py-3 text-xs shadow-md`
- **Assistant Message**:
  - Avatar: `w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0`
  - Container: `bg-slate-800/80 text-slate-200 border border-slate-700/80 rounded-2xl rounded-tl-none px-4 py-3 text-xs leading-relaxed space-y-2`

### 6.6 Markdown & Prose Styling (`.prose`)

The application formats LLM diagnostic outputs via GitHub-flavored Markdown with customized typography in `src/index.css`:

- **Line Height**: `1.8` for dense readability.
- **Headings**:
  - `h1`: `1.5rem`, `font-extrabold`, bottom border in slate-400/20 (`border-b border-slate-400/20`).
  - `h2`: `1.25rem`, `font-bold`, color `#38bdf8` (Cyan), bottom border in cyan-400/20.
  - `h3`: `1.05rem`, `font-bold`, color `#7dd3fc`.
  - `h4`: `0.95rem`, `font-semibold`, color `#93c5fd`.
- **Blockquotes**: `border-l-4 border-cyan-400 bg-slate-900/60 px-5 py-3 rounded-r-lg`.
- **Code Blocks (`pre`)**: Background `#020617`, border `#1e293b`, font `JetBrains Mono`, padding `1rem`, rounded `0.75rem`.

---

## 7. Recharts Visualization Specification

Cluster timeline charts use SVG gradients and dynamic tooltip containers that automatically adapt to light and dark themes:

```tsx
<ResponsiveContainer width="100%" height={260}>
  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
    <defs>
      <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
      </linearGradient>
      <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
      </linearGradient>
    </defs>
    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
    <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} />
    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
    <Tooltip content={<CustomChartTooltip />} />
    <Area type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#totalGrad)" name="Total Entries" />
    <Area type="monotone" dataKey="errors" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#errorGrad)" name="Errors / Warnings" />
  </AreaChart>
</ResponsiveContainer>
```

### High-Contrast Chart Tooltip CSS

```css
/* Dark Mode Tooltip */
body:not(.theme-light) .custom-chart-tooltip,
body:not(.theme-light) .recharts-default-tooltip {
  background-color: #0f172a !important;
  border: 1px solid #334155 !important;
  color: #f8fafc !important;
  border-radius: 0.75rem !important;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6) !important;
}

/* Light Mode Tooltip */
body.theme-light .custom-chart-tooltip,
body.theme-light .recharts-default-tooltip {
  background-color: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  color: #0f172a !important;
  border-radius: 0.75rem !important;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15) !important;
}
```

---

## 8. Scrollbar & Micro-Interaction Tokens

### 8.1 Custom WebKit Scrollbars

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: #0f172a;
}
::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

/* Light mode scrollbar track & thumb */
body.theme-light ::-webkit-scrollbar-track {
  background: #f1f5f9;
}
body.theme-light ::-webkit-scrollbar-thumb {
  background: #cbd5e1;
}
body.theme-light ::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
```

### 8.2 Micro-Interactions & Animation Utilities

| Utility | Description | Use Case |
| :--- | :--- | :--- |
| `animate-pulse` | Subtle opacity breathing | Active live diagnostics, streaming indicators, error alerts |
| `animate-spin` | Infinite 360-degree rotation | Ingestion loading spinner, active audit generation |
| `animate-ping` | Radiating radar ping dot | Live SSE incoming token heartbeat |
| `cursor-col-resize` | Column divider resize cursor | Chat sidebar width adjuster handle |
| `transition-all` | 150ms–200ms ease transition | Button hover states, tab switching, card elevation |

---

## 9. Reusable Button & Input Cheat Sheet

### Primary Action Button (Gradient Cyan/Indigo)
```tsx
<button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-md shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50">
  <Play className="w-3.5 h-3.5" />
  <span>Execute Action</span>
</button>
```

### Secondary Action Button (Slate Surface)
```tsx
<button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs border border-slate-700 cursor-pointer transition-all">
  <Copy className="w-3.5 h-3.5" />
  <span>Copy</span>
</button>
```

### Destructive / Stop Action Button (Rose)
```tsx
<button className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold shadow-md shadow-rose-600/10 cursor-pointer transition-all">
  <Square className="w-3.5 h-3.5 fill-current" />
  <span>Stop</span>
</button>
```

### Search / Filter Text Input
```tsx
<input 
  type="text" 
  placeholder="Search logs, thread names, or Spec IDs..." 
  className="w-full px-4 py-2 rounded-xl bg-slate-800/90 border border-slate-700 text-white text-xs placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
/>
```
