import React, { useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, Screen, SearchInput, Select, ToastHost, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { Article, Depot } from '../ui/App';

/**
 * Inventaire physique — one-shot count reconciliation for a depot.
 *
 * The operator types the counted quantity per article; on closing, the deltas
 * become REGULE_PLUS / REGULE_MOINS documents (created then validated), reusing
 * the exact same stock-mutation path as every other movement — the inventory
 * never touches stock rows directly. Régule lines are priced at P.U.M.P so the
 * corrections carry no artificial margin.
 */
export function InventaireScreen({
  articles,
  depots,
  onSaved
}: {
  articles: Article[];
  depots: Depot[];
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const [depotId, setDepotId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [closing, setClosing] = useState(false);

  const effectiveDepot = depotId || (depots.find((d) => d.isDefault) ?? depots[0])?.id || '';

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles
      .filter((a) => !q || a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q))
      .map((a) => {
        const stock = a.stocksByDepot[effectiveDepot];
        const systemQty = stock?.qtyInStock ?? 0;
        const raw = counts[a.id];
        const counted = raw === undefined || raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
        const delta = counted === null || Number.isNaN(counted) ? 0 : counted - systemQty;
        return { article: a, systemQty, reserved: stock?.qtyReserved ?? 0, counted, delta };
      });
  }, [articles, counts, effectiveDepot, search]);

  const touched = rows.filter((r) => r.counted !== null && r.delta !== 0);
  const plus = touched.filter((r) => r.delta > 0);
  const minus = touched.filter((r) => r.delta < 0);

  async function close() {
    if (touched.length === 0 || !effectiveDepot) return;

    /**
     * Une régularisation exige désormais un motif. Une clôture d'inventaire en
     * est un par nature: on récupère « écart d'inventaire » dans la table de
     * référence plutôt que de le coder en dur, pour qu'il reste modifiable.
     */
    let typeReguleId: string;
    try {
      const motifs = await apiRequest<{ id: string; code: string; sens: string; active: boolean }[]>('/types-regules');
      const ecart = motifs.find((m) => m.code === 'ECART_INV' && m.active) ?? motifs.find((m) => m.sens === 'TOUS' && m.active);
      if (!ecart) {
        toasts.error("Aucun motif de régularisation « les deux sens » n'est actif: créez-en un dans Fichier > Types des régules.");
        return;
      }
      typeReguleId = ecart.id;
    } catch (err) {
      toasts.error(describeError(err));
      return;
    }

    /**
     * Un article suivi par lot ne peut pas voir son stock augmenter sans qu'on
     * dise DANS QUEL lot: la clôture ne peut pas le deviner. On refuse plutôt
     * que de créer du stock qu'aucun lot ne couvre.
     */
    const plusAvecLot = plus.filter((r) => r.article.suiviLot);
    if (plusAvecLot.length > 0) {
      toasts.error(
        `${plusAvecLot.map((r) => r.article.code).join(', ')}: article(s) suivi(s) par lot. Régularisez l'écart positif depuis Mouvement > Régules plus, où le n° de lot se saisit.`
      );
      return;
    }

    setClosing(true);
    try {
      const refs: string[] = [];
      // Positive deltas: stock found that the system didn't know about.
      if (plus.length > 0) {
        const doc = await apiRequest<{ id: string; reference: string }>('/documents', {
          method: 'POST',
          body: {
            type: 'REGULE_PLUS',
            depotId: effectiveDepot,
            paymentMode: 'ESPECE',
            remise: 0,
            typeReguleId,
            motif: `Inventaire physique du ${new Date().toLocaleDateString('fr-FR')}`,
            lines: plus.map((r) => ({
              articleId: r.article.id,
              depotId: effectiveDepot,
              quantity: r.delta,
              unitPriceHT: r.article.pump,
              discountPercent: 0,
              tvaRate: 0
            }))
          }
        });
        await apiRequest(`/documents/${doc.id}/validate`, { method: 'POST' });
        refs.push(doc.reference);
      }
      // Negative deltas: shrinkage — stock the system had but the shelf doesn't.
      if (minus.length > 0) {
        const doc = await apiRequest<{ id: string; reference: string }>('/documents', {
          method: 'POST',
          body: {
            type: 'REGULE_MOINS',
            depotId: effectiveDepot,
            paymentMode: 'ESPECE',
            remise: 0,
            typeReguleId,
            motif: `Inventaire physique du ${new Date().toLocaleDateString('fr-FR')}`,
            lines: minus.map((r) => ({
              articleId: r.article.id,
              depotId: effectiveDepot,
              quantity: -r.delta,
              unitPriceHT: r.article.pump,
              discountPercent: 0,
              tvaRate: 0
            }))
          }
        });
        await apiRequest(`/documents/${doc.id}/validate`, { method: 'POST' });
        refs.push(doc.reference);
      }
      toasts.success(`Inventaire clôturé — régule(s) ${refs.join(', ')} validée(s).`);
      setCounts({});
      await onSaved();
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <Screen
      title="Inventaire physique"
      description="Saisissez les quantités réellement comptées; les écarts génèrent des régularisations validées."
      maxWidth="max-w-5xl"
      actions={
        <div className="flex items-center gap-3">
          {touched.length > 0 && (
            <span className="text-[11px] text-slate-500">
              {plus.length > 0 && <Badge tone="success">+{plus.reduce((s, r) => s + r.delta, 0)}</Badge>}{' '}
              {minus.length > 0 && <Badge tone="danger">{minus.reduce((s, r) => s + r.delta, 0)}</Badge>}
            </span>
          )}
          <Button variant="primary" disabled={touched.length === 0 || closing} onClick={close}>
            {closing ? 'Clôture…' : `Clôturer (${touched.length} écart${touched.length > 1 ? 's' : ''})`}
          </Button>
        </div>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 border-b border-slate-100 flex items-center gap-3">
          <Select value={effectiveDepot} onChange={(e) => { setDepotId(e.target.value); setCounts({}); }} className="max-w-56" aria-label="Dépôt inventorié">
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="flex-1 max-w-sm">
            <SearchInput value={search} onChange={setSearch} />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 pt-0">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
              <tr>
                <th className="p-2.5 text-left text-[10px] uppercase font-semibold">Article</th>
                <th className="p-2.5 text-center text-[10px] uppercase font-semibold w-24">Stock système</th>
                <th className="p-2.5 text-center text-[10px] uppercase font-semibold w-20">Réservé</th>
                <th className="p-2.5 text-center text-[10px] uppercase font-semibold w-28">Compté</th>
                <th className="p-2.5 text-center text-[10px] uppercase font-semibold w-24">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.article.id} className={r.counted !== null && r.delta !== 0 ? 'bg-amber-50/40' : ''}>
                  <td className="p-2.5">
                    <span className="font-mono font-bold text-[#0F5B38] mr-2">{r.article.code}</span>
                    {r.article.designation}
                  </td>
                  <td className="p-2.5 text-center font-mono">{r.systemQty}</td>
                  <td className="p-2.5 text-center font-mono text-amber-600">{r.reserved || '—'}</td>
                  <td className="p-2.5 text-center">
                    <input
                      value={counts[r.article.id] ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [r.article.id]: e.target.value }))}
                      placeholder={String(r.systemQty)}
                      inputMode="numeric"
                      className="w-20 text-center border border-slate-200 rounded-lg py-1 font-mono focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    {r.counted === null || r.delta === 0 ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={`font-mono font-bold ${r.delta > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {r.delta > 0 ? '+' : ''}
                        {r.delta}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
