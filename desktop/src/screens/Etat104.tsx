import React, { useEffect, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Screen, money } from '../components/ui';
import { CompanySettings, printHtml } from '../services/print';

/**
 * État 104 — relevé annuel des clients.
 *
 * Une ligne par client avec ses identifiants fiscaux (NIF, RC, AI, NIS, NIN),
 * son adresse et le total de ses opérations sur l'exercice, nettes des avoirs.
 * Aucun seuil d'exclusion : tous les clients ayant réalisé des opérations sont
 * listés.
 *
 * Les clients dont les identifiants sont incomplets sont signalés à l'écran et
 * sur l'impression : la déclaration ne peut pas être déposée en l'état.
 */

interface Etat104Row {
  partnerId: string;
  code: string;
  raisonSociale: string;
  address: string | null;
  email: string | null;
  nif: string | null;
  rc: string | null;
  ai: string | null;
  nis: string | null;
  nin: string | null;
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
  operations: number;
  identifiantsManquants: string[];
}

export function Etat104Screen({ settings }: { settings: CompanySettings }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Etat104Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<Etat104Row[]>(`/reports/etat-104?year=${year}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [year]);

  const incomplets = rows.filter((r) => r.identifiantsManquants.length > 0);
  const totalHT = rows.reduce((s, r) => s + r.montantHT, 0);
  const totalTTC = rows.reduce((s, r) => s + r.montantTTC, 0);

  function printReport() {
    const body = rows
      .map(
        (r) => `<tr>
          <td>${r.raisonSociale}</td>
          <td class="m">${r.nif ?? '—'}</td>
          <td class="m">${r.rc ?? '—'}</td>
          <td class="m">${r.ai ?? '—'}</td>
          <td class="m">${r.nis ?? '—'}</td>
          <td class="m">${r.nin ?? '—'}</td>
          <td>${r.address ?? '—'}</td>
          <td class="r m">${money(r.montantHT)}</td>
          <td class="r m">${money(r.montantTTC)}</td>
        </tr>`
      )
      .join('');

    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Etat 104 ${year}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #0F5B38; color: #fff; padding: 5px 6px; text-align: left; font-size: 9px; }
        td { padding: 4px 6px; border-bottom: 1px solid #ddd; }
        .m { font-family: Consolas, monospace; }
        .r { text-align: right; }
        .warn { border: 1.5px solid #b45309; color: #b45309; font-weight: 700; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; }
      </style></head><body>
      <h2 style="margin:0">État 104 — Relevé des clients ${year}</h2>
      <div style="color:#555;margin:2px 0 10px">
        ${settings['company.name'] ?? ''} — NIF ${settings['company.nif'] ?? '—'} · RC ${settings['company.rc'] ?? '—'} ·
        AI ${settings['company.ai'] ?? '—'} · NIS ${settings['company.nis'] ?? '—'} · NIN ${settings['company.nin'] ?? '—'}
      </div>
      ${
        incomplets.length > 0
          ? `<div class="warn">${incomplets.length} client(s) sans identifiants fiscaux complets — à compléter avant dépôt.</div>`
          : ''
      }
      <table>
        <thead><tr>
          <th>Client</th><th>NIF</th><th>RC</th><th>AI</th><th>NIS</th><th>NIN</th><th>Adresse</th>
          <th class="r">Montant HT</th><th class="r">Montant TTC</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div style="margin-top:10px;text-align:right;font-weight:700">
        Total HT : ${money(totalHT)} DZD &nbsp;&nbsp; Total TTC : ${money(totalTTC)} DZD
      </div>
      <div style="margin-top:14px;font-size:9px;color:#777">
        Document de travail — à vérifier par le comptable avant dépôt.
      </div>
    </body></html>`);
  }

  return (
    <Screen
      title="État 104 — Relevé des clients"
      description="Un client par ligne, avec ses identifiants fiscaux et le total de ses opérations sur l'exercice."
      maxWidth="max-w-full"
      actions={
        <div className="flex items-center gap-2">
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
      {incomplets.length > 0 && (
        <Card className="shrink-0 border-amber-200 bg-amber-50/60">
          <p className="text-[11px] text-amber-800 leading-relaxed">
            <b>{incomplets.length} client(s)</b> n'ont pas tous leurs identifiants fiscaux (NIF, RC, AI, NIS, NIN). Complétez-les dans la
            fiche du partenaire avant de déposer la déclaration — les lignes concernées sont signalées ci-dessous.
          </p>
        </Card>
      )}

      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          <DataTable
            loading={loading}
            columns={[
              {
                key: 'client',
                header: 'Client',
                render: (r: Etat104Row) => (
                  <span>
                    <span className="font-mono font-bold text-[#0F5B38] mr-2">{r.code}</span>
                    {r.raisonSociale}
                  </span>
                )
              },
              { key: 'nif', header: 'NIF', render: (r) => <span className="font-mono text-[10px]">{r.nif ?? '—'}</span> },
              { key: 'rc', header: 'RC', render: (r) => <span className="font-mono text-[10px]">{r.rc ?? '—'}</span> },
              { key: 'ai', header: 'AI', render: (r) => <span className="font-mono text-[10px]">{r.ai ?? '—'}</span> },
              { key: 'nis', header: 'NIS', render: (r) => <span className="font-mono text-[10px]">{r.nis ?? '—'}</span> },
              { key: 'nin', header: 'NIN', render: (r) => <span className="font-mono text-[10px]">{r.nin ?? '—'}</span> },
              { key: 'ops', header: 'Opér.', align: 'center', render: (r) => r.operations },
              { key: 'ht', header: 'Montant HT', align: 'right', render: (r) => <span className="font-mono">{money(r.montantHT)}</span> },
              {
                key: 'ttc',
                header: 'Montant TTC',
                align: 'right',
                render: (r) => <span className="font-mono font-bold">{money(r.montantTTC)}</span>
              },
              {
                key: 'etat',
                header: '',
                align: 'center',
                render: (r) =>
                  r.identifiantsManquants.length > 0 ? (
                    <Badge tone="warning">{r.identifiantsManquants.join(', ').toUpperCase()}</Badge>
                  ) : (
                    <Badge tone="success">Complet</Badge>
                  )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.partnerId}
            emptyMessage="Aucune opération client sur cet exercice."
          />
        </div>
      </Card>
    </Screen>
  );
}
