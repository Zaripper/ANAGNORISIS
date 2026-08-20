import React, { useEffect, useMemo, useState } from 'react';
import { CASH_STATUS_LABELS, type CashStatus } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  Modal,
  Screen,
  SearchInput,
  Select,
  ToastHost,
  dateTime,
  money,
  num,
  useToasts
} from '../components/ui';
import { describeError } from './ReferenceData';
import type { Partner } from '../ui/App';

/**
 * Saisie de la caisse et validation.
 *
 * Reprend la séparation du logiciel actuel: le caissier enregistre les
 * mouvements de la journée, un responsable les valide. Tant qu'une écriture est
 * en brouillon elle n'impute aucun solde — c'est ce délai qui permet de relire
 * une saisie avant qu'elle ne touche le compte d'un client.
 *
 * Les écritures nées d'un document ou d'un chèque arrivent déjà validées: elles
 * reflètent une opération validée ailleurs et n'ont pas à l'être deux fois.
 */

interface CashRow {
  id: string;
  type: 'RECETTE' | 'DEPENSE';
  amount: number | string;
  paymentMode: string;
  description: string;
  reference: string | null;
  status: CashStatus;
  createdAt: string;
  documentId: string | null;
  partner?: { code: string; raisonSociale: string } | null;
}

const STATUT_TON: Record<CashStatus, 'warning' | 'success' | 'danger'> = {
  OUVERT: 'warning',
  VALIDE: 'success',
  ANNULE: 'danger'
};

export function SaisieCaisseScreen({ partners, onSaved }: { partners: Partner[]; onSaved: () => Promise<void> }) {
  const toasts = useToasts();
  const [rows, setRows] = useState<CashRow[]>([]);
  const [tab, setTab] = useState<CashStatus>('OUVERT');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiRequest<{ transactions: CashRow[] }>('/cash?paymentMode=ESPECE');
      setRows(data.transactions);
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => r.status === tab)
      .filter(
        (r) =>
          !q ||
          r.description.toLowerCase().includes(q) ||
          (r.partner?.raisonSociale ?? '').toLowerCase().includes(q) ||
          (r.reference ?? '').toLowerCase().includes(q)
      );
  }, [rows, tab, search]);

  /** Solde net des écritures affichées: recettes moins dépenses. */
  const soldeAffiche = visibles.reduce((s, r) => s + num(r.amount) * (r.type === 'RECETTE' ? 1 : -1), 0);

  async function agir(row: CashRow, action: 'validate' | 'cancel') {
    setBusyId(row.id);
    try {
      await apiRequest(`/cash/${row.id}/${action}`, { method: 'POST' });
      toasts.success(
        action === 'validate'
          ? `Écriture validée — ${row.partner ? 'le solde du partenaire est imputé.' : 'portée en caisse.'}`
          : 'Écriture annulée.'
      );
      await load();
      await onSaved();
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen
      title="Saisie de la caisse et validation"
      description="Mouvements d'espèces. Une écriture en brouillon n'impute aucun solde tant qu'elle n'est pas validée."
      maxWidth="max-w-6xl"
      actions={
        <Button variant="primary" onClick={() => setShowForm(true)}>
          + Nouvelle écriture
        </Button>
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-3 border-b border-slate-100 flex items-center gap-3">
          <div className="flex gap-1">
            {(['OUVERT', 'VALIDE', 'ANNULE'] as CashStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                  tab === s ? 'bg-[#0F5B38] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {CASH_STATUS_LABELS[s]}
                {s === 'OUVERT' && rows.some((r) => r.status === 'OUVERT')
                  ? ` (${rows.filter((r) => r.status === 'OUVERT').length})`
                  : ''}
              </button>
            ))}
          </div>
          <div className="flex-1 max-w-sm">
            <SearchInput value={search} onChange={setSearch} placeholder="Libellé, partenaire ou pièce…" />
          </div>
          <span className="ml-auto text-slate-400 text-[11px]">
            Solde affiché: <span className="font-mono font-bold text-slate-600">{money(soldeAffiche)}</span>
          </span>
        </div>

        <div className="p-3 flex-1 min-h-0">
          <DataTable
            columns={[
              { key: 'date', header: 'Date', render: (r: CashRow) => dateTime(r.createdAt) },
              {
                key: 'sens',
                header: 'Sens',
                align: 'center',
                render: (r) => (
                  <Badge tone={r.type === 'RECETTE' ? 'success' : 'danger'}>{r.type === 'RECETTE' ? 'Recette' : 'Dépense'}</Badge>
                )
              },
              { key: 'libelle', header: 'Libellé', render: (r) => r.description },
              { key: 'partenaire', header: 'Partenaire', render: (r) => r.partner?.raisonSociale ?? '—' },
              {
                key: 'montant',
                header: 'Montant',
                align: 'right',
                render: (r) => <span className="font-mono font-bold">{money(num(r.amount))}</span>
              },
              {
                key: 'origine',
                header: 'Origine',
                align: 'center',
                render: (r) => (
                  <span className="text-[10px] text-slate-400">{r.documentId ? 'Document' : 'Saisie'}</span>
                )
              },
              {
                key: 'statut',
                header: 'État',
                align: 'center',
                render: (r) => <Badge tone={STATUT_TON[r.status]}>{CASH_STATUS_LABELS[r.status]}</Badge>
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (r) => (
                  <div className="flex justify-end gap-1.5">
                    {r.status === 'OUVERT' && (
                      <Button size="sm" variant="primary" disabled={busyId === r.id} onClick={() => agir(r, 'validate')}>
                        {busyId === r.id ? '…' : 'Valider'}
                      </Button>
                    )}
                    {/*
                     * Une écriture née d'un document ne s'annule pas ici: elle est le
                     * reflet de ce document. La contrepasser depuis le journal
                     * laisserait la facture « réglée » et la caisse en désaccord.
                     * C'est l'annulation du document qui doit faire le travail.
                     */}
                    {r.status !== 'ANNULE' && !r.documentId && (
                      <Button size="sm" variant="danger" disabled={busyId === r.id} onClick={() => agir(r, 'cancel')}>
                        Annuler
                      </Button>
                    )}
                    {r.documentId && r.status !== 'ANNULE' && (
                      <span className="text-[10px] text-slate-300 px-1" title="À annuler depuis le document d'origine">
                        —
                      </span>
                    )}
                  </div>
                )
              }
            ]}
            rows={visibles}
            rowKey={(r) => r.id}
            emptyMessage={loading ? 'Chargement…' : `Aucune écriture « ${CASH_STATUS_LABELS[tab]} ».`}
          />
        </div>
      </Card>

      {showForm && (
        <NouvelleEcritureModal
          partners={partners}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            setTab('OUVERT');
            await load();
            await onSaved();
            toasts.success('Écriture enregistrée en brouillon — elle attend sa validation.');
          }}
          onError={(m) => toasts.error(m)}
        />
      )}

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

