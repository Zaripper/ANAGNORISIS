import React, { useEffect, useState } from 'react';
import { Database, Download, HardDriveDownload } from 'lucide-react';
import { apiRequest, getApiBase, getToken } from '../services/apiClient';
import { Button, Card, DataTable, Screen, Select, ToastHost, useToasts } from '../components/ui';

/**
 * Maintenance tools (admin): logical JSON backup of the database, per-year
 * archive export, and a read-only raw table browser for support/debugging.
 */

/** Authenticated file download: fetch with the bearer token, save via a blob URL. */
async function downloadExport(params: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/backup/export${params}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ''}` }
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function SauvegardeScreen() {
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);

  async function backup() {
    setBusy(true);
    try {
      await downloadExport('', 'anagnorisis-backup.json');
      toasts.success('Sauvegarde téléchargée — conservez-la hors du poste serveur.');
    } catch {
      toasts.error('Export impossible. Vérifiez la connexion au serveur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Sauvegarde" description="Export logique de la base — à conserver sur un support externe." maxWidth="max-w-2xl">
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0F5B38]/10 text-[#0F5B38] flex items-center justify-center shrink-0">
            <HardDriveDownload className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-slate-900 text-sm">Sauvegarde JSON complète</div>
            <p className="text-slate-500 text-[11px] mt-1 leading-relaxed">
              Toutes les données (partenaires, articles, documents, trésorerie, paramètres) dans un fichier JSON horodaté,
              téléchargeable depuis n'importe quel poste. Recommandé: une sauvegarde par jour ouvré, conservée hors site.
            </p>
            <Button variant="primary" className="mt-3" onClick={backup} disabled={busy}>
              <Download className="w-3.5 h-3.5" /> {busy ? 'Export en cours…' : 'Télécharger la sauvegarde'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Sauvegarde binaire complète (recommandée en plus)" className="shrink-0">
        <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
          Pour une restauration à l'identique, planifiez aussi <code className="font-mono bg-slate-100 px-1 rounded">pg_dump</code> sur le poste
          serveur (Planificateur de tâches Windows) :
        </p>
        <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-[10px] font-mono overflow-x-auto">
{`pg_dump -U postgres -F c -f "D:\\sauvegardes\\anagnorisis-%DATE%.dump" anagnorisis
:: restauration :
pg_restore -U postgres -d anagnorisis --clean "D:\\sauvegardes\\anagnorisis-....dump"`}
        </pre>
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

export function ArchivageScreen() {
  const toasts = useToasts();
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    try {
      await downloadExport(`?year=${year}`, `anagnorisis-archive-${year}.json`);
      toasts.success(`Archive ${year} téléchargée.`);
    } catch {
      toasts.error('Export impossible.');
    } finally {
      setBusy(false);
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  return (
    <Screen title="Archivage" description="Export d'un exercice complet (documents, lignes, trésorerie, charges) pour conservation légale." maxWidth="max-w-2xl">
      <Card>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-40">
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Exercice</label>
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" onClick={archive} disabled={busy}>
            <Download className="w-3.5 h-3.5" /> {busy ? 'Export…' : `Exporter l'exercice ${year}`}
          </Button>
        </div>
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          L'export n'efface rien: les documents restent consultables dans l'application. Il fournit une copie autonome de
          l'exercice à conserver avec vos pièces comptables.
        </p>
      </Card>
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Raw table browser (admin, read-only)
// ---------------------------------------------------------------------------
export function TablesScreen() {
  const [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest<string[]>('/admin/tables').then(setTables).catch(() => setTables([]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    apiRequest<Record<string, unknown>[]>(`/admin/tables/${selected}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selected]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Screen
      title="Tables (avancé)"
      description="Lecture seule, 200 lignes maximum par table — outil de support, pas un écran de gestion."
      maxWidth="max-w-6xl"
      actions={
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-400" />
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-52">
            <option value="">— Choisir une table —</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 flex-1 min-h-0">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs">Sélectionnez une table à inspecter.</div>
          ) : (
            <DataTable
              loading={loading}
              columns={columns.map((c) => ({
                key: c,
                header: c,
                render: (r: Record<string, unknown>) => {
                  const v = r[c];
                  const text = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                  return <span className="font-mono text-[10px] whitespace-nowrap">{text.length > 60 ? text.slice(0, 57) + '…' : text}</span>;
                }
              }))}
              rows={rows}
              rowKey={(r) => String((r as { id?: unknown }).id ?? JSON.stringify(r))}
              emptyMessage="Table vide."
            />
          )}
        </div>
      </Card>
    </Screen>
  );
}
