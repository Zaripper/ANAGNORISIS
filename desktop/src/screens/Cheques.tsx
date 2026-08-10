import React, { useEffect, useMemo, useState } from 'react';
import { CHEQUE_ETAT_LABELS, canTransitionCheque, type ChequeEtat } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, DataTable, Field, Input, Modal, Screen, SearchInput, Select, ToastHost, dateShort, money, num, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { Partner } from '../ui/App';

/**
 * Chèques recette / dépense — suivi dans le temps, comme dans le logiciel actuel.
 *
 * Les onglets sont les états du chèque. Ils ne sont pas décoratifs: chaque
 * passage d'état porte un effet comptable précis, décrit dans le service
 * serveur. L'écran se contente de les déclencher et de rendre l'état lisible.
 *
 * Un chèque reçu commence « en instance »; un chèque émis est directement
 * « mis en paiement » — d'où des onglets différents selon le sens.
 */

interface ChequeRow {
  id: string;
  type: 'RECETTE' | 'DEPENSE';
  etat: ChequeEtat;
  numeroPiece: string | null;
  datePiece: string;
  numeroCheque: string;
  dateCheque: string | null;
  banque: string | null;
  montant: number | string;
  libelle: string | null;
  partner?: { code: string; raisonSociale: string; balance: number | string };
}

const ETAT_TONE: Record<ChequeEtat, 'neutral' | 'info' | 'success' | 'danger'> = {
  EN_INSTANCE: 'neutral',
  MIS_EN_PAIEMENT: 'info',
  PAYE: 'success',
  ANNULE: 'danger'
};

