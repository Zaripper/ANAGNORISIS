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
export const pricePolicies = ['PRIX_SAISI', 'TAUX'] as const;

export type UserRole = (typeof userRoles)[number];
export type DocumentType = (typeof documentTypes)[number];
export type DocumentStatus = (typeof documentStatuses)[number];
export type PaymentMode = (typeof paymentModes)[number];
export type CashTxType = (typeof cashTxTypes)[number];
export type PricePolicy = (typeof pricePolicies)[number];

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
  /** Quantité facturée. Le bonus s'y ajoute au stock mais jamais au prix. */
  quantity: number;
  unitPriceHT: number;
  /** Per-line discount in percent (0-100). */
  discountPercent: number;
  tvaRate: number;
  /** Weighted-average cost snapshot used for the margin figures. */
  purchaseCostPUMP: number;
  /**
   * Quantité offerte (« bonus »). Elle sort du stock comme le reste mais ne se
   * facture pas: c'est de la marchandise donnée. Son coût pèse donc en entier
   * sur la marge, sans contrepartie de chiffre d'affaires.
   */
  quantiteBonus?: number;
  /**
   * Ristourne en valeur sur la ligne, appliquée APRÈS la remise en pourcentage.
   * Les deux coexistent dans le logiciel actuel: la remise est un taux négocié
   * par catégorie, la ristourne un geste ponctuel en dinars.
   */
  ristourne?: number;
}

/**
 * Montant HT d'une ligne: remise en pourcentage puis ristourne en valeur.
 *
 * Une ristourne supérieure au montant remisé ramènerait la ligne en négatif —
 * ce serait une facture qui rembourse le client. On plafonne à zéro plutôt que
 * de laisser passer une ligne négative dans la TVA et le CA.
 */
export function lineTotalHT(line: TotalsLine): number {
  const apresRemise = line.quantity * line.unitPriceHT * (1 - line.discountPercent / 100);
  return Math.max(0, apresRemise - (line.ristourne ?? 0));
}

/** Quantité réellement sortie du stock: facturée + offerte. */
export function lineStockQuantity(line: Pick<TotalsLine, 'quantity' | 'quantiteBonus'>): number {
  return line.quantity + (line.quantiteBonus ?? 0);
}

// ---------- Emballage (colisage / vrac) ----------
export const emballages = ['VRAC', 'COLISAGE'] as const;
export type Emballage = (typeof emballages)[number];

/**
 * Le gros se vend au colis, le détail à l'unité. En colisage l'opérateur saisit
 * un nombre de colis et la quantité en découle du colisage de l'article — c'est
 * ainsi que le logiciel actuel évite les erreurs de comptage sur des commandes
 * de plusieurs centaines d'unités.
 *
 * Le stock, lui, reste toujours compté en unités: un colisage nul ou absent
 * ferait disparaître la marchandise du stock, donc on retombe sur 1.
 */
export function quantiteDepuisColis(nbColis: number, colisage: number | null | undefined): number {
  const parColis = colisage && colisage > 0 ? colisage : 1;
  return Math.max(0, Math.trunc(nbColis)) * parColis;
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
    const lineHT = lineTotalHT(l);
    totalHT += lineHT;
    totalTVA += lineHT * (l.tvaRate / 100);
    // Le coût porte sur TOUT ce qui sort, bonus compris: la marchandise offerte
    // a été payée au fournisseur. L'ignorer surestimerait la marge d'autant.
    purchaseTotal += lineStockQuantity(l) * l.purchaseCostPUMP;
  }
  const preStampTTC = totalHT - remise + totalTVA;
  const stampDuty = fiscalStamp(preStampTTC, paymentMode);
  const totalTTC = preStampTTC + stampDuty;
  const marginHT = totalHT - purchaseTotal;
  const marginPercent = totalHT > 0 ? (marginHT / totalHT) * 100 : 0;
  return { totalHT, totalTVA, stampDuty, totalTTC, marginHT, marginPercent };
}



// ---------- Cheques ----------
export const chequeEtats = ['EN_INSTANCE', 'MIS_EN_PAIEMENT', 'PAYE', 'ANNULE'] as const;
export type ChequeEtat = (typeof chequeEtats)[number];

/**
 * Etats de depart selon le type, comme dans le logiciel actuel:
 * un cheque RECU commence "en instance" (on l'a en main, pas encore remis),
 * un cheque EMIS commence directement "mis en paiement" (il est parti).
 */
export function initialChequeEtat(type: CashTxType): ChequeEtat {
  return type === 'RECETTE' ? 'EN_INSTANCE' : 'MIS_EN_PAIEMENT';
}

