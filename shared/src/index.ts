import { z } from 'zod';

export const userRoles = ['ADMINISTRATEUR', 'CAISSIER', 'AGENT'] as const;
export const documentTypes = [
  'ACHAT',
  'COMMANDE',
  'BON_LIVRAISON',
  'BON_PREPARATION',
  'VENTE',
  'FACTURE',
  'PROFORMA',
  'RETOUR_CLIENT',
  'RETOUR_FOURNISSEUR',
  'REGULE_PLUS',
  'REGULE_MOINS',
  'TRANSFERT'
] as const;
export const documentStatuses = ['OUVERT', 'VALIDE', 'ANNULE'] as const;
export const paymentModes = ['ESPECE', 'CHEQUE', 'TRAITE', 'VIREMENT'] as const;
export const cashTxTypes = ['RECETTE', 'DEPENSE'] as const;

export type UserRole = (typeof userRoles)[number];
export type DocumentType = (typeof documentTypes)[number];
export type DocumentStatus = (typeof documentStatuses)[number];
export type PaymentMode = (typeof paymentModes)[number];
export type CashTxType = (typeof cashTxTypes)[number];

// ---------- Stock direction ----------
// Types that add quantity to stock at validation (draft creation never touches physical stock)
export const stockReceivingTypes: DocumentType[] = ['ACHAT', 'RETOUR_CLIENT', 'REGULE_PLUS'];
// Types that reserve at draft time and remove quantity from stock at validation
export const stockConsumingTypes: DocumentType[] = [
  'BON_LIVRAISON',
  'BON_PREPARATION',
  'VENTE',
  'FACTURE',
  'RETOUR_FOURNISSEUR',
  'REGULE_MOINS'
];
// TRANSFERT is handled on its own: it both removes (source depotId) and adds (destDepotId) stock.

// Only a true purchase re-bases the weighted-average cost (P.U.M.P). A client return or a
// stock-count correction adds quantity back but must NOT be treated as if we bought it again —
// doing so would silently corrupt the cost basis used for every future margin calculation.
export const pumpRecalculatingTypes: DocumentType[] = ['ACHAT'];

// Types that require a Partner (client or supplier). Internal stock movements (régules,
// transfers) and quotes (proforma) have no commercial counterpart.
export const partnerRequiredTypes: DocumentType[] = [
  'ACHAT',
  'COMMANDE',
  'BON_LIVRAISON',
  'BON_PREPARATION',
  'VENTE',
  'FACTURE',
  'PROFORMA',
  'RETOUR_CLIENT',
  'RETOUR_FOURNISSEUR'
];

export interface LedgerEffect {
  // How the document's total affects Partner.balance once validated. A purchase or sale
  // increases what's owed; a return (avoir) decreases it; internal movements and quotes
  // never touch a balance at all.
  partnerBalanceSign: 1 | -1 | 0;
  // Which way cash moves if paymentMode is ESPECE. null = no cash impact.
  cashType: CashTxType | null;
}

export function ledgerEffect(type: DocumentType): LedgerEffect {
  switch (type) {
    case 'ACHAT':
      return { partnerBalanceSign: 1, cashType: 'DEPENSE' }; // we owe the supplier more; cash goes out if paid immediately
    case 'BON_LIVRAISON':
    case 'BON_PREPARATION':
    case 'VENTE':
    case 'FACTURE':
      return { partnerBalanceSign: 1, cashType: 'RECETTE' }; // the client owes us more; cash comes in if paid immediately
    case 'RETOUR_FOURNISSEUR':
      return { partnerBalanceSign: -1, cashType: 'RECETTE' }; // avoir achat: we owe the supplier less; they may refund cash
    case 'RETOUR_CLIENT':
      return { partnerBalanceSign: -1, cashType: 'DEPENSE' }; // avoir vente: the client owes us less; we may refund cash
    default:
      // PROFORMA (quote), COMMANDE (purchase order awaiting reception),
      // REGULE_PLUS/MOINS and TRANSFERT (internal movements): no financial effect.
      return { partnerBalanceSign: 0, cashType: null };
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// ---------- Document totals (single source of truth) ----------
// Both the server (persisting documents) and the client (live totals in editors
// and the POS) compute through these functions, so a displayed total can never
// disagree with what gets stored.

/**
 * Droit de timbre — barème progressif par tranche, confirmé par le comptable
 * (2026). Le taux de la tranche s'applique à la TOTALITÉ du montant TTC, il ne
 * s'agit pas d'un calcul marginal.
 *
 *   < 300 DZD            aucun timbre
 *   300 – 30 000 DZD     1,0 %
 *   30 000 – 100 000 DZD 1,5 %
 *   > 100 000 DZD        2,0 %
 *
 * Le timbre ne s'applique qu'aux règlements en espèces, et se calcule sur le
 * TTC (contrairement à la TVA qui se calcule sur le HT).
 */
export const TIMBRE_SEUIL_MIN = 300;

export const TIMBRE_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: TIMBRE_SEUIL_MIN, rate: 0 },
  { upTo: 30000, rate: 0.01 },
  { upTo: 100000, rate: 0.015 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.02 }
];

