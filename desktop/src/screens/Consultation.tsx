import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import {
  Badge,
  Button,
  Card,
  type Column,
  DataTable,
  DateRangeFilter,
  Input,
  Screen,
  SearchInput,
  StatusBadge,
  ToastHost,
  dateShort,
  dateTime,
  money,
  num,
  statusLabel,
  useDateRange,
  useTextFilter,
  useToasts
} from '../components/ui';
import { describeError } from './ReferenceData';
import type { Article, DocumentRow } from '../ui/App';

/**
 * Échéance d'un bon de préparation, exprimée en jours restants plutôt qu'en date:
 * le préparateur a besoin de savoir combien de temps il lui reste, pas de
 * soustraire deux dates de tête. Au-delà de l'échéance la réservation tombe et
 * le bon n'est plus validable.
 */
function EcheanceBP({ dateValidite }: { dateValidite?: string | null }) {
  if (!dateValidite) return <span className="text-slate-400">—</span>;

  const jours = Math.ceil((new Date(dateValidite).getTime() - Date.now()) / 86400000);
  if (jours < 0) return <Badge tone="danger">Échu</Badge>;
  if (jours === 0) return <Badge tone="danger">Dernier jour</Badge>;
  if (jours <= 2) return <Badge tone="warning">{jours} j</Badge>;
  return <span className="text-slate-500 text-xs">{jours} j</span>;
}

/**
 * Aperçu d'un document, ouvert en cliquant une ligne.
 *
 * Reproche du propriétaire: depuis une file de validation, impossible de voir
 * ce qu'on validait. Valider un bon sans pouvoir en lire les lignes, c'est
 * signer sans lire. La fenêtre est en lecture seule et se ferme à l'Échap.
 */