/**
 * Transitions autorisees.
 *
 * On ne revient jamais en arriere (un cheque encaisse ne redevient pas "en
 * instance"): cela ferait diverger la banque et le solde client sans trace.
 *
 * En revanche PAYE -> ANNULE reste ouvert, parce qu'un cheque rejete apres
 * encaissement est un cas courant: la banque contrepasse plusieurs jours plus
 * tard. Interdire ce passage obligerait a corriger a la main un impaye.
 *
 * ANNULE est le seul etat reellement terminal.
 */
export const CHEQUE_TRANSITIONS: Record<ChequeEtat, ChequeEtat[]> = {
  EN_INSTANCE: ['MIS_EN_PAIEMENT', 'PAYE', 'ANNULE'],
  MIS_EN_PAIEMENT: ['PAYE', 'ANNULE'],
  PAYE: ['ANNULE'],
  ANNULE: []
};

export function canTransitionCheque(from: ChequeEtat, to: ChequeEtat): boolean {
  return CHEQUE_TRANSITIONS[from].includes(to);
}

export const CHEQUE_ETAT_LABELS: Record<ChequeEtat, string> = {
  EN_INSTANCE: 'En instance',
  MIS_EN_PAIEMENT: 'Mis en paiement',
  PAYE: 'Payé',
  ANNULE: 'Annulé'
};

export const createChequeSchema = z.object({
  type: z.enum(cashTxTypes),
  partnerId: z.string().uuid(),
  numeroCheque: z.string().min(1),
  montant: z.number().positive(),
  numeroPiece: z.string().optional().nullable(),
  datePiece: z.string().optional().nullable(),
  dateCheque: z.string().optional().nullable(),
  banque: z.string().optional().nullable(),
  libelle: z.string().optional().nullable()
});
export type CreateChequeInput = z.infer<typeof createChequeSchema>;

export const updateChequeEtatSchema = z.object({ etat: z.enum(chequeEtats) });

// ---------- Validite des bons de preparation ----------
/**
 * Un bon de preparation reserve du stock sans le sortir. Sans date limite, un
 * bon prepare puis oublie (client qui ne vient pas chercher sa commande)
 * immobilise ce stock indefiniment: l'article apparait indisponible a la vente
 * alors qu'il est physiquement en rayon. C'est la panne classique du poste de
 * preparation, et la raison pour laquelle le logiciel actuel donne une duree de
 * validite au bon.
 *
 * La duree est parametrable (BP_DUREE_VALIDITE_JOURS) mais la date limite est
 * FIGEE a la creation: rallonger le parametre ne doit pas ressusciter des bons
 * deja expires, et le raccourcir ne doit pas en faire expirer d'un coup.
 */
export const BP_DUREE_VALIDITE_JOURS_DEFAUT = 8;
export const BP_DUREE_VALIDITE_KEY = 'BP_DUREE_VALIDITE_JOURS';

/** Date limite de validite d'un bon cree a `from`, ou null si le type n'expire pas. */
export function dateValiditeBP(from: Date, joursValidite: number): Date {
  const limite = new Date(from);
  limite.setDate(limite.getDate() + joursValidite);
  return limite;
}

/**
 * Lit la duree de validite depuis les parametres, en retombant sur la valeur par
 * defaut si elle est absente, vide ou aberrante. Une duree de 0 jour ferait
 * expirer chaque bon a l'instant de sa creation: on la refuse.
 */
export function parseDureeValiditeBP(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return BP_DUREE_VALIDITE_JOURS_DEFAUT;
  return Math.floor(n);
}

/** Jours restants avant echeance (negatif si depasse). */
export function joursAvantEcheance(dateValidite: Date, now: Date = new Date()): number {
  return Math.ceil((dateValidite.getTime() - now.getTime()) / 86400000);
}

// ---------- Blocage des partenaires ----------
/**
 * Regle de blocage d'un client, reprise du logiciel actuel.
 *
 * Deux conditions independantes, evaluees seulement si le blocage est actif
 * pour ce partenaire:
 *
 *  1. MONTANT — le solde depasse le seuil autorise.
 *  2. ANCIENNETE — la dette est ouverte depuis plus de `blocageJours` jours a
 *     compter de la date de reference. C'est ce qui permet de bloquer un client
 *     qui paie trop lentement, meme s'il reste sous son plafond.
 *
 * Un seuil a 0 signifie "pas de plafond", pas "tout est bloque": c'est la
 * convention du logiciel d'origine et l'inverse serait catastrophique en caisse.
 */
