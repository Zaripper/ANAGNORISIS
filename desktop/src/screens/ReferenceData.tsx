import React, { useMemo, useState } from 'react';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, Screen, SearchInput, Select, ToastHost, useToasts } from '../components/ui';
import type { Column } from '../components/ui';
import { REGULE_SENS_LABELS, type ReguleSens } from '@anagnorisis/shared';

/**
 * One reusable CRUD screen for every simple reference table (Livreurs, Zones,
 * Classes de charges, Types des régules, Dépôts).
 *
 * These used to be crammed into a single "Données de base" page that could only
 * *create* rows — there was no way to correct a typo or retire an obsolete entry,
 * and individual items had no menu presence of their own. Each now gets its own
 * screen and full create/edit/deactivate, driven by the field descriptors below.
 */

export interface RefField {
  key: string;
  label: string;
  type: 'text' | 'boolean' | 'select';
  /** Options d'une liste fermée (`type: 'select'`). */
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Codes are canonicalised to upper case, matching how the seed data is written. */
  uppercase?: boolean;
  placeholder?: string;
  mono?: boolean;
  /** Rendered in the table as a badge with this label when true. */
  badgeLabel?: string;
}

/**
 * Rows only need an id; fields are read positionally through the descriptors, so
 * concrete row types (Livreur, Zone, ...) stay plain interfaces without needing an
 * index signature.
 */
export interface RefEntity {
  id: string;
}

/** Field access helper — descriptors address columns by string key. */
function fieldValue(row: RefEntity, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

export function ReferenceDataScreen<T extends RefEntity>({
  title,
  description,
  endpoint,
  fields,
  rows,
  onRefresh,
  canEdit = true,
  searchKeys
}: {
  title: string;
  description: string;
  /** API path without leading slash segment duplication, e.g. `/livreurs`. */
  endpoint: string;
  fields: RefField[];
  rows: T[];
  onRefresh: () => Promise<void>;
  canEdit?: boolean;
  searchKeys: string[];
}) {
  const toasts = useToasts();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => searchKeys.some((k) => String(fieldValue(r, k) ?? '').toLowerCase().includes(q)));
  }, [rows, search, searchKeys]);

  const columns: Column<T>[] = [
    ...fields.map<Column<T>>((f) => ({
      key: f.key,
      header: f.label,
      align: f.type === 'boolean' ? 'center' : 'left',
      render: (row) => {
        const value = fieldValue(row, f.key);
        if (f.type === 'boolean') {
          if (f.badgeLabel) return value ? <Badge tone="success">{f.badgeLabel}</Badge> : null;
          return value === false ? <Badge tone="neutral">Inactif</Badge> : <Badge tone="success">Actif</Badge>;
        }
        if (f.type === 'select') {
          const option = f.options?.find((o) => o.value === value);
          return <span className="text-slate-600 text-xs">{option?.label ?? '—'}</span>;
        }
        const text = value == null || value === '' ? '—' : String(value);
        return <span className={f.mono ? 'font-mono font-bold text-[#0F5B38]' : 'text-slate-800'}>{text}</span>;
      }
    })),
    ...(canEdit
      ? [
          {
            key: '__actions',
            header: 'Actions',
            align: 'right' as const,
            width: '110px',
            render: (row: T) => (
              <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                Modifier
              </Button>
            )
          }
        ]
      : [])
  ];

  return (
    <Screen
      title={title}
      description={description}
      maxWidth="max-w-5xl"
      actions={
        canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Nouveau
          </Button>
        )
      }
    >
      <Card className="flex-1 min-h-0" padded={false}>
        <div className="px-2 py-1.5 border-b border-slate-100 flex items-center gap-3">
          <div className="flex-1 max-w-sm">
            <SearchInput value={search} onChange={setSearch} />
          </div>
          <span className="text-slate-400 text-[11px] ml-auto">
            {filtered.length} / {rows.length} élément(s)
          </span>
        </div>
        <div className="flex-1 min-h-0 p-3 pt-0">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            emptyMessage={search ? `Aucun résultat pour « ${search} ».` : 'Aucun élément. Utilisez « Nouveau » pour en créer un.'}
          />
        </div>
      </Card>

      {(creating || editing) && (
        <RefEntityModal
          title={editing ? `Modifier — ${title}` : `Nouveau — ${title}`}
          fields={fields}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={async (payload) => {
            try {
              if (editing) {
                await apiRequest(`${endpoint}/${editing.id}`, { method: 'PUT', body: payload });
                toasts.success('Modification enregistrée.');
              } else {
                await apiRequest(endpoint, { method: 'POST', body: payload });
                toasts.success('Élément créé.');
              }
              await onRefresh();
              setCreating(false);
              setEditing(null);
            } catch (err) {
              toasts.error(describeError(err));
            }
          }}
        />
      )}

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

