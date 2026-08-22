import React, { useEffect, useMemo, useState } from 'react';
import { evaluatePartnerBlocking } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, Field, Input, Screen, SearchInput, Select, ToastHost, money, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { Partner, PartnerCategoryOpt, Zone } from '../ui/App';

/**
 * Fichier → Partenaires — fiche partenaire complète, reprise du logiciel actuel.
 *
 * Seul endroit où un partenaire se crée ou se modifie. La fiche reprend les
 * quatre blocs de l'écran d'origine: Infos, Coordonnées, Contact/Autres, et
 * Blocage du partenaire.
 */

interface FormState {
  code: string;
  raisonSociale: string;
  categoryId: string;
  zoneId: string;
  address: string;
  pays: string;
  codePostal: string;
  ville: string;
  phone: string;
  fax: string;
  mobile: string;
  email: string;
  siteInternet: string;
  contact: string;
  rc: string;
  nif: string;
  ai: string;
  nis: string;
  nin: string;
  peutAvoirRefaction: boolean;
  seuilAutorise: string;
  blocageActif: boolean;
  blocageDateReference: string;
  blocageJours: string;
}

function emptyForm(categories: PartnerCategoryOpt[]): FormState {
  return {
    code: '',
    raisonSociale: '',
    categoryId: categories[0]?.id ?? '',
    zoneId: '',
    address: '',
    pays: '',
    codePostal: '',
    ville: '',
    phone: '',
    fax: '',
    mobile: '',
    email: '',
    siteInternet: '',
    contact: '',
    rc: '',
    nif: '',
    ai: '',
    nis: '',
    nin: '',
    peutAvoirRefaction: false,
    seuilAutorise: '0',
    blocageActif: false,
    blocageDateReference: '',
    blocageJours: ''
  };
}

function formFromPartner(p: Partner): FormState {
  const str = (v: unknown) => (v == null ? '' : String(v));
  return {
    code: p.code,
    raisonSociale: p.raisonSociale,
    categoryId: p.categoryId,
    zoneId: p.zoneId ?? '',
    address: str(p.address),
    pays: str(p.pays),
    codePostal: str(p.codePostal),
    ville: str(p.ville),
    phone: str(p.phone),
    fax: str(p.fax),
    mobile: str(p.mobile),
    email: str(p.email),
    siteInternet: str(p.siteInternet),
    contact: str(p.contact),
    rc: str(p.rc),
    nif: str(p.nif),
    ai: str(p.ai),
    nis: str(p.nis),
    nin: str(p.nin),
    peutAvoirRefaction: Boolean(p.peutAvoirRefaction),
    seuilAutorise: String(p.seuilAutorise ?? 0),
    blocageActif: Boolean(p.blocageActif),
    blocageDateReference: p.blocageDateReference ? String(p.blocageDateReference).slice(0, 10) : '',
    blocageJours: p.blocageJours == null ? '' : String(p.blocageJours)
  };
}

