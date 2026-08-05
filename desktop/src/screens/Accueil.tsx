import React from 'react';
import { Boxes, ClipboardList, ScanBarcode, type LucideIcon } from 'lucide-react';
import { DjemroudLogo } from '../components/AppShell';
import type { ScreenId } from '../ui/navigation';

/**
 * Accueil — écran d'ouverture.
 *
 * Un fond vert très clair frappé du logo en filigrane, le message de bienvenue,
 * et trois raccourcis compacts vers le travail quotidien. Rien n'est lancé à
 * l'ouverture; tout le reste passe par le rail de modules ou Ctrl+K.
 */

interface Tile {
  id: ScreenId;
  label: string;
  icon: LucideIcon;
}

const TILES: Tile[] = [
  { id: 'CAISSE_POS', label: 'Caisse', icon: ScanBarcode },
  { id: 'BONS_PREP', label: 'Bon de commande', icon: ClipboardList },
  { id: 'STOCKS', label: 'Stock', icon: Boxes }
];

export function AccueilScreen({ username, onNavigate }: { username?: string; onNavigate: (id: ScreenId) => void }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 13 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  return (
    <div className="flex-1 min-h-0 relative rounded-2xl overflow-hidden bg-[#0F5B38]/[0.045] flex items-center justify-center">
      {/* Logo en filigrane: décoratif, il ne doit jamais intercepter un clic. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden="true">
        <DjemroudLogo className="w-[32rem] h-[32rem] text-[#0F5B38] opacity-[0.05]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 px-6">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            {greeting}
            {username ? `, ${username}` : ''}
          </h1>
          <p className="text-slate-500 text-sm mt-1.5">
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            Exercice {now.getFullYear()}
          </p>
        </div>

        <div className="flex items-start justify-center gap-4">
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onNavigate(t.id)}
                className="group w-28 flex flex-col items-center gap-2"
              >
                <span className="w-16 h-16 rounded-2xl bg-white border border-[#0F5B38]/15 text-[#0F5B38] flex items-center justify-center shadow-sm transition-all duration-150 group-hover:bg-[#0F5B38] group-hover:text-white group-hover:shadow-md group-hover:-translate-y-0.5 group-active:translate-y-0">
                  <Icon className="w-7 h-7" strokeWidth={1.6} />
                </span>
                <span className="text-[11px] font-semibold text-slate-600 text-center leading-tight group-hover:text-slate-900">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          <kbd className="font-mono bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">Ctrl</kbd> +{' '}
          <kbd className="font-mono bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">K</kbd> pour accéder à tous les écrans
        </p>
      </div>
    </div>
  );
}
