import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest, ApiError, getStoredUser } from '../services/apiClient';
import { AppShell, DjemroudLogo } from '../components/AppShell';
import type { ScreenId } from './navigation';
import type { UserRole } from '@anagnorisis/shared';
import {
  CHARGE_CLASS_FIELDS,
  DEPOT_FIELDS,
  LIVREUR_FIELDS,
  ReferenceDataScreen,
  TYPE_REGLEMENT_FIELDS,
  ZONE_FIELDS,
  describeError
} from '../screens/ReferenceData';
import type { RefField } from '../screens/ReferenceData';
import { Badge, Button, Card, Field, Input, Modal, Screen, Select, ToastHost, useToasts } from '../components/ui';
import { POSScreen } from '../screens/POS';
import { CommandesScreen } from '../screens/Commandes';
import { ChargesScreen } from '../screens/Charges';
import { DocumentListScreen, MouvementArticleScreen, ReapproScreen, ValidationQueueScreen } from '../screens/Consultation';
import { SettingsScreen, UsersScreen } from '../screens/Admin';
import { InventaireScreen } from '../screens/Inventaire';
import { CALivreursScreen, FiscalScreen } from '../screens/Analyse';
import { Etat104Screen } from '../screens/Etat104';
import { GraphesScreen, MontantsBlocageScreen, SituationScreen } from '../screens/Insights';
import { ArchivageScreen, SauvegardeScreen, TablesScreen } from '../screens/Maintenance';
import { AccueilScreen } from '../screens/Accueil';
import { CompanySettings, invoiceHtml, printHtml } from '../services/print';

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================
export interface PartnerCategoryOpt {
  id: string;
  code: string;
  label: string;
  isSupplier: boolean;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Livreur {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  active: boolean;
}

export interface ChargeClass {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

export interface TypeReglement {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

export interface Partner {
  id: string;
  code: string;
  raisonSociale: string;
  categoryId: string;
  categoryLabel?: string;
  categoryIsSupplier?: boolean;
  phone?: string;
  address?: string;
  balance: number;
  seuilAutorise: number;
}

export interface Article {
  id: string;
  code: string;
  barcode?: string | null;
  designation: string;
  pump: number;
  priceHT: number; // display price for the currently selected partner's category tier
  tvaRate: number;
  seuilReappro?: number | null;
  /** Mis en avant a la caisse (onglet Preferes). */
  preferred?: boolean;
  /** Quantite maximale par client et par document (produits rares). */
  maxQtyPerClient?: number | null;
  stockGlobal: number; // summed available stock (in stock - reserved) across all depots
  pricesByCategory: Record<string, { priceHT: number; priceTTC: number }>;
  stocksByDepot: Record<string, { qtyInStock: number; qtyReserved: number }>;
}

export interface Depot {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface CommentItem {
  id: string;
  entityType: string;
  entityId: string;
  body: string;
  createdAt: string;
}

export interface DocLine {
  id: string;
  num: number;
  depotId: string;
  depotLabel: string;
  articleId: string;
  code: string;
  designation: string;
  qte: number;
  pump: number;
  prixVente: number;
  remisePercent: number;
  montantHT: number;
  tvaRate: number;
}

interface CashTransaction {
  id: string;
  type: 'RECETTE' | 'DEPENSE';
  amount: number | string;
  paymentMode: string;
  description: string;
  reference?: string | null;
  bankName?: string | null;
  partnerId?: string | null;
  createdAt: string;
  partner?: { code: string; raisonSociale: string } | null;
}

export interface DocumentRow {
  id: string;
  reference: string;
  type: string;
  status: 'OUVERT' | 'VALIDE' | 'ANNULE';
  totalHT?: number | string;
  totalTVA?: number | string;
  stampDuty?: number | string;
  totalTTC: number | string;
  marginHT?: number | string;
  marginPercent?: number | string;
  remise?: number | string;
  motif?: string | null;
  createdAt: string;
  partnerId?: string | null;
  depotId?: string;
  destDepotId?: string | null;
  paymentMode?: string;
  partner?: { raisonSociale: string; code: string };
  destDepot?: { name: string } | null;
  lines?: {
    id: string;
    articleId: string;
    depotId: string;
    quantity: number;
    unitPriceHT: number | string;
    discountPercent: number | string;
    tvaRate: number | string;
    totalHT: number | string;
    totalTTC: number | string;
    purchaseCostPUMP: number | string;
    article?: { code: string; designation: string };
    depot?: { name: string };
  }[];
}

/**
 * The view type is now derived from the screen registry rather than declared
 * separately, so a screen cannot exist in navigation without a matching id here
 * (or vice versa) — that mismatch is what previously hid "Classes de charges"
 * behind a generic "Données de base" entry.
 */
type ERPView = ScreenId | null;

type BackendDocumentType =
  | 'ACHAT'
  | 'BON_LIVRAISON'
  | 'BON_PREPARATION'
  | 'FACTURE'
  | 'PROFORMA'
  | 'RETOUR_FOURNISSEUR'
  | 'RETOUR_CLIENT'
  | 'REGULE_PLUS'
  | 'REGULE_MOINS'
  | 'TRANSFERT';

function viewToDocumentType(view: ERPView): BackendDocumentType {
  switch (view) {
    case 'ACHATS':
      return 'ACHAT';
    case 'AVOIRS_ACHATS':
      return 'RETOUR_FOURNISSEUR';
    case 'AVOIRS_VENTES':
      return 'RETOUR_CLIENT';
    case 'FACTURE':
      return 'FACTURE';
    case 'PROFORMA':
      return 'PROFORMA';
    case 'BONS_LIVRAISON':
      return 'BON_LIVRAISON';
    case 'BONS_PREP':
    case 'VENTES_VALIDATION':
    default:
      return 'BON_PREPARATION';
  }
}

function num(v: unknown) {
  return Number(v ?? 0);
}

/** Taux de TVA en vigueur. Le catalogue mélange les trois. */
const TVA_RATES = [19, 9, 0];

// ==========================================
// 3. MODALS (Clean Google Dialog Style)
// ==========================================
function PartnerSelectModal({
  partners,
  onClose,
  onSelectPartner
}: {
  partners: Partner[];
  onClose: () => void;
  onSelectPartner: (partner: Partner) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPartners = partners.filter(
    (p) => p.code.toLowerCase().includes(searchTerm.toLowerCase()) || p.raisonSociale.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh] text-xs">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Sélectionner un Client</h3>
            <p className="text-[11px] text-slate-400">Ets Djemroud • Répertoire Partenaires</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold p-1">
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
          <input
            type="text"
            placeholder="Rechercher par code ou raison sociale..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs"
            autoFocus
          />
          <div className="border border-slate-100 rounded-xl overflow-y-auto flex-1">
            <table className="w-full text-left">
              <thead className="bg-slate-50 sticky top-0 border-b border-slate-100 text-slate-500 font-medium text-[11px]">
                <tr>
                  <th className="p-3">Code</th>
                  <th className="p-3">Raison Sociale</th>
                  <th className="p-3 text-right">Solde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPartners.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => {
                      onSelectPartner(p);
                      onClose();
                    }}
                    className="hover:bg-[#0F5B38]/5 cursor-pointer transition"
                  >
                    <td className="p-3 font-mono font-bold text-[#0F5B38]">{p.code}</td>
                    <td className="p-3 font-medium text-slate-800">{p.raisonSociale}</td>
                    <td className="p-3 text-right font-mono text-slate-600">{p.balance.toFixed(2)} DZD</td>
                  </tr>
                ))}
                {filteredPartners.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-slate-400">
                      Aucun partenaire trouvé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArticleSelectModal({
  articles,
  onClose,
  onAddArticle
}: {
  articles: Article[];
  onClose: () => void;
  onAddArticle: (article: Article) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredArticles = articles.filter(
    (a) => a.code.toLowerCase().includes(searchTerm.toLowerCase()) || a.designation.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh] text-xs">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Catalogue Parapharmaceutique</h3>
            <p className="text-[11px] text-slate-400">Sélectionnez un produit à ajouter au document</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold p-1">
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
          <input
            type="text"
            placeholder="Rechercher un produit par code ou désignation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs"
            autoFocus
          />
          <div className="border border-slate-100 rounded-xl overflow-y-auto flex-1">
            <table className="w-full text-left">
              <thead className="bg-slate-50 sticky top-0 border-b border-slate-100 text-slate-500 font-medium text-[11px]">
                <tr>
                  <th className="p-3">Code</th>
                  <th className="p-3">Désignation</th>
                  <th className="p-3 text-right">Prix HT</th>
                  <th className="p-3 text-center">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredArticles.map((art) => (
                  <tr
                    key={art.id}
                    onClick={() => {
                      onAddArticle(art);
                      onClose();
                    }}
                    className="hover:bg-[#0F5B38]/5 cursor-pointer transition"
                  >
                    <td className="p-3 font-mono font-bold text-slate-900">{art.code}</td>
                    <td className="p-3 font-medium text-slate-800">{art.designation}</td>
                    <td className="p-3 text-right font-mono font-bold text-[#0F5B38]">{art.priceHT.toFixed(2)} DZD</td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-bold ${
                          art.stockGlobal > 0 ? 'bg-emerald-50 text-[#0F5B38]' : 'bg-rose-50 text-rose-600'
                        }`}
                      >
                        {art.stockGlobal} U
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredArticles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-400">
                      Aucun article trouvé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReserveArticleModal({
  articles,
  depots,
  onClose,
  onReserve
}: {
  articles: Article[];
  depots: Depot[];
  onClose: () => void;
  onReserve: (article: Article, quantities: Record<string, number>) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const filteredArticles = articles.filter(
    (a) => a.code.toLowerCase().includes(searchTerm.toLowerCase()) || a.designation.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function pickArticle(article: Article) {
    setSelectedArticle(article);
    setQuantities({});
  }

  function handleConfirm() {
    if (!selectedArticle) return;
    const toReserve = Object.fromEntries(Object.entries(quantities).filter(([, qty]) => qty > 0));
    if (Object.keys(toReserve).length === 0) return;
    onReserve(selectedArticle, toReserve);
    onClose();
  }

  const totalAReserver = Object.values(quantities).reduce((sum, q) => sum + (q || 0), 0);

  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] text-xs">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Ajouter des articles au bon de préparation</h3>
            <p className="text-[11px] text-slate-400">Recherchez un article puis indiquez la quantité à réserver par dépôt</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold p-1">
            ✕
          </button>
        </div>

        {!selectedArticle ? (
          <div className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
            <input
              type="text"
              placeholder="Rechercher un produit par code ou désignation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs"
              autoFocus
            />
            <div className="border border-slate-100 rounded-xl overflow-y-auto flex-1">
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-100 text-slate-500 font-medium text-[11px]">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Désignation</th>
                    <th className="p-3 text-center">Stock Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredArticles.map((art) => (
                    <tr key={art.id} onClick={() => pickArticle(art)} className="hover:bg-[#0F5B38]/5 cursor-pointer transition">
                      <td className="p-3 font-mono font-bold text-slate-900">{art.code}</td>
                      <td className="p-3 font-medium text-slate-800">{art.designation}</td>
                      <td className="p-3 text-center font-mono">{art.stockGlobal}</td>
                    </tr>
                  ))}
                  {filteredArticles.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-slate-400">
                        Aucun article trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex justify-between items-center">
              <div>
                <span className="font-mono font-bold text-[#0F5B38]">{selectedArticle.code}</span>{' '}
                <span className="font-semibold text-slate-800">{selectedArticle.designation}</span>
              </div>
              <button onClick={() => setSelectedArticle(null)} className="text-slate-400 hover:text-[#0F5B38] font-medium">
                ← Changer d'article
              </button>
            </div>

            <div className="border border-slate-100 rounded-xl overflow-y-auto flex-1">
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-100 text-slate-500 font-medium text-[11px]">
                  <tr>
                    <th className="p-3">Dépôt</th>
                    <th className="p-3 text-center">En dépôt</th>
                    <th className="p-3 text-center">Réservée</th>
                    <th className="p-3 text-center">En stock</th>
                    <th className="p-3 text-center">À réserver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {depots.map((d) => {
                    const s = selectedArticle.stocksByDepot[d.id] ?? { qtyInStock: 0, qtyReserved: 0 };
                    const available = s.qtyInStock - s.qtyReserved;
                    return (
                      <tr key={d.id}>
                        <td className="p-3 font-medium text-slate-800">{d.name}</td>
                        <td className="p-3 text-center font-mono">{s.qtyInStock}</td>
                        <td className="p-3 text-center font-mono text-amber-600">{s.qtyReserved}</td>
                        <td className="p-3 text-center font-mono font-bold text-[#0F5B38]">{available}</td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min={0}
                            max={available}
                            value={quantities[d.id] ?? ''}
                            onChange={(e) =>
                              setQuantities((prev) => ({ ...prev, [d.id]: Math.max(0, Math.min(available, parseInt(e.target.value) || 0)) }))
                            }
                            className="w-16 text-center border border-slate-200 rounded-lg font-bold font-mono py-1 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-500">Total à réserver: {totalAReserver}</span>
              <span className="font-semibold text-slate-500">
                Prix HT: <strong className="text-[#0F5B38]">{selectedArticle.priceHT.toFixed(2)} DZD</strong>
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSelectedArticle(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
                Annuler
              </button>
              <button
                onClick={handleConfirm}
                disabled={totalAReserver === 0}
                className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-4 py-2 rounded-xl transition disabled:opacity-40"
              >
                Réserver
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PrixArticlesView({
  articles,
  categories,
  depots
}: {
  articles: Article[];
  categories: PartnerCategoryOpt[];
  depots: Depot[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priceTab, setPriceTab] = useState<'categorie' | 'partenaire'>('categorie');

  const filtered = articles.filter(
    (a) => a.code.toLowerCase().includes(searchTerm.toLowerCase()) || a.designation.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const selected = articles.find((a) => a.id === selectedId) ?? filtered[0] ?? null;

  const clientCategories = categories.filter((c) => !c.isSupplier);

  const globalStock = selected
    ? Object.values(selected.stocksByDepot).reduce(
        (acc, s) => ({ qty: acc.qty + s.qtyInStock, reserved: acc.reserved + s.qtyReserved }),
        { qty: 0, reserved: 0 }
      )
    : { qty: 0, reserved: 0 };

  return (
    <div className="flex-1 flex gap-4 overflow-hidden max-w-7xl mx-auto w-full z-10">
      {/* LEFT: article list */}
      <div className="w-96 flex flex-col gap-2 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <span className="font-extrabold text-slate-900 text-sm">Prix Unitaires des Articles</span>
          <input
            type="text"
            placeholder="Rechercher par code ou désignation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
              <tr>
                <th className="p-2 px-3">Code</th>
                <th className="p-2 px-3">Désignation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`cursor-pointer transition ${selected?.id === a.id ? 'bg-[#0F5B38]/10' : 'hover:bg-slate-50'}`}
                >
                  <td className="p-2 px-3 font-mono font-bold text-slate-800">{a.code}</td>
                  <td className="p-2 px-3 text-slate-700">{a.designation}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-6 text-center text-slate-400">
                    Aucun article.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RIGHT: detail panels */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">
            Sélectionnez un article dans la liste.
          </div>
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold text-[#0F5B38]">{selected.code}</span>
                <span className="font-extrabold text-slate-900">{selected.designation}</span>
              </div>
              <span className="text-slate-400 text-[11px]">P.U.M.P.: {selected.pump.toFixed(2)} DZD · TVA: {selected.tvaRate}%</span>

              <div className="grid grid-cols-5 gap-2 mt-3">
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Quantité</div>
                  <div className="font-mono font-bold">{globalStock.qty}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Réservée</div>
                  <div className="font-mono font-bold text-amber-600">{globalStock.reserved}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Stock</div>
                  <div className="font-mono font-bold text-[#0F5B38]">{globalStock.qty - globalStock.reserved}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Prix unit. HT</div>
                  <div className="font-mono font-bold">{selected.priceHT.toFixed(2)}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Prix unit. TTC</div>
                  <div className="font-mono font-bold">{(selected.priceHT * (1 + selected.tvaRate / 100)).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-auto">
              {priceTab === 'categorie' ? (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-3">Catégorie</th>
                      <th className="p-3 text-right">Taux %</th>
                      <th className="p-3 text-right">Prix unit. HT</th>
                      <th className="p-3 text-right">Prix unit. TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clientCategories.map((c) => {
                      const price = selected.pricesByCategory[c.id];
                      return (
                        <tr key={c.id}>
                          <td className="p-3 font-medium text-slate-800">{c.label}</td>
                          <td className="p-3 text-right font-mono text-slate-400">0,00</td>
                          <td className="p-3 text-right font-mono font-semibold text-[#0F5B38]">{(price?.priceHT ?? 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-mono">{(price?.priceTTC ?? 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs">Ce module n'est pas encore implémenté.</div>
              )}

              <div className="border-t border-slate-100 mt-2">
                <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quantité par dépôt</div>
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="p-3">Dépôt</th>
                      <th className="p-3 text-right">Quantité</th>
                      <th className="p-3 text-right">Qté réservée</th>
                      <th className="p-3 text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {depots.map((d) => {
                      const s = selected.stocksByDepot[d.id] ?? { qtyInStock: 0, qtyReserved: 0 };
                      return (
                        <tr key={d.id}>
                          <td className="p-3 font-medium text-slate-800">{d.name}</td>
                          <td className="p-3 text-right font-mono">{s.qtyInStock}</td>
                          <td className="p-3 text-right font-mono text-amber-600">{s.qtyReserved}</td>
                          <td className="p-3 text-right font-mono font-bold text-[#0F5B38]">{s.qtyInStock - s.qtyReserved}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPriceTab('partenaire')}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${
                  priceTab === 'partenaire' ? 'bg-[#0F5B38] text-white border-[#0F5B38]' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Prix par partenaire
              </button>
              <button
                onClick={() => setPriceTab('categorie')}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${
                  priceTab === 'categorie' ? 'bg-[#0F5B38] text-white border-[#0F5B38]' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Prix par catégorie
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface SimpleMovementLine {
  articleId: string;
  code: string;
  designation: string;
  qte: number;
  pump: number;
}

function RegulesScreen({
  mode,
  onModeChange,
  articles,
  depots,
  documents,
  onSaved
}: {
  mode: 'REGULE_PLUS' | 'REGULE_MOINS';
  onModeChange: (mode: 'REGULE_PLUS' | 'REGULE_MOINS') => void;
  articles: Article[];
  depots: Depot[];
  documents: DocumentRow[];
  onSaved: () => void;
}) {
  const [depotId, setDepotId] = useState(depots.find((d) => d.isDefault)?.id ?? depots[0]?.id ?? '');
  const [motif, setMotif] = useState('');
  const [lines, setLines] = useState<SimpleMovementLine[]>([]);
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isPlus = mode === 'REGULE_PLUS';
  const relevant = documents.filter((d) => d.type === mode);

  function addArticle(art: Article) {
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.articleId === art.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qte: next[existing].qte + 1 };
        return next;
      }
      return [...prev, { articleId: art.id, code: art.code, designation: art.designation, qte: 1, pump: art.pump }];
    });
    setShowArticleModal(false);
  }

  function updateQte(articleId: string, qte: number) {
    setLines((prev) => prev.map((l) => (l.articleId === articleId ? { ...l, qte: Math.max(1, qte) } : l)));
  }

  function removeLine(articleId: string) {
    setLines((prev) => prev.filter((l) => l.articleId !== articleId));
  }

  async function handleSave() {
    if (!depotId || lines.length === 0) {
      setNotice('Sélectionnez un dépôt et ajoutez au moins un article.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const document = await apiRequest<{ id: string; reference: string }>('/documents', {
        method: 'POST',
        body: {
          type: mode,
          depotId,
          motif: motif || null,
          paymentMode: 'VIREMENT',
          remise: 0,
          lines: lines.map((l) => ({
            articleId: l.articleId,
            depotId,
            quantity: l.qte,
            unitPriceHT: l.pump,
            discountPercent: 0,
            tvaRate: 0
          }))
        }
      });
      await apiRequest(`/documents/${document.id}/validate`, { method: 'POST' });
      setNotice(`Régularisation ${document.reference} enregistrée et appliquée au stock.`);
      setLines([]);
      setMotif('');
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const totalQte = lines.reduce((acc, l) => acc + l.qte, 0);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <span className="font-extrabold text-slate-900 text-base">
            Régularisation de Stock — {isPlus ? 'Entrée (Plus)' : 'Sortie (Moins)'}
          </span>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => onModeChange('REGULE_PLUS')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${isPlus ? 'bg-[#0F5B38] text-white' : 'text-slate-600'}`}
            >
              Plus
            </button>
            <button
              onClick={() => onModeChange('REGULE_MOINS')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${!isPlus ? 'bg-[#0F5B38] text-white' : 'text-slate-600'}`}
            >
              Moins
            </button>
          </div>
        </div>

        {notice && <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{notice}</div>}

        <div className="grid grid-cols-12 gap-3 text-xs">
          <div className="col-span-4">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">DÉPÔT</label>
            <select
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            >
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-8">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">MOTIF (ex: inventaire, casse, perte)</label>
            <input
              type="text"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
        </div>

        <button
          onClick={() => setShowArticleModal(true)}
          className="self-start bg-[#0F5B38] hover:bg-[#0b462b] text-white font-medium px-4 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 text-xs"
        >
          <span className="font-bold text-sm">+</span> Ajouter Article
        </button>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Désignation</th>
              <th className="p-3 text-center">Quantité</th>
              <th className="p-3 text-right">P.U.M.P.</th>
              <th className="p-3 text-center w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.articleId}>
                <td className="p-3 font-mono font-bold text-slate-800">{l.code}</td>
                <td className="p-3 font-medium text-slate-900">{l.designation}</td>
                <td className="p-3 text-center">
                  <input
                    type="number"
                    min={1}
                    value={l.qte}
                    onChange={(e) => updateQte(l.articleId, parseInt(e.target.value) || 1)}
                    className="w-16 text-center border border-slate-200 rounded-lg font-bold font-mono py-1 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20"
                  />
                </td>
                <td className="p-3 text-right font-mono text-slate-400">{l.pump.toFixed(2)}</td>
                <td className="p-3 text-center">
                  <button onClick={() => removeLine(l.articleId)} className="text-slate-300 hover:text-rose-600 font-bold p-1 transition">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="p-16 text-center text-slate-400 font-medium">
                  Aucun article. Cliquez sur "+ Ajouter Article" pour commencer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="text-xs font-semibold text-slate-500">Quantité totale à {isPlus ? 'ajouter' : 'retirer'}: {totalQte}</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-xs text-xs disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer et Appliquer'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs max-h-40 overflow-auto">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Régularisations récentes</div>
        {relevant.slice(0, 8).map((doc) => (
          <div key={doc.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
            <span className="font-mono font-bold text-slate-800">{doc.reference}</span>
            <span className="text-slate-400">{doc.motif || '—'}</span>
            <StatusBadgeSmall status={doc.status} />
          </div>
        ))}
        {relevant.length === 0 && <div className="text-slate-300 text-center py-2">Aucune régularisation.</div>}
      </div>

      {showArticleModal && <ArticleSelectModal articles={articles} onClose={() => setShowArticleModal(false)} onAddArticle={addArticle} />}
    </div>
  );
}

function TransfertScreen({
  depots,
  articles,
  documents,
  onSaved
}: {
  depots: Depot[];
  articles: Article[];
  documents: DocumentRow[];
  onSaved: () => void;
}) {
  const [sourceDepotId, setSourceDepotId] = useState(depots[0]?.id ?? '');
  const [destDepotId, setDestDepotId] = useState(depots[1]?.id ?? depots[0]?.id ?? '');
  const [motif, setMotif] = useState('');
  const [lines, setLines] = useState<SimpleMovementLine[]>([]);
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const relevant = documents.filter((d) => d.type === 'TRANSFERT');

  function addArticle(art: Article) {
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.articleId === art.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qte: next[existing].qte + 1 };
        return next;
      }
      return [...prev, { articleId: art.id, code: art.code, designation: art.designation, qte: 1, pump: art.pump }];
    });
    setShowArticleModal(false);
  }

  function updateQte(articleId: string, qte: number) {
    setLines((prev) => prev.map((l) => (l.articleId === articleId ? { ...l, qte: Math.max(1, qte) } : l)));
  }

  function removeLine(articleId: string) {
    setLines((prev) => prev.filter((l) => l.articleId !== articleId));
  }

  async function handleSave() {
    if (!sourceDepotId || !destDepotId) {
      setNotice('Sélectionnez un dépôt source et un dépôt destination.');
      return;
    }
    if (sourceDepotId === destDepotId) {
      setNotice('Le dépôt destination doit être différent du dépôt source.');
      return;
    }
    if (lines.length === 0) {
      setNotice('Ajoutez au moins un article à transférer.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const document = await apiRequest<{ id: string; reference: string }>('/documents', {
        method: 'POST',
        body: {
          type: 'TRANSFERT',
          depotId: sourceDepotId,
          destDepotId,
          motif: motif || null,
          paymentMode: 'VIREMENT',
          remise: 0,
          lines: lines.map((l) => ({
            articleId: l.articleId,
            depotId: sourceDepotId,
            quantity: l.qte,
            unitPriceHT: l.pump,
            discountPercent: 0,
            tvaRate: 0
          }))
        }
      });
      await apiRequest(`/documents/${document.id}/validate`, { method: 'POST' });
      setNotice(`Transfert ${document.reference} enregistré et appliqué.`);
      setLines([]);
      setMotif('');
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const totalQte = lines.reduce((acc, l) => acc + l.qte, 0);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
        <span className="font-extrabold text-slate-900 text-base border-b border-slate-100 pb-3">Transfert Inter-Dépôts</span>

        {notice && <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{notice}</div>}

        <div className="grid grid-cols-12 gap-3 text-xs">
          <div className="col-span-4">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">DÉPÔT SOURCE</label>
            <select
              value={sourceDepotId}
              onChange={(e) => setSourceDepotId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            >
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">DÉPÔT DESTINATION</label>
            <select
              value={destDepotId}
              onChange={(e) => setDestDepotId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            >
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">MOTIF</label>
            <input
              type="text"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
        </div>

        <button
          onClick={() => setShowArticleModal(true)}
          className="self-start bg-[#0F5B38] hover:bg-[#0b462b] text-white font-medium px-4 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 text-xs"
        >
          <span className="font-bold text-sm">+</span> Ajouter Article
        </button>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Désignation</th>
              <th className="p-3 text-center">Quantité</th>
              <th className="p-3 text-right">P.U.M.P.</th>
              <th className="p-3 text-center w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.articleId}>
                <td className="p-3 font-mono font-bold text-slate-800">{l.code}</td>
                <td className="p-3 font-medium text-slate-900">{l.designation}</td>
                <td className="p-3 text-center">
                  <input
                    type="number"
                    min={1}
                    value={l.qte}
                    onChange={(e) => updateQte(l.articleId, parseInt(e.target.value) || 1)}
                    className="w-16 text-center border border-slate-200 rounded-lg font-bold font-mono py-1 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20"
                  />
                </td>
                <td className="p-3 text-right font-mono text-slate-400">{l.pump.toFixed(2)}</td>
                <td className="p-3 text-center">
                  <button onClick={() => removeLine(l.articleId)} className="text-slate-300 hover:text-rose-600 font-bold p-1 transition">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="p-16 text-center text-slate-400 font-medium">
                  Aucun article. Cliquez sur "+ Ajouter Article" pour commencer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="text-xs font-semibold text-slate-500">Quantité totale à transférer: {totalQte}</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-xs text-xs disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer et Transférer'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs max-h-40 overflow-auto">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Transferts récents</div>
        {relevant.slice(0, 8).map((doc) => (
          <div key={doc.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
            <span className="font-mono font-bold text-slate-800">{doc.reference}</span>
            <span className="text-slate-400">→ {doc.destDepot?.name ?? '—'}</span>
            <StatusBadgeSmall status={doc.status} />
          </div>
        ))}
        {relevant.length === 0 && <div className="text-slate-300 text-center py-2">Aucun transfert.</div>}
      </div>

      {showArticleModal && <ArticleSelectModal articles={articles} onClose={() => setShowArticleModal(false)} onAddArticle={addArticle} />}
    </div>
  );
}

function StatusBadgeSmall({ status }: { status: 'OUVERT' | 'VALIDE' | 'ANNULE' }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
        status === 'VALIDE' ? 'bg-emerald-50 text-emerald-700' : status === 'ANNULE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {status}
    </span>
  );
}

/**
 * Shared screen for Chèques recette/dépense and Virement ou versement. Both are
 * "partner settlements": picking a partner always pays down whatever is currently
 * outstanding in that relationship (see the backend's /cash settlement logic) —
 * RECETTE/DEPENSE here only describes which way the cash/cheque/virement itself
 * moves, not the direction of the underlying debt.
 */
function PartnerSettlementScreen({
  title,
  paymentMode,
  mode,
  onModeChange,
  partners,
  transactions,
  onSaved
}: {
  title: string;
  paymentMode: 'CHEQUE' | 'VIREMENT';
  mode: 'RECETTE' | 'DEPENSE';
  onModeChange: (mode: 'RECETTE' | 'DEPENSE') => void;
  partners: Partner[];
  transactions: CashTransaction[];
  onSaved: () => void;
}) {
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const relevant = transactions.filter((t) => t.paymentMode === paymentMode);
  const isRecette = mode === 'RECETTE';

  async function handleSave() {
    if (!partner || amount <= 0) {
      setNotice('Sélectionnez un partenaire et saisissez un montant.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiRequest('/cash', {
        method: 'POST',
        body: {
          type: mode,
          amount,
          paymentMode,
          partnerId: partner.id,
          reference: reference || null,
          bankName: bankName || null,
          description: description || `${title} — ${partner.raisonSociale}`
        }
      });
      setNotice(`${title} de ${amount.toFixed(2)} DZD enregistré pour ${partner.raisonSociale}.`);
      setAmount(0);
      setReference('');
      setBankName('');
      setDescription('');
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-4xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <span className="font-extrabold text-slate-900 text-base">{title}</span>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => onModeChange('RECETTE')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${isRecette ? 'bg-[#0F5B38] text-white' : 'text-slate-600'}`}
            >
              Recette
            </button>
            <button
              onClick={() => onModeChange('DEPENSE')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${!isRecette ? 'bg-[#0F5B38] text-white' : 'text-slate-600'}`}
            >
              Dépense
            </button>
          </div>
        </div>

        {notice && <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{notice}</div>}

        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-400 text-[11px] uppercase tracking-wider">Partenaire:</span>
            {partner ? (
              <>
                <span className="font-mono font-bold bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[#0F5B38]">{partner.code}</span>
                <span className="font-bold text-slate-800">{partner.raisonSociale}</span>
                <span className="text-slate-400">Solde: {partner.balance.toFixed(2)} DZD</span>
              </>
            ) : (
              <span className="text-slate-400">Aucun sélectionné</span>
            )}
          </div>
          <button
            onClick={() => setShowPartnerModal(true)}
            className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-3 py-1 rounded-lg transition text-xs"
          >
            Choisir Partenaire
          </button>
        </div>

        <div className="grid grid-cols-12 gap-3 text-xs">
          <div className="col-span-3">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">MONTANT (DZD)</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-mono font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
          <div className="col-span-3">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              {paymentMode === 'CHEQUE' ? 'N° CHÈQUE' : 'RÉFÉRENCE VIREMENT'}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
          <div className="col-span-3">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">BANQUE</label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
          <div className="col-span-3">
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">NOTE</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(optionnel)"
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="self-end bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-xs text-xs disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs flex-1 overflow-auto">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{title} récents</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Partenaire</th>
              <th className="p-2">Référence</th>
              <th className="p-2">Banque</th>
              <th className="p-2 text-center">Type</th>
              <th className="p-2 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {relevant.slice(0, 20).map((t) => (
              <tr key={t.id}>
                <td className="p-2">{new Date(t.createdAt).toLocaleDateString('fr-FR')}</td>
                <td className="p-2">{t.partner ? `${t.partner.code} - ${t.partner.raisonSociale}` : '—'}</td>
                <td className="p-2 font-mono">{t.reference || '—'}</td>
                <td className="p-2">{t.bankName || '—'}</td>
                <td className="p-2 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      t.type === 'RECETTE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {t.type}
                  </span>
                </td>
                <td className="p-2 text-right font-mono font-bold">{num(t.amount).toFixed(2)}</td>
              </tr>
            ))}
            {relevant.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  Aucune opération.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPartnerModal && (
        <PartnerSelectModal partners={partners} onClose={() => setShowPartnerModal(false)} onSelectPartner={setPartner} />
      )}
    </div>
  );
}

/**
 * Read-only ledger view shared by Journal de caisse (ESPECE only), Journal de
 * banque (everything except ESPECE), and Transactions caissières (everything).
 */
function CashJournalTable({ title, transactions }: { title: string; transactions: CashTransaction[] }) {
  const totalRecette = transactions.filter((t) => t.type === 'RECETTE').reduce((acc, t) => acc + num(t.amount), 0);
  const totalDepense = transactions.filter((t) => t.type === 'DEPENSE').reduce((acc, t) => acc + num(t.amount), 0);
  const solde = totalRecette - totalDepense;

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="font-extrabold text-slate-900 text-base">{title}</span>
        <div className="flex gap-6 text-xs">
          <div>
            <span className="text-slate-400 font-medium block text-[11px]">RECETTES</span>
            <span className="font-mono font-bold text-emerald-700">{totalRecette.toFixed(2)} DZD</span>
          </div>
          <div>
            <span className="text-slate-400 font-medium block text-[11px]">DÉPENSES</span>
            <span className="font-mono font-bold text-rose-700">{totalDepense.toFixed(2)} DZD</span>
          </div>
          <div>
            <span className="text-slate-400 font-medium block text-[11px]">SOLDE</span>
            <span className="font-mono font-bold text-[#0F5B38]">{solde.toFixed(2)} DZD</span>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Description</th>
              <th className="p-3">Partenaire</th>
              <th className="p-3">Mode</th>
              <th className="p-3 text-center">Type</th>
              <th className="p-3 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((t) => (
              <tr key={t.id}>
                <td className="p-3">{new Date(t.createdAt).toLocaleString('fr-FR')}</td>
                <td className="p-3 font-medium text-slate-800">{t.description}</td>
                <td className="p-3 text-slate-500">{t.partner ? `${t.partner.code} - ${t.partner.raisonSociale}` : '—'}</td>
                <td className="p-3 text-slate-500">{t.paymentMode}</td>
                <td className="p-3 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      t.type === 'RECETTE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {t.type}
                  </span>
                </td>
                <td className={`p-3 text-right font-mono font-bold ${t.type === 'RECETTE' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {t.type === 'RECETTE' ? '+' : '-'}
                  {num(t.amount).toFixed(2)}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  Aucune transaction.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PartnerHistoryDocument {
  id: string;
  reference: string;
  type: string;
  status: 'OUVERT' | 'VALIDE' | 'ANNULE';
  totalTTC: number | string;
  createdAt: string;
}

interface PartnerHistoryDetail {
  id: string;
  code: string;
  raisonSociale: string;
  balance: number | string;
  seuilAutorise: number | string;
  address?: string | null;
  phone?: string | null;
  category?: { label: string; isSupplier: boolean };
  documents: PartnerHistoryDocument[];
  cashTransactions: CashTransaction[];
}

/**
 * Suivi d'un partenaire — full account statement for one partner: identity, current
 * balance vs credit limit, every document (achats/ventes/avoirs/etc.), and every
 * cash/cheque/virement settlement tied to them.
 */
function SuiviPartenaireScreen({ partners }: { partners: Partner[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerHistoryDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = partners.filter(
    (p) => p.code.toLowerCase().includes(searchTerm.toLowerCase()) || p.raisonSociale.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    apiRequest<PartnerHistoryDetail>(`/partners/${selectedId}/history`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const overLimit = detail ? num(detail.balance) > num(detail.seuilAutorise) && num(detail.seuilAutorise) > 0 : false;

  return (
    <div className="flex-1 flex gap-4 overflow-hidden max-w-7xl mx-auto w-full z-10">
      <div className="w-80 flex flex-col gap-2 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <span className="font-extrabold text-slate-900 text-sm">Suivi d'un Partenaire</span>
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`px-3 py-2 text-xs cursor-pointer border-b border-slate-50 transition ${
                selectedId === p.id ? 'bg-[#0F5B38]/10' : 'hover:bg-slate-50'
              }`}
            >
              <div className="font-mono font-bold text-slate-800">{p.code}</div>
              <div className="text-slate-600">{p.raisonSociale}</div>
            </div>
          ))}
          {filtered.length === 0 && <div className="p-6 text-center text-slate-400 text-xs">Aucun partenaire.</div>}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {loading && <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">Chargement...</div>}

        {!loading && !detail && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">
            Sélectionnez un partenaire dans la liste.
          </div>
        )}

        {!loading && detail && (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold text-[#0F5B38]">{detail.code}</span>
                <span className="font-extrabold text-slate-900">{detail.raisonSociale}</span>
                {overLimit && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700">⚠ Crédit dépassé</span>
                )}
              </div>
              <div className="text-slate-400 text-[11px] mb-3">
                {detail.category?.label} · {detail.phone || 'N/A'} · {detail.address || 'N/A'}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Solde</div>
                  <div className={`font-mono font-bold ${overLimit ? 'text-rose-600' : 'text-slate-800'}`}>{num(detail.balance).toFixed(2)} DZD</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Seuil Autorisé</div>
                  <div className="font-mono font-bold text-slate-800">{num(detail.seuilAutorise).toFixed(2)} DZD</div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Disponible</div>
                  <div className="font-mono font-bold text-[#0F5B38]">{(num(detail.seuilAutorise) - num(detail.balance)).toFixed(2)} DZD</div>
                </div>
              </div>
            </div>

            <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
              <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">Documents</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="p-2 px-3">Référence</th>
                    <th className="p-2 px-3">Type</th>
                    <th className="p-2 px-3 text-center">Statut</th>
                    <th className="p-2 px-3 text-right">Total TTC</th>
                    <th className="p-2 px-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.documents.map((doc) => (
                    <tr key={doc.id}>
                      <td className="p-2 px-3 font-mono font-bold text-slate-800">{doc.reference}</td>
                      <td className="p-2 px-3 text-slate-600">{doc.type}</td>
                      <td className="p-2 px-3 text-center">
                        <StatusBadgeSmall status={doc.status} />
                      </td>
                      <td className="p-2 px-3 text-right font-mono">{num(doc.totalTTC).toFixed(2)}</td>
                      <td className="p-2 px-3">{new Date(doc.createdAt).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  ))}
                  {detail.documents.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400">
                        Aucun document.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-t border-slate-100 mt-2">
                Opérations de caisse
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                  <tr>
                    <th className="p-2 px-3">Date</th>
                    <th className="p-2 px-3">Description</th>
                    <th className="p-2 px-3">Mode</th>
                    <th className="p-2 px-3 text-center">Type</th>
                    <th className="p-2 px-3 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.cashTransactions.map((t) => (
                    <tr key={t.id}>
                      <td className="p-2 px-3">{new Date(t.createdAt).toLocaleDateString('fr-FR')}</td>
                      <td className="p-2 px-3">{t.description}</td>
                      <td className="p-2 px-3">{t.paymentMode}</td>
                      <td className="p-2 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            t.type === 'RECETTE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {t.type}
                        </span>
                      </td>
                      <td className="p-2 px-3 text-right font-mono font-bold">{num(t.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  {detail.cashTransactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400">
                        Aucune opération de caisse.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <CommentsPanel entityType="Partner" entityId={detail.id} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Créances et dettes — the two sides of the ledger. Since Partner.balance is an
 * unsigned "amount outstanding" (it doesn't itself say who owes whom), the
 * category's `isSupplier` flag is what tells us which side a given balance is on:
 * a non-supplier (client) category with a positive balance is money owed TO us
 * (créance); a supplier category with a positive balance is money WE owe (dette).
 */
function CreancesDettesScreen({ partners }: { partners: Partner[] }) {
  const creances = partners.filter((p) => !p.categoryIsSupplier && p.balance > 0).sort((a, b) => b.balance - a.balance);
  const dettes = partners.filter((p) => p.categoryIsSupplier && p.balance > 0).sort((a, b) => b.balance - a.balance);
  const totalCreances = creances.reduce((acc, p) => acc + p.balance, 0);
  const totalDettes = dettes.reduce((acc, p) => acc + p.balance, 0);

  function renderTable(rows: Partner[], emptyLabel: string) {
    return (
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
          <tr>
            <th className="p-2 px-3">Code</th>
            <th className="p-2 px-3">Raison Sociale</th>
            <th className="p-2 px-3">Catégorie</th>
            <th className="p-2 px-3 text-right">Montant</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="p-2 px-3 font-mono font-bold text-slate-800">{p.code}</td>
              <td className="p-2 px-3">{p.raisonSociale}</td>
              <td className="p-2 px-3 text-slate-500">{p.categoryLabel}</td>
              <td className="p-2 px-3 text-right font-mono font-bold">{p.balance.toFixed(2)} DZD</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-6 text-center text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="font-extrabold text-slate-900 text-base">Créances et Dettes</span>
        <div className="flex gap-6 text-xs">
          <div>
            <span className="text-slate-400 font-medium block text-[11px]">TOTAL CRÉANCES (clients nous doivent)</span>
            <span className="font-mono font-bold text-emerald-700">{totalCreances.toFixed(2)} DZD</span>
          </div>
          <div>
            <span className="text-slate-400 font-medium block text-[11px]">TOTAL DETTES (nous devons aux fournisseurs)</span>
            <span className="font-mono font-bold text-rose-700">{totalDettes.toFixed(2)} DZD</span>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
          <div className="px-3 py-2 text-[11px] font-bold text-emerald-700 uppercase tracking-wider border-b border-slate-100">Créances</div>
          {renderTable(creances, 'Aucune créance.')}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
          <div className="px-3 py-2 text-[11px] font-bold text-rose-700 uppercase tracking-wider border-b border-slate-100">Dettes</div>
          {renderTable(dettes, 'Aucune dette.')}
        </div>
      </div>
    </div>
  );
}

/** Liste des partenaires bloqués — anyone with a credit limit set who has exceeded it. */
function PartenairesBloquesScreen({ partners }: { partners: Partner[] }) {
  const blocked = partners
    .filter((p) => p.seuilAutorise > 0 && p.balance > p.seuilAutorise)
    .sort((a, b) => b.balance - b.seuilAutorise - (a.balance - a.seuilAutorise));

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
        <span className="font-extrabold text-slate-900 text-base">Liste des Partenaires Bloqués</span>
        <p className="text-slate-400 text-[11px] mt-1">Partenaires dont le solde dépasse le seuil de crédit autorisé.</p>
      </div>
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Raison Sociale</th>
              <th className="p-3">Catégorie</th>
              <th className="p-3 text-right">Solde</th>
              <th className="p-3 text-right">Seuil Autorisé</th>
              <th className="p-3 text-right">Dépassement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {blocked.map((p) => (
              <tr key={p.id} className="bg-rose-50/40">
                <td className="p-3 font-mono font-bold text-rose-700">{p.code}</td>
                <td className="p-3 font-medium text-slate-800">{p.raisonSociale}</td>
                <td className="p-3 text-slate-500">{p.categoryLabel}</td>
                <td className="p-3 text-right font-mono">{p.balance.toFixed(2)} DZD</td>
                <td className="p-3 text-right font-mono text-slate-400">{p.seuilAutorise.toFixed(2)} DZD</td>
                <td className="p-3 text-right font-mono font-bold text-rose-700">{(p.balance - p.seuilAutorise).toFixed(2)} DZD</td>
              </tr>
            ))}
            {blocked.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  Aucun partenaire bloqué.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Créances à recouvrer — client debts specifically, sorted by amount, for collections follow-up. */
function CreancesARecouvrerScreen({ partners }: { partners: Partner[] }) {
  const rows = partners.filter((p) => !p.categoryIsSupplier && p.balance > 0).sort((a, b) => b.balance - a.balance);
  const total = rows.reduce((acc, p) => acc + p.balance, 0);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="font-extrabold text-slate-900 text-base">Créances à Recouvrer</span>
        <div className="text-xs">
          <span className="text-slate-400 font-medium block text-[11px]">TOTAL À RECOUVRER</span>
          <span className="font-mono font-bold text-[#0F5B38]">{total.toFixed(2)} DZD</span>
        </div>
      </div>
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Raison Sociale</th>
              <th className="p-3">Catégorie</th>
              <th className="p-3 text-right">Montant Dû</th>
              <th className="p-3 text-center">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const overLimit = p.seuilAutorise > 0 && p.balance > p.seuilAutorise;
              return (
                <tr key={p.id}>
                  <td className="p-3 font-mono font-bold text-slate-800">{p.code}</td>
                  <td className="p-3 font-medium text-slate-800">{p.raisonSociale}</td>
                  <td className="p-3 text-slate-500">{p.categoryLabel}</td>
                  <td className="p-3 text-right font-mono font-bold">{p.balance.toFixed(2)} DZD</td>
                  <td className="p-3 text-center">
                    {overLimit ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700">Dépassé</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">En cours</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  Aucune créance à recouvrer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ChiffreAffairesRow {
  month: string;
  ventesHT: number;
  avoirsVenteHT: number;
  caNetHT: number;
  achatsHT: number;
  avoirsAchatHT: number;
  achatsNetHT: number;
  margeHT: number;
}

function ChiffreAffairesScreen() {
  const [rows, setRows] = useState<ChiffreAffairesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);

  useEffect(() => {
    setLoading(true);
    apiRequest<ChiffreAffairesRow[]>(`/reports/chiffre-affaires?months=${months}`)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [months]);

  const totalCA = rows.reduce((acc, r) => acc + r.caNetHT, 0);
  const totalMarge = rows.reduce((acc, r) => acc + r.margeHT, 0);
  const totalAchats = rows.reduce((acc, r) => acc + r.achatsNetHT, 0);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.caNetHT)));

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <span className="font-extrabold text-slate-900 text-base">Chiffres d'Affaires</span>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 text-xs font-medium"
        >
          <option value={6}>6 derniers mois</option>
          <option value={12}>12 derniers mois</option>
          <option value={24}>24 derniers mois</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs text-center">
          <div className="text-[11px] text-slate-400 font-bold uppercase">CA Net HT (période)</div>
          <div className="text-xl font-black font-mono text-[#0F5B38] mt-1">{totalCA.toFixed(2)} DZD</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs text-center">
          <div className="text-[11px] text-slate-400 font-bold uppercase">Marge Totale HT</div>
          <div className="text-xl font-black font-mono text-emerald-700 mt-1">{totalMarge.toFixed(2)} DZD</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs text-center">
          <div className="text-[11px] text-slate-400 font-bold uppercase">Achats Nets HT</div>
          <div className="text-xl font-black font-mono text-slate-700 mt-1">{totalAchats.toFixed(2)} DZD</div>
        </div>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Chargement...</div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
              <tr>
                <th className="p-3">Mois</th>
                <th className="p-3 text-right">Ventes HT</th>
                <th className="p-3 text-right">Avoirs Vente</th>
                <th className="p-3 text-right">CA Net HT</th>
                <th className="p-3 text-right">Achats Nets HT</th>
                <th className="p-3 text-right">Marge HT</th>
                <th className="p-3 w-40">Tendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.month}>
                  <td className="p-3 font-mono font-bold text-slate-800">{r.month}</td>
                  <td className="p-3 text-right font-mono">{r.ventesHT.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono text-rose-600">{r.avoirsVenteHT.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono font-bold text-[#0F5B38]">{r.caNetHT.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono">{r.achatsNetHT.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono font-semibold text-emerald-700">{r.margeHT.toFixed(2)}</td>
                  <td className="p-3">
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${r.caNetHT >= 0 ? 'bg-[#0F5B38]' : 'bg-rose-500'}`}
                        style={{ width: `${(Math.abs(r.caNetHT) / maxAbs) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    Aucune donnée sur cette période.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface DashboardSummary {
  caMoisHT: number;
  margeMoisHT: number;
  achatsMoisHT: number;
  documentsOuverts: number;
  partenairesBloques: number;
  valeurStock: number;
  totalCreances: number;
  totalDettes: number;
}

function TableauDeBordScreen() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<DashboardSummary>('/reports/dashboard')
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">Chargement...</div>;
  }
  if (!summary) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">Impossible de charger le tableau de bord.</div>;
  }

  const cards: { label: string; value: string; color: string }[] = [
    { label: "CA du mois (HT)", value: `${summary.caMoisHT.toFixed(2)} DZD`, color: 'text-[#0F5B38]' },
    { label: 'Marge du mois (HT)', value: `${summary.margeMoisHT.toFixed(2)} DZD`, color: 'text-emerald-700' },
    { label: 'Achats du mois (HT)', value: `${summary.achatsMoisHT.toFixed(2)} DZD`, color: 'text-slate-700' },
    { label: 'Valeur du Stock (PUMP)', value: `${summary.valeurStock.toFixed(2)} DZD`, color: 'text-slate-700' },
    { label: 'Créances Clients', value: `${summary.totalCreances.toFixed(2)} DZD`, color: 'text-emerald-700' },
    { label: 'Dettes Fournisseurs', value: `${summary.totalDettes.toFixed(2)} DZD`, color: 'text-rose-700' },
    { label: 'Documents Ouverts', value: `${summary.documentsOuverts}`, color: 'text-amber-700' },
    { label: 'Partenaires Bloqués', value: `${summary.partenairesBloques}`, color: 'text-rose-700' }
  ];

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
        <span className="font-extrabold text-slate-900 text-base">Tableau de Bord</span>
        <p className="text-slate-400 text-[11px] mt-1">Vue d'ensemble en temps réel de l'activité.</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">{c.label}</div>
            <div className={`text-lg font-black font-mono mt-1 ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface VenteArticleRow {
  articleId: string;
  code: string;
  designation: string;
  quantity: number;
  totalHT: number;
}

function VentesArticlesScreen() {
  const [rows, setRows] = useState<VenteArticleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<VenteArticleRow[]>('/reports/ventes-articles?limit=50')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const maxQty = Math.max(1, ...rows.map((r) => Math.abs(r.quantity)));

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
        <span className="font-extrabold text-slate-900 text-base">Ventes d'Articles</span>
        <p className="text-slate-400 text-[11px] mt-1">Quantités et chiffre d'affaires net (ventes moins avoirs) par article.</p>
      </div>
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Chargement...</div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Désignation</th>
                <th className="p-3 text-right">Qté Vendue (nette)</th>
                <th className="p-3 text-right">CA HT (net)</th>
                <th className="p-3 w-40">Répartition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.articleId}>
                  <td className="p-3 font-mono font-bold text-slate-900">{r.code}</td>
                  <td className="p-3 font-medium text-slate-800">{r.designation}</td>
                  <td className={`p-3 text-right font-mono font-bold ${r.quantity < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{r.quantity}</td>
                  <td className="p-3 text-right font-mono font-semibold text-[#0F5B38]">{r.totalHT.toFixed(2)}</td>
                  <td className="p-3">
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${r.quantity >= 0 ? 'bg-[#0F5B38]' : 'bg-rose-500'}`}
                        style={{ width: `${(Math.abs(r.quantity) / maxQty) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    Aucune vente enregistrée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Etats des articles — full inventory state per article: stock, reserved, available, and valuation at cost. Built entirely from already-fetched article data, no extra round trip needed. */
function EtatsArticlesScreen({ articles }: { articles: Article[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const filtered = articles.filter(
    (a) => a.code.toLowerCase().includes(searchTerm.toLowerCase()) || a.designation.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalValue = articles.reduce((acc, a) => {
    const totalStock = Object.values(a.stocksByDepot).reduce((s, d) => s + d.qtyInStock, 0);
    return acc + totalStock * a.pump;
  }, 0);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
        <div>
          <span className="font-extrabold text-slate-900 text-base">Etats des Articles</span>
          <p className="text-slate-400 text-[11px] mt-1">Inventaire complet: stock, réservé, disponible, valorisation.</p>
        </div>
        <div className="text-right text-xs">
          <span className="text-slate-400 font-medium block text-[11px]">VALEUR TOTALE STOCK (PUMP)</span>
          <span className="font-mono font-bold text-[#0F5B38]">{totalValue.toFixed(2)} DZD</span>
        </div>
      </div>

      <input
        type="text"
        placeholder="Rechercher par code ou désignation..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="border border-slate-200 rounded-xl px-4 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/30 transition text-xs shadow-xs"
      />

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Désignation</th>
              <th className="p-3 text-right">P.U.M.P.</th>
              <th className="p-3 text-right">TVA</th>
              <th className="p-3 text-center">En Stock</th>
              <th className="p-3 text-center">Réservé</th>
              <th className="p-3 text-center">Disponible</th>
              <th className="p-3 text-right">Valorisation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((a) => {
              const totalStock = Object.values(a.stocksByDepot).reduce((s, d) => s + d.qtyInStock, 0);
              const totalReserved = Object.values(a.stocksByDepot).reduce((s, d) => s + d.qtyReserved, 0);
              return (
                <tr
                  key={a.id}
                  onClick={() => setSelectedArticleId(a.id === selectedArticleId ? null : a.id)}
                  className={`cursor-pointer transition ${selectedArticleId === a.id ? 'bg-[#0F5B38]/5' : 'hover:bg-slate-50'}`}
                >
                  <td className="p-3 font-mono font-bold text-slate-900">{a.code}</td>
                  <td className="p-3 font-medium text-slate-800">{a.designation}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{a.pump.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{a.tvaRate}%</td>
                  <td className="p-3 text-center font-mono">{totalStock}</td>
                  <td className="p-3 text-center font-mono text-amber-600">{totalReserved}</td>
                  <td
                    className={`p-3 text-center font-mono font-bold ${totalStock - totalReserved <= 0 ? 'text-rose-600' : 'text-[#0F5B38]'}`}
                  >
                    {totalStock - totalReserved}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold">{(totalStock * a.pump).toFixed(2)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">
                  Aucun article.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedArticleId && <CommentsPanel entityType="Article" entityId={selectedArticleId} />}
    </div>
  );
}

/**
 * Generic attach-a-note widget. Comments are polymorphic (entityType + entityId) so this
 * single component covers Partner/Article/Document detail views without a dedicated table
 * or screen per entity — matches how the backend already models Comment.
 */
function CommentsPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest<CommentItem[]>(`/comments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      setComments(res);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [entityType, entityId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest('/comments', { method: 'POST', body: { entityType, entityId, body: draft.trim() } });
      setDraft('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="font-bold text-slate-900">Commentaires</span>
        <span className="text-slate-400 text-[10px]">{comments.length} note(s)</span>
      </div>
      <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
        {loading && <div className="text-slate-400 text-[11px]">Chargement...</div>}
        {!loading && comments.length === 0 && <div className="text-slate-400 text-[11px]">Aucun commentaire.</div>}
        {comments.map((c) => (
          <div key={c.id} className="bg-slate-50 border border-slate-100 rounded-xl p-2">
            <div className="text-slate-700 whitespace-pre-wrap">{c.body}</div>
            <div className="text-slate-400 text-[10px] mt-1">{new Date(c.createdAt).toLocaleString('fr-FR')}</div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ajouter une note..."
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={submitting || !draft.trim()}
          className="bg-[#0F5B38] text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          Ajouter
        </button>
      </form>
    </div>
  );
}

/**
 * Create-partner dialog. Rebuilt on the shared Modal/Field primitives; it was
 * previously styled as a Windows-98 grey dialog (#d4d0c8 / #0a246a) which clashed
 * with every other surface in the app.
 */
function NewPartnerModal({
  categories,
  zones,
  onClose,
  onSubmit
}: {
  categories: PartnerCategoryOpt[];
  zones: Zone[];
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState('');
  const [raisonSociale, setRaisonSociale] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [zoneId, setZoneId] = useState('');
  // Identifiants fiscaux — requis pour l'État 104 et les mentions de facture.
  const [fiscal, setFiscal] = useState({ nif: '', rc: '', ai: '', nis: '', nin: '', address: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!code.trim()) next.code = 'Champ obligatoire';
    if (!raisonSociale.trim()) next.raisonSociale = 'Champ obligatoire';
    if (!categoryId) next.categoryId = 'Sélectionnez une catégorie';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    onSubmit({
      code: code.trim().toUpperCase(),
      raisonSociale: raisonSociale.trim(),
      categoryId,
      zoneId: zoneId || null,
      address: clean(fiscal.address),
      phone: clean(fiscal.phone),
      email: clean(fiscal.email),
      nif: clean(fiscal.nif),
      rc: clean(fiscal.rc),
      ai: clean(fiscal.ai),
      nis: clean(fiscal.nis),
      nin: clean(fiscal.nin)
    });
  }

  return (
    <Modal
      title="Nouveau partenaire"
      description="Client ou fournisseur selon la catégorie choisie."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={submit as unknown as React.MouseEventHandler<HTMLButtonElement>}>
            Créer le partenaire
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required error={errors.code}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex: CLI009" className="font-mono uppercase" />
          </Field>
          <Field label="Catégorie" required error={errors.categoryId}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Choisir —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.code})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Raison sociale" required error={errors.raisonSociale}>
          <Input value={raisonSociale} onChange={(e) => setRaisonSociale(e.target.value)} placeholder="ex: EURL PHARMA PLUS" />
        </Field>
        <Field label="Zone" hint="Optionnel — sert au regroupement géographique.">
          <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">Sans zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name} ({zone.code})
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Adresse">
            <Input value={fiscal.address} onChange={(e) => setFiscal({ ...fiscal, address: e.target.value })} />
          </Field>
          <Field label="Téléphone">
            <Input value={fiscal.phone} onChange={(e) => setFiscal({ ...fiscal, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Email">
          <Input value={fiscal.email} onChange={(e) => setFiscal({ ...fiscal, email: e.target.value })} />
        </Field>

        <div className="border-t border-slate-100 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            Identifiants fiscaux <span className="font-normal normal-case text-slate-400">— requis pour l'État 104</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="NIF">
              <Input value={fiscal.nif} onChange={(e) => setFiscal({ ...fiscal, nif: e.target.value })} className="font-mono" />
            </Field>
            <Field label="RC">
              <Input value={fiscal.rc} onChange={(e) => setFiscal({ ...fiscal, rc: e.target.value })} className="font-mono" />
            </Field>
            <Field label="AI">
              <Input value={fiscal.ai} onChange={(e) => setFiscal({ ...fiscal, ai: e.target.value })} className="font-mono" />
            </Field>
            <Field label="NIS">
              <Input value={fiscal.nis} onChange={(e) => setFiscal({ ...fiscal, nis: e.target.value })} className="font-mono" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="NIN">
              <Input value={fiscal.nin} onChange={(e) => setFiscal({ ...fiscal, nin: e.target.value })} className="font-mono" />
            </Field>
          </div>
        </div>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Create-category dialog, rebuilt on the shared primitives (see above). */
function NewCategoryModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: { code: string; label: string }) => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!code.trim()) next.code = 'Champ obligatoire';
    if (!label.trim()) next.label = 'Champ obligatoire';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({ code: code.trim().toUpperCase(), label: label.trim() });
  }

  return (
    <Modal
      title="Nouvelle catégorie de partenaire"
      description="Définit un palier tarifaire réutilisable."
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={submit as unknown as React.MouseEventHandler<HTMLButtonElement>}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Code" required error={errors.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex: PHARM_SUD" className="font-mono uppercase" />
        </Field>
        <Field label="Libellé" required error={errors.label}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Pharmacies Réseau Sud" />
        </Field>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/**
 * Partner categories carry one extra flag beyond code/label: `isSupplier` decides
 * whether partners in the category appear on the purchasing side or the sales side.
 */
const PARTNER_CATEGORY_FIELDS: RefField[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, uppercase: true, mono: true, placeholder: 'ex: PHARM_SUD' },
  { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'ex: Pharmacies Réseau Sud' },
  { key: 'isSupplier', label: 'Catégorie fournisseur (achats)', type: 'boolean', badgeLabel: 'Fournisseur' }
];

/** Écran honnête pour un module annoncé mais pas encore construit. */
function NotImplementedScreen({ label }: { label: string }) {
  return (
    <Screen title={label} description="Module prévu, pas encore disponible." maxWidth="max-w-xl">
      <Card>
        <p className="text-xs text-slate-600 leading-relaxed">
          Cet écran n&apos;est pas encore développé. En attendant, les montants nécessaires (TVA collectée et déductible, timbre encaissé,
          chiffre d&apos;affaires) sont disponibles dans <b>Déclaration TVA</b> et <b>Timbre fiscal encaissé</b>.
        </p>
      </Card>
    </Screen>
  );
}

function AProposScreen() {
  return (
    <Screen title="À propos" description="Informations sur l'application" maxWidth="max-w-2xl">
      <Card>
        <div className="flex items-center gap-4 mb-4">
          <DjemroudLogo className="w-14 h-14" />
          <div>
            <div className="font-extrabold text-slate-900 text-sm">Anagnorisis ERP</div>
            <div className="text-slate-500 text-[11px]">Ets Djemroud — Parapharmacie Gros &amp; Détail</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-slate-400 text-[10px] font-bold uppercase">Version</dt>
            <dd className="font-mono text-slate-800">0.1.0</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-[10px] font-bold uppercase">Base de données</dt>
            <dd className="text-slate-800">PostgreSQL</dd>
          </div>
        </dl>
        <p className="text-slate-400 text-[11px] mt-4 leading-relaxed">
          Raccourci : <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Ctrl</kbd> +{' '}
          <kbd className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">K</kbd> ouvre la recherche d'écrans.
        </p>
      </Card>
    </Screen>
  );
}

// ==========================================
// 4. MAIN APPLICATION COMPONENT
// ==========================================
export default function App({ onLogout }: { onLogout: () => void }) {
  // Login lands on a neutral welcome screen — opening the app starts no workflow.
  const [currentView, setCurrentView] = useState<ERPView>('ACCUEIL');
  const [virementMode, setVirementMode] = useState<'RECETTE' | 'DEPENSE'>('RECETTE');

  // Identifies the signed-in user for the shell (name, role) and for role-gated
  // navigation entries. Read from the session the login screen persisted.
  const currentUser = useMemo(() => getStoredUser<{ id: string; username: string; role: UserRole }>(), []);

  /**
   * Régules and chèques used to share one view with a hidden mode toggle, so the
   * sidebar could not show which one you were on. They are now distinct screens
   * and the mode is derived from the screen id — one less piece of hidden state.
   */
  const regulesMode: 'REGULE_PLUS' | 'REGULE_MOINS' = currentView === 'REGULES_MOINS' ? 'REGULE_MOINS' : 'REGULE_PLUS';
  const chequeMode: 'RECETTE' | 'DEPENSE' = currentView === 'CHEQUES_DEPENSE' ? 'DEPENSE' : 'RECETTE';

  // Modals
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [showNewPartnerModal, setShowNewPartnerModal] = useState(false);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);

  // Real data (fetched from the backend)
  const [partners, setPartners] = useState<Partner[]>([]);
  const [categories, setCategories] = useState<PartnerCategoryOpt[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [livreurs, setLivreurs] = useState<Livreur[]>([]);
  const [chargeClasses, setChargeClasses] = useState<ChargeClass[]>([]);
  const [typeReglements, setTypeReglements] = useState<TypeReglement[]>([]);
  const [rawArticles, setRawArticles] = useState<any[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [settings, setSettings] = useState<CompanySettings>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Émet la facture d'un bon de livraison validé. Le serveur crée une facture
   * liée au BL: elle reprend ses montants mais n'a aucun effet sur le stock ni
   * sur le solde client, déjà imputés par le bon de livraison.
   */
  async function handleFacturerBL(blId: string) {
    try {
      const facture = await apiRequest<{ id: string; reference: string }>(`/documents/${blId}/facturer`, { method: 'POST' });
      await refreshAll();
      setNotice(`Facture ${facture.reference} émise.`);
      handlePrintDocument(facture.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setNotice(
        code === 'BON_LIVRAISON_ALREADY_INVOICED'
          ? 'Ce bon de livraison a déjà été facturé.'
          : "Facturation impossible."
      );
    }
  }

  /** Fetches the full document (lines + article info) and sends it to the printer as an A4 bon/facture. */
  async function handlePrintDocument(docId: string) {
    try {
      const doc = await apiRequest<any>(`/documents/${docId}`);
      printHtml(
        invoiceHtml(
          {
            reference: doc.reference,
            type: doc.type,
            date: doc.validatedAt ?? doc.createdAt,
            partnerName: doc.partner?.raisonSociale ?? null,
            partnerCode: doc.partner?.code ?? null,
            partnerAddress: doc.partner?.address ?? null,
            partnerFiscal: doc.partner
              ? { nif: doc.partner.nif, rc: doc.partner.rc, ai: doc.partner.ai, nis: doc.partner.nis, nin: doc.partner.nin, email: doc.partner.email }
              : null,
            paymentMode: doc.paymentMode,
            totalHT: num(doc.totalHT),
            remise: num(doc.remise),
            totalTVA: num(doc.totalTVA),
            stampDuty: num(doc.stampDuty),
            totalTTC: num(doc.totalTTC),
            lines: (doc.lines ?? []).map((l: any) => ({
              code: l.article?.code ?? '',
              designation: l.article?.designation ?? '',
              quantity: l.quantity,
              unitPriceHT: num(l.unitPriceHT),
              discountPercent: num(l.discountPercent),
              tvaRate: num(l.tvaRate),
              totalHT: num(l.totalHT)
            }))
          },
          settings
        )
      );
    } catch {
      alert("Impression impossible — document introuvable.");
    }
  }

  async function refreshAll() {
    try {
      const [partnersRes, categoriesRes, zonesRes, livreursRes, chargeClassesRes, typeReglementsRes, articlesRes, depotsRes, documentsRes, cashRes] = await Promise.all([
        apiRequest<any[]>('/partners?limit=50000'),
        apiRequest<PartnerCategoryOpt[]>('/partner-categories'),
        apiRequest<Zone[]>('/zones'),
        apiRequest<Livreur[]>('/livreurs'),
        apiRequest<ChargeClass[]>('/charge-classes'),
        apiRequest<TypeReglement[]>('/type-reglements'),
        apiRequest<any[]>('/articles?limit=50000'),
        apiRequest<Depot[]>('/depots'),
        apiRequest<DocumentRow[]>('/documents'),
        apiRequest<{ transactions: CashTransaction[]; totalBalance: number }>('/cash')
      ]);
      // Company identity for printed documents; non-fatal if unavailable.
      apiRequest<CompanySettings>('/settings').then(setSettings).catch(() => undefined);

      setCategories(categoriesRes);
      setZones(zonesRes);
      setLivreurs(livreursRes);
      setChargeClasses(chargeClassesRes);
      setTypeReglements(typeReglementsRes);
      setPartners(
        partnersRes.map((p) => ({
          id: p.id,
          code: p.code,
          raisonSociale: p.raisonSociale,
          categoryId: p.categoryId,
          categoryLabel: p.category?.label,
          categoryIsSupplier: p.category?.isSupplier ?? false,
          phone: p.phone ?? undefined,
          address: p.address ?? undefined,
          balance: num(p.balance),
          seuilAutorise: num(p.seuilAutorise)
        }))
      );
      setRawArticles(articlesRes);
      setDepots(depotsRes);
      setDocuments(documentsRes);
      setCashTransactions(cashRes.transactions);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onLogout();
        return;
      }
      setLoadError(error instanceof Error ? error.message : 'Erreur de connexion au serveur');
    }
  }

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Document state
  const [docReference, setDocReference] = useState<string | null>(null);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [viewingDocDetail, setViewingDocDetail] = useState<DocumentRow | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [selectedDepotId, setSelectedDepotId] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [paymentType, setPaymentType] = useState<'ESPECE' | 'CHEQUE' | 'VIREMENT' | 'TRAITE'>('ESPECE');
  const [selectedLivreurId, setSelectedLivreurId] = useState('');
  const [lines, setLines] = useState<DocLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDepotId && depots.length > 0) {
      setSelectedDepotId(depots.find((d) => d.isDefault)?.id ?? depots[0].id);
    }
  }, [depots, selectedDepotId]);

  useEffect(() => {
    if (!selectedLivreurId && livreurs.length > 0) {
      setSelectedLivreurId(livreurs[0].id);
    }
  }, [livreurs, selectedLivreurId]);

  useEffect(() => {
    if (!viewingDocId) {
      setViewingDocDetail(null);
      return;
    }
    apiRequest<DocumentRow>(`/documents/${viewingDocId}`)
      .then(setViewingDocDetail)
      .catch(() => setViewingDocDetail(null));
  }, [viewingDocId]);

  useEffect(() => {
    if (!selectedPartner && partners.length > 0) {
      const isPurchaseViewNow = currentView === 'ACHATS' || currentView === 'AVOIRS_ACHATS';
      const pool = partners.filter((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        return isPurchaseViewNow ? cat?.isSupplier : !cat?.isSupplier;
      });
      setSelectedPartner(pool[0] ?? partners[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners, currentView]);

  // Derived article list, priced for the currently selected partner's category
  const articles: Article[] = useMemo(() => {
    return rawArticles.map((a) => {
      const pricesByCategory: Record<string, { priceHT: number; priceTTC: number }> = {};
      for (const p of a.prices ?? []) {
        pricesByCategory[p.categoryId] = { priceHT: num(p.priceHT), priceTTC: num(p.priceTTC) };
      }
      const stocksByDepot: Record<string, { qtyInStock: number; qtyReserved: number }> = {};
      let totalAvailable = 0;
      for (const s of a.stocks ?? []) {
        stocksByDepot[s.depotId] = { qtyInStock: s.qtyInStock, qtyReserved: s.qtyReserved };
        totalAvailable += s.qtyInStock - s.qtyReserved;
      }
      const tierPrice = selectedPartner ? pricesByCategory[selectedPartner.categoryId]?.priceHT : undefined;
      return {
        id: a.id,
        code: a.code,
        barcode: a.barcode ?? null,
        designation: a.designation,
        pump: num(a.pump),
        tvaRate: num(a.tvaRate),
        seuilReappro: a.seuilReappro ?? null,
        preferred: Boolean(a.preferred),
        maxQtyPerClient: a.maxQtyPerClient ?? null,
        priceHT: tierPrice ?? num(a.pump),
        stockGlobal: totalAvailable,
        pricesByCategory,
        stocksByDepot
      };
    });
  }, [rawArticles, selectedPartner]);

  const isPurchaseView = currentView === 'ACHATS' || currentView === 'AVOIRS_ACHATS';
  const partnerPool = useMemo(
    () =>
      partners.filter((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        return isPurchaseView ? cat?.isSupplier : !cat?.isSupplier;
      }),
    [partners, categories, isPurchaseView]
  );

  // Helpers
  const handleUpdateLineQuantity = (id: string, qte: number) => {
    setLines(
      lines.map((l) => {
        if (l.id === id) {
          const validQte = Math.max(1, qte);
          const montant = validQte * l.prixVente * (1 - l.remisePercent / 100);
          return { ...l, qte: validQte, montantHT: montant };
        }
        return l;
      })
    );
  };

  /**
   * Le taux de TVA est proposé depuis la fiche article, mais reste modifiable sur
   * chaque ligne: le catalogue mélange des produits à 19 %, 9 % et 0 %, et le taux
   * applicable peut différer selon l'opération.
   */
  const handleUpdateLineTva = (id: string, tvaRate: number) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, tvaRate } : l)));
  };

  const handleRemoveLine = (id: string) => {
    setLines(lines.filter((l) => l.id !== id).map((l, idx) => ({ ...l, num: idx + 1 })));
  };

  const handleAddArticleToDoc = (art: Article) => {
    const depot = depots.find((d) => d.id === selectedDepotId);
    const newLine: DocLine = {
      id: String(Date.now()),
      num: lines.length + 1,
      depotId: selectedDepotId,
      depotLabel: depot?.name ?? '',
      articleId: art.id,
      code: art.code,
      designation: art.designation,
      qte: 1,
      pump: art.pump,
      prixVente: art.priceHT,
      remisePercent: 0,
      montantHT: art.priceHT,
      tvaRate: art.tvaRate
    };
    setLines([...lines, newLine]);
  };

  const handleReserveArticle = (art: Article, quantities: Record<string, number>) => {
    const newLines: DocLine[] = Object.entries(quantities).map(([depotId, qty], idx) => {
      const depot = depots.find((d) => d.id === depotId);
      return {
        id: `${Date.now()}-${idx}`,
        num: lines.length + idx + 1,
        depotId,
        depotLabel: depot?.name ?? '',
        articleId: art.id,
        code: art.code,
        designation: art.designation,
        qte: qty,
        pump: art.pump,
        prixVente: art.priceHT,
        remisePercent: 0,
        montantHT: qty * art.priceHT,
        tvaRate: art.tvaRate
      };
    });
    setLines([...lines, ...newLines]);
  };

  const relevantDocuments = documents.filter((d) => {
    if (currentView === 'ACHATS') return d.type === 'ACHAT';
    if (currentView === 'BONS_PREP' || currentView === 'VENTES_VALIDATION') return d.type === 'BON_PREPARATION';
    if (currentView === 'AVOIRS_ACHATS') return d.type === 'RETOUR_FOURNISSEUR';
    if (currentView === 'AVOIRS_VENTES') return d.type === 'RETOUR_CLIENT';
    if (currentView === 'FACTURE') return d.type === 'FACTURE';
    if (currentView === 'PROFORMA') return d.type === 'PROFORMA';
    if (currentView === 'BONS_LIVRAISON') return d.type === 'BON_LIVRAISON';
    return false;
  });

  // ---------- Piece-number navigation (browse existing documents of this type) ----------
  const navDocs = [...relevantDocuments].sort((a, b) => a.reference.localeCompare(b.reference));
  const navIndex = viewingDocId ? navDocs.findIndex((d) => d.id === viewingDocId) : -1;

  function goFirst() {
    if (navDocs.length > 0) setViewingDocId(navDocs[0].id);
  }
  function goPrev() {
    if (navIndex > 0) setViewingDocId(navDocs[navIndex - 1].id);
  }
  function goNext() {
    if (navIndex >= 0 && navIndex < navDocs.length - 1) setViewingDocId(navDocs[navIndex + 1].id);
  }
  function goLast() {
    if (navDocs.length > 0) setViewingDocId(navDocs[navDocs.length - 1].id);
  }

  const isReadOnly = !!viewingDocDetail;
  const displayLines = viewingDocDetail
    ? (viewingDocDetail.lines ?? []).map((l, idx) => ({
        id: l.id,
        num: idx + 1,
        depotId: l.depotId,
        depotLabel: l.depot?.name ?? '',
        articleId: l.articleId,
        code: l.article?.code ?? '',
        designation: l.article?.designation ?? '',
        qte: l.quantity,
        pump: num(l.purchaseCostPUMP),
        prixVente: num(l.unitPriceHT),
        remisePercent: num(l.discountPercent),
        montantHT: num(l.totalHT),
        tvaRate: num(l.tvaRate)
      }))
    : lines;

  function handleNouveau() {
    setViewingDocId(null);
    setEditingDocumentId(null);
    setDocReference(null);
    setLines([]);
    setNotice(null);
  }

  function handleModifier() {
    if (!viewingDocDetail || viewingDocDetail.status !== 'OUVERT') return;
    const depot = depots.find((d) => d.id === viewingDocDetail.depotId);
    setSelectedDepotId(viewingDocDetail.depotId ?? selectedDepotId);
    setPaymentType((viewingDocDetail.paymentMode as typeof paymentType) ?? 'ESPECE');
    const partner = partners.find((p) => p.id === viewingDocDetail.partnerId);
    setSelectedPartner(partner ?? null);
    setLines(
      (viewingDocDetail.lines ?? []).map((l, idx) => ({
        id: l.id,
        num: idx + 1,
        depotId: l.depotId,
        depotLabel: l.depot?.name ?? depot?.name ?? '',
        articleId: l.articleId,
        code: l.article?.code ?? '',
        designation: l.article?.designation ?? '',
        qte: l.quantity,
        pump: num(l.purchaseCostPUMP),
        prixVente: num(l.unitPriceHT),
        remisePercent: num(l.discountPercent),
        montantHT: num(l.totalHT),
        tvaRate: num(l.tvaRate)
      }))
    );
    setEditingDocumentId(viewingDocDetail.id);
    setDocReference(viewingDocDetail.reference);
    setViewingDocId(null);
  }

  // Calculations — pulled from the stored document when browsing, computed live when drafting
  const totalHT = viewingDocDetail ? num(viewingDocDetail.totalHT) : lines.reduce((acc, l) => acc + l.montantHT, 0);
  const totalTVA = viewingDocDetail ? num(viewingDocDetail.totalTVA) : lines.reduce((acc, l) => acc + l.montantHT * (l.tvaRate / 100), 0);
  const totalTimbre = viewingDocDetail
    ? num(viewingDocDetail.stampDuty)
    : paymentType === 'ESPECE' && totalHT + totalTVA > 0
    ? Math.min(Math.max((totalHT + totalTVA) * 0.01, 5), 2500)
    : 0;
  const totalTTC = viewingDocDetail ? num(viewingDocDetail.totalTTC) : totalHT + totalTVA;
  const totalNet = viewingDocDetail ? totalTTC : totalTTC + totalTimbre;
  const totalMargeDZD = viewingDocDetail ? num(viewingDocDetail.marginHT) : totalHT - lines.reduce((acc, l) => acc + l.pump * l.qte, 0);
  const margePercent = viewingDocDetail ? num(viewingDocDetail.marginPercent) : totalHT > 0 ? (totalMargeDZD / totalHT) * 100 : 0;

  async function handleSaveDocument() {
    const editableViews: ERPView[] = ['ACHATS', 'BONS_PREP', 'VENTES_VALIDATION', 'AVOIRS_ACHATS', 'AVOIRS_VENTES'];
    if (!editableViews.includes(currentView)) return;
    if (!selectedPartner || !selectedDepotId || lines.length === 0) {
      setNotice('Sélectionnez un partenaire, un dépôt, et ajoutez au moins un article.');
      return;
    }

    // Documents that are final at save time: ventes/avoirs (immediate commercial
    // effect), factures (a facture is not a draft), and proformas (validation is a
    // no-op for them — no stock, no ledger — but marks the quote as issued).
    const autoValidate =
      currentView === 'VENTES_VALIDATION' ||
      currentView === 'AVOIRS_ACHATS' ||
      currentView === 'AVOIRS_VENTES' ||
      currentView === 'FACTURE' ||
      currentView === 'PROFORMA' ||
      currentView === 'BONS_LIVRAISON';

    setSaving(true);
    setNotice(null);
    try {
      const type = viewToDocumentType(currentView);
      const payload = {
        type,
        partnerId: selectedPartner.id,
        livreurId: selectedLivreurId || null,
        depotId: selectedDepotId,
        paymentMode: paymentType,
        remise: 0,
        lines: lines.map((l) => ({
          articleId: l.articleId,
          depotId: l.depotId,
          quantity: l.qte,
          unitPriceHT: l.prixVente,
          discountPercent: l.remisePercent,
          tvaRate: l.tvaRate
        }))
      };

      const document = editingDocumentId
        ? await apiRequest<{ id: string; reference: string }>(`/documents/${editingDocumentId}`, { method: 'PUT', body: payload })
        : await apiRequest<{ id: string; reference: string }>('/documents', { method: 'POST', body: payload });

      if (autoValidate) {
        await apiRequest(`/documents/${document.id}/validate`, { method: 'POST' });
      }

      setDocReference(document.reference);
      setNotice(`Document ${document.reference} enregistré${autoValidate ? ' et validé' : ' en brouillon'}.`);
      setLines([]);
      setEditingDocumentId(null);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidateExisting(doc: DocumentRow) {
    try {
      await apiRequest(`/documents/${doc.id}/validate`, { method: 'POST' });
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erreur');
    }
  }

  async function handleCancelExisting(doc: DocumentRow) {
    if (!confirm(`Annuler le document validé ${doc.reference} ?`)) return;
    try {
      await apiRequest(`/documents/${doc.id}/cancel`, { method: 'POST' });
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erreur');
    }
  }

  async function handleDeleteDraft(doc: DocumentRow) {
    if (!confirm(`Supprimer le brouillon ${doc.reference} ?`)) return;
    try {
      await apiRequest(`/documents/${doc.id}`, { method: 'DELETE' });
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erreur');
    }
  }

  async function handleAddPartner(data: { code: string; raisonSociale: string; categoryId: string; zoneId?: string | null }) {
    try {
      await apiRequest('/partners', { method: 'POST', body: { ...data, zoneId: data.zoneId ?? null, seuilAutorise: 0 } });
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erreur');
    }
  }

  async function handleAddCategory(data: { code: string; label: string }) {
    try {
      await apiRequest('/partner-categories', { method: 'POST', body: { ...data, isSupplier: false } });
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erreur');
    }
  }

  return (
    <AppShell current={currentView} onNavigate={setCurrentView} user={currentUser} onLogout={onLogout}>

        {/* ---------- PARTENAIRES ---------- */}
        {currentView === 'PARTENAIRES' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-5xl mx-auto w-full z-10">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center">
              <span className="font-extrabold text-slate-900 text-base">Répertoire des Partenaires</span>
              <button
                onClick={() => setShowNewPartnerModal(true)}
                className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-medium px-4 py-2 rounded-xl transition shadow-xs text-xs"
              >
                + Nouveau Partenaire
              </button>
            </div>
            <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Raison Sociale</th>
                    <th className="p-3">Catégorie</th>
                    <th className="p-3 text-right">Solde</th>
                    <th className="p-3 text-right">Seuil Autorisé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {partners.map((p) => (
                    <tr key={p.id} className={p.balance > p.seuilAutorise && p.seuilAutorise > 0 ? 'bg-rose-50/60' : ''}>
                      <td className="p-3 font-mono font-bold text-[#0F5B38]">{p.code}</td>
                      <td className="p-3 font-medium text-slate-800">{p.raisonSociale}</td>
                      <td className="p-3 text-slate-500">{p.categoryLabel}</td>
                      <td className="p-3 text-right font-mono">{p.balance.toFixed(2)} DZD</td>
                      <td className="p-3 text-right font-mono text-slate-400">{p.seuilAutorise.toFixed(2)} DZD</td>
                    </tr>
                  ))}
                  {partners.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        Aucun partenaire.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- MASTER DATA (one screen per reference table) ---------- */}
        {currentView === 'LIVREURS' && (
          <ReferenceDataScreen
            title="Livreurs"
            description="Agents de livraison rattachés aux bons et aux ventes."
            endpoint="/livreurs"
            fields={LIVREUR_FIELDS}
            rows={livreurs}
            searchKeys={['code', 'name', 'phone']}
            onRefresh={refreshAll}
          />
        )}

        {currentView === 'ZONES' && (
          <ReferenceDataScreen
            title="Zones"
            description="Secteurs géographiques utilisés pour regrouper les partenaires."
            endpoint="/zones"
            fields={ZONE_FIELDS}
            rows={zones}
            searchKeys={['code', 'name']}
            onRefresh={refreshAll}
          />
        )}

        {currentView === 'CHARGE_CLASSES' && (
          <ReferenceDataScreen
            title="Classes de charges"
            description="Catégories de dépenses (loyer, transport, salaires...) utilisées par le module Charges."
            endpoint="/charge-classes"
            fields={CHARGE_CLASS_FIELDS}
            rows={chargeClasses}
            searchKeys={['code', 'label']}
            onRefresh={refreshAll}
          />
        )}

        {currentView === 'TYPE_REGULES' && (
          <ReferenceDataScreen
            title="Types de règlement"
            description="Conditions de paiement proposées aux partenaires (comptant, 30 jours...)."
            endpoint="/type-reglements"
            fields={TYPE_REGLEMENT_FIELDS}
            rows={typeReglements}
            searchKeys={['code', 'label']}
            onRefresh={refreshAll}
          />
        )}

        {currentView === 'DEPOTS' && (
          <ReferenceDataScreen
            title="Dépôts"
            description="Emplacements de stockage. Le dépôt par défaut est présélectionné dans les saisies."
            endpoint="/depots"
            fields={DEPOT_FIELDS}
            rows={depots}
            searchKeys={['code', 'name']}
            onRefresh={refreshAll}
          />
        )}

        {currentView === 'PARTNER_CATEGORIES' && (
          <ReferenceDataScreen
            title="Catégories de partenaires"
            description="Paliers tarifaires. « Fournisseur » détermine si la catégorie apparaît côté achats ou côté ventes."
            endpoint="/partner-categories"
            fields={PARTNER_CATEGORY_FIELDS}
            rows={categories as unknown as (PartnerCategoryOpt & { id: string })[]}
            searchKeys={['code', 'label']}
            onRefresh={refreshAll}
          />
        )}

        {/* ---------- ARTICLES / PRIX ---------- */}
        {currentView === 'ARTICLES' && (
          <PrixArticlesView articles={articles} categories={categories} depots={depots} />
        )}

        {currentView === 'ACCUEIL' && <AccueilScreen username={currentUser?.username} onNavigate={setCurrentView} />}

        {currentView === 'A_PROPOS' && <AProposScreen />}

        {/* ---------- POS / RETAIL ---------- */}
        {currentView === 'CAISSE_POS' && (
          <POSScreen
            articles={articles}
            partners={partners}
            depots={depots}
            settings={settings}
            cashierName={currentUser?.username}
            onSaved={refreshAll}
          />
        )}

        {/* ---------- COMMANDES / CHARGES ---------- */}
        {currentView === 'COMMANDES' && (
          <CommandesScreen articles={articles} partners={partners} depots={depots} documents={documents} onSaved={refreshAll} />
        )}
        {currentView === 'CHARGES' && <ChargesScreen chargeClasses={chargeClasses} />}

        {/* ---------- CONSULTATION ---------- */}
        {currentView === 'VALIDATION_BON_PREP' && (
          <ValidationQueueScreen documents={documents} onChanged={refreshAll} onPrint={handlePrintDocument} />
        )}
        {currentView === 'LISTE_BONS_PREP' && (
          <DocumentListScreen
            title="Liste des bons de préparation"
            description="Tous les bons de préparation, quel que soit leur statut."
            documents={documents}
            types={['BON_PREPARATION']}
            onPrint={handlePrintDocument}
          />
        )}
        {currentView === 'ARCHIVE' && (
          <DocumentListScreen
            title="Consultation de l'archive"
            description="Documents validés et annulés, tous types confondus."
            documents={documents}
            types={['ACHAT', 'COMMANDE', 'BON_PREPARATION', 'VENTE', 'FACTURE', 'PROFORMA', 'RETOUR_CLIENT', 'RETOUR_FOURNISSEUR', 'REGULE_PLUS', 'REGULE_MOINS', 'TRANSFERT']}
            statuses={['VALIDE', 'ANNULE']}
            onPrint={handlePrintDocument}
          />
        )}
        {currentView === 'MOUVEMENT_ARTICLE' && <MouvementArticleScreen articles={articles} />}
        {currentView === 'REAPPRO' && <ReapproScreen articles={articles} onChanged={refreshAll} />}

        {/* ---------- ANALYSE / FISCAL ---------- */}
        {currentView === 'CHIFFRE_AFFAIRES_AGENT' && <CALivreursScreen />}
        {currentView === 'DECLARATION_TVA' && <FiscalScreen kind="TVA" settings={settings} />}
        {currentView === 'ETAT_104' && <Etat104Screen settings={settings} />}
        {currentView === 'ETAT_G50' && <NotImplementedScreen label="État G50" />}

        {/* ---------- OUTILS ---------- */}
        {currentView === 'UTILISATEURS' && <UsersScreen currentUserId={currentUser?.id} />}
        {currentView === 'PARAMETRES' && <SettingsScreen onSaved={setSettings} />}
        {currentView === 'INVENTAIRES' && <InventaireScreen articles={articles} depots={depots} onSaved={refreshAll} />}

        {/* ---------- SYNTHÈSES & MAINTENANCE ---------- */}
        {currentView === 'SITUATION' && <SituationScreen articles={articles} depots={depots} />}
        {currentView === 'GRAPHE_INDICES' && <GraphesScreen />}
        {currentView === 'MONTANTS_BLOCAGE' && <MontantsBlocageScreen partners={partners} onChanged={refreshAll} />}
        {currentView === 'SAUVEGARDE' && <SauvegardeScreen />}
        {currentView === 'ARCHIVAGE' && <ArchivageScreen />}
        {currentView === 'AFFICHAGE_TABLES' && <TablesScreen />}

        {/* ---------- STOCKS ---------- */}
        {currentView === 'STOCKS' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-6xl mx-auto w-full z-10">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="font-extrabold text-slate-900 text-base">Consultation des Stocks</span>
            </div>
            <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Désignation</th>
                    {depots.map((d) => (
                      <th key={d.id} className="p-3 text-center">
                        {d.name}
                      </th>
                    ))}
                    <th className="p-3 text-center">Total Disponible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {articles.map((a) => (
                    <tr key={a.id}>
                      <td className="p-3 font-mono font-bold text-slate-900">{a.code}</td>
                      <td className="p-3 font-medium text-slate-800">{a.designation}</td>
                      {depots.map((d) => {
                        const s = a.stocksByDepot[d.id];
                        const available = s ? s.qtyInStock - s.qtyReserved : 0;
                        return (
                          <td key={d.id} className="p-3 text-center font-mono">
                            {s ? `${available} / ${s.qtyInStock}` : '—'}
                          </td>
                        );
                      })}
                      <td className="p-3 text-center font-mono font-bold text-[#0F5B38]">{a.stockGlobal}</td>
                    </tr>
                  ))}
                  {articles.length === 0 && (
                    <tr>
                      <td colSpan={3 + depots.length} className="p-8 text-center text-slate-400">
                        Aucun article.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- REGULES (stock corrections) ---------- */}
        {(currentView === 'REGULES_PLUS' || currentView === 'REGULES_MOINS') && (
          <RegulesScreen
            mode={regulesMode}
            onModeChange={(m) => setCurrentView(m === 'REGULE_PLUS' ? 'REGULES_PLUS' : 'REGULES_MOINS')}
            articles={articles}
            depots={depots}
            documents={documents}
            onSaved={refreshAll}
          />
        )}

        {/* ---------- TRANSFERTS (inter-depot transfers) ---------- */}
        {currentView === 'TRANSFERTS' && (
          <TransfertScreen depots={depots} articles={articles} documents={documents} onSaved={refreshAll} />
        )}

        {/* ---------- CHÈQUES (recette/dépense) ---------- */}
        {(currentView === 'CHEQUES_RECETTE' || currentView === 'CHEQUES_DEPENSE') && (
          <PartnerSettlementScreen
            title="Chèques"
            paymentMode="CHEQUE"
            mode={chequeMode}
            onModeChange={(m) => setCurrentView(m === 'RECETTE' ? 'CHEQUES_RECETTE' : 'CHEQUES_DEPENSE')}
            partners={partners}
            transactions={cashTransactions}
            onSaved={refreshAll}
          />
        )}

        {/* ---------- VIREMENT OU VERSEMENT ---------- */}
        {currentView === 'VIREMENT' && (
          <PartnerSettlementScreen
            title="Virement ou Versement"
            paymentMode="VIREMENT"
            mode={virementMode}
            onModeChange={setVirementMode}
            partners={partners}
            transactions={cashTransactions}
            onSaved={refreshAll}
          />
        )}

        {/* ---------- JOURNAL DE CAISSE (espèces uniquement) ---------- */}
        {currentView === 'JOURNAL_CAISSE' && (
          <CashJournalTable title="Journal de Caisse" transactions={cashTransactions.filter((t) => t.paymentMode === 'ESPECE')} />
        )}

        {/* ---------- JOURNAL DE BANQUE (tout sauf espèces) ---------- */}
        {currentView === 'JOURNAL_BANQUE' && (
          <CashJournalTable title="Journal de Banque" transactions={cashTransactions.filter((t) => t.paymentMode !== 'ESPECE')} />
        )}

        {/* ---------- TRANSACTIONS CAISSIÈRES (toutes opérations) ---------- */}
        {currentView === 'TRANSACTIONS_CAISSIERES' && (
          <CashJournalTable title="Transactions Caissières" transactions={cashTransactions} />
        )}

        {/* ---------- SUIVI D'UN PARTENAIRE ---------- */}
        {currentView === 'SUIVI_PARTENAIRE' && <SuiviPartenaireScreen partners={partners} />}

        {/* ---------- CRÉANCES ET DETTES ---------- */}
        {currentView === 'CREANCES_DETTES' && <CreancesDettesScreen partners={partners} />}

        {/* ---------- LISTE DES PARTENAIRES BLOQUÉS ---------- */}
        {currentView === 'PARTENAIRES_BLOQUES' && <PartenairesBloquesScreen partners={partners} />}

        {/* ---------- CRÉANCES À RECOUVRER ---------- */}
        {currentView === 'CREANCES_A_RECOUVRER' && <CreancesARecouvrerScreen partners={partners} />}

        {/* ---------- CHIFFRES D'AFFAIRES ---------- */}
        {currentView === 'CHIFFRE_AFFAIRES' && <ChiffreAffairesScreen />}

        {/* ---------- TABLEAU DE BORD ---------- */}
        {currentView === 'TABLEAU_BORD' && <TableauDeBordScreen />}

        {/* ---------- VENTES D'ARTICLES ---------- */}
        {currentView === 'VENTES_ARTICLES' && <VentesArticlesScreen />}

        {/* ---------- ETATS DES ARTICLES ---------- */}
        {currentView === 'ETATS_ARTICLES' && <EtatsArticlesScreen articles={articles} />}

        {/* ---------- ACTIVE DOCUMENT EDITOR VIEW (Achats / Bons Prep / Ventes / Factures / Proforma) ---------- */}
        {(currentView === 'ACHATS' ||
          currentView === 'BONS_PREP' ||
          currentView === 'VENTES_VALIDATION' ||
          currentView === 'AVOIRS_ACHATS' ||
          currentView === 'AVOIRS_VENTES' ||
          currentView === 'FACTURE' ||
          currentView === 'PROFORMA' ||
          currentView === 'BONS_LIVRAISON') && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden max-w-7xl mx-auto w-full z-10">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-slate-900 text-base">
                    {currentView === 'VENTES_VALIDATION' && 'Saisie de Vente & Validation'}
                    {currentView === 'ACHATS' && "Saisie d'Achat Fournisseur"}
                    {currentView === 'BONS_PREP' && 'Bon de Préparation'}
                    {currentView === 'AVOIRS_ACHATS' && 'Avoir Achat (Retour Fournisseur)'}
                    {currentView === 'AVOIRS_VENTES' && 'Avoir Vente (Retour Client)'}
                    {currentView === 'FACTURE' && 'Facture Client'}
                    {currentView === 'PROFORMA' && 'Facture Proforma (Devis)'}
                    {currentView === 'BONS_LIVRAISON' && 'Bon de Livraison'}
                  </span>
                  <span className="text-slate-400 font-mono text-xs">
                    Réf: {viewingDocDetail?.reference ?? docReference ?? '(nouveau)'}
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-1 py-1">
                    <button onClick={goFirst} disabled={navDocs.length === 0} className="px-2 text-slate-500 hover:text-[#0F5B38] disabled:opacity-30" title="Premier">
                      ⏮
                    </button>
                    <button onClick={goPrev} disabled={navIndex <= 0} className="px-2 text-slate-500 hover:text-[#0F5B38] disabled:opacity-30" title="Précédent">
                      ◀
                    </button>
                    <button
                      onClick={goNext}
                      disabled={navIndex < 0 || navIndex >= navDocs.length - 1}
                      className="px-2 text-slate-500 hover:text-[#0F5B38] disabled:opacity-30"
                      title="Suivant"
                    >
                      ▶
                    </button>
                    <button onClick={goLast} disabled={navDocs.length === 0} className="px-2 text-slate-500 hover:text-[#0F5B38] disabled:opacity-30" title="Dernier">
                      ⏭
                    </button>
                  </div>
                  {viewingDocDetail && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        viewingDocDetail.status === 'VALIDE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : viewingDocDetail.status === 'ANNULE'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {viewingDocDetail.status}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {viewingDocDetail && (
                    <button
                      onClick={() => handlePrintDocument(viewingDocDetail.id)}
                      className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-4 py-2 rounded-xl transition text-xs"
                    >
                      🖨 Imprimer
                    </button>
                  )}
                  {/* Un BL validé se facture en un clic; la facture reprend ses montants
                      sans réimputer le stock ni le solde (déjà faits par le BL). */}
                  {viewingDocDetail?.type === 'BON_LIVRAISON' && viewingDocDetail.status === 'VALIDE' && (
                    <button
                      onClick={() => handleFacturerBL(viewingDocDetail.id)}
                      className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-4 py-2 rounded-xl transition text-xs"
                    >
                      Facturer
                    </button>
                  )}
                  {viewingDocDetail?.status === 'OUVERT' && (
                    <button
                      onClick={handleModifier}
                      className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-4 py-2 rounded-xl transition text-xs"
                    >
                      Modifier
                    </button>
                  )}
                  <button
                    onClick={handleNouveau}
                    className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-4 py-2 rounded-xl transition text-xs"
                  >
                    Nouveau
                  </button>
                  {!viewingDocDetail && (
                    <button
                      onClick={() => (currentView === 'BONS_PREP' ? setShowReserveModal(true) : setShowArticleModal(true))}
                      className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-medium px-4 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 text-xs"
                    >
                      <span className="font-bold text-sm">+</span> {currentView === 'BONS_PREP' ? 'Réserver des articles' : 'Ajouter Produit'}
                    </button>
                  )}
                </div>
              </div>

              {notice && <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{notice}</div>}

              <div className="grid grid-cols-12 gap-3 text-xs">
                <div className="col-span-3">
                  <label className="block text-slate-400 font-medium mb-1 text-[11px]">DÉPÔT</label>
                  <select
                    value={selectedDepotId}
                    onChange={(e) => setSelectedDepotId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-3">
                  <label className="block text-slate-400 font-medium mb-1 text-[11px]">MODE RÈGLEMENT</label>
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value as typeof paymentType)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
                  >
                    <option value="ESPECE">Espèce (Timbre Fiscal 1%)</option>
                    <option value="CHEQUE">Chèque</option>
                    <option value="TRAITE">Traite</option>
                    <option value="VIREMENT">Virement Bancaire</option>
                  </select>
                </div>

                <div className="col-span-3">
                  <label className="block text-slate-400 font-medium mb-1 text-[11px]">LIVREUR / AGENT</label>
                  <select
                    value={selectedLivreurId}
                    onChange={(e) => setSelectedLivreurId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20 transition"
                  >
                    <option value="">Aucun</option>
                    {livreurs.map((livreur) => (
                      <option key={livreur.id} value={livreur.id}>
                        {livreur.name} ({livreur.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-12 bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-400 text-[11px] uppercase tracking-wider">
                      {isPurchaseView ? 'Fournisseur:' : 'Client:'}
                    </span>
                    {selectedPartner ? (
                      <>
                        <span className="font-mono font-bold bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[#0F5B38]">
                          {selectedPartner.code}
                        </span>
                        <span className="font-bold text-slate-800">{selectedPartner.raisonSociale}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Aucun sélectionné</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowPartnerModal(true)}
                    className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-3 py-1 rounded-lg transition shadow-2xs text-xs"
                  >
                    {isPurchaseView ? 'Changer Fournisseur' : 'Changer Client'}
                  </button>
                </div>
              </div>
            </div>

            {/* PRODUCT LINES TABLE */}
            <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col">
              <div className="overflow-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0 text-[11px]">
                    <tr>
                      <th className="p-3 w-10 text-center">N°</th>
                      <th className="p-3 w-32">Dépôt</th>
                      <th className="p-3 w-28">Code</th>
                      <th className="p-3">Désignation Produit</th>
                      <th className="p-3 text-center w-20">Qté</th>
                      <th className="p-3 text-right w-24">P.U.M.P.</th>
                      <th className="p-3 text-right w-28">Prix Vente</th>
                      <th className="p-3 text-right w-28">Montant HT</th>
                      <th className="p-3 text-center w-16">TVA</th>
                      <th className="p-3 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayLines.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-16 text-center text-slate-400 font-medium">
                          {isReadOnly ? (
                            'Ce document ne contient aucune ligne.'
                          ) : (
                            <>
                              Aucun produit sélectionné. Cliquez sur{' '}
                              <strong className="text-[#0F5B38] cursor-pointer" onClick={() => setShowArticleModal(true)}>
                                + Ajouter Produit
                              </strong>{' '}
                              pour commencer la saisie.
                            </>
                          )}
                        </td>
                      </tr>
                    ) : (
                      displayLines.map((line) => (
                        <tr key={line.id} className="hover:bg-slate-50/80 transition">
                          <td className="p-3 text-center font-mono text-slate-400 font-bold">{line.num}</td>
                          <td className="p-3 text-slate-500 font-medium">{line.depotLabel}</td>
                          <td className="p-3 font-mono font-bold text-slate-800">{line.code}</td>
                          <td className="p-3 font-medium text-slate-900">{line.designation}</td>
                          <td className="p-3 text-center">
                            {isReadOnly ? (
                              <span className="font-bold font-mono">{line.qte}</span>
                            ) : (
                              <input
                                type="number"
                                min="1"
                                value={line.qte}
                                onChange={(e) => handleUpdateLineQuantity(line.id, parseInt(e.target.value) || 1)}
                                className="w-14 text-center border border-slate-200 rounded-lg font-bold font-mono py-1 focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20"
                              />
                            )}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-400">{line.pump.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono font-semibold text-slate-800">{line.prixVente.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">{line.montantHT.toFixed(2)}</td>
                          <td className="p-3 text-center">
                            {isReadOnly ? (
                              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono text-[10px]">{line.tvaRate}%</span>
                            ) : (
                              /* Le taux vient de la fiche article mais reste modifiable ligne par ligne:
                                 le catalogue mélange des produits à 19 %, 9 % et 0 %. */
                              <select
                                value={line.tvaRate}
                                onChange={(e) => handleUpdateLineTva(line.id, Number(e.target.value))}
                                className="border border-slate-200 rounded-lg px-1.5 py-1 font-mono text-[11px] bg-white focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/20"
                                aria-label={`Taux de TVA pour ${line.code}`}
                              >
                                {TVA_RATES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}%
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {!isReadOnly && (
                              <button onClick={() => handleRemoveLine(line.id)} className="text-slate-300 hover:text-rose-600 font-bold p-1 transition">
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TOTALS & SAVE BAR */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex justify-between items-center gap-4">
              <div className="flex items-center gap-8 text-xs">
                <div>
                  <span className="text-slate-400 font-medium block text-[11px]">TOTAL HT</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">{totalHT.toFixed(2)} DZD</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block text-[11px]">TOTAL TVA</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">{totalTVA.toFixed(2)} DZD</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block text-[11px]">TIMBRE FISCAL</span>
                  <span className="text-sm font-bold text-amber-700 font-mono">{totalTimbre.toFixed(2)} DZD</span>
                </div>
                <div className="border-l border-slate-200 pl-8">
                  <span className="text-slate-400 font-medium block text-[11px]">MARGE COMMERCIALE</span>
                  <span className="text-xs font-bold text-[#0F5B38] font-mono">
                    {totalMargeDZD.toFixed(2)} DZD ({margePercent.toFixed(1)}%)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Net à Payer</span>
                  <span className="text-lg font-black font-mono text-[#0F5B38]">{totalNet.toFixed(2)} DZD</span>
                </div>
                {!isReadOnly && currentView === 'BONS_PREP' && lines.length > 0 && (
                  <button
                    onClick={() => setLines([])}
                    className="bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-600 font-semibold px-4 py-2.5 rounded-xl transition text-xs"
                  >
                    Annuler réservation
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={handleSaveDocument}
                    disabled={saving}
                    className="bg-[#0F5B38] hover:bg-[#0b462b] text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-xs text-xs disabled:opacity-50"
                  >
                    {saving
                      ? 'Enregistrement...'
                      : currentView === 'BONS_PREP'
                      ? 'Enregistrer la Réservation [F10]'
                      : currentView === 'FACTURE'
                      ? 'Enregistrer la Facture [F10]'
                      : currentView === 'PROFORMA'
                      ? 'Émettre la Proforma [F10]'
                      : currentView === 'VENTES_VALIDATION' || currentView === 'AVOIRS_ACHATS' || currentView === 'AVOIRS_VENTES'
                      ? 'Enregistrer et Valider [F10]'
                      : 'Enregistrer [F10]'}
                  </button>
                )}
              </div>
            </div>

            {/* RECENT DOCUMENTS OF THIS TYPE */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs max-h-40 overflow-auto">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Documents récents</div>
              {relevantDocuments.slice(0, 8).map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setViewingDocId(doc.id)}
                  className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">{doc.reference}</span>
                    <span className="text-slate-400">{doc.partner?.raisonSociale}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        doc.status === 'VALIDE' ? 'bg-emerald-50 text-emerald-700' : doc.status === 'ANNULE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {doc.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-600">{num(doc.totalTTC).toFixed(2)} DZD</span>
                    {doc.status === 'OUVERT' && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleValidateExisting(doc);
                          }}
                          className="text-[#0F5B38] font-semibold hover:underline"
                        >
                          Valider
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDraft(doc);
                          }}
                          className="text-slate-400 hover:text-rose-600 font-semibold hover:underline"
                        >
                          Supprimer
                        </button>
                      </>
                    )}
                    {doc.status === 'VALIDE' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelExisting(doc);
                        }}
                        className="text-rose-500 font-semibold hover:underline"
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {relevantDocuments.length === 0 && <div className="text-slate-300 text-center py-2">Aucun document.</div>}
            </div>
          </div>
        )}

      {/* ==========================================
          4. MODALS
         ========================================== */}
      {showPartnerModal && (
        <PartnerSelectModal partners={partnerPool} onClose={() => setShowPartnerModal(false)} onSelectPartner={(partner) => setSelectedPartner(partner)} />
      )}

      {showArticleModal && <ArticleSelectModal articles={articles} onClose={() => setShowArticleModal(false)} onAddArticle={handleAddArticleToDoc} />}

      {showReserveModal && (
        <ReserveArticleModal articles={articles} depots={depots} onClose={() => setShowReserveModal(false)} onReserve={handleReserveArticle} />
      )}

      {showNewPartnerModal && (
        <NewPartnerModal
          categories={categories}
          zones={zones}
          onClose={() => setShowNewPartnerModal(false)}
          onSubmit={(data) => {
            handleAddPartner(data as never);
            setShowNewPartnerModal(false);
          }}
        />
      )}

      {showNewCategoryModal && (
        <NewCategoryModal
          onClose={() => setShowNewCategoryModal(false)}
          onSubmit={(data) => {
            handleAddCategory(data);
            setShowNewCategoryModal(false);
          }}
        />
      )}
    </AppShell>
  );
}