export function PartenairesFichierScreen({
  partners,
  categories,
  zones,
  onSaved
}: {
  partners: Partner[];
  categories: PartnerCategoryOpt[];
  zones: Zone[];
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => p.code.toLowerCase().includes(q) || p.raisonSociale.toLowerCase().includes(q));
  }, [partners, search]);

  const selected = partners.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setForm(null);
    setCreating(false);
  }, [selectedId]);

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  async function save() {
    if (!form) return;
    if (!form.code.trim() || !form.raisonSociale.trim() || !form.categoryId) {
      toasts.error('Code, raison sociale et catégorie sont obligatoires.');
      return;
    }
    setSaving(true);
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    const body = {
      code: form.code.trim().toUpperCase(),
      raisonSociale: form.raisonSociale.trim(),
      categoryId: form.categoryId,
      zoneId: form.zoneId || null,
      address: clean(form.address),
      pays: clean(form.pays),
      codePostal: clean(form.codePostal),
      ville: clean(form.ville),
      phone: clean(form.phone),
      fax: clean(form.fax),
      mobile: clean(form.mobile),
      email: clean(form.email),
      siteInternet: clean(form.siteInternet),
      contact: clean(form.contact),
      rc: clean(form.rc),
      nif: clean(form.nif),
      ai: clean(form.ai),
      nis: clean(form.nis),
      nin: clean(form.nin),
      peutAvoirRefaction: form.peutAvoirRefaction,
      seuilAutorise: Math.max(0, Number(form.seuilAutorise.replace(',', '.')) || 0),
      blocageActif: form.blocageActif,
      blocageDateReference: form.blocageDateReference ? new Date(form.blocageDateReference).toISOString() : null,
      blocageJours: form.blocageJours.trim() === '' ? null : Math.max(0, Math.floor(Number(form.blocageJours) || 0))
    };

    try {
      if (creating) {
        const created = await apiRequest<{ id: string }>('/partners', { method: 'POST', body });
        await onSaved();
        setSelectedId(created.id);
        toasts.success('Partenaire créé.');
      } else if (selected) {
        await apiRequest(`/partners/${selected.id}`, { method: 'PUT', body });
        await onSaved();
        toasts.success('Partenaire modifié.');
      }
      setForm(null);
      setCreating(false);
    } catch (err) {
      toasts.error(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!selected) return;
    try {
      await apiRequest(`/partners/${selected.id}`, { method: 'PUT', body: { active: false } });
      await onSaved();
      toasts.success(`${selected.code} désactivé.`);
      setSelectedId(null);
    } catch (err) {
      toasts.error(describeError(err));
    }
  }

  const editing = form !== null;

  return (
    <Screen
      title="Partenaires"
      description="Fiche partenaire — seul endroit où clients et fournisseurs se créent et se modifient."
      maxWidth="max-w-7xl"
      actions={
        <div className="flex items-center gap-2">
          {!editing && selected && (
            <>
              <Button variant="secondary" onClick={() => setForm(formFromPartner(selected))}>
                Modifier
              </Button>
              <Button variant="danger" onClick={deactivate}>
                Désactiver
              </Button>
            </>
          )}
          {!editing && (
            <Button
              variant="primary"
              onClick={() => {
                setSelectedId(null);
                setForm(emptyForm(categories));
                setCreating(true);
              }}
            >
              + Nouveau
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setForm(null);
                  setCreating(false);
                }}
              >
                Annuler
              </Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex-1 flex gap-4 min-h-0">
        {/* ---------------- Liste ---------------- */}
        <Card className="w-80 shrink-0" padded={false}>
          <div className="px-2 py-1.5 border-b border-slate-100">
            <SearchInput value={search} onChange={setSearch} placeholder="Code ou raison sociale…" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filtered.map((p) => {
              const blocked = evaluatePartnerBlocking({
                balance: p.balance,
                seuilAutorise: p.seuilAutorise,
                blocageActif: Boolean(p.blocageActif),
                blocageDateReference: p.blocageDateReference,
                blocageJours: p.blocageJours
              }).blocked;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-50 transition ${
                    selectedId === p.id ? 'bg-[#0F5B38]/10' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono font-bold text-[11px] ${p.active === false ? 'text-slate-400 line-through' : 'text-[#0F5B38]'}`}>
                      {p.code}
                    </span>
                    {blocked && <span className="text-rose-600 text-[10px]" title="Bloqué">●</span>}
                    {p.active === false && <span className="text-[9px] text-slate-400">inactif</span>}
                  </div>
                  <div className={`text-[11px] truncate ${p.active === false ? 'text-slate-400' : 'text-slate-600'}`}>{p.raisonSociale}</div>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="p-6 text-center text-slate-400 text-xs">Aucun partenaire.</div>}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400">
            {filtered.length} / {partners.length} partenaire(s)
          </div>
        </Card>

        {/* ---------------- Fiche ---------------- */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!selected && !editing ? (
            <Card className="h-full">
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                Sélectionnez un partenaire, ou cliquez sur « Nouveau ».
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <InfosBlock form={form} selected={selected} categories={categories} zones={zones} patch={patch} />
              <CoordonneesBlock form={form} selected={selected} patch={patch} />
              <AutresBlock form={form} selected={selected} patch={patch} />
              <BlocageBlock form={form} selected={selected} patch={patch} />
            </div>
          )}
        </div>
      </div>

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
function InfosBlock({
  form,
  selected,
  categories,
  zones,
  patch
}: {
  form: FormState | null;
  selected: Partner | null;
  categories: PartnerCategoryOpt[];
  zones: Zone[];
  patch: (n: Partial<FormState>) => void;
}) {
  if (!form) {
    if (!selected) return null;
    return (
      <Card title="Infos">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Read label="Code" value={selected.code} mono />
          <div className="col-span-2">
            <Read label="Raison sociale" value={selected.raisonSociale} />
          </div>
          <Read label="Catégorie" value={selected.categoryLabel ?? '—'} />
          <Read label="Zone" value={zones.find((z) => z.id === selected.zoneId)?.name ?? '—'} />
          <Read label="Solde" value={`${money(selected.balance)} DZD`} mono />
        </dl>
      </Card>
    );
  }
  return (
    <Card title="Infos">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Code" required>
          <Input value={form.code} onChange={(e) => patch({ code: e.target.value })} className="font-mono uppercase" />
        </Field>
        <div className="col-span-2">
          <Field label="Raison sociale" required>
            <Input value={form.raisonSociale} onChange={(e) => patch({ raisonSociale: e.target.value })} />
          </Field>
        </div>
        <Field label="Catégorie" required>
          <Select value={form.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Zone">
          <Select value={form.zoneId} onChange={(e) => patch({ zoneId: e.target.value })}>
            <option value="">—</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

function CoordonneesBlock({ form, selected, patch }: { form: FormState | null; selected: Partner | null; patch: (n: Partial<FormState>) => void }) {
  const fields: { key: keyof FormState; label: string }[] = [
    { key: 'address', label: 'Adresse' },
    { key: 'pays', label: 'Pays' },
    { key: 'codePostal', label: 'Code postal' },
    { key: 'ville', label: 'Ville' },
    { key: 'phone', label: 'Téléphone' },
    { key: 'fax', label: 'Fax' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'Email' },
    { key: 'siteInternet', label: 'Site internet' }
  ];

  return (
    <Card title="Coordonnées">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {fields.map((f) =>
          form ? (
            <Field key={f.key} label={f.label}>
              <Input value={String(form[f.key] ?? '')} onChange={(e) => patch({ [f.key]: e.target.value } as Partial<FormState>)} />
            </Field>
          ) : (
            <Read key={f.key} label={f.label} value={String((selected as unknown as Record<string, unknown>)?.[f.key] ?? '') || '—'} />
          )
        )}
      </div>
    </Card>
  );
}

function AutresBlock({ form, selected, patch }: { form: FormState | null; selected: Partner | null; patch: (n: Partial<FormState>) => void }) {
  const ids: { key: keyof FormState; label: string }[] = [
    { key: 'rc', label: 'R.C.' },
    { key: 'nif', label: 'M.F. (NIF)' },
    { key: 'ai', label: 'A.I.' },
    { key: 'nis', label: 'NIS' },
    { key: 'nin', label: 'NIN' }
  ];

  return (
    <Card title="Contact et identifiants">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {form ? (
          <Field label="Contact">
            <Input value={form.contact} onChange={(e) => patch({ contact: e.target.value })} />
          </Field>
        ) : (
          <Read label="Contact" value={selected?.contact || '—'} />
        )}
        {ids.map((f) =>
          form ? (
            <Field key={f.key} label={f.label}>
              <Input
                value={String(form[f.key] ?? '')}
                onChange={(e) => patch({ [f.key]: e.target.value } as Partial<FormState>)}
                className="font-mono"
              />
            </Field>
          ) : (
            <Read key={f.key} label={f.label} value={String((selected as unknown as Record<string, unknown>)?.[f.key] ?? '') || '—'} mono />
          )
        )}
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        {form ? (
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.peutAvoirRefaction}
              onChange={(e) => patch({ peutAvoirRefaction: e.target.checked })}
              className="w-3.5 h-3.5"
            />
            Peut avoir une réfaction
          </label>
        ) : selected?.peutAvoirRefaction ? (
          <Badge tone="info">Peut avoir une réfaction</Badge>
        ) : (
          <span className="text-[11px] text-slate-400">Pas de réfaction</span>
        )}
      </div>
    </Card>
  );
}

function BlocageBlock({ form, selected, patch }: { form: FormState | null; selected: Partner | null; patch: (n: Partial<FormState>) => void }) {
  const state = selected
    ? evaluatePartnerBlocking({
        balance: selected.balance,
        seuilAutorise: selected.seuilAutorise,
        blocageActif: Boolean(selected.blocageActif),
        blocageDateReference: selected.blocageDateReference,
        blocageJours: selected.blocageJours
      })
    : null;

  return (
    <Card title="Blocage du partenaire">
      {form ? (
        <>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={form.blocageActif}
              onChange={(e) => patch({ blocageActif: e.target.checked })}
              className="w-3.5 h-3.5"
            />
            Bloquer ce partenaire si son solde dépasse le montant autorisé
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Montant autorisé (DZD)" hint="0 = pas de plafond">
              <Input value={form.seuilAutorise} onChange={(e) => patch({ seuilAutorise: e.target.value })} className="text-right font-mono" />
            </Field>
            <Field label="Date de référence" hint="Point de départ de l'ancienneté">
              <Input type="date" value={form.blocageDateReference} onChange={(e) => patch({ blocageDateReference: e.target.value })} />
            </Field>
            <Field label="Nbre jours de blocage" hint="Vide = pas de limite d'ancienneté">
              <Input value={form.blocageJours} onChange={(e) => patch({ blocageJours: e.target.value })} className="text-right font-mono" />
            </Field>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Read label="Blocage" value={selected?.blocageActif ? 'Actif' : 'Inactif'} />
            <Read label="Montant autorisé" value={selected ? money(selected.seuilAutorise) : '—'} mono />
            <Read
              label="Date de référence"
              value={selected?.blocageDateReference ? new Date(selected.blocageDateReference).toLocaleDateString('fr-FR') : '—'}
            />
            <Read label="Jours de blocage" value={selected?.blocageJours == null ? '—' : String(selected.blocageJours)} />
          </div>
          {state && (
            <div className="border-t border-slate-100 pt-3 flex items-center gap-2 flex-wrap">
              {state.blocked ? (
                <>
                  <Badge tone="danger">Bloqué</Badge>
                  {state.reasons.includes('MONTANT') && <Badge tone="warning">Solde au-dessus du montant</Badge>}
                  {state.reasons.includes('ANCIENNETE') && (
                    <Badge tone="warning">Dette ouverte depuis {state.joursEcoules} jours</Badge>
                  )}
                </>
              ) : (
                <Badge tone="success">Non bloqué</Badge>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Read({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-slate-800 mt-0.5 break-words ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
