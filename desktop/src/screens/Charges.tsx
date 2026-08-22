import React, { useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Button, Card, DataTable, Field, Input, Modal, Screen, Select, ToastHost, dateShort, money, num, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { ChargeClass } from '../ui/App';

/**
 * Charges — operating expenses (rent, transport, salaries…), classed by the
 * admin-defined Classes de charges. Net profit = commercial margin − charges,
 * which is why these matter beyond bookkeeping.
 */

export interface ChargeRow {
  id: string;
  amount: number | string;
  description: string;
  paymentMode: string;
  date: string;
  chargeClass?: { code: string; label: string };
  chargeClassId: string;
}

export function ChargesScreen({ chargeClasses }: { chargeClasses: ChargeClass[] }) {
  const toasts = useToasts();
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const activeClasses = useMemo(() => chargeClasses.filter((c) => c.active !== false), [chargeClasses]);

  async function load() {
    setLoading(true);
    try {
      setRows(await apiRequest<ChargeRow[]>('/charges'));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  const monthTotal = useMemo(() => {
    const now = new Date();
    return rows
      .filter((r) => {
        const d = new Date(r.date);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, r) => s + num(r.amount), 0);
  }, [rows]);

  return (
    <Screen
      title="Charges"
      description="Dépenses de fonctionnement classées par nature."
      maxWidth="max-w-5xl"
      actions={
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase text-slate-400">Charges du mois</div>
            <div className="font-mono font-bold text-rose-600">{money(monthTotal)} DZD</div>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)} disabled={activeClasses.length === 0}>
            + Nouvelle charge
          </Button>
        </div>
      }
    >
      {activeClasses.length === 0 && (
        <Card>
          <p className="text-xs text-slate-500">
            Créez d'abord au moins une <b>classe de charges</b> (Fichier → Classes de charges) pour pouvoir saisir des dépenses.
          </p>
        </Card>
      )}
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="p-2 flex-1 min-h-0">
          <DataTable
            loading={loading}
            columns={[
              { key: 'date', header: 'Date', render: (r: ChargeRow) => dateShort(r.date) },
              {
                key: 'class',
                header: 'Classe',
                render: (r) => (
                  <span>
                    <span className="font-mono font-bold text-[#0F5B38] mr-1.5">{r.chargeClass?.code}</span>
                    {r.chargeClass?.label}
                  </span>
                )
              },
              { key: 'desc', header: 'Description', render: (r) => r.description },
              { key: 'mode', header: 'Mode', align: 'center', render: (r) => r.paymentMode },
              { key: 'amount', header: 'Montant', align: 'right', render: (r) => <span className="font-mono font-bold text-rose-600">{money(num(r.amount))}</span> }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="Aucune charge saisie."
          />
        </div>
      </Card>

      {creating && (
        <NewChargeModal
          classes={activeClasses}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
            toasts.success('Charge enregistrée.');
          }}
          onError={(m) => toasts.error(m)}
        />
      )}
      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

function NewChargeModal({
  classes,
  onClose,
  onSaved,
  onError
}: {
  classes: ChargeClass[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [chargeClassId, setChargeClassId] = useState(classes[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMode, setPaymentMode] = useState('ESPECE');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!chargeClassId || !description.trim() || !(value > 0)) return;
    setSaving(true);
    try {
      await apiRequest('/charges', {
        method: 'POST',
        body: { chargeClassId, amount: value, description: description.trim(), paymentMode, date: new Date(date).toISOString() }
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
      title="Nouvelle charge"
      onClose={onClose}
      width="max-w-md"
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
        <Field label="Classe de charge" required>
          <Select value={chargeClassId} onChange={(e) => setChargeClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.code})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DZD)" required>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className="text-right font-mono" />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Mode de paiement">
          <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            <option value="ESPECE">Espèces</option>
            <option value="CHEQUE">Chèque</option>
            <option value="TRAITE">Traite</option>
            <option value="VIREMENT">Virement</option>
          </Select>
        </Field>
        <Field label="Description" required>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex: Loyer local — août" />
        </Field>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
