import React, { useEffect, useMemo, useState } from 'react';
import { effectivePriceHT, type PricePolicy } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import { Badge, Button, Card, Field, Input, Screen, SearchInput, Select, ToastHost, money, num, useToasts } from '../components/ui';
import { describeError } from './ReferenceData';
import type { Article, Depot, Partner, PartnerCategoryOpt } from '../ui/App';

/**
 * Fichier → Articles — fiche article complète, reprise du logiciel actuel.
 *
 * C'est le SEUL endroit où un article se crée ou se modifie: les écrans de
 * Mouvement consomment le catalogue sans jamais pouvoir l'enrichir. La mise en
 * page reprend celle du logiciel d'origine — liste à gauche, fiche à droite —
 * avec ses trois blocs: identification, stock, et politique de prix par
 * catégorie de partenaire.
 */

interface PriceRow {
  categoryId: string;
  policy: PricePolicy;
  /** Prix de vente HT saisi (politique PRIX_SAISI). */
  priceHT: string;
  /** Taux de marge appliqué au P.U.M.P (politique TAUX). */
  taux: string;
}

interface FormState {
  code: string;
  designation: string;
  barcode: string;
  tvaRate: string;
  colisage: string;
  tauxRefaction: string;
  securite: string;
  seuilReappro: string;
  quantiteReappro: string;
  mainSupplierId: string;
  preferred: boolean;
  suiviLot: boolean;
  ppa: string;
  tauxUGAutorise: string;
  maxQtyPerClient: string;
  prices: PriceRow[];
}

const TVA_RATES = [19, 9, 0];

function emptyForm(categories: PartnerCategoryOpt[]): FormState {
  return {
    code: '',
    designation: '',
    barcode: '',
    tvaRate: '19',
    colisage: '0',
    tauxRefaction: '0',
    securite: '',
    seuilReappro: '',
    quantiteReappro: '',
    mainSupplierId: '',
    preferred: false,
    suiviLot: false,
    ppa: '',
    tauxUGAutorise: '',
    maxQtyPerClient: '',
    prices: categories.map((c) => ({ categoryId: c.id, policy: 'PRIX_SAISI' as PricePolicy, priceHT: '', taux: '' }))
  };
}

function formFromArticle(a: Article, categories: PartnerCategoryOpt[]): FormState {
  return {
    code: a.code,
    designation: a.designation,
    barcode: a.barcode ?? '',
    tvaRate: String(a.tvaRate),
    colisage: String(a.colisage ?? 0),
    tauxRefaction: String(a.tauxRefaction ?? 0),
    securite: a.securite == null ? '' : String(a.securite),
    seuilReappro: a.seuilReappro == null ? '' : String(a.seuilReappro),
    quantiteReappro: a.quantiteReappro == null ? '' : String(a.quantiteReappro),
    mainSupplierId: a.mainSupplierId ?? '',
    preferred: Boolean(a.preferred),
    suiviLot: Boolean(a.suiviLot),
    ppa: a.ppa ? String(a.ppa) : '',
    tauxUGAutorise: a.tauxUGAutorise ? String(a.tauxUGAutorise) : '',
    maxQtyPerClient: a.maxQtyPerClient == null ? '' : String(a.maxQtyPerClient),
    prices: categories.map((c) => {
      const p = a.pricesByCategory[c.id];
      return {
        categoryId: c.id,
        policy: (p?.policy ?? 'PRIX_SAISI') as PricePolicy,
        priceHT: p ? String(p.priceHT) : '',
        taux: p?.taux ? String(p.taux) : ''
      };
    })
  };
}

