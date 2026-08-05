import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Input, Screen, ToastHost, money, num, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { Article, Depot, Partner } from '../ui/App';

// ---------------------------------------------------------------------------
// Situation générale — one-page snapshot of the business
// ---------------------------------------------------------------------------
interface DashboardData {
  caMoisHT: number;
  margeMoisHT: number;
  achatsMoisHT: number;
  documentsOuverts: number;
  partenairesBloques: number;
  valeurStock: number;
  totalCreances: number;
  totalDettes: number;
}

export function SituationScreen({ articles, depots }: { articles: Article[]; depots: Depot[] }) {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [cashBalance, setCashBalance] = useState<number | null>(null);

  useEffect(() => {
    apiRequest<DashboardData>('/reports/dashboard').then(setDash).catch(() => setDash(null));
    apiRequest<{ totalBalance: number }>('/cash').then((r) => setCashBalance(num(r.totalBalance))).catch(() => setCashBalance(null));
  }, []);

  /** Stock valuation split by depot, computed from live stock rows at P.U.M.P. */
  const byDepot = useMemo(
    () =>
      depots.map((d) => {
        let qty = 0;
        let value = 0;
        let reserved = 0;
        for (const a of articles) {
          const s = a.stocksByDepot[d.id];
          if (!s) continue;
          qty += s.qtyInStock;
          reserved += s.qtyReserved;
          value += s.qtyInStock * a.pump;
        }
        return { depot: d, qty, reserved, value };
      }),
    [articles, depots]
  );

  const netPosition = dash ? dash.totalCreances - dash.totalDettes : 0;

  return (
    <Screen title="Situation générale" description="Photographie instantanée: stock, créances, dettes et trésorerie." maxWidth="max-w-5xl">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <Stat label="Valeur du stock (PUMP)" value={dash ? money(dash.valeurStock) : '…'} tone="brand" />
        <Stat label="Créances clients" value={dash ? money(dash.totalCreances) : '…'} tone="emerald" />
        <Stat label="Dettes fournisseurs" value={dash ? money(dash.totalDettes) : '…'} tone="rose" />
        <Stat label="Solde de caisse" value={cashBalance != null ? money(cashBalance) : '…'} tone={cashBalance != null && cashBalance < 0 ? 'rose' : 'brand'} />
      </div>

      <Card title="Stock par dépôt" padded={false} className="shrink-0">
        <div className="p-3">
          <DataTable
            columns={[
              { key: 'depot', header: 'Dépôt', render: (r: (typeof byDepot)[number]) => <span className="font-semibold">{r.depot.name}</span> },
              { key: 'qty', header: 'Unités en stock', align: 'right', render: (r) => <span className="font-mono">{r.qty}</span> },
              { key: 'rsv', header: 'Réservées', align: 'right', render: (r) => <span className="font-mono text-amber-600">{r.reserved || '—'}</span> },
              { key: 'val', header: 'Valorisation (PUMP)', align: 'right', render: (r) => <span className="font-mono font-bold">{money(r.value)} DZD</span> }
            ]}
            rows={byDepot}
            rowKey={(r) => r.depot.id}
            emptyMessage="Aucun dépôt."
          />
        </div>
      </Card>

      <Card title="Position nette" className="shrink-0">
        <p className="text-xs text-slate-600 leading-relaxed">
          Créances moins dettes: <b className={`font-mono ${netPosition >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{money(netPosition)} DZD</b>.{' '}
          {dash && dash.partenairesBloques > 0 ? (
            <>
              <Badge tone="danger">{dash.partenairesBloques} partenaire(s) au-dessus du seuil</Badge> — voir « Partenaires bloqués ».
            </>
          ) : (
            'Aucun partenaire au-dessus de son seuil autorisé.'
          )}{' '}
          {dash && dash.documentsOuverts > 0 && <>{dash.documentsOuverts} document(s) encore ouverts.</>}
        </p>
      </Card>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'emerald' | 'rose' }) {
  const colors = { brand: 'text-[#0F5B38]', emerald: 'text-emerald-700', rose: 'text-rose-600' };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-mono font-extrabold text-lg mt-0.5 tabular-nums ${colors[tone]}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graphes & indices — hand-rolled SVG, no chart dependency
// ---------------------------------------------------------------------------
interface CAMonth {
  month: string;
  caNetHT: number;
  achatsNetHT: number;
  margeHT: number;
}

interface TopArticle {
  articleId: string;
  code: string;
  designation: string;
  quantity: number;
  totalHT: number;
}

export function GraphesScreen() {
  const [months, setMonths] = useState<CAMonth[]>([]);
  const [top, setTop] = useState<TopArticle[]>([]);

  useEffect(() => {
    apiRequest<CAMonth[]>('/reports/chiffre-affaires?months=12').then(setMonths).catch(() => setMonths([]));
    apiRequest<TopArticle[]>('/reports/ventes-articles?limit=8').then(setTop).catch(() => setTop([]));
  }, []);

  return (
    <Screen title="Graphes & indices" description="Évolution sur 12 mois et palmarès des articles (documents validés)." maxWidth="max-w-5xl">
      <Card title="Chiffre d'affaires net vs marge (HT, 12 mois)" className="shrink-0">
        <CAChart data={months} />
      </Card>
      <Card title="Top articles par quantité vendue (net des avoirs)" className="flex-1 min-h-0 overflow-y-auto">
        <TopArticlesChart data={top} />
      </Card>
    </Screen>
  );
}

function CAChart({ data }: { data: CAMonth[] }) {
  const W = 860;
  const H = 220;
  const PAD = { l: 60, r: 10, t: 12, b: 26 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.caNetHT, d.margeHT)));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const barW = data.length ? Math.min(38, (innerW / data.length) * 0.55) : 0;
  const x = (i: number) => PAD.l + (innerW / Math.max(data.length, 1)) * (i + 0.5);
  const y = (v: number) => PAD.t + innerH * (1 - v / max);

  const marginPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(Math.max(d.margeHT, 0))}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Chiffre d'affaires mensuel">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize="8.5" fill="#94a3b8" fontFamily="Consolas,monospace">
              {Math.round((max * f) / 1000)}k
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.month}>
            <rect x={x(i) - barW / 2} y={y(d.caNetHT)} width={barW} height={Math.max(innerH - (y(d.caNetHT) - PAD.t), 0)} rx="4" fill="#0F5B38" opacity="0.85">
              <title>{`${d.month} — CA net ${money(d.caNetHT)} DZD`}</title>
            </rect>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#64748b" fontFamily="Consolas,monospace">
              {d.month.slice(5)}
            </text>
          </g>
        ))}
        <path d={marginPath} fill="none" stroke="#b45309" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={d.month} cx={x(i)} cy={y(Math.max(d.margeHT, 0))} r="3" fill="#b45309">
            <title>{`${d.month} — marge ${money(d.margeHT)} DZD`}</title>
          </circle>
        ))}
        <g fontSize="9" fontFamily="inherit">
          <rect x={PAD.l} y={2} width="10" height="10" rx="3" fill="#0F5B38" opacity="0.85" />
          <text x={PAD.l + 14} y={10} fill="#475569">CA net HT</text>
          <circle cx={PAD.l + 78} cy={7} r="4" fill="#b45309" />
          <text x={PAD.l + 86} y={10} fill="#475569">Marge HT</text>
        </g>
      </svg>
    </div>
  );
}

function TopArticlesChart({ data }: { data: TopArticle[] }) {
  const max = Math.max(1, ...data.map((d) => d.quantity));
  if (data.length === 0) return <div className="text-slate-400 text-xs py-8 text-center">Aucune vente validée.</div>;
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => (
        <div key={d.articleId} className="flex items-center gap-3">
          <div className="w-56 shrink-0 truncate text-[11px]">
            <span className="font-mono font-bold text-[#0F5B38] mr-1.5">{d.code}</span>
            <span className="text-slate-700">{d.designation}</span>
          </div>
          <div className="flex-1 h-5 bg-slate-100 rounded-lg overflow-hidden">
            <div
              className="h-full bg-[#0F5B38]/80 rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
              style={{ width: `${Math.max((d.quantity / max) * 100, 4)}%` }}
            >
              <span className="text-white text-[9px] font-bold font-mono">{d.quantity}</span>
            </div>
          </div>
          <span className="w-24 text-right font-mono text-[10px] text-slate-500 shrink-0">{money(d.totalHT)} HT</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Montants de blocage — credit thresholds, bulk-editable
// ---------------------------------------------------------------------------
export function MontantsBlocageScreen({ partners, onChanged }: { partners: Partner[]; onChanged: () => Promise<void> }) {
  const toasts = useToasts();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      partners
        .filter((p) => !p.categoryIsSupplier)
        .map((p) => ({ ...p, blocked: p.seuilAutorise > 0 && p.balance > p.seuilAutorise }))
        .sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.balance - a.balance),
    [partners]
  );

  async function save(partnerId: string) {
    const raw = drafts[partnerId];
    if (raw === undefined) return;
    const value = Math.max(0, Number(raw.replace(',', '.')) || 0);
    setSavingId(partnerId);
    try {
      await apiRequest(`/partners/${partnerId}`, { method: 'PUT', body: { seuilAutorise: value } });
      setDrafts((d) => {
        const { [partnerId]: _drop, ...rest } = d;
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

  const blockedCount = rows.filter((r) => r.blocked).length;

  return (
    <Screen
      title="Montants de blocage"
      description="Seuil de crédit autorisé par client. Au-delà, le client apparaît comme bloqué (0 = pas de limite)."
      maxWidth="max-w-4xl"
      actions={blockedCount > 0 ? <Badge tone="danger">{blockedCount} bloqué(s)</Badge> : <Badge tone="success">Aucun blocage</Badge>}
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          <DataTable
            columns={[
              {
                key: 'partner',
                header: 'Client',
                render: (r: (typeof rows)[number]) => (
                  <span>
                    <span className="font-mono font-bold text-[#0F5B38] mr-2">{r.code}</span>
                    {r.raisonSociale}
                  </span>
                )
              },
              {
                key: 'balance',
                header: 'Solde',
                align: 'right',
                render: (r) => <span className={`font-mono font-bold ${r.blocked ? 'text-rose-600' : 'text-slate-800'}`}>{money(r.balance)}</span>
              },
              {
                key: 'seuil',
                header: 'Seuil autorisé',
                align: 'center',
                render: (r) => (
                  <div className="flex items-center justify-center gap-1.5">
                    <Input
                      value={drafts[r.id] ?? String(r.seuilAutorise || '')}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="0 (illimité)"
                      inputMode="decimal"
                      className="w-28 text-right font-mono py-1"
                    />
                    {drafts[r.id] !== undefined && (
                      <Button size="sm" variant="primary" disabled={savingId === r.id} onClick={() => save(r.id)}>
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
                  r.seuilAutorise <= 0 ? <Badge tone="neutral">Sans limite</Badge> : r.blocked ? <Badge tone="danger">Bloqué</Badge> : <Badge tone="success">OK</Badge>
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="Aucun client."
          />
        </div>
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