/** Taux de timbre applicable à un montant TTC donné. */
export function timbreRate(preStampTotalTTC: number): number {
  for (const bracket of TIMBRE_BRACKETS) {
    if (preStampTotalTTC < bracket.upTo) return bracket.rate;
  }
  return TIMBRE_BRACKETS[TIMBRE_BRACKETS.length - 1].rate;
}

/** Droit de timbre: espèces uniquement, assis sur le TTC, arrondi au centime. */
export function fiscalStamp(preStampTotalTTC: number, paymentMode: PaymentMode): number {
  if (paymentMode !== 'ESPECE' || preStampTotalTTC <= 0) return 0;
  return Math.round(preStampTotalTTC * timbreRate(preStampTotalTTC) * 100) / 100;
}

export interface TotalsLine {
  quantity: number;
  unitPriceHT: number;
  /** Per-line discount in percent (0-100). */
  discountPercent: number;
  tvaRate: number;
  /** Weighted-average cost snapshot used for the margin figures. */
  purchaseCostPUMP: number;
}

export interface DocTotals {
  totalHT: number;
  totalTVA: number;
  stampDuty: number;
  totalTTC: number;
  marginHT: number;
  marginPercent: number;
}

export function computeDocTotals(lines: TotalsLine[], remise: number, paymentMode: PaymentMode): DocTotals {
  let totalHT = 0;
  let totalTVA = 0;
  let purchaseTotal = 0;
  for (const l of lines) {
    const lineHT = l.quantity * l.unitPriceHT * (1 - l.discountPercent / 100);
    totalHT += lineHT;
    totalTVA += lineHT * (l.tvaRate / 100);
    purchaseTotal += l.quantity * l.purchaseCostPUMP;
  }
  const preStampTTC = totalHT - remise + totalTVA;
  const stampDuty = fiscalStamp(preStampTTC, paymentMode);
  const totalTTC = preStampTTC + stampDuty;
  const marginHT = totalHT - purchaseTotal;
  const marginPercent = totalHT > 0 ? (marginHT / totalHT) * 100 : 0;
  return { totalHT, totalTVA, stampDuty, totalTTC, marginHT, marginPercent };
}

// ---------- Auth ----------
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- Partner categories ----------
export const createPartnerCategorySchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  isSupplier: z.boolean().default(false)
});
export type CreatePartnerCategoryInput = z.infer<typeof createPartnerCategorySchema>;

export const updatePartnerCategorySchema = createPartnerCategorySchema.partial();
export type UpdatePartnerCategoryInput = z.infer<typeof updatePartnerCategorySchema>;

// ---------- Partners ----------
export const createPartnerSchema = z.object({
  code: z.string().min(1),
  raisonSociale: z.string().min(1),
  categoryId: z.string().uuid(),
  zoneId: z.string().uuid().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // Identifiants fiscaux repris sur les factures et dans l'État 104.
  nif: z.string().optional().nullable(),
  rc: z.string().optional().nullable(),
  ai: z.string().optional().nullable(),
  nis: z.string().optional().nullable(),
  nin: z.string().optional().nullable(),
  seuilAutorise: z.number().nonnegative().default(0)
});
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  active: z.boolean().optional()
});
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

// ---------- Articles ----------
export const createArticleSchema = z.object({
  code: z.string().min(1),
  barcode: z.string().optional().nullable(),
  designation: z.string().min(1),
  category: z.string().optional().nullable(),
  pump: z.number().nonnegative().default(0),
  tvaRate: z.number().nonnegative().default(19),
  seuilReappro: z.number().int().nonnegative().optional().nullable(),
  // Mise en avant a la caisse.
  preferred: z.boolean().optional(),
  // Contingentement des produits rares: max par client et par document.
  maxQtyPerClient: z.number().int().positive().optional().nullable(),
  prices: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        priceHT: z.number().nonnegative(),
        priceTTC: z.number().nonnegative()
      })
    )
    .default([])
});
export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export const updateArticleSchema = createArticleSchema.partial().extend({
  active: z.boolean().optional()
});
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

