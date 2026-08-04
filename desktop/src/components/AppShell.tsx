import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@anagnorisis/shared';
import { SCREEN_GROUPS, SCREENS, ScreenDef, ScreenGroup, ScreenId, getScreen, searchScreens, visibleScreens } from '../ui/navigation';
import { Badge, Button } from './ui';

/**
 * Application chrome: brand bar, grouped sidebar, and the Ctrl+K command palette.
 *
 * This replaces the previous menubar, where ~60 screens were hidden behind five
 * dropdowns. Finding anything required knowing which dropdown it lived under, and
 * several entries were mislabelled or pointed at placeholders. The sidebar keeps
 * the same familiar group names but stays visible, marks the active screen, and
 * dims not-yet-built ones. The palette makes everything reachable by name.
 */

export function DjemroudLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="#0F5B38">
        <path d="M100 95 C80 60, 45 60, 45 85 C45 105, 80 100, 100 95 Z" />
        <path d="M95 100 C60 80, 60 45, 85 45 C105 45, 100 80, 95 100 Z" />
        <path d="M105 100 C140 80, 140 45, 115 45 C95 45, 100 80, 105 100 Z" />
        <path d="M100 95 C120 60, 155 60, 155 85 C155 105, 120 100, 100 95 Z" />
        <path d="M95 100 C60 120, 60 155, 85 155 C105 155, 100 120, 95 100 Z" />
        <path d="M100 105 C80 140, 45 140, 45 115 C45 95, 80 100, 100 105 Z" />
        <path d="M105 100 C140 120, 140 155, 115 155 C95 155, 100 120, 105 100 Z" />
        <path d="M100 105 C120 140, 155 140, 155 115 C155 95, 120 100, 100 105 Z" />
        <path d="M100 110 Q98 150 102 170" stroke="#0F5B38" strokeWidth="6" strokeLinecap="round" fill="none" />
        <path d="M99 140 Q85 135 78 125 Q90 125 99 140 Z" />
        <path d="M101 145 Q115 140 122 130 Q110 130 101 145 Z" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Command palette
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

  // Keep the highlighted row valid as the result set shrinks.
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

  // Scroll the active row into view when navigating with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] flex items-start justify-center z-[70] p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <span className="text-slate-400">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aller à un écran... (ex: charges, dépôts, TVA)"
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="text-[10px] font-mono bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-8 text-center text-slate-400 text-xs">Aucun écran ne correspond à « {query} ».</div>}
          {results.map((s, i) => (
            <div
              key={s.id}
              data-index={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                onSelect(s.id);
                onClose();
              }}
              className={`px-4 py-2 flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-[#0F5B38]/8' : ''}`}
            >
              <div className="min-w-0">
                <div className={`text-xs font-semibold truncate ${s.implemented ? 'text-slate-800' : 'text-slate-400'}`}>{s.label}</div>
                <div className="text-[10px] text-slate-400">{s.group}</div>
              </div>
              {!s.implemented && <Badge tone="neutral">à venir</Badge>}
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 flex gap-3 text-[10px] text-slate-400">
          <span>
            <kbd className="font-mono">↑↓</kbd> naviguer
          </span>
          <span>
            <kbd className="font-mono">⏎</kbd> ouvrir
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function Sidebar({
  current,
  onSelect,
  role,
  collapsed
}: {
  current: ScreenId | null;
  onSelect: (id: ScreenId) => void;
  role: UserRole | undefined;
  collapsed: boolean;
}) {
  const available = useMemo(() => visibleScreens(role), [role]);

  // Groups start expanded; the one holding the active screen always stays open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SCREEN_GROUPS.map((g) => [g, true]))
  );

  const byGroup = useMemo(() => {
    const map = new Map<ScreenGroup, ScreenDef[]>();
    for (const g of SCREEN_GROUPS) map.set(g, []);
    for (const s of available) map.get(s.group)?.push(s);
    return map;
  }, [available]);

  if (collapsed) return null;

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
      <nav className="py-2">
        {SCREEN_GROUPS.map((group) => {
          const items = byGroup.get(group) ?? [];
          if (items.length === 0) return null;
          const open = openGroups[group];
          return (
            <div key={group} className="mb-0.5">
              <button
                onClick={() => setOpenGroups((g) => ({ ...g, [group]: !g[group] }))}
                className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600"
              >
                {group}
                <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
              </button>
              {open &&
                items.map((s) => {
                  const isActive = current === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelect(s.id)}
                      title={s.implemented ? s.label : `${s.label} — pas encore disponible`}
                      className={`w-full text-left px-4 py-1.5 text-xs flex items-center justify-between gap-2 border-l-2 transition ${
                        isActive
                          ? 'border-[#0F5B38] bg-[#0F5B38]/8 text-[#0F5B38] font-semibold'
                          : s.implemented
                            ? 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            : 'border-transparent text-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{s.label}</span>
                      {!s.implemented && <span className="text-[9px] text-slate-300 shrink-0">•</span>}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>
      <div className="mt-auto px-4 py-3 text-[10px] text-slate-300 border-t border-slate-100">
        {SCREENS.filter((s) => s.implemented).length} / {SCREENS.length} modules actifs
      </div>
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
  onNavigate: (id: ScreenId | null) => void;
  user: { username: string; role: UserRole } | null;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Ctrl/Cmd+K opens the palette from anywhere.
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

  const activeScreen = current ? getScreen(current) : undefined;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#FAF9F6] text-slate-800 font-sans text-xs overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-4 z-30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={sidebarCollapsed ? 'Afficher le menu' : 'Masquer le menu'}
          >
            ☰
          </button>
          <button onClick={() => onNavigate(null)} className="flex items-center gap-2.5 group min-w-0">
            <DjemroudLogo className="w-7 h-7 transition group-hover:scale-105" />
            <div className="flex flex-col items-start min-w-0">
              <span className="font-extrabold text-xs tracking-tight text-[#0F5B38] truncate">ETS DJEMROUD</span>
              <span className="text-[9px] text-slate-400 font-medium -mt-0.5 truncate">Parapharmacie • Gros &amp; Détail</span>
            </div>
          </button>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="flex-1 max-w-md flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 hover:bg-white hover:border-slate-300 transition"
        >
          <span>⌕</span>
          <span className="text-[11px]">Rechercher un écran...</span>
          <kbd className="ml-auto text-[9px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>

        <div className="flex items-center gap-3 shrink-0">
          {user && (
            <div className="text-right leading-tight hidden sm:block">
              <div className="font-semibold text-slate-700 text-[11px]">{user.username}</div>
              <div className="text-[9px] text-slate-400">{user.role}</div>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={onLogout}>
            Déconnexion
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <Sidebar current={current} onSelect={onNavigate} role={user?.role} collapsed={sidebarCollapsed} />
        <main className="flex-1 min-w-0 flex flex-col p-5 overflow-hidden relative">
          {activeScreen && !activeScreen.implemented ? <NotBuiltYet screen={activeScreen} /> : children}
        </main>
      </div>

      {paletteOpen && <CommandPalette role={user?.role} onSelect={(id) => onNavigate(id)} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

/**
 * Honest placeholder. It names the screen and says plainly that it is not built,
 * rather than rendering an empty shell that looks broken.
 */
function NotBuiltYet({ screen }: { screen: ScreenDef }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-white border border-slate-200 rounded-2xl px-10 py-8 shadow-xs text-center max-w-md">
        <div className="font-extrabold text-slate-900 text-sm mb-1">{screen.label}</div>
        <div className="text-slate-400 text-xs mb-3">{screen.group}</div>
        <p className="text-slate-500 text-xs leading-relaxed">
          Ce module n'est pas encore disponible. Il apparaît ici pour que la navigation reflète le périmètre complet prévu.
        </p>
      </div>
    </div>
  );
}
