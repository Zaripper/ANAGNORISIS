import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  PackageSearch,
  Receipt,
  ScanBarcode,
  Truck,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react';
import { apiRequest } from '../services/apiClient';
import { money } from '../components/ui';
import type { ScreenId } from '../ui/navigation';

/**
 * Accueil — the landing screen after login.
 *
 * Deliberately starts no workflow: it greets, surfaces the figures that decide
 * what to do next (stock alerts, créances), and offers one-click entry points.
 * The tile layout mirrors the home screen the team already uses daily, so the
 * switch costs them no relearning.
 */

interface DashboardData {
  caMoisHT: number;
  margeMoisHT: number;
  documentsOuverts: number;
  partenairesBloques: number;
  valeurStock: number;
  totalCreances: number;
  totalDettes: number;
}

interface ReorderAlert {
  id: string;
  code: string;
  available: number;
  seuilReappro: number;
}

interface Tile {
  id: ScreenId;
  label: string;
  icon: LucideIcon;
  color: string;
}

const AJOUT: Tile[] = [
  { id: 'CAISSE_POS', label: 'Vente au comptoir', icon: ScanBarcode, color: '#0F5B38' },
  { id: 'BONS_PREP', label: 'Bon de commande', icon: ClipboardList, color: '#1D4ED8' },
  { id: 'ACHATS', label: "Saisie d'achat", icon: Truck, color: '#B45309' },
  { id: 'FACTURE', label: 'Facture', icon: FileText, color: '#0E7490' },
  { id: 'AVOIRS_VENTES', label: 'Avoir client', icon: Receipt, color: '#BE123C' },
  { id: 'ARTICLES', label: 'Articles', icon: Boxes, color: '#4D7C0F' }
];

const JOURNAL: Tile[] = [
  { id: 'VALIDATION_BON_PREP', label: 'Validation commandes', icon: ClipboardList, color: '#0F5B38' },
  { id: 'LISTE_BONS_PREP', label: 'Journal des commandes', icon: FileText, color: '#1D4ED8' },
  { id: 'ACHATS_CONSULT', label: 'Journal des achats', icon: Truck, color: '#B45309' },
  { id: 'STOCKS', label: 'Journal de stock', icon: PackageSearch, color: '#4D7C0F' },
  { id: 'JOURNAL_CAISSE', label: 'Caisse', icon: Wallet, color: '#9333EA' },
  { id: 'CREANCES_DETTES', label: 'Balance tiers', icon: Users, color: '#0E7490' }
];

const ANALYSE: Tile[] = [
  { id: 'TABLEAU_BORD', label: 'Tableau de bord', icon: BarChart3, color: '#0F5B38' },
  { id: 'SITUATION', label: 'Situation générale', icon: PackageSearch, color: '#1D4ED8' },
  { id: 'REAPPRO', label: 'Réapprovisionnement', icon: AlertTriangle, color: '#B45309' },
  { id: 'GRAPHE_INDICES', label: 'Graphes & indices', icon: BarChart3, color: '#9333EA' }
];

export function AccueilScreen({ username, onNavigate }: { username?: string; onNavigate: (id: ScreenId) => void }) {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);

  useEffect(() => {
    apiRequest<DashboardData>('/reports/dashboard').then(setDash).catch(() => setDash(null));
    apiRequest<ReorderAlert[]>('/articles/reorder-alerts').then(setAlerts).catch(() => setAlerts([]));
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 13 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const ruptures = alerts.filter((a) => a.available <= 0).length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full flex flex-col gap-5">
        {/* Greeting */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {greeting}
              {username ? `, ${username}` : ''}
            </h1>
            <p className="text-slate-500 text-[13px] mt-0.5">
              {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Exercice{' '}
              {now.getFullYear()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Chiffre d'affaires du mois</div>
            <div className="font-mono font-extrabold text-xl text-[#0F5B38] tabular-nums">{dash ? money(dash.caMoisHT) : '—'} DZD</div>
          </div>
        </div>

        {/* Attention strip — what actually needs a decision today */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Alert
            label="Articles en rupture"
            value={ruptures}
            tone={ruptures > 0 ? 'danger' : 'ok'}
            onClick={() => onNavigate('REAPPRO')}
          />
          <Alert
            label="Alertes de stock"
            value={alerts.length}
            tone={alerts.length > 0 ? 'warn' : 'ok'}
            onClick={() => onNavigate('REAPPRO')}
          />
          <Alert
            label="Documents ouverts"
            value={dash?.documentsOuverts ?? 0}
            tone={(dash?.documentsOuverts ?? 0) > 0 ? 'warn' : 'ok'}
            onClick={() => onNavigate('VALIDATION_BON_PREP')}
          />
          <Alert
            label="Partenaires bloqués"
            value={dash?.partenairesBloques ?? 0}
            tone={(dash?.partenairesBloques ?? 0) > 0 ? 'danger' : 'ok'}
            onClick={() => onNavigate('PARTENAIRES_BLOQUES')}
          />
        </div>

        {/* Quick entry points, grouped the way the team already thinks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <TileGroup title="Ajout" tiles={AJOUT} onNavigate={onNavigate} />
          <TileGroup title="Journal" tiles={JOURNAL} onNavigate={onNavigate} />
          <TileGroup title="Analyses" tiles={ANALYSE} onNavigate={onNavigate} />
        </div>

        <p className="text-[11px] text-slate-400 text-center pb-2">
          Astuce : <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Ctrl</kbd> +{' '}
          <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">K</kbd> ouvre la recherche d'écrans.
        </p>
      </div>
    </div>
  );
}

function Alert({ label, value, tone, onClick }: { label: string; value: number; tone: 'ok' | 'warn' | 'danger'; onClick: () => void }) {
  const styles = {
    ok: 'border-slate-200 text-slate-400',
    warn: 'border-amber-200 bg-amber-50/60 text-amber-700',
    danger: 'border-rose-200 bg-rose-50/60 text-rose-700'
  };
  return (
    <button
      onClick={onClick}
      className={`bg-white border rounded-2xl px-4 py-3 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 ${styles[tone]}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide">{label}</div>
      <div className="font-mono font-extrabold text-2xl mt-0.5 tabular-nums text-slate-900">{value}</div>
    </button>
  );
}

function TileGroup({ title, tiles, onNavigate }: { title: string; tiles: Tile[]; onNavigate: (id: ScreenId) => void }) {
  return (
    <section>
      <h2 className="text-slate-400 font-bold text-sm mb-2.5">{title}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onNavigate(t.id)}
              style={{ backgroundColor: t.color }}
              className="aspect-[4/3] rounded-2xl text-white flex flex-col items-center justify-center gap-2 px-2 text-center shadow-sm transition-all duration-150 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
            >
              <Icon className="w-7 h-7" strokeWidth={1.6} />
              <span className="text-[11px] font-semibold leading-tight">{t.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