export function ChequesScreen({
  type,
  partners,
  onSaved
}: {
  type: 'RECETTE' | 'DEPENSE';
  partners: Partner[];
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const [rows, setRows] = useState<ChequeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Un chèque émis ne passe jamais par « en instance »: il est parti dès sa création.
  const tabs: ChequeEtat[] = type === 'RECETTE' ? ['EN_INSTANCE', 'MIS_EN_PAIEMENT', 'PAYE', 'ANNULE'] : ['MIS_EN_PAIEMENT', 'PAYE', 'ANNULE'];
  const [tab, setTab] = useState<ChequeEtat>(tabs[0]);

  async function load() {
    setLoading(true);
    try {
      setRows(await apiRequest<ChequeRow[]>(`/cheques?type=${type}`));
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTab(type === 'RECETTE' ? 'EN_INSTANCE' : 'MIS_EN_PAIEMENT');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const counts = useMemo(() => {
    const c: Partial<Record<ChequeEtat, number>> = {};
    for (const r of rows) c[r.etat] = (c[r.etat] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => r.etat === tab)
      .filter(
        (r) =>
          !q ||
          r.numeroCheque.toLowerCase().includes(q) ||
          (r.partner?.raisonSociale ?? '').toLowerCase().includes(q) ||
          (r.banque ?? '').toLowerCase().includes(q)
      );
  }, [rows, tab, search]);

  const total = visible.reduce((s, r) => s + num(r.montant), 0);

  async function transition(row: ChequeRow, etat: ChequeEtat) {
    setBusyId(row.id);
    try {
      await apiRequest(`/cheques/${row.id}/etat`, { method: 'PUT', body: { etat } });
      await load();
      await onSaved();
      toasts.success(`Chèque ${row.numeroCheque} → ${CHEQUE_ETAT_LABELS[etat]}.`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      toasts.error(raw.startsWith('TRANSITION_INTERDITE') ? 'Ce chèque est clôturé: son état ne peut plus changer.' : describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  const title = type === 'RECETTE' ? 'Chèques recette' : 'Chèques dépense';

  return (
    <Screen
      title={title}
      description={
        type === 'RECETTE'
          ? 'Chèques reçus des clients. Le solde est imputé à la remise; la banque au moment de l’encaissement.'
          : 'Chèques émis aux fournisseurs. Le solde est imputé à l’émission; la banque au moment du débit.'
      }
      maxWidth="max-w-6xl"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Nouveau chèque
        </Button>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${
                  tab === t ? 'bg-[#0F5B38] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {CHEQUE_ETAT_LABELS[t]}
                {counts[t] ? <span className="ml-1.5 opacity-70">({counts[t]})</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1 max-w-xs">
            <SearchInput value={search} onChange={setSearch} placeholder="N° chèque, partenaire, banque…" />
          </div>
          <span className="ml-auto text-[11px] text-slate-500">
            Total affiché: <b className="font-mono">{money(total)} DZD</b>
          </span>
        </div>

        <div className="p-3 flex-1 min-h-0">
          <DataTable
            loading={loading}
            columns={[
              { key: 'num', header: 'N° chèque', render: (r: ChequeRow) => <span className="font-mono font-bold">{r.numeroCheque}</span> },
              { key: 'date', header: 'Date', render: (r) => (r.dateCheque ? dateShort(r.dateCheque) : dateShort(r.datePiece)) },
              {
                key: 'partner',
                header: 'Partenaire',
                render: (r) => (
                  <span>
                    <span className="font-mono text-[10px] text-slate-400 mr-1.5">{r.partner?.code}</span>
                    {r.partner?.raisonSociale ?? '—'}
                  </span>
                )
              },
              { key: 'banque', header: 'Banque', render: (r) => r.banque ?? '—' },
              { key: 'montant', header: 'Montant', align: 'right', render: (r) => <span className="font-mono font-bold">{money(num(r.montant))}</span> },
              { key: 'etat', header: 'État', align: 'center', render: (r) => <Badge tone={ETAT_TONE[r.etat]}>{CHEQUE_ETAT_LABELS[r.etat]}</Badge> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (r) => (
                  <div className="flex justify-end gap-1.5">
                    {(['MIS_EN_PAIEMENT', 'PAYE', 'ANNULE'] as ChequeEtat[])
                      .filter((t) => canTransitionCheque(r.etat, t))
                      .map((t) => (
                        <Button
                          key={t}
                          size="sm"
                          variant={t === 'ANNULE' ? 'danger' : t === 'PAYE' ? 'primary' : 'secondary'}
                          disabled={busyId === r.id}
                          onClick={() => transition(r, t)}
                        >
                          {t === 'MIS_EN_PAIEMENT' ? 'Remettre' : t === 'PAYE' ? 'Encaisser' : 'Impayé'}
                        </Button>
                      ))}
                  </div>
                )
              }
            ]}
            rows={visible}
            rowKey={(r) => r.id}
            emptyMessage={`Aucun chèque « ${CHEQUE_ETAT_LABELS[tab]} ».`}
          />
        </div>
      </Card>

      {creating && (
        <NewChequeModal
          type={type}
          partners={partners}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
            await onSaved();
            toasts.success('Chèque enregistré.');
          }}
          onError={(m) => toasts.error(m)}
        />
      )}
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

function NewChequeModal({
  type,
  partners,
  onClose,
  onSaved,
  onError
}: {
  type: 'RECETTE' | 'DEPENSE';
  partners: Partner[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  // Un chèque reçu vient d'un client; un chèque émis va à un fournisseur.
  const pool = useMemo(
    () => partners.filter((p) => (type === 'RECETTE' ? !p.categoryIsSupplier : p.categoryIsSupplier)),
    [partners, type]
  );

  const [partnerId, setPartnerId] = useState(pool[0]?.id ?? '');
  const [numeroCheque, setNumeroCheque] = useState('');
  const [montant, setMontant] = useState('');
  const [banque, setBanque] = useState('');
  const [dateCheque, setDateCheque] = useState(() => new Date().toISOString().slice(0, 10));
  const [numeroPiece, setNumeroPiece] = useState('');
  const [libelle, setLibelle] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(montant.replace(',', '.'));
    if (!partnerId || !numeroCheque.trim() || !(value > 0)) {
      onError('Partenaire, numéro de chèque et montant sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/cheques', {
        method: 'POST',
        body: {
          type,
          partnerId,
          numeroCheque: numeroCheque.trim(),
          montant: value,
          banque: banque.trim() || null,
          dateCheque: dateCheque ? new Date(dateCheque).toISOString() : null,
          numeroPiece: numeroPiece.trim() || null,
          libelle: libelle.trim() || null
        }
      });
      await onSaved();
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={type === 'RECETTE' ? 'Nouveau chèque reçu' : 'Nouveau chèque émis'}
      description={
        type === 'RECETTE'
          ? 'Le solde du client est imputé dès maintenant; la banque suivra à l’encaissement.'
          : 'Le solde du fournisseur est imputé dès maintenant; la banque suivra au débit.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={saving} onClick={submit as unknown as React.MouseEventHandler<HTMLButtonElement>}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Partenaire" required>
          <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            {pool.map((p) => (
              <option key={p.id} value={p.id}>
                {p.raisonSociale} ({p.code})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="N° chèque" required>
            <Input value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Montant (DZD)" required>
            <Input value={montant} onChange={(e) => setMontant(e.target.value)} inputMode="decimal" className="text-right font-mono" />
          </Field>
          <Field label="Banque">
            <Input value={banque} onChange={(e) => setBanque(e.target.value)} />
          </Field>
          <Field label="Date du chèque">
            <Input type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} />
          </Field>
          <Field label="N° pièce">
            <Input value={numeroPiece} onChange={(e) => setNumeroPiece(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <Field label="Libellé">
          <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
