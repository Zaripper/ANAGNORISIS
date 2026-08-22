import React, { useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Screen, SearchInput, Select, StatusBadge, ToastHost, dateShort, money, num, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import { useListeClavier, type Article, type Depot, type DocumentRow, type Partner } from '../ui/App';

/**
 * Commandes fournisseurs — purchase orders.
 *
 * A commande has no stock or ledger effect of its own; it is a promise to buy.
 * "Réceptionner" turns it into a real, validated ACHAT (stock in, P.U.M.P
 * recalculated, supplier balance updated) in one action on the server.
 *
 * ÉCRAN NON RACCORDÉ. Il a été retiré des menus et plus rien ne l'importe: le
 * cycle commande → réception passe aujourd'hui par l'éditeur de documents
 * commun. Le fichier est gardé parce que le serveur sait toujours réceptionner
 * une commande, mais tant qu'il n'apparaît pas dans `navigation.ts`, personne
 * ne peut l'ouvrir — et le corriger n'a aucun effet visible. À raccorder ou à
 * supprimer, pas à entretenir en l'état.
 */

interface OrderLine {
  articleId: string;
  code: string;
  designation: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
}

export function CommandesScreen({
  articles,
  partners,
  depots,
  documents,
  onSaved
}: {
  articles: Article[];
  partners: Partner[];
  depots: Depot[];
  documents: DocumentRow[];
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const suppliers = useMemo(() => partners.filter((p) => p.categoryIsSupplier), [partners]);
  const commandes = useMemo(() => documents.filter((d) => d.type === 'COMMANDE'), [documents]);

  const [supplierId, setSupplierId] = useState('');
  const [depotId, setDepotId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  const effectiveSupplier = supplierId || suppliers[0]?.id || '';
  const effectiveDepot = depotId || (depots.find((d) => d.isDefault) ?? depots[0])?.id || '';

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return articles.filter((a) => a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q)).slice(0, 6);
  }, [search, articles]);

  /**
   * Clavier sur les suggestions: fleches pour parcourir, Entree pour ajouter la
   * ligne, Echap pour abandonner la recherche. Ici la liste n'est pas un modal
   * mais un menu sous le champ; quand il est vide le crochet ne fait rien, ce
   * qui evite de capter les touches du reste de l'ecran.
   */
  const { index, setIndex, refLigne } = useListeClavier(matches, (a) => addLine(a), () => setSearch(''), {
    fermerApresChoix: false
  });

  function addLine(a: Article) {
    if (lines.some((l) => l.articleId === a.id)) return setSearch('');
    setLines((ls) => [
      ...ls,
      // A purchase order is priced at what we expect to pay: last known cost.
      { articleId: a.id, code: a.code, designation: a.designation, quantity: 1, unitPriceHT: a.pump, tvaRate: a.tvaRate }
    ]);
    setSearch('');
  }

  function patchLine(articleId: string, patch: Partial<OrderLine>) {
    setLines((ls) => ls.map((l) => (l.articleId === articleId ? { ...l, ...patch } : l)));
  }

  const totalHT = lines.reduce((s, l) => s + l.quantity * l.unitPriceHT, 0);

  async function save() {
    if (!effectiveSupplier || !effectiveDepot || lines.length === 0) return;
    setSaving(true);
    try {
      const doc = await apiRequest<{ reference: string }>('/documents', {
        method: 'POST',
        body: {
          type: 'COMMANDE',
          partnerId: effectiveSupplier,
          depotId: effectiveDepot,
          paymentMode: 'VIREMENT',
          remise: 0,
          lines: lines.map((l) => ({
            articleId: l.articleId,
            depotId: effectiveDepot,
            quantity: l.quantity,
            unitPriceHT: l.unitPriceHT,
            discountPercent: 0,
            tvaRate: l.tvaRate
          }))
        }
      });
      toasts.success(`Commande ${doc.reference} enregistrée.`);
      setLines([]);
      await onSaved();
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function receive(doc: DocumentRow) {
    setReceivingId(doc.id);
    try {
      const res = await apiRequest<{ achat: { reference: string } }>(`/documents/${doc.id}/receive`, { method: 'POST' });
      toasts.success(`Commande réceptionnée — achat ${res.achat.reference} validé (stock mis à jour).`);
      await onSaved();
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setReceivingId(null);
    }
  }

  return (
    <Screen title="Commandes fournisseurs" description="Bons de commande sans effet de stock; la réception génère l'achat validé correspondant.">
      <div className="flex-1 flex gap-4 min-h-0">
        <Card title="Nouvelle commande" className="flex-1 min-w-0" padded={false}>
          <div className="p-3 flex flex-col gap-3 flex-1 min-h-0">
            <div className="grid grid-cols-2 gap-2">
              <Select value={effectiveSupplier} onChange={(e) => setSupplierId(e.target.value)} aria-label="Fournisseur">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.raisonSociale} ({s.code})
                  </option>
                ))}
              </Select>
              <Select value={effectiveDepot} onChange={(e) => setDepotId(e.target.value)} aria-label="Dépôt de réception">
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="relative">
              <SearchInput value={search} onChange={setSearch} placeholder="Ajouter un article (code ou désignation)…" />
              {matches.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                  {/*
                    Memes informations que dans les autres selecteurs: stock, UG
                    autorisee, peremption, PPA et cout d'achat. Le commercial ne
                    doit pas avoir a quitter le bon pour savoir ce qu'il commande.
                  */}
                  {matches.map((a, i) => (
                    <div
                      key={a.id}
                      ref={i === index ? refLigne : undefined}
                      onMouseEnter={() => setIndex(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addLine(a);
                      }}
                      className={`px-3 py-1.5 cursor-pointer text-xs ${i === index ? 'bg-[#0F5B38]/10' : 'hover:bg-[#0F5B38]/5'}`}
                    >
                      <div className="flex justify-between gap-3">
                        <span className="truncate">
                          <span className="font-mono font-bold text-[#0F5B38] mr-2">{a.code}</span>
                          {a.designation}
                        </span>
                        <span className={`font-mono shrink-0 ${a.stockGlobal > 0 ? 'text-slate-500' : 'text-rose-600'}`}>
                          Stock {a.stockGlobal}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-slate-400 mt-0.5">
                        <span>UG max {a.tauxUGAutorise ? `${a.tauxUGAutorise}%` : '—'}</span>
                        <span>
                          Péremption{' '}
                          {a.lots?.[0] ? new Date(a.lots[0].datePeremption).toLocaleDateString('fr-FR') : '—'}
                        </span>
                        <span>PPA {a.ppa ? money(a.ppa) : '—'}</span>
                        <span>Coût {money(a.pump)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto border border-slate-100 rounded-xl">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="p-2 text-left text-[10px] uppercase font-semibold">Article</th>
                    <th className="p-2 text-center text-[10px] uppercase font-semibold w-20">Qté</th>
                    <th className="p-2 text-right text-[10px] uppercase font-semibold w-28">P.U. HT</th>
                    <th className="p-2 text-right text-[10px] uppercase font-semibold w-24">Total HT</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l) => (
                    <tr key={l.articleId}>
                      <td className="p-2">
                        <span className="font-mono font-bold text-[#0F5B38] mr-2">{l.code}</span>
                        {l.designation}
                      </td>
                      <td className="p-2">
                        <input
                          value={l.quantity}
                          onChange={(e) => patchLine(l.articleId, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-16 text-center border border-slate-200 rounded-lg py-1 font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          value={l.unitPriceHT}
                          onChange={(e) => patchLine(l.articleId, { unitPriceHT: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-24 text-right border border-slate-200 rounded-lg py-1 font-mono"
                        />
                      </td>
                      <td className="p-2 text-right font-mono font-semibold">{money(l.quantity * l.unitPriceHT)}</td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => setLines((ls) => ls.filter((x) => x.articleId !== l.articleId))}
                          className="text-slate-300 hover:text-rose-600 font-bold"
                          aria-label={`Retirer ${l.code}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        Aucune ligne — recherchez un article ci-dessus.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500 text-xs">
                Total HT: <span className="font-mono font-bold text-slate-800">{money(totalHT)} DZD</span>
              </span>
              <Button variant="primary" disabled={lines.length === 0 || saving} onClick={save}>
                {saving ? 'Enregistrement…' : 'Enregistrer la commande'}
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Commandes en cours & historique" className="flex-1 min-w-0" padded={false}>
          <div className="p-3 flex-1 min-h-0">
            <DataTable
              columns={[
                { key: 'ref', header: 'Référence', render: (d: DocumentRow) => <span className="font-mono font-bold">{d.reference}</span> },
                { key: 'partner', header: 'Fournisseur', render: (d) => d.partner?.raisonSociale ?? '—' },
                { key: 'date', header: 'Date', render: (d) => dateShort(d.createdAt) },
                { key: 'ht', header: 'Total HT', align: 'right', render: (d) => <span className="font-mono">{money(num(d.totalHT))}</span> },
                {
                  key: 'status',
                  header: 'Statut',
                  align: 'center',
                  render: (d) => (d.status === 'VALIDE' ? <Badge tone="success">Réceptionnée</Badge> : <StatusBadge status={d.status} />)
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (d) =>
                    d.status === 'OUVERT' ? (
                      <Button size="sm" variant="primary" disabled={receivingId === d.id} onClick={() => receive(d)}>
                        {receivingId === d.id ? 'Réception…' : 'Réceptionner'}
                      </Button>
                    ) : (
                      <span className="text-slate-400 text-[10px]">{d.motif ?? ''}</span>
                    )
                }
              ]}
              rows={commandes}
              rowKey={(d) => d.id}
              emptyMessage="Aucune commande fournisseur."
            />
          </div>
        </Card>
      </div>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