export interface PartnerBlockingState {
  balance: number;
  seuilAutorise: number;
  blocageActif: boolean;
  blocageDateReference?: string | Date | null;
  blocageJours?: number | null;
}

export interface PartnerBlockingResult {
  blocked: boolean;
  /** Motifs cumulables, pour pouvoir expliquer le blocage a l'ecran. */
  reasons: ('MONTANT' | 'ANCIENNETE')[];
  /** Jours ecoules depuis la date de reference, null si non applicable. */
  joursEcoules: number | null;
}

export function evaluatePartnerBlocking(p: PartnerBlockingState, now: Date = new Date()): PartnerBlockingResult {
  const reasons: PartnerBlockingResult['reasons'] = [];
  let joursEcoules: number | null = null;

  if (p.blocageDateReference) {
    const ref = new Date(p.blocageDateReference);
    if (!Number.isNaN(ref.getTime())) {
      joursEcoules = Math.floor((now.getTime() - ref.getTime()) / 86400000);
    }
  }

  if (!p.blocageActif) return { blocked: false, reasons, joursEcoules };

  // Un solde nul ou crediteur ne bloque jamais, quelle que soit l'anciennete.
  if (p.balance > 0) {
    if (p.seuilAutorise > 0 && p.balance > p.seuilAutorise) reasons.push('MONTANT');
    if (p.blocageJours != null && joursEcoules != null && joursEcoules > p.blocageJours) reasons.push('ANCIENNETE');
  }

  return { blocked: reasons.length > 0, reasons, joursEcoules };
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
  pays: z.string().optional().nullable(),
  codePostal: z.string().optional().nullable(),
  ville: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  siteInternet: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  peutAvoirRefaction: z.boolean().optional(),
  blocageActif: z.boolean().optional(),
  blocageDateReference: z.string().optional().nullable(),
  blocageJours: z.number().int().nonnegative().optional().nullable(),
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
  quantiteReappro: z.number().int().nonnegative().optional().nullable(),
  securite: z.number().int().nonnegative().optional().nullable(),
  colisage: z.number().int().nonnegative().default(0),
  tauxRefaction: z.number().min(0).max(100).default(0),
  mainSupplierId: z.string().uuid().optional().nullable(),
  // Mise en avant a la caisse.
  preferred: z.boolean().optional(),
  // Contingentement des produits rares: max par client et par document.
  maxQtyPerClient: z.number().int().positive().optional().nullable(),
  prices: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        priceHT: z.number().nonnegative(),
        priceTTC: z.number().nonnegative(),
        policy: z.enum(pricePolicies).default('PRIX_SAISI'),
        taux: z.number().min(0).default(0)
      })
    )
    .default([])
});

/**
 * Prix de vente HT effectif d'un article pour une categorie.
 *
 * PRIX_SAISI: le prix saisi fait foi.
 * TAUX: le prix est derive du P.U.M.P — la marge reste constante quand le cout
 * d'achat evolue, ce qui evite de reprendre tous les tarifs a chaque achat.
 */
export function effectivePriceHT(
  price: { policy?: PricePolicy | null; taux?: number | null; priceHT: number },
  pump: number
): number {
  if (price.policy === 'TAUX') {
    const taux = price.taux ?? 0;
    return Math.round(pump * (1 + taux / 100) * 100) / 100;
  }
  return price.priceHT;
}
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
export const documentLineInputSchema = z
  .object({
    articleId: z.string().uuid(),
    depotId: z.string().uuid(),
    /**
     * Quantite facturee, en unites. Elle peut valoir 0 sur une ligne purement
     * bonus (marchandise offerte sans contrepartie), d'ou le `nonnegative`.
     */
    quantity: z.number().int().nonnegative(),
    unitPriceHT: z.number().nonnegative(),
    discountPercent: z.number().min(0).max(100).default(0),
    tvaRate: z.number().nonnegative().default(19),
    emballage: z.enum(emballages).default('VRAC'),
    nbColis: z.number().int().nonnegative().optional().nullable(),
    numeroColis: z.string().max(60).optional().nullable(),
    quantiteBonus: z.number().int().nonnegative().default(0),
    ristourne: z.number().nonnegative().default(0)
  })
  .superRefine((line, ctx) => {
    // Une ligne sans quantite ni bonus ne sort rien du stock et ne facture
    // rien: c'est une ligne vide oubliee dans la saisie.
    if (line.quantity === 0 && line.quantiteBonus === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'LINE_QUANTITY_REQUIRED' });
    }
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
