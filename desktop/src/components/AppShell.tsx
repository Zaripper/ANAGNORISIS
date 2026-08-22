import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@anagnorisis/shared';
import { LogOut, Search } from 'lucide-react';
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
// Barre de menus (en haut)
// ---------------------------------------------------------------------------

/**
 * Navigation en barre supérieure, avec un menu déroulant par module.
 *
 * Elle remplace le rail d'icônes et le panneau latéral, qui mangeaient à eux
 * deux près de 300 px sur la gauche — la largeur d'une colonne de tableau. Sur
 * un écran de poste de saisie, c'était autant de place en moins pour les lignes
 * d'un bon, et c'est le premier reproche fait au logiciel.
 *
 * La forme reprend celle des logiciels de gestion que l'utilisateur connaît:
 * une barre de menus qu'on ouvre, où l'on choisit, et qui se referme.
 */
function MenuBar({
  activeModule,
  current,
  isHome,
  onSelect,
  onHome,
  role
}: {
  activeModule: ScreenGroup | null;
  current: ScreenId | null;
  isHome: boolean;
  onSelect: (id: ScreenId) => void;
  onHome: () => void;
  role: UserRole | undefined;
}) {
  const [ouvert, setOuvert] = useState<ScreenGroup | null>(null);
  const barre = useRef<HTMLDivElement>(null);

  const modules = useMemo(() => {
    const avecEcrans = new Set(visibleScreens(role).map((s) => s.group));
    return SCREEN_GROUPS.filter((g) => avecEcrans.has(g));
  }, [role]);

  // Un clic hors de la barre referme le menu, comme partout ailleurs.
  useEffect(() => {
    if (!ouvert) return;
    function surClic(e: MouseEvent) {
      if (barre.current && !barre.current.contains(e.target as Node)) setOuvert(null);
    }
    function surTouche(e: KeyboardEvent) {
      if (e.key === 'Escape') setOuvert(null);
    }
    document.addEventListener('mousedown', surClic);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert]);

  const Home = HOME_ICON;

  return (
    <div ref={barre} className="shrink-0 bg-[#0B3D26] text-white flex items-stretch h-10 relative z-40">
      <button
        onClick={onHome}
        title="Accueil"
        className={`px-3 flex items-center gap-2 transition ${isHome ? 'bg-white/15' : 'hover:bg-white/10'}`}
      >
        <DjemroudLogo className="w-6 h-6 text-[#7BC9A3]" />
        <Home className="w-4 h-4" />
      </button>

      {modules.map((g) => {
        const items = visibleScreens(role).filter((s) => s.group === g);
        const estActif = activeModule === g && !isHome;
        return (
          <div key={g} className="relative">
            <button
              onClick={() => setOuvert((o) => (o === g ? null : g))}
              onMouseEnter={() => setOuvert((o) => (o ? g : o))}
              className={`h-full px-4 text-[12px] font-semibold transition ${
                ouvert === g ? 'bg-white/20' : estActif ? 'bg-white/10' : 'hover:bg-white/10'
              }`}
            >
              {MODULE_META[g].label ?? g}
            </button>

            {ouvert === g && (
              <div className="absolute left-0 top-full min-w-[268px] bg-white text-slate-700 rounded-b-xl shadow-2xl border border-slate-200 border-t-0 py-1.5 anim-panel">
                {items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setOuvert(null);
                      onSelect(s.id);
                    }}
                    title={s.implemented ? s.label : `${s.label} — pas encore disponible`}
                    className={`w-full text-left px-4 py-1.5 text-[12px] flex items-center justify-between gap-3 transition ${
                      current === s.id
                        ? 'bg-[#0F5B38] text-white font-semibold'
                        : s.implemented
                          ? 'hover:bg-slate-100'
                          : 'text-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{s.label}</span>
                    {!s.implemented && <span className="text-[9px] shrink-0">•</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  // The module whose panel is shown. Follows the current screen but can be
  // switched independently (browsing another module before picking a screen).
  const [activeModule, setActiveModule] = useState<ScreenGroup>('Fichier');

  const screen = current ? getScreen(current) : undefined;
  const isHome = current === HOME_SCREEN;

  useEffect(() => {
    if (screen && screen.group !== 'Accueil' && screen.group !== activeModule) setActiveModule(screen.group);
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

  return (
    /*
     * Empilement vertical: menus en haut, puis le contenu sur TOUTE la largeur.
     * L'ancienne disposition (rail + panneau à gauche) consommait près de 300 px
     * en permanence, ce qui écrasait les tableaux de saisie.
     */
    <div className="flex flex-col h-screen w-screen bg-[#F6F5F1] text-slate-800 font-sans text-xs overflow-hidden">
      <MenuBar
        activeModule={activeModule}
        current={current}
        isHome={isHome}
        onSelect={onNavigate}
        onHome={() => onNavigate(HOME_SCREEN)}
        role={user?.role}
      />

      <header className="h-9 shrink-0 bg-white border-b border-slate-200 px-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5 min-w-0 text-[12px]">
          {screen && !isHome && <span className="text-slate-400">{screen.group}</span>}
          {screen && !isHome && <span className="text-slate-300">/</span>}
          <span className="font-bold text-slate-900 truncate">{isHome ? 'Accueil' : screen?.label ?? ''}</span>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-auto flex items-center gap-2 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 hover:bg-white hover:border-slate-300 hover:text-slate-600 transition w-56"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-[11px]">Rechercher…</span>
          <kbd className="ml-auto text-[9px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>

        <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-slate-100">
          <div className="w-6 h-6 rounded-full bg-[#0F5B38] text-white flex items-center justify-center text-[9px] font-bold uppercase">
            {user?.username?.slice(0, 2) ?? '??'}
          </div>
          <div className="leading-tight hidden md:block">
            <div className="font-semibold text-slate-700 text-[11px]">{user?.username}</div>
            <div className="text-[9px] text-slate-400">{user?.role}</div>
          </div>
          <button onClick={onLogout} title="Déconnexion" className="p-1 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Keyed on the screen id so every navigation re-runs the entrance animation. */}
        <div key={current ?? 'home'} className="flex-1 min-h-0 flex flex-col p-3 anim-view">
          {screen && !screen.implemented ? <NotBuiltYet screen={screen} /> : children}
        </div>
      </main>

      {paletteOpen && <CommandPalette role={user?.role} onSelect={onNavigate} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

/**
 * Ecran d'un module present dans le menu mais pas encore construit. Il nomme le
 * module et le dit franchement, plutot que d'afficher une page vide qui
 * ressemble a une panne.
 */
function NotBuiltYet({ screen }: { screen: ScreenDef }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-white border border-slate-200 rounded-2xl px-10 py-8 shadow-xs text-center max-w-md">
        <div className="font-extrabold text-slate-900 text-sm mb-1">{screen.label}</div>
        <div className="text-slate-400 text-xs mb-3">{screen.group}</div>
        <p className="text-slate-500 text-xs leading-relaxed">
          Ce module figure au menu pour refleter le perimetre complet du logiciel, mais il n&apos;est pas encore developpe.
        </p>
      </div>
    </div>
  );
}