// ---------- Master data ----------
export const createLivreurSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  active: z.boolean().default(true)
});
export type CreateLivreurInput = z.infer<typeof createLivreurSchema>;
export const updateLivreurSchema = createLivreurSchema.partial();
export type UpdateLivreurInput = z.infer<typeof updateLivreurSchema>;

export const createZoneSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().default(true)
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export const updateZoneSchema = createZoneSchema.partial();
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

export const createChargeClassSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  active: z.boolean().default(true)
});
export type CreateChargeClassInput = z.infer<typeof createChargeClassSchema>;
export const updateChargeClassSchema = createChargeClassSchema.partial();
export type UpdateChargeClassInput = z.infer<typeof updateChargeClassSchema>;

export const createTypeReglementSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  active: z.boolean().default(true)
});
export type CreateTypeReglementInput = z.infer<typeof createTypeReglementSchema>;
export const updateTypeReglementSchema = createTypeReglementSchema.partial();
export type UpdateTypeReglementInput = z.infer<typeof updateTypeReglementSchema>;

export const createCommentSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  body: z.string().min(1)
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const createChargeSchema = z.object({
  chargeClassId: z.string().uuid(),
  amount: z.number().nonnegative(),
  description: z.string().min(1),
  paymentMode: z.enum(paymentModes).default('ESPECE'),
  date: z.string().optional().nullable(),
  documentId: z.string().uuid().optional().nullable()
});
export type CreateChargeInput = z.infer<typeof createChargeSchema>;
export const updateChargeSchema = createChargeSchema.partial();
export type UpdateChargeInput = z.infer<typeof updateChargeSchema>;

// ---------- Depots ----------
export const createDepotSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean().default(false)
});
export type CreateDepotInput = z.infer<typeof createDepotSchema>;

export const updateDepotSchema = createDepotSchema.partial();
export type UpdateDepotInput = z.infer<typeof updateDepotSchema>;

// ---------- Documents ----------
export const documentLineInputSchema = z.object({
  articleId: z.string().uuid(),
  depotId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceHT: z.number().nonnegative(),
  discountPercent: z.number().min(0).max(100).default(0),
  tvaRate: z.number().nonnegative().default(19)
});
export type DocumentLineInput = z.infer<typeof documentLineInputSchema>;

export const createDocumentSchema = z
  .object({
    type: z.enum(documentTypes),
    partnerId: z.string().uuid().optional().nullable(),
    livreurId: z.string().uuid().optional().nullable(),
    depotId: z.string().uuid(),
    destDepotId: z.string().uuid().optional().nullable(),
    supplierInvoiceNum: z.string().optional().nullable(),
    motif: z.string().optional().nullable(),
    paymentMode: z.enum(paymentModes).default('ESPECE'),
    remise: z.number().nonnegative().default(0),
    lines: z.array(documentLineInputSchema).min(1)
  })
  .superRefine((data, ctx) => {
    if ((partnerRequiredTypes as string[]).includes(data.type) && !data.partnerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partnerId'], message: 'PARTNER_REQUIRED_FOR_TYPE' });
    }
    if (data.type === 'TRANSFERT') {
      if (!data.destDepotId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destDepotId'], message: 'DEST_DEPOT_REQUIRED_FOR_TRANSFER' });
      } else if (data.destDepotId === data.depotId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destDepotId'], message: 'DEST_DEPOT_MUST_DIFFER_FROM_SOURCE' });
      }
    }
  });
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentSchema;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

// ---------- Cash journal ----------
export const createCashTransactionSchema = z.object({
  type: z.enum(cashTxTypes),
  amount: z.number().positive(),
  paymentMode: z.enum(paymentModes),
  description: z.string().min(1),
  partnerId: z.string().uuid().optional().nullable(),
  reference: z.string().optional().nullable(),
  bankName: z.string().optional().nullable()
});
export type CreateCashTransactionInput = z.infer<typeof createCashTransactionSchema>;

// ---------- Users (admin-managed accounts) ----------
export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'USERNAME_INVALID_CHARS'),
  password: z.string().min(6, 'PASSWORD_TOO_SHORT'),
  role: z.enum(userRoles),
  active: z.boolean().default(true)
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Password omitted = unchanged. Role/active edits are how accounts are promoted or retired. */
export const updateUserSchema = z.object({
  password: z.string().min(6, 'PASSWORD_TOO_SHORT').optional(),
  role: z.enum(userRoles).optional(),
  active: z.boolean().optional()
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ---------- Application settings ----------
/** Flat key/value map; keys are dot-namespaced (company.*, print.*). */
export const updateSettingsSchema = z.record(z.string().min(1).max(80), z.string().max(2000));
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
