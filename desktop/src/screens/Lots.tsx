import React, { useEffect, useMemo, useState } from 'react';
import { LOT_ETAT_LABELS, joursAvantPeremption, lotEtat, type LotEtat } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import { Badge, Card, DataTable, Screen, SearchInput, dateShort, money, num } from '../components/ui';

/**
 * Lots et dates de péremption.
 *
 * Trié par péremption croissante: l'ordre dans lequel il faut s'en occuper.
 * La valeur des lots périmés est mise en avant parce que c'est de l'argent déjà
 * perdu qui dort en rayon — le seul chiffre qui fait sortir la marchandise.
 */

interface LotRow {
  id: string;
  numeroLot: string;
  datePeremption: string;
  qtyInStock: number;
  qtyReserved: number;
  article: { code: string; designation: string };
  depot: { name: string };
}

const TON: Record<LotEtat, 'danger' | 'warning' | 'success'> = {
  PERIME: 'danger',
  ALERTE: 'warning',
  BON: 'success'
};

export function LotsScreen() {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [alerte, setAlerte] = useState(90);
  const [valeurPerimee, setValeurPerimee] = useState(0);
  const [filtre, setFiltre] = useState<'TOUS' | LotEtat>('TOUS');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ lots: LotRow[]; alerteJours: number; valeurPerimee: number }>('/lots')
      .then((d) => {
        setLots(d.lots);
        setAlerte(d.alerteJours);
        setValeurPerimee(d.valeurPerimee);
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    return lots
      .filter((l) => filtre === 'TOUS' || lotEtat(new Date(l.datePeremption), alerte, now) === filtre)
      .filter(
        (l) =>
          !q ||
          l.numeroLot.toLowerCase().includes(q) ||
          l.article.code.toLowerCase().includes(q) ||
          l.article.designation.toLowerCase().includes(q)
      );
  }, [lots, filtre, search, alerte]);

  const compte = (e: LotEtat) => {
    const now = new Date();
    return lots.filter((l) => lotEtat(new Date(l.datePeremption), alerte, now) === e).length;
  };

  return (
    <Screen
      title="Lots et péremptions"
      description={`Alerte à ${alerte} jours. Un lot périmé n'est jamais servi à la vente; sa sortie du stock reste un geste délibéré (régule moins).`}
      maxWidth="max-w-full"
    >
      {valeurPerimee > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-rose-800">
            {compte('PERIME')} lot(s) périmé(s) encore en stock — marchandise invendable à sortir.
          </span>
          <span className="font-mono font-black text-rose-700">{money(valeurPerimee)}</span>
        </div>
      )}

      <Card className="flex-1 min-h-0" padded={false}>
        <div className="px-2 py-1.5 border-b border-slate-100 flex items-center gap-3">
          <div className="flex gap-1">
            {(['TOUS', 'PERIME', 'ALERTE', 'BON'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setFiltre(e)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                  filtre === e ? 'bg-[#0F5B38] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {e === 'TOUS' ? 'Tous' : `${LOT_ETAT_LABELS[e]} (${compte(e)})`}
              </button>
            ))}
          </div>
          <div className="flex-1 max-w-sm">
            <SearchInput value={search} onChange={setSearch} placeholder="N° de lot, code ou désignation…" />
          </div>
          <span className="ml-auto text-slate-400 text-[11px]">{rows.length} lot(s)</span>
        </div>

        <div className="p-2 flex-1 min-h-0">
          <DataTable
            columns={[
              { key: 'code', header: 'Code', render: (l: LotRow) => <span className="font-mono font-bold">{l.article.code}</span> },
              { key: 'designation', header: 'Désignation', render: (l) => l.article.designation },
              { key: 'lot', header: 'N° lot', render: (l) => <span className="font-mono">{l.numeroLot}</span> },
              { key: 'depot', header: 'Dépôt', render: (l) => l.depot.name },
              { key: 'peremption', header: 'Péremption', render: (l) => dateShort(l.datePeremption) },
              {
                key: 'jours',
                header: 'Échéance',
                align: 'center',
                render: (l) => {
                  const j = joursAvantPeremption(new Date(l.datePeremption));
                  return j < 0 ? (
                    <span className="text-rose-600 font-bold text-xs">{-j} j de retard</span>
                  ) : (
                    <span className="text-slate-500 text-xs">{j} j</span>
                  );
                }
              },
              {
                key: 'qty',
                header: 'En stock',
                align: 'right',
                render: (l) => <span className="font-mono font-bold">{num(l.qtyInStock)}</span>
              },
              {
                key: 'reserve',
                header: 'Réservé',
                align: 'right',
                render: (l) => <span className="font-mono text-slate-400">{num(l.qtyReserved)}</span>
              },
              {
                key: 'etat',
                header: 'État',
                align: 'center',
                render: (l) => {
                  const e = lotEtat(new Date(l.datePeremption), alerte);
                  return <Badge tone={TON[e]}>{LOT_ETAT_LABELS[e]}</Badge>;
                }
              }
            ]}
            rows={rows}
            rowKey={(l) => l.id}
            emptyMessage={
              loading
                ? 'Chargement…'
                : lots.length === 0
                  ? "Aucun lot enregistré. Le suivi par lot s'active article par article dans Fichier > Articles."
                  : 'Aucun lot ne correspond.'
            }
          />
        </div>
      </Card>
    </Screen>
  );
}