/** Turns API error codes into something a shop manager can act on. */
/**
 * Traduction des codes d'erreur du serveur.
 *
 * Le serveur répond par des codes stables (`LOT_STOCK_INSUFFISANT`,
 * `RATIONED_ARTICLE:ART-A:10`…) parce qu'ils sont testables et ne changent pas
 * avec la langue. Mais un caissier n'a pas à lire ça: sans traduction il voit
 * une chaîne en majuscules et appelle quelqu'un. Chaque code que le serveur
 * peut lever a donc sa phrase ici.
 *
 * Certains codes portent un suffixe après « : » (le code article contingenté,
 * l'état de chèque refusé). Il est extrait pour rendre le message précis.
 */
const ERREURS: Record<string, string> = {
  VALIDATION_ERROR: 'Certains champs sont invalides ou manquants.',
  FORBIDDEN: "Votre rôle ne permet pas cette opération.",
  SESSION_EXPIRED: 'Session expirée, veuillez vous reconnecter.',
  INTERNAL_SERVER_ERROR: 'Erreur serveur. Réessayez ou contactez un administrateur.',

  // Stock
  INSUFFICIENT_STOCK: "Stock insuffisant pour cette quantité (le stock déjà réservé par d'autres documents est décompté).",
  STOCK_NOT_FOUND: "Cet article n'a pas de stock enregistré dans ce dépôt.",
  RESERVATION_MISMATCH: "La réservation de stock ne correspond plus au document. Rouvrez-le et enregistrez-le à nouveau.",
  ARTICLE_NOT_FOUND: 'Article introuvable.',

  // Lots et péremption
  LOT_REQUIS: 'Cet article est suivi par lot: indiquez un numéro de lot et une date de péremption.',
  LOT_STOCK_INSUFFISANT:
    "Pas assez de stock non périmé pour cette quantité. Les lots périmés ne sont jamais servis, même s'ils sont physiquement présents.",

  // Documents
  DOCUMENT_NOT_FOUND: 'Document introuvable.',
  DOCUMENT_CANCELLED: 'Ce document est annulé.',
  DOCUMENT_NOT_EDITABLE: "Seul un document ouvert peut être modifié ou supprimé.",
  DOCUMENT_EXPIRE: "Ce bon de préparation est échu: sa réservation de stock a été libérée. Créez-en un nouveau.",
  ONLY_VALIDATED_DOCUMENTS_CAN_BE_CANCELLED: 'Seul un document validé peut être annulé.',
  PARTNER_REQUIRED_FOR_TYPE: 'Ce type de document exige un partenaire.',
  PARTNER_NOT_FOUND: 'Partenaire introuvable.',
  DEST_DEPOT_REQUIRED_FOR_TRANSFER: 'Un transfert exige un dépôt de destination.',
  DEST_DEPOT_MUST_DIFFER_FROM_SOURCE: 'Le dépôt de destination doit être différent du dépôt de départ.',
  DEST_DEPOT_NOT_FOUND: 'Dépôt de destination introuvable.',
  LINE_QUANTITY_REQUIRED: 'Une ligne doit porter une quantité ou des unités gratuites.',

  // Commandes et bons de livraison
  NOT_A_COMMANDE: "Ce document n'est pas un bon de commande.",
  COMMANDE_ALREADY_RECEIVED_OR_CANCELLED: 'Cette commande a déjà été réceptionnée ou annulée.',
  NOT_A_BON_LIVRAISON: "Ce document n'est pas un bon de livraison.",
  BON_LIVRAISON_NOT_VALIDATED: 'Le bon de livraison doit être validé avant de pouvoir être facturé.',
  BON_LIVRAISON_ALREADY_INVOICED: 'Ce bon de livraison a déjà sa facture.',

  // Régularisations
  TYPE_REGULE_REQUIRED: 'Choisissez un type de régule: un écart de stock sans motif ne peut plus être expliqué ensuite.',
  TYPE_REGULE_NOT_FOUND: 'Motif de régularisation introuvable.',

  // Caisse et chèques
  CASH_ENTRY_NOT_FOUND: 'Écriture de caisse introuvable.',
  CASH_ENTRY_CANCELLED: 'Cette écriture est annulée: elle ne peut plus être validée.',
  CASH_ENTRY_FROM_DOCUMENT:
    "Cette écriture provient d'un document: annulez le document lui-même, sinon la facture resterait « réglée » alors que la caisse dit le contraire.",
  CHEQUE_NOT_FOUND: 'Chèque introuvable.',

  INVALID_DATE: 'Date invalide.'
};