function ApercuDocument({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<DocumentRow>(`/documents/${documentId}`)
      .then(setDoc)
      .catch((e) => setErreur(describeError(e)));
  }, [documentId]);

  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center gap-4">
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">
              {doc ? `${doc.type} ${doc.reference}` : 'Chargement…'}
            </div>
            {doc && (
              <div className="text-[11px] text-slate-400">
                {dateShort(doc.createdAt)} · {doc.partner?.raisonSociale ?? 'Sans partenaire'} · {statusLabel(doc.status)}
              </div>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Fermer (Échap)
          </Button>
        </div>

        <div className="p-4 flex-1 min-h-0 overflow-auto">
          {erreur && <div className="text-xs text-rose-700">{erreur}</div>}
          {doc && (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-2">Code</th>
                  <th className="p-2">Désignation</th>
                  <th className="p-2 text-center">Qté</th>
                  <th className="p-2 text-center">UG</th>
                  <th className="p-2 text-right">P.U. HT</th>
                  <th className="p-2 text-right">Remise</th>
                  <th className="p-2 text-right">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(doc.lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="p-2 font-mono font-bold text-[#0F5B38]">{l.article?.code ?? '—'}</td>
                    <td className="p-2">{l.article?.designation ?? '—'}</td>
                    <td className="p-2 text-center font-mono font-bold">{l.quantity}</td>
                    <td className="p-2 text-center font-mono text-[#0F5B38]">{l.quantiteBonus ? `+${l.quantiteBonus}` : '—'}</td>
                    <td className="p-2 text-right font-mono">{money(num(l.unitPriceHT))}</td>
                    <td className="p-2 text-right font-mono text-slate-500">{num(l.discountPercent)}%</td>
                    <td className="p-2 text-right font-mono font-bold">{money(num(l.totalHT))}</td>
                  </tr>
                ))}
                {(doc.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      Ce document ne contient aucune ligne.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {doc && (
          <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-6 text-xs shrink-0">
            <div>
              <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Total HT</span>
              <span className="font-mono font-bold">{money(num(doc.totalHT))}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase tracking-wider block">TVA</span>
              <span className="font-mono font-bold">{money(num(doc.totalTVA))}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Timbre</span>
              <span className="font-mono font-bold text-amber-700">{money(num(doc.stampDuty))}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Total TTC</span>
              <span className="font-mono font-black text-[#0F5B38]">{money(num(doc.totalTTC))}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shared read-only document table used by the consultation screens. */
function DocumentsTable({
  rows,
  extraColumns,
  extraActions,
  onRowClick,
  emptyMessage
}: {
  rows: DocumentRow[];
  extraColumns?: Column<DocumentRow>[];
  extraActions?: (d: DocumentRow) => React.ReactNode;
  onRowClick?: (d: DocumentRow) => void;
  emptyMessage: string;
}) {
  return (
    <DataTable
      columns={[
        { key: 'ref', header: 'Référence', render: (d: DocumentRow) => <span className="font-mono font-bold">{d.reference}</span> },
        { key: 'type', header: 'Type', render: (d) => <span className="text-slate-600">{d.type}</span> },
        { key: 'partner', header: 'Partenaire', render: (d) => d.partner?.raisonSociale ?? '—' },
        { key: 'date', header: 'Date', render: (d) => dateShort(d.createdAt) },
        { key: 'ttc', header: 'Total TTC', align: 'right', render: (d) => <span className="font-mono">{money(num(d.totalTTC))}</span> },
        { key: 'status', header: 'Statut', align: 'center', render: (d) => <StatusBadge status={d.status} /> },
        ...(extraColumns ?? []),
        ...(extraActions ? [{ key: 'actions', header: '', align: 'right' as const, render: extraActions }] : [])
      ]}
      rows={rows}
      rowKey={(d) => d.id}
      onRowClick={onRowClick}
      emptyMessage={emptyMessage}
    />
  );
}

/**
 * File d'attente de validation.
 *
 * Le logiciel actuel sépare toujours la saisie de la validation: n'importe qui
 * prépare un document, un responsable le valide. C'est cette séparation qui
 * permettra de restreindre la validation à l'administrateur sans toucher à la
 * saisie. L'écran est donc générique — bons de préparation, achats — plutôt que
 * dupliqué par type.
 */
export function ValidationQueueScreen({
  type,
  title,
  description,
  documents,
  onChanged,
  onPrint
}: {
  type: string;
  title: string;
  /** Rappelle à l'écran ce que « valider » déclenche réellement. */
  description: (enAttente: number) => string;
  documents: DocumentRow[];
  onChanged: () => Promise<void>;
  onPrint: (docId: string) => void;
}) {
  const toasts = useToasts();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const estBonPreparation = type === 'BON_PREPARATION';
  const queue = useMemo(() => documents.filter((d) => d.type === type && d.status === 'OUVERT'), [documents, type]);

  /**
   * Balayage des bons échus à l'ouverture de l'écran.
   *
   * Le poste serveur d'une petite structure n'est pas toujours allumé, donc une
   * tâche planifiée ne suffit pas: une réservation ne doit pas survivre à un
   * week-end machine éteinte. Le déclencheur est l'écran lui-même, qui est de
   * toute façon consulté avant chaque validation.
   */
  useEffect(() => {
    if (!estBonPreparation) return;
    let annule = false;
    (async () => {
      try {
        const { count } = await apiRequest<{ liberes: string[]; count: number }>(
          '/documents/expire-bons-preparation',
          { method: 'POST' }
        );
        if (annule || count === 0) return;
        toasts.info(`${count} bon(s) échu(s) — réservations libérées.`);
        await onChanged();
      } catch {
        // Le balayage est un entretien de fond: son échec ne doit pas empêcher
        // l'écran de s'afficher ni la validation de fonctionner.
      }
    })();
    return () => {
      annule = true;
    };
    // Volontairement au montage seulement: relancer le balayage à chaque
    // rafraîchissement provoquerait une boucle (balayage -> onChanged -> rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(doc: DocumentRow, action: 'validate' | 'delete') {
    setBusyId(doc.id);
    try {
      if (action === 'validate') {
        await apiRequest(`/documents/${doc.id}/validate`, { method: 'POST' });
        toasts.success(`${doc.reference} validé — stock et solde mis à jour.`);
      } else {
        await apiRequest(`/documents/${doc.id}`, { method: 'DELETE' });
        toasts.success(`${doc.reference} supprimé — réservations libérées.`);
      }
      await onChanged();
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen title={title} description={description(queue.length)} maxWidth="max-w-full">
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-2 flex-1 min-h-0">
          <DocumentsTable
            rows={queue}
            onRowClick={(d) => setApercu(d.id)}
            emptyMessage="Aucun document en attente de validation."
            extraColumns={
              estBonPreparation
                ? [
                    {
                      key: 'validite',
                      header: 'Validité',
                      align: 'center',
                      render: (d: DocumentRow) => <EcheanceBP dateValidite={d.dateValidite} />
                    }
                  ]
                : undefined
            }
            extraActions={(d) => (
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => onPrint(d.id)}>
                  Imprimer
                </Button>
                <Button size="sm" variant="danger" disabled={busyId === d.id} onClick={() => act(d, 'delete')}>
                  Supprimer
                </Button>
                <Button size="sm" variant="primary" disabled={busyId === d.id} onClick={() => act(d, 'validate')}>
                  {busyId === d.id ? '…' : 'Valider'}
                </Button>
              </div>
            )}
          />
        </div>
      </Card>
      {apercu && <ApercuDocument documentId={apercu} onClose={() => setApercu(null)} />}
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

/** Generic filtered document list, powering Achats / Liste des BP / Archive. */
export function DocumentListScreen({
  title,
  description,
  documents,
  types,
  statuses,
  onPrint
}: {
  title: string;
  description: string;
  documents: DocumentRow[];
  types: string[];
  statuses?: string[];
  onPrint: (docId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('TOUS');
  const [apercu, setApercu] = useState<string | null>(null);

  /**
   * Filtre par période sur la date du document. C'est la date de saisie qui
   * fait foi, pas celle de validation: un bon préparé le 12 et validé le 15
   * reste un document du 12 pour qui le cherche.
   */
  const periode = useDateRange(documents, (d) => d.createdAt);

  const parType = useMemo(
    () =>
      periode.filtered
        .filter((d) => types.includes(d.type))
        .filter((d) => (statuses ? statuses.includes(d.status) : true))
        .filter((d) => (statusFilter === 'TOUS' ? true : d.status === statusFilter)),
    [periode.filtered, types, statuses, statusFilter]
  );

  const { search, setSearch, filtered: rows } = useTextFilter(parType, (d) => [
    d.reference,
    d.partner?.raisonSociale,
    d.partner?.code,
    d.motif
  ]);

  const statusChips = ['TOUS', ...(statuses ?? ['OUVERT', 'VALIDE', 'ANNULE', 'EXPIRE'])];

  return (
    <Screen title={title} description={description} maxWidth="max-w-full">
      <Card className="flex-1 min-h-0" padded={false}>
        {/*
          Recherche, periode et statuts sur UNE seule ligne. Empilees, les trois
          barres poussaient la premiere ligne de donnees a plus de 400 px du haut
          — la moitie de la hauteur utile passait en filtres.
        */}
        <div className="px-2 py-1.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <div className="w-56 shrink-0">
            <SearchInput value={search} onChange={setSearch} placeholder="Référence, partenaire ou motif…" />
          </div>
          <DateRangeFilter
            du={periode.du}
            au={periode.au}
            onDu={periode.setDu}
            onAu={periode.setAu}
            onReset={periode.reset}
            actif={periode.actif}
          />
          <div className="flex gap-1">
            {statusChips.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                  statusFilter === s ? 'bg-[#0F5B38] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {s === 'TOUS' ? 'Tous' : statusLabel(s)}
              </button>
            ))}
          </div>
          <span className="ml-auto text-slate-400 text-[11px]">{rows.length} document(s)</span>
        </div>
        <div className="p-2 flex-1 min-h-0">
          <DocumentsTable
            rows={rows}
            onRowClick={(d) => setApercu(d.id)}
            emptyMessage="Aucun document ne correspond."
            extraActions={(d) => (
              <Button size="sm" variant="secondary" onClick={() => onPrint(d.id)}>
                Imprimer
              </Button>
            )}
          />
        </div>
      </Card>
      {apercu && <ApercuDocument documentId={apercu} onClose={() => setApercu(null)} />}
    </Screen>
  );
}

/** Mouvement d'un article — chronological stock ledger with running balance. */
interface MovementRow {
  date: string;
  reference: string;
  type: string;
  depot: string;
  partner: string | null;
  qty: number;
  runningQty: number;
}

export function MouvementArticleScreen({ articles }: { articles: Article[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Article | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter((a) => a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q));
  }, [articles, search]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    apiRequest<MovementRow[]>(`/articles/${selected.id}/movements`)
      .then(setMovements)
      .catch(() => setMovements([]))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <Screen title="Mouvement d'un article" description="Chaque entrée/sortie validée, avec solde courant." maxWidth="max-w-full">
      <div className="flex-1 flex gap-4 min-h-0">
        <Card className="w-80 shrink-0" padded={false}>
          <div className="px-2 py-1.5 border-b border-slate-100">
            <SearchInput value={search} onChange={setSearch} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-slate-50 transition ${
                  selected?.id === a.id ? 'bg-[#0F5B38]/10' : 'hover:bg-slate-50'
                }`}
              >
                <div className="font-mono font-bold text-slate-800">{a.code}</div>
                <div className="text-slate-600 truncate">{a.designation}</div>
              </button>
            ))}
          </div>
        </Card>
        <Card className="flex-1 min-w-0" padded={false}>
          <div className="p-2 flex-1 min-h-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center h-full text-slate-400 text-xs">Sélectionnez un article.</div>
            ) : (
              <DataTable
                loading={loading}
                columns={[
                  { key: 'date', header: 'Date', render: (m: MovementRow) => dateTime(m.date) },
                  { key: 'ref', header: 'Référence', render: (m) => <span className="font-mono font-bold">{m.reference}</span> },
                  { key: 'type', header: 'Type', render: (m) => m.type },
                  { key: 'depot', header: 'Dépôt', render: (m) => m.depot },
                  { key: 'partner', header: 'Partenaire', render: (m) => m.partner ?? '—' },
                  {
                    key: 'qty',
                    header: 'Qté',
                    align: 'right',
                    render: (m) => (
                      <span className={`font-mono font-bold ${m.qty >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {m.qty >= 0 ? '+' : ''}
                        {m.qty}
                      </span>
                    )
                  },
                  { key: 'run', header: 'Solde', align: 'right', render: (m) => <span className="font-mono font-bold">{m.runningQty}</span> }
                ]}
                rows={movements}
                rowKey={(m) => `${m.reference}-${m.depot}-${m.qty}`}
                emptyMessage="Aucun mouvement validé pour cet article."
              />
            )}
          </div>
        </Card>
      </div>
    </Screen>
  );
}

/**
 * Articles à réapprovisionner: thresholds are editable inline, alerts (available
 * below threshold) rise to the top with a red badge.
 */
export function ReapproScreen({ articles, onChanged }: { articles: Article[]; onChanged: () => Promise<void> }) {
  const toasts = useToasts();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      articles
        .map((a) => {
          const available = Object.values(a.stocksByDepot).reduce((s, d) => s + d.qtyInStock - d.qtyReserved, 0);
          const seuil = a.seuilReappro ?? null;
          return { ...a, available, seuil, alert: seuil != null && available < seuil };
        })
        .sort((x, y) => Number(y.alert) - Number(x.alert) || x.available - y.available),
    [articles]
  );

  const alertCount = rows.filter((r) => r.alert).length;

  async function saveSeuil(articleId: string) {
    const raw = drafts[articleId];
    if (raw === undefined) return;
    const value = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
    if (value !== null && Number.isNaN(value)) return;
    setSavingId(articleId);
    try {
      await apiRequest(`/articles/${articleId}`, { method: 'PUT', body: { seuilReappro: value } });
      setDrafts((d) => {
        const { [articleId]: _drop, ...rest } = d;
        return rest;
      });
      await onChanged();
      toasts.success('Seuil mis à jour.');
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Screen
      title="Articles à réapprovisionner"
      description="Alerte lorsque le stock disponible passe sous le seuil défini par article."
      maxWidth="max-w-full"
      actions={alertCount > 0 ? <Badge tone="danger">{alertCount} alerte(s)</Badge> : <Badge tone="success">Aucune alerte</Badge>}
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-2 flex-1 min-h-0">
          <DataTable
            columns={[
              {
                key: 'article',
                header: 'Article',
                render: (r: (typeof rows)[number]) => (
                  <span>
                    <span className="font-mono font-bold text-[#0F5B38] mr-2">{r.code}</span>
                    {r.designation}
                  </span>
                )
              },
              { key: 'avail', header: 'Disponible', align: 'center', render: (r) => <span className="font-mono font-bold">{r.available}</span> },
              {
                key: 'seuil',
                header: 'Seuil de réappro',
                align: 'center',
                render: (r) => (
                  <div className="flex items-center justify-center gap-1.5">
                    <Input
                      value={drafts[r.id] ?? (r.seuil == null ? '' : String(r.seuil))}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="—"
                      className="w-20 text-center font-mono py-1"
                    />
                    {drafts[r.id] !== undefined && (
                      <Button size="sm" variant="primary" disabled={savingId === r.id} onClick={() => saveSeuil(r.id)}>
                        OK
                      </Button>
                    )}
                  </div>
                )
              },
              {
                key: 'state',
                header: 'État',
                align: 'center',
                render: (r) =>
                  r.seuil == null ? (
                    <Badge tone="neutral">Sans seuil</Badge>
                  ) : r.alert ? (
                    <Badge tone="danger">À commander</Badge>
                  ) : (
                    <Badge tone="success">OK</Badge>
                  )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="Aucun article."
          />
        </div>
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
