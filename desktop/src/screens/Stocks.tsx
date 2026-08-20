import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Screen, SearchInput, money, num } from '../components/ui';
import { describeError } from './ReferenceData';

/**
 * Consultation des stocks, au présent ou à une date passée.
 *
 * Le propriétaire veut pouvoir demander « qu'est-ce que j'avais en rayon le
 * 12 mars ? ». Le serveur reconstitue la quantité en défaisant les mouvements
 * postérieurs; cet écran ne fait que choisir la date et afficher le résultat.
 *
 * Une différence assumée entre les deux modes: le réservé n'existe qu'au
 * présent. Une réservation est un état courant, pas un mouvement historisé — on
 * ne peut donc pas dire ce qui était réservé un jour donné, et la colonne
 * disparaît en consultation historique plutôt que d'afficher un zéro trompeur.
 */

interface LigneStock {
  articleId: string;
  code: string;
  designation: string;
  pump: number;
  parDepot: { depotId: string; depotName: string; qtyInStock: number; qtyReserved: number }[];
  total: number;
}

interface ReponseStocks {
  date: string | null;
  depots: { id: string; name: string }[];
  lignes: LigneStock[];
  valeurTotale: number;
}

/** Date du jour au format attendu par un <input type="date">. */
function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

export function StocksScreen() {
  const [data, setData] = useState<ReponseStocks | null>(null);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  async function charger(d: string) {
    setLoading(true);
    setErreur(null);
    try {
      setData(await apiRequest<ReponseStocks>(`/stocks${d ? `?date=${d}` : ''}`));
    } catch (err) {
      setErreur(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    charger(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const historique = !!data?.date;

  const lignes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.lignes;
    return data.lignes.filter((l) => l.code.toLowerCase().includes(q) || l.designation.toLowerCase().includes(q));
  }, [data, search]);

  const valeurAffichee = lignes.reduce((s, l) => s + l.total * l.pump, 0);

  return (
    <Screen
      title="Consultation des stocks"
      description={
        historique
          ? `État reconstitué à la fermeture du ${new Date(data!.date!).toLocaleDateString('fr-FR')}. Les quantités réservées ne sont pas historisées et ne sont donc pas affichées.`
          : 'État actuel. Chaque dépôt affiche « disponible / physique »; la différence est ce qui est réservé par des documents ouverts.'
      }
      maxWidth="max-w-6xl"
      actions={
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Au</label>
          <input
            type="date"
            value={date}
            max={aujourdhui()}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            aria-label="Consulter le stock à cette date"
          />
          {date && (
            <Button variant="secondary" size="sm" onClick={() => setDate('')}>
              Aujourd'hui
            </Button>
          )}
        </div>
      }
    >
      {historique && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 text-xs font-medium text-amber-800">
          Vue historique — ces quantités sont reconstituées, elles ne reflètent pas le stock actuel.
        </div>
      )}
      {erreur && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-2.5 text-xs font-medium text-rose-800">{erreur}</div>
      )}

      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 border-b border-slate-100 flex items-center gap-3">
          <div className="flex-1 max-w-sm">
            <SearchInput value={search} onChange={setSearch} placeholder="Code ou désignation…" />
          </div>
          <span className="ml-auto text-slate-400 text-[11px]">
            {lignes.length} article(s) · valeur au P.U.M.P{' '}
            <span className="font-mono font-bold text-slate-600">{money(valeurAffichee)}</span>
          </span>
        </div>

        <div className="p-3 flex-1 min-h-0">
          <DataTable
            columns={[
              { key: 'code', header: 'Code', render: (l: LigneStock) => <span className="font-mono font-bold text-[#0F5B38]">{l.code}</span> },
              { key: 'designation', header: 'Désignation', render: (l) => l.designation },
              ...(data?.depots ?? []).map((d) => ({
                key: d.id,
                header: d.name,
                align: 'center' as const,
                render: (l: LigneStock) => {
                  const s = l.parDepot.find((x) => x.depotId === d.id);
                  if (!s) return <span className="text-slate-300">—</span>;
                  if (historique) return <span className="font-mono">{num(s.qtyInStock)}</span>;
                  const dispo = s.qtyInStock - s.qtyReserved;
                  return (
                    <span className="font-mono" title={`${s.qtyReserved} réservé(s)`}>
                      {num(dispo)} / {num(s.qtyInStock)}
                    </span>
                  );
                }
              })),
              {
                key: 'total',
                header: 'Total',
                align: 'center',
                render: (l) => <span className="font-mono font-bold text-[#0F5B38]">{num(l.total)}</span>
              },
              {
                key: 'valeur',
                header: 'Valeur',
                align: 'right',
                render: (l) => <span className="font-mono text-slate-500">{money(l.total * l.pump)}</span>
              }
            ]}
            rows={lignes}
            rowKey={(l) => l.articleId}
            emptyMessage={loading ? 'Chargement…' : search ? 'Aucun article ne correspond.' : 'Aucun article.'}
          />
        </div>
      </Card>
    </Screen>
  );
}