export function ArticlesFichierScreen({
  articles,
  categories,
  partners,
  depots,
  onSaved
}: {
  articles: Article[];
  categories: PartnerCategoryOpt[];
  partners: Partner[];
  depots: Depot[];
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** null = consultation; sinon on est en création ou en modification. */
  const [form, setForm] = useState<FormState | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const suppliers = useMemo(() => partners.filter((p) => p.categoryIsSupplier), [partners]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) => a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q) || (a.barcode ?? '').includes(q)
    );
  }, [articles, search]);

  const selected = articles.find((a) => a.id === selectedId) ?? null;

  // Quitter le mode édition si l'article sélectionné change sous nos pieds.
  useEffect(() => {
    setForm(null);
    setCreating(false);
  }, [selectedId]);

  function startCreate() {
    setSelectedId(null);
    setForm(emptyForm(categories));
    setCreating(true);
  }

  function startEdit() {
    if (!selected) return;
    setForm(formFromArticle(selected, categories));
    setCreating(false);
  }

  async function save() {
    if (!form) return;
    if (!form.code.trim() || !form.designation.trim()) {
      toasts.error('Le code et le libellé sont obligatoires.');
      return;
    }
    setSaving(true);
    const optInt = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0)));
    const body = {
      code: form.code.trim().toUpperCase(),
      designation: form.designation.trim(),
      barcode: form.barcode.trim() || null,
      tvaRate: Number(form.tvaRate) || 0,
      colisage: Math.max(0, Math.floor(Number(form.colisage) || 0)),
      tauxRefaction: Math.max(0, Number(form.tauxRefaction.replace(',', '.')) || 0),
      securite: optInt(form.securite),
      seuilReappro: optInt(form.seuilReappro),
      quantiteReappro: optInt(form.quantiteReappro),
      mainSupplierId: form.mainSupplierId || null,
      preferred: form.preferred,
      suiviLot: form.suiviLot,
      ppa: Number(form.ppa.replace(',', '.')) || 0,
      tauxUGAutorise: Number(form.tauxUGAutorise.replace(',', '.')) || 0,
      maxQtyPerClient: form.maxQtyPerClient.trim() === '' ? null : Math.max(1, Math.floor(Number(form.maxQtyPerClient) || 1)),
      prices: form.prices
        // Une ligne sans prix ni taux n'est pas un tarif: on ne la crée pas.
        .filter((p) => (p.policy === 'TAUX' ? p.taux.trim() !== '' : p.priceHT.trim() !== ''))
        .map((p) => {
          const priceHT = Number(p.priceHT.replace(',', '.')) || 0;
          const tvaRate = Number(form.tvaRate) || 0;
          return {
            categoryId: p.categoryId,
            policy: p.policy,
            taux: Number(p.taux.replace(',', '.')) || 0,
            priceHT,
            priceTTC: Math.round(priceHT * (1 + tvaRate / 100) * 100) / 100
          };
        })
    };

    try {
      if (creating) {
        const created = await apiRequest<{ id: string }>('/articles', { method: 'POST', body });
        await onSaved();
        setSelectedId(created.id);
        toasts.success('Article créé.');
      } else if (selected) {
        await apiRequest(`/articles/${selected.id}`, { method: 'PUT', body });
        await onSaved();
        toasts.success('Article modifié.');
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
      await apiRequest(`/articles/${selected.id}`, { method: 'PUT', body: { active: false } });
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
      title="Articles"
      description="Fiche article — seul endroit où le catalogue se crée et se modifie."
      maxWidth="max-w-7xl"
      actions={
        <div className="flex items-center gap-2">
          {!editing && selected && (
            <>
              <Button variant="secondary" onClick={startEdit}>
                Modifier
              </Button>
              <Button variant="danger" onClick={deactivate}>
                Désactiver
              </Button>
            </>
          )}
          {!editing && (
            <Button variant="primary" onClick={startCreate}>
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
            <SearchInput value={search} onChange={setSearch} placeholder="Code, désignation, code-barres…" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`w-full text-left px-3 py-2 border-b border-slate-50 transition ${
                  selectedId === a.id ? 'bg-[#0F5B38]/10' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px] text-[#0F5B38]">{a.code}</span>
                  {a.preferred && <span className="text-amber-500 text-[10px]">★</span>}
                </div>
                <div className="text-[11px] text-slate-600 truncate">{a.designation}</div>
              </button>
            ))}
            {filtered.length === 0 && <div className="p-6 text-center text-slate-400 text-xs">Aucun article.</div>}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400">
            {filtered.length} / {articles.length} article(s)
          </div>
        </Card>

        {/* ---------------- Fiche ---------------- */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!selected && !editing ? (
            <Card className="h-full">
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                Sélectionnez un article, ou cliquez sur « Nouveau ».
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <ArticleIdentity
                form={form}
                selected={selected}
                suppliers={suppliers}
                onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
              />
              <ArticleStock form={form} selected={selected} depots={depots} onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))} />
              <ArticlePricing
                form={form}
                selected={selected}
                categories={categories}
                onChange={(prices) => setForm((f) => (f ? { ...f, prices } : f))}
              />
            </div>
          )}
        </div>
      </div>

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Bloc identification
// ---------------------------------------------------------------------------
function ArticleIdentity({
  form,
  selected,
  suppliers,
  onChange
}: {
  form: FormState | null;
  selected: Article | null;
  suppliers: Partner[];
  onChange: (patch: Partial<FormState>) => void;
}) {
  if (!form) {
    if (!selected) return null;
    return (
      <Card title="Article">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <ReadField label="Code" value={selected.code} mono />
          <ReadField label="Code-barres" value={selected.barcode || '—'} mono />
          <ReadField label="TVA" value={`${selected.tvaRate} %`} />
          <ReadField label="Colisage" value={String(selected.colisage ?? 0)} />
          <div className="col-span-2 md:col-span-4">
            <ReadField label="Libellé" value={selected.designation} />
          </div>
          <ReadField label="PPA" value={selected.ppa ? money(num(selected.ppa)) : '—'} />
          <ReadField label="Taux d'UG autorisé" value={selected.tauxUGAutorise ? `${num(selected.tauxUGAutorise)} %` : '—'} />
          <ReadField label="Taux de réfaction" value={`${num(selected.tauxRefaction)} %`} />
          <ReadField label="Sécurité" value={selected.securite == null ? '—' : String(selected.securite)} />
          <ReadField label="Fournisseur" value={selected.mainSupplierName || '—'} />
          <ReadField label="Contingent / client" value={selected.maxQtyPerClient == null ? '—' : String(selected.maxQtyPerClient)} />
        </dl>
      </Card>
    );
  }

  return (
    <Card title="Article">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Code" required>
          <Input value={form.code} onChange={(e) => onChange({ code: e.target.value })} className="font-mono uppercase" />
        </Field>
        <Field label="Code-barres">
          <Input value={form.barcode} onChange={(e) => onChange({ barcode: e.target.value })} className="font-mono" />
        </Field>
        <Field label="TVA">
          <Select value={form.tvaRate} onChange={(e) => onChange({ tvaRate: e.target.value })}>
            {TVA_RATES.map((r) => (
              <option key={r} value={r}>
                {r} %
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Colisage" hint="Unités par colis (0 = à l'unité)">
          <Input value={form.colisage} onChange={(e) => onChange({ colisage: e.target.value })} className="text-right font-mono" />
        </Field>
        <div className="col-span-2 md:col-span-4">
          <Field label="Libellé" required>
            <Input value={form.designation} onChange={(e) => onChange({ designation: e.target.value })} />
          </Field>
        </div>
        <Field label="PPA" hint="Prix public de référence, affiché à la saisie.">
          <Input value={form.ppa} onChange={(e) => onChange({ ppa: e.target.value })} className="text-right font-mono" />
        </Field>
        <Field label="Taux d'UG autorisé (%)" hint="Marge d'unités gratuites accordée sur cet article.">
          <Input
            value={form.tauxUGAutorise}
            onChange={(e) => onChange({ tauxUGAutorise: e.target.value })}
            className="text-right font-mono"
          />
        </Field>
        <Field label="Taux de réfaction (%)">
          <Input value={form.tauxRefaction} onChange={(e) => onChange({ tauxRefaction: e.target.value })} className="text-right font-mono" />
        </Field>
        <Field label="Sécurité" hint="Stock à ne pas entamer">
          <Input value={form.securite} onChange={(e) => onChange({ securite: e.target.value })} className="text-right font-mono" />
        </Field>
        <Field label="Fournisseur habituel">
          <Select value={form.mainSupplierId} onChange={(e) => onChange({ mainSupplierId: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.raisonSociale}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contingent / client" hint="Vide = illimité">
          <Input value={form.maxQtyPerClient} onChange={(e) => onChange({ maxQtyPerClient: e.target.value })} className="text-right font-mono" />
        </Field>
        <div className="col-span-2 md:col-span-4">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.preferred}
              onChange={(e) => onChange({ preferred: e.target.checked })}
              className="w-3.5 h-3.5"
            />
            Article préféré (mis en avant à la caisse)
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer ml-6">
            <input
              type="checkbox"
              checked={form.suiviLot}
              onChange={(e) => onChange({ suiviLot: e.target.checked })}
              className="w-3.5 h-3.5"
            />
            Suivi par lot et date de péremption
          </label>
          {form.suiviLot && (
            <p className="text-[10px] text-slate-400 mt-1 ml-6">
              Chaque réception exigera un n° de lot et une date de péremption. À la vente, le lot le plus proche de la
              péremption part en premier, et un lot périmé n'est jamais servi.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bloc stock
// ---------------------------------------------------------------------------
function ArticleStock({
  form,
  selected,
  depots,
  onChange
}: {
  form: FormState | null;
  selected: Article | null;
  depots: Depot[];
  onChange: (patch: Partial<FormState>) => void;
}) {
  const totalStock = selected ? Object.values(selected.stocksByDepot).reduce((s, d) => s + d.qtyInStock, 0) : 0;

  return (
    <Card title="Stock">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {form ? (
          <>
            <Field label="Seuil d'alerte" hint="Déclenche le réapprovisionnement">
              <Input value={form.seuilReappro} onChange={(e) => onChange({ seuilReappro: e.target.value })} className="text-right font-mono" />
            </Field>
            <Field label="Quantité de réappro." hint="Quantité à commander">
              <Input value={form.quantiteReappro} onChange={(e) => onChange({ quantiteReappro: e.target.value })} className="text-right font-mono" />
            </Field>
          </>
        ) : (
          <>
            <ReadField label="Seuil d'alerte" value={selected?.seuilReappro == null ? '—' : String(selected.seuilReappro)} />
            <ReadField label="Quantité de réappro." value={selected?.quantiteReappro == null ? '—' : String(selected.quantiteReappro)} />
          </>
        )}
        {/* Stock et P.U.M.P ne se saisissent jamais: ils résultent des mouvements. */}
        <ReadField label="Stock total" value={String(totalStock)} />
        <ReadField label="Prix moyen pondéré" value={selected ? money(selected.pump) : '—'} mono />
      </div>

      {selected && depots.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Par dépôt</div>
          <div className="flex flex-wrap gap-2">
            {depots.map((d) => {
              const st = selected.stocksByDepot[d.id];
              return (
                <span key={d.id} className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                  {d.name}: <b className="font-mono">{st?.qtyInStock ?? 0}</b>
                  {st && st.qtyReserved > 0 && <span className="text-amber-600"> (réservé {st.qtyReserved})</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bloc politique de prix
// ---------------------------------------------------------------------------
function ArticlePricing({
  form,
  selected,
  categories,
  onChange
}: {
  form: FormState | null;
  selected: Article | null;
  categories: PartnerCategoryOpt[];
  onChange: (prices: PriceRow[]) => void;
}) {
  const pump = selected ? selected.pump : 0;

  return (
    <Card title="Politique de prix" padded={false}>
      <div className="p-3">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
            <tr>
              <th className="p-2.5 text-left text-[10px] uppercase font-semibold">Catégorie</th>
              <th className="p-2.5 text-left text-[10px] uppercase font-semibold w-40">Politique</th>
              <th className="p-2.5 text-right text-[10px] uppercase font-semibold w-36">Taux / Prix</th>
              <th className="p-2.5 text-right text-[10px] uppercase font-semibold w-32">Prix HT effectif</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((c, i) => {
              const row = form?.prices.find((p) => p.categoryId === c.id);
              const stored = selected?.pricesByCategory[c.id];

              if (!form) {
                const policy = (stored?.policy ?? 'PRIX_SAISI') as PricePolicy;
                const effective = stored ? effectivePriceHT({ policy, taux: stored.taux ?? 0, priceHT: stored.priceHT }, pump) : null;
                return (
                  <tr key={c.id}>
                    <td className="p-2.5 font-semibold text-slate-800">{c.label}</td>
                    <td className="p-2.5">
                      {stored ? <Badge tone={policy === 'TAUX' ? 'info' : 'neutral'}>{policy === 'TAUX' ? 'Taux' : 'Prix saisi'}</Badge> : '—'}
                    </td>
                    <td className="p-2.5 text-right font-mono">
                      {stored ? (policy === 'TAUX' ? `${num(stored.taux)} %` : money(stored.priceHT)) : '—'}
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold">{effective == null ? '—' : money(effective)}</td>
                  </tr>
                );
              }

              const idx = form.prices.findIndex((p) => p.categoryId === c.id);
              const patch = (next: Partial<PriceRow>) => {
                const copy = [...form.prices];
                copy[idx] = { ...copy[idx], ...next };
                onChange(copy);
              };
              const effective = row
                ? effectivePriceHT(
                    { policy: row.policy, taux: Number(row.taux.replace(',', '.')) || 0, priceHT: Number(row.priceHT.replace(',', '.')) || 0 },
                    pump
                  )
                : 0;

              return (
                <tr key={c.id} className={i % 2 ? 'bg-slate-50/40' : ''}>
                  <td className="p-2.5 font-semibold text-slate-800">{c.label}</td>
                  <td className="p-2.5">
                    <Select value={row?.policy ?? 'PRIX_SAISI'} onChange={(e) => patch({ policy: e.target.value as PricePolicy })} className="py-1">
                      <option value="PRIX_SAISI">Prix saisi</option>
                      <option value="TAUX">Taux</option>
                    </Select>
                  </td>
                  <td className="p-2.5 text-right">
                    {row?.policy === 'TAUX' ? (
                      <Input value={row.taux} onChange={(e) => patch({ taux: e.target.value })} placeholder="%" className="text-right font-mono py-1" />
                    ) : (
                      <Input
                        value={row?.priceHT ?? ''}
                        onChange={(e) => patch({ priceHT: e.target.value })}
                        placeholder="0,00"
                        className="text-right font-mono py-1"
                      />
                    )}
                  </td>
                  <td className="p-2.5 text-right font-mono font-bold text-[#0F5B38]">{money(effective)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[10px] text-slate-400 mt-2">
          « Taux » calcule le prix depuis le P.U.M.P ({money(pump)} DZD) — la marge reste constante quand le coût d&apos;achat évolue.
        </p>
      </div>
    </Card>
  );
}

function ReadField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-slate-800 mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
