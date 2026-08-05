import React from 'react';
import { Boxes, ClipboardList, ScanBarcode, type LucideIcon } from 'lucide-react';
import { DjemroudLogo } from '../components/AppShell';
import type { ScreenId } from '../ui/navigation';

/**
 * Accueil — écran d'ouverture.
 *
 * Volontairement minimal: il accueille l'utilisateur et propose les trois points
 * d'entrée du quotidien. Aucun traitement n'est lancé à l'ouverture; tout le
 * reste passe par le rail de modules ou la recherche (Ctrl+K).
 */

interface Tile {
  id: ScreenId;
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
}

const TILES: Tile[] = [
  {
    id: 'CAISSE_POS',
    label: 'Caisse',
    hint: 'Vente au comptoir',
    icon: ScanBarcode,
    color: '#0F5B38'
  },
  {
    id: 'BONS_PREP',
    label: 'Bon de commande',
    hint: 'Commande client',
    icon: ClipboardList,
    color: '#1D4ED8'
  },
  {
    id: 'STOCKS',
    label: 'Stock',
    hint: 'Stocks par dépôt',
    icon: Boxes,
    color: '#B45309'
  }
];

export function AccueilScreen({ username, onNavigate }: { username?: string; onNavigate: (id: ScreenId) => void }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 13 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center">
      <div className="w-full max-w-4xl flex flex-col items-center gap-10 py-8">
        {/* Accueil */}
        <div className="flex flex-col items-center text-center">
          <DjemroudLogo className="w-16 h-16 text-[#0F5B38]" />
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-4">
            {greeting}
            {username ? `, ${username}` : ''}
          </h1>
          <p className="text-slate-500 text-sm mt-1.5">
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            Exercice {now.getFullYear()}
          </p>
        </div>

        {/* Les trois points d'entrée du quotidien */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onNavigate(t.id)}
                style={{ backgroundColor: t.color }}
                className="aspect-square rounded-3xl text-white flex flex-col items-center justify-center gap-3 px-4 text-center shadow-md transition-all duration-150 hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:shadow-md"
              >
                <Icon className="w-12 h-12" strokeWidth={1.4} />
                <div>
                  <div className="text-base font-bold leading-tight">{t.label}</div>
                  <div className="text-[11px] font-medium opacity-75 mt-0.5">{t.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Ctrl</kbd> +{' '}
          <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">K</kbd> pour accéder à tous les écrans
        </p>
      </div>
    </div>
  );
}
