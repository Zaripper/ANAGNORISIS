import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@anagnorisis/shared';
import { ChevronsLeft, ChevronsRight, LogOut, Search } from 'lucide-react';
import {
  HOME_ICON,
  HOME_SCREEN,
  MODULE_META,
  SCREEN_GROUPS,
  ScreenDef,
  ScreenGroup,
  ScreenId,
  getScreen,
  searchScreens,
  visibleScreens
} from '../ui/navigation';

/**
 * Application chrome, modelled on modern ERP shells (icon rail + contextual panel):
 *
 *  ┌────┬────────────┬──────────────────────────────┐
 *  │rail│ module     │ topbar (breadcrumb · search)  │
 *  │    │ panel      ├──────────────────────────────┤
 *  │    │ (screens   │ animated screen container     │
 *  │    │  of active │                               │
 *  │    │  module)   │                               │
 *  └────┴────────────┴──────────────────────────────┘
 *
 * The rail shows ~9 business modules; the panel shows only the active module's
 * screens (≤9 each). This replaces the previous single flat sidebar of 60
 * entries. Ctrl+K still jumps anywhere by name.
 */

export function DjemroudLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="currentColor">
        <path d="M100 95 C80 60, 45 60, 45 85 C45 105, 80 100, 100 95 Z" />
        <path d="M95 100 C60 80, 60 45, 85 45 C105 45, 100 80, 95 100 Z" />
        <path d="M105 100 C140 80, 140 45, 115 45 C95 45, 100 80, 105 100 Z" />
        <path d="M100 95 C120 60, 155 60, 155 85 C155 105, 120 100, 100 95 Z" />
        <path d="M95 100 C60 120, 60 155, 85 155 C105 155, 100 120, 95 100 Z" />
        <path d="M100 105 C80 140, 45 140, 45 115 C45 95, 80 100, 100 105 Z" />
        <path d="M105 100 C140 120, 140 155, 115 155 C95 155, 100 120, 105 100 Z" />
        <path d="M100 105 C120 140, 155 140, 155 115 C155 95, 120 100, 100 105 Z" />
        <path d="M100 110 Q98 150 102 170" stroke="currentColor" strokeWidth="6" strokeLinecap="round" fill="none" />
        <path d="M99 140 Q85 135 78 125 Q90 125 99 140 Z" />
        <path d="M101 145 Q115 140 122 130 Q110 130 101 145 Z" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Command palette (Ctrl+K)
