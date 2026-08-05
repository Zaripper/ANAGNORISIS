import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Input, Screen, money } from '../components/ui';
import { CompanySettings, printHtml } from '../services/print';

// ---------------------------------------------------------------------------
// Chiffre d'affaires par agent (livreur)
// ---------------------------------------------------------------------------
interface CALivreurRow {
  code: string;
  name: string;
  ventesHT: number;
  avoirsHT: number;
  caNetHT: number;
  margeHT: number;
  documents: number;
}

export function CALivreursScreen() {
  const [months, setMonths] = useState(12);
  const [rows, setRows] = useState<CALivreurRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<CALivreurRow[]>(`/reports/ca-livreurs?months=${months}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [months]);

  const total = rows.reduce((s, r) => s + r.caNetHT, 0);

  return (
    <Screen
      title="Chiffre d'affaires par agent"
      description="Ventes validées (nettes des avoirs) regroupées par livreur/agent affecté au document."
      maxWidth="max-w-4xl"
      actions={
        <div className="flex gap-1">
          {[3, 6, 12, 24].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                months === m ? 'bg-[#0F5B38] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {m} mois
            </button>
          ))}
        </div>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          <DataTable
            loading={loading}
            columns={[
              {
                key: 'agent',
                header: 'Agent',
                render: (r: CALivreurRow) => (
                  <span>
                    <span className="font-mono font-bold text-[#0F5B38] mr-2">{r.code}</span>
                    {r.name}
                  </span>
                )
              },
              { key: 'docs', header: 'Documents', align: 'center', render: (r) => r.documents },
              { key: 'ventes', header: 'Ventes HT', align: 'right', render: (r) => <span className="font-mono">{money(r.ventesHT)}</span> },
              { key: 'avoirs', header: 'Avoirs HT', align: 'right', render: (r) => <span className="font-mono text-rose-600">{r.avoirsHT ? '−' + money(r.avoirsHT) : '—'}</span> },
              { key: 'net', header: 'CA net HT', align: 'right', render: (r) => <span className="font-mono font-bold">{money(r.caNetHT)}</span> },
              { key: 'marge', header: 'Marge HT', align: 'right', render: (r) => <span className="font-mono text-[#0F5B38]">{money(r.margeHT)}</span> },
              {
                key: 'share',
                header: 'Part',
                align: 'right',
                render: (r) => <span className="font-mono text-slate-500">{total > 0 ? ((r.caNetHT / total) * 100).toFixed(1) + ' %' : '—'}</span>
              }
            ]}
            rows={rows}
            rowKey={(r) => r.code + r.name}
            emptyMessage="Aucune vente sur la période."
          />
        </div>
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Fiscal working papers (TVA / Timbre / TAP / G50) — explicitly non-authoritative
// ---------------------------------------------------------------------------
interface FiscalMonth {
  month: string;
  ventesHT: number;
  tvaCollectee: number;
  achatsHT: number;
  tvaDeductible: number;
  timbre: number;
  tvaAPayer: number;
}

export type FiscalKind = 'TVA' | 'ETAT104' | 'TAP' | 'G50';

const FISCAL_TITLES: Record<FiscalKind, { title: string; description: string }> = {
  TVA: { title: 'Déclaration TVA — document de travail', description: 'TVA collectée sur ventes validées vs TVA déductible sur achats validés.' },
  ETAT104: { title: 'État 104 et Timbre — document de travail', description: 'Ventes mensuelles et timbre fiscal réellement facturé sur les ventes en espèces.' },
  TAP: { title: 'Déclaration TAP — document de travail', description: "Chiffre d'affaires mensuel avec TAP calculée au taux choisi." },
  G50: { title: 'État G50 — document de travail', description: 'Synthèse mensuelle: CA, TVA à payer, timbre et TAP.' }
};

export function FiscalScreen({ kind, settings }: { kind: FiscalKind; settings: CompanySettings }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<FiscalMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [tapRate, setTapRate] = useState('1.5');

  useEffect(() => {
    setLoading(true);
    apiRequest<FiscalMonth[]>(`/reports/fiscal?year=${year}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [year]);

  const meta = FISCAL_TITLES[kind];
  const tap = (Number(tapRate.replace(',', '.')) || 0) / 100;

  const columns = useMemo(() => {
    const base = [{ key: 'month', header: 'Mois', render: (r: FiscalMonth) => <span className="font-mono font-bold">{r.month}</span> }];
    const ca = { key: 'ca', header: 'CA HT (net)', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.ventesHT)}</span> };
    switch (kind) {
      case 'TVA':
        return [
          ...base,
          ca,
          { key: 'coll', header: 'TVA collectée', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.tvaCollectee)}</span> },
          { key: 'achats', header: 'Achats HT', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.achatsHT)}</span> },
          { key: 'ded', header: 'TVA déductible', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.tvaDeductible)}</span> },
          {
            key: 'due',
            header: 'TVA à payer',
            align: 'right' as const,
            render: (r: FiscalMonth) => (
              <span className={`font-mono font-bold ${r.tvaAPayer >= 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{money(r.tvaAPayer)}</span>
            )
          }
        ];
      case 'ETAT104':
        return [
          ...base,
          ca,
          { key: 'timbre', header: 'Timbre fiscal', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono font-bold">{money(r.timbre)}</span> }
        ];
      case 'TAP':
        return [
          ...base,
          ca,
          { key: 'tap', header: `TAP (${tapRate} %)`, align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono font-bold">{money(r.ventesHT * tap)}</span> }
        ];
      case 'G50':
        return [
          ...base,
          ca,
          { key: 'tva', header: 'TVA à payer', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.tvaAPayer)}</span> },
          { key: 'timbre', header: 'Timbre', align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.timbre)}</span> },
          { key: 'tap', header: `TAP (${tapRate} %)`, align: 'right' as const, render: (r: FiscalMonth) => <span className="font-mono">{money(r.ventesHT * tap)}</span> }
        ];
    }
  }, [kind, tap, tapRate]);

  function printReport() {
    const header = `${settings['company.name'] ?? ''} — NIF ${settings['company.nif'] ?? '—'} — AI ${settings['company.ai'] ?? '—'}`;
    const body = rows
      .map((r) => {
        const cells: string[] = [r.month, money(r.ventesHT)];
        if (kind === 'TVA') cells.push(money(r.tvaCollectee), money(r.achatsHT), money(r.tvaDeductible), money(r.tvaAPayer));
        if (kind === 'ETAT104') cells.push(money(r.timbre));
        if (kind === 'TAP') cells.push(money(r.ventesHT * tap));
        if (kind === 'G50') cells.push(money(r.tvaAPayer), money(r.timbre), money(r.ventesHT * tap));
        return `<tr>${cells.map((c, i) => `<td style="text-align:${i === 0 ? 'left' : 'right'};padding:4px 8px;border-bottom:1px solid #ddd;font-family:Consolas,monospace">${c}</td>`).join('')}</tr>`;
      })
      .join('');
    const heads = (columns ?? []).map((c) => `<th style="text-align:left;padding:4px 8px;background:#0F5B38;color:#fff">${c.header}</th>`).join('');
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px}</style></head><body>
      <h2 style="margin:0">${meta.title} — ${year}</h2>
      <div style="color:#555;margin:2px 0 8px">${header}</div>
      <div style="border:1.5px solid #b45309;color:#b45309;font-weight:700;padding:6px 10px;border-radius:6px;margin-bottom:10px">
        DOCUMENT DE TRAVAIL NON CONTRACTUEL — chiffres à faire vérifier par votre comptable avant toute déclaration.
      </div>
      <table style="width:100%;border-collapse:collapse"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`);
  }

  return (
    <Screen
      title={meta.title}
      description={meta.description}
      maxWidth="max-w-4xl"
      actions={
        <div className="flex items-center gap-2">
          {kind === 'TAP' || kind === 'G50' ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400">Taux TAP %</span>
              <Input value={tapRate} onChange={(e) => setTapRate(e.target.value)} className="w-16 text-right font-mono py-1" />
            </div>
          ) : null}
          <div className="flex gap-1">
            {[year - 1, year, year + 1].map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                  y === year ? 'bg-[#0F5B38] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={printReport} disabled={rows.length === 0}>
            Imprimer
          </Button>
        </div>
      }
    >
      <Card className="shrink-0 border-amber-200 bg-amber-50/60">
        <p className="text-[11px] text-amber-800 leading-relaxed">
          <b>Document de travail, non contractuel.</b> Ces montants sont calculés à partir des documents validés dans le système et servent de
          base de travail pour votre comptable. Ils ne remplacent pas la déclaration officielle et doivent être vérifiés avant tout dépôt.
        </p>
      </Card>
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          <DataTable loading={loading} columns={columns ?? []} rows={rows} rowKey={(r) => r.month} emptyMessage="Aucune donnée pour cette année." />
        </div>
      </Card>
    </Screen>
  );
}