function NouvelleEcritureModal({
  partners,
  onClose,
  onSaved,
  onError
}: {
  partners: Partner[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [type, setType] = useState<'RECETTE' | 'DEPENSE'>('RECETTE');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const montant = Number(amount);
    if (!Number.isFinite(montant) || montant <= 0) {
      onError('Le montant doit être supérieur à zéro.');
      return;
    }
    if (!description.trim()) {
      onError('Le libellé est obligatoire.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/cash', {
        method: 'POST',
        body: {
          type,
          amount: montant,
          paymentMode: 'ESPECE',
          description: description.trim(),
          partnerId: partnerId || null,
          reference: reference.trim() || null,
          // Saisie de caisse: toujours en brouillon. C'est tout l'objet de
          // l'écran — la validation est un geste distinct, fait par quelqu'un
          // d'autre.
          status: 'OUVERT'
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
      title="Nouvelle écriture de caisse"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer en brouillon'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sens" required>
          <Select value={type} onChange={(e) => setType(e.target.value as 'RECETTE' | 'DEPENSE')}>
            <option value="RECETTE">Recette (encaissement)</option>
            <option value="DEPENSE">Dépense (décaissement)</option>
          </Select>
        </Field>
        <Field label="Montant (DZD)" required>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Libellé" required>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: règlement facture 2026FC000012" />
          </Field>
        </div>
        <Field label="Partenaire" hint="Laisser vide pour un mouvement de caisse sans tiers.">
          <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">— Aucun —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.raisonSociale}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="N° de pièce">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