export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Les codes à suffixe: on isole la racine et on réinjecte le détail.
  const [code, ...details] = raw.split(':');
  const detail = details.join(':').trim();

  if (ERREURS[raw]) return ERREURS[raw];

  switch (code) {
    case 'RATIONED_ARTICLE': {
      // RATIONED_ARTICLE:<code article>:<quantité max>
      const [article, max] = details;
      return `Article contingenté ${article ?? ''}: ${max ?? 'une quantité'} maximum par client et par document.`.trim();
    }
    case 'LOT_REQUIS':
      return `${ERREURS.LOT_REQUIS}${detail ? ` (article ${detail})` : ''}`;
    case 'TYPE_REGULE_INACTIF':
      return `Le motif « ${detail} » n'est plus actif: choisissez-en un autre.`;
    case 'TYPE_REGULE_MAUVAIS_SENS':
      return `Le motif « ${detail} » ne s'emploie pas dans ce sens (une casse n'explique pas une entrée de stock).`;
    case 'TRANSITION_INTERDITE':
      return "Ce changement d'état n'est pas permis pour ce chèque.";
    default:
      break;
  }

  if (ERREURS[code]) return ERREURS[code];
  // Prisma unique-constraint violations surface as a bare message; make them readable.
  if (raw.includes('Unique constraint') || raw.includes('P2002')) return 'Ce code existe déjà. Choisissez un code unique.';
  return raw;
}

function RefEntityModal<T extends RefEntity>({
  title,
  fields,
  initial,
  onClose,
  onSubmit
}: {
  title: string;
  fields: RefField[];
  initial: T | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of fields) {
      const existing = initial ? fieldValue(initial, f.key) : undefined;
      seed[f.key] =
        f.type === 'boolean'
          ? Boolean(existing ?? false)
          : ((existing as string) ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : ''));
    }
    // A brand new reference row is active unless the form says otherwise.
    if (!initial && fields.some((f) => f.key === 'active')) seed.active = true;
    return seed;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !String(values[f.key] ?? '').trim()) next[f.key] = 'Champ obligatoire';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'boolean') payload[f.key] = Boolean(v);
      else {
        const s = String(v ?? '').trim();
        payload[f.key] = f.uppercase ? s.toUpperCase() : s || null;
      }
    }
    try {
      await onSubmit(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Annuler
          </Button>
          <Button variant="primary" onClick={submit as unknown as React.MouseEventHandler<HTMLButtonElement>} disabled={saving}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {fields.map((f) =>
          f.type === 'boolean' ? (
            <Checkbox
              key={f.key}
              label={f.label}
              checked={Boolean(values[f.key])}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))}
            />
          ) : f.type === 'select' ? (
            <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
              <Select
                value={String(values[f.key] ?? '')}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
              <Input
                value={String(values[f.key] ?? '')}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={f.mono ? 'font-mono uppercase' : undefined}
              />
            </Field>
          )
        )}
        {/* Enables Enter-to-submit without exposing a second visible button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Field definitions per reference table
// ---------------------------------------------------------------------------
export const LIVREUR_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: LIV01' },
  { key: 'name', label: 'Nom complet', type: 'text', required: true, placeholder: 'ex: Karim Benali' },
  { key: 'phone', label: 'Téléphone', type: 'text', placeholder: 'ex: 0555 12 34 56' },
  { key: 'active', label: 'Actif', type: 'boolean' }
];

export const ZONE_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: ZN_CENTRE' },
  { key: 'name', label: 'Nom de la zone', type: 'text', required: true, placeholder: 'ex: Alger Centre' },
  { key: 'active', label: 'Active', type: 'boolean' }
];

export const CHARGE_CLASS_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: LOYER' },
  { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'ex: Loyer et charges locatives' },
  { key: 'active', label: 'Active', type: 'boolean' }
];

/**
 * Motifs de régularisation de stock.
 *
 * Le sens restreint le motif à l'opération qui a du sens: une casse n'explique
 * jamais une entrée de marchandise. Sans cette contrainte, un état des pertes
 * mélange des écarts qui n'ont rien à voir.
 */
export const TYPE_REGULE_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: CASSE' },
  { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'ex: Casse' },
  {
    key: 'sens',
    label: 'Sens autorisé',
    type: 'select',
    options: (Object.keys(REGULE_SENS_LABELS) as ReguleSens[]).map((v) => ({ value: v, label: REGULE_SENS_LABELS[v] }))
  },
  { key: 'active', label: 'Actif', type: 'boolean' }
];

export const DEPOT_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: DEPOT_NORD' },
  { key: 'name', label: 'Nom du dépôt', type: 'text', required: true, placeholder: 'ex: Dépôt Nord' },
  { key: 'isDefault', label: 'Dépôt par défaut', type: 'boolean', badgeLabel: 'Par défaut' }
];