// ---------------------------------------------------------------------------
function CommandPalette({
  role,
  onSelect,
  onClose
}: {
  role: UserRole | undefined;
  onSelect: (id: ScreenId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchScreens(query, role).slice(0, 40), [query, role]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = results[active];
        if (pick) {
          onSelect(pick.id);
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, active, onSelect, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-start justify-center z-[70] p-4 pt-[12vh] anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl flex flex-col overflow-hidden anim-pop">
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aller à un écran… (ex: caisse, tva, dépôts)"
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="text-[10px] font-mono bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-8 text-center text-slate-400 text-xs">Aucun écran ne correspond à « {query} ».</div>}
          {results.map((s, i) => {
            const Icon = MODULE_META[s.group].icon;
            return (
              <div
                key={s.id}
                data-index={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
                className={`px-4 py-2 flex items-center gap-3 cursor-pointer ${i === active ? 'bg-[#0F5B38]/8' : ''}`}
              >
                <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 truncate">{s.label}</div>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">{s.group}</span>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 flex gap-3 text-[10px] text-slate-400">
          <span><kbd className="font-mono">↑↓</kbd> naviguer</span>
          <span><kbd className="font-mono">⏎</kbd> ouvrir</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon rail (modules)
// ---------------------------------------------------------------------------
function Rail({
  activeModule,
  isHome,
  onModule,
  onHome,
  role
}: {
  activeModule: ScreenGroup | null;
  isHome: boolean;
  onModule: (g: ScreenGroup) => void;
  onHome: () => void;
  role: UserRole | undefined;
}) {
  const modules = useMemo(() => {
    const withScreens = new Set(visibleScreens(role).map((s) => s.group));
    return SCREEN_GROUPS.filter((g) => withScreens.has(g));
  }, [role]);

  const Home = HOME_ICON;

  return (
    <div className="w-[68px] shrink-0 bg-[#0B3D26] flex flex-col items-center py-3 gap-1 text-white">
      <div className="mb-2 text-[#7BC9A3]">
        <DjemroudLogo className="w-9 h-9" />
      </div>

      <RailButton label="Accueil" active={isHome} onClick={onHome}>
        <Home className="w-[18px] h-[18px]" />
      </RailButton>

      <div className="w-8 border-t border-white/10 my-1.5" />

      {modules.map((g) => {
        const Icon = MODULE_META[g].icon;
        return (
          <RailButton key={g} label={g} title={MODULE_META[g].hint} active={activeModule === g && !isHome} onClick={() => onModule(g)}>
            <Icon className="w-[18px] h-[18px]" />
          </RailButton>
        );
      })}
    </div>
  );
}

function RailButton({
  label,
  title,
  active,
  onClick,
  children
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`w-14 rounded-xl flex flex-col items-center gap-0.5 py-1.5 transition-all duration-150 ${
        active ? 'bg-white/15 text-white shadow-inner' : 'text-white/55 hover:text-white hover:bg-white/8'
      }`}
    >
      {children}
      <span className="text-[8.5px] font-semibold leading-none tracking-tight">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Contextual module panel
// ---------------------------------------------------------------------------
function ModulePanel({
  module,
  current,
  onSelect,
  role,
  collapsed
}: {
  module: ScreenGroup;
  current: ScreenId | null;
  onSelect: (id: ScreenId) => void;
  role: UserRole | undefined;
  collapsed: boolean;
}) {
  const items = useMemo(() => visibleScreens(role).filter((s) => s.group === module), [role, module]);

  if (collapsed) return null;

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto anim-panel" key={module}>
      <div className="px-4 pt-4 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{module}</div>
        <div className="text-[10px] text-slate-300 mt-0.5 leading-snug">{MODULE_META[module].hint}</div>
      </div>
      <nav className="px-2 pb-4 flex flex-col gap-0.5">
        {items.map((s) => {
          const isActive = current === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`text-left px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                isActive ? 'bg-[#0F5B38] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
export function AppShell({
  current,
  onNavigate,
  user,
  onLogout,
  children
}: {
  current: ScreenId | null;
  onNavigate: (id: ScreenId) => void;
  user: { username: string; role: UserRole } | null;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // The module whose panel is shown. Follows the current screen but can be
  // switched independently (browsing another module before picking a screen).
  const [activeModule, setActiveModule] = useState<ScreenGroup>('Ventes');

  const screen = current ? getScreen(current) : undefined;
  const isHome = current === HOME_SCREEN;

  useEffect(() => {
    if (screen && screen.group !== activeModule) setActiveModule(screen.group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function openModule(g: ScreenGroup) {
    setActiveModule(g);
    setPanelCollapsed(false);
    // Land on the module's first screen immediately — one click, not two.
    const first = visibleScreens(user?.role ?? undefined).find((s) => s.group === g);
    if (first) onNavigate(first.id);
  }

  return (
    <div className="flex h-screen w-screen bg-[#F6F5F1] text-slate-800 font-sans text-xs overflow-hidden">
      <Rail activeModule={activeModule} isHome={isHome} onModule={openModule} onHome={() => onNavigate(HOME_SCREEN)} role={user?.role} />

      <ModulePanel module={activeModule} current={current} onSelect={onNavigate} role={user?.role} collapsed={panelCollapsed} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 bg-white border-b border-slate-200 px-4 flex items-center gap-3">
          <button
            onClick={() => setPanelCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            aria-label={panelCollapsed ? 'Afficher le panneau' : 'Masquer le panneau'}
          >
            {panelCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 min-w-0 text-[13px]">
            {screen && !isHome && <span className="text-slate-400">{screen.group}</span>}
            {screen && !isHome && <span className="text-slate-300">/</span>}
            <span className="font-bold text-slate-900 truncate">{isHome ? 'Tableau de bord' : screen?.label ?? ''}</span>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 hover:bg-white hover:border-slate-300 hover:text-slate-600 transition w-64"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="text-[11px]">Rechercher…</span>
            <kbd className="ml-auto text-[9px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-slate-100">
            <div className="w-7 h-7 rounded-full bg-[#0F5B38] text-white flex items-center justify-center text-[10px] font-bold uppercase">
              {user?.username?.slice(0, 2) ?? '??'}
            </div>
            <div className="leading-tight hidden md:block">
              <div className="font-semibold text-slate-700 text-[11px]">{user?.username}</div>
              <div className="text-[9px] text-slate-400">{user?.role}</div>
            </div>
            <button onClick={onLogout} title="Déconnexion" className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Keyed on the screen id so every navigation re-runs the entrance animation. */}
          <div key={current ?? 'home'} className="flex-1 min-h-0 flex flex-col p-5 anim-view">
            {children}
          </div>
        </main>
      </div>

      {paletteOpen && <CommandPalette role={user?.role} onSelect={onNavigate} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
