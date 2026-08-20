import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import {
  CreateDocumentInput,
  UpdateDocumentInput,
  DocumentType,
  PaymentMode,
  computeDocTotals,
  stockConsumingTypes,
  stockReceivingTypes,
  pumpRecalculatingTypes,
  ledgerEffect,
  lineStockQuantity,
  lineTotalHT,
  quantiteDepuisColis,
  type Emballage,
  BP_DUREE_VALIDITE_KEY,
  dateValiditeBP,
  parseDureeValiditeBP
} from '../../../shared/src';
import { entrerEnLot, libererLots, rendreAuxLots, reserverLots, sortirLots } from './lot.service';

type Tx = Prisma.TransactionClient;

function isConsuming(type: DocumentType) {
  return (stockConsumingTypes as string[]).includes(type);
}

function isReceiving(type: DocumentType) {
  return (stockReceivingTypes as string[]).includes(type);
}

function isTransfer(type: DocumentType) {
  return type === 'TRANSFERT';
}

function recalculatesPump(type: DocumentType) {
  return (pumpRecalculatingTypes as string[]).includes(type);
}

function typePrefix(type: string) {
  switch (type) {
    case 'ACHAT':
      return 'AC';
    case 'COMMANDE':
      return 'CM';
    case 'BON_LIVRAISON':
      return 'BL';
    case 'BON_PREPARATION':
      return 'BP';
    case 'VENTE':
      return 'VT';
    case 'FACTURE':
      return 'FC';
    case 'PROFORMA':
      return 'PF';
    case 'RETOUR_CLIENT':
      return 'RC';
    case 'RETOUR_FOURNISSEUR':
      return 'RF';
    case 'REGULE_PLUS':
      return 'RP';
    case 'REGULE_MOINS':
      return 'RM';
    case 'TRANSFERT':
      return 'TR';
    default:
      return 'DX';
  }
}

async function nextReference(tx: Tx, type: string) {
  const year = new Date().getFullYear();
  const prefix = `${year}${typePrefix(type)}`;
  // Advisory lock scoped to type+year prevents duplicate refs under concurrent writers.
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${type}:${year}`);
  const last = await tx.document.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' }
  });
  const nextSeq = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Options appliquees a chaque transaction document.
 *
 * La generation de reference prend un verrou consultatif par type+annee, donc
 * des ecritures concurrentes (plusieurs caissiers qui valident en meme temps)
 * se mettent en file. Les valeurs par defaut de Prisma (maxWait 2 s, timeout
 * 5 s) font echouer cette file des 3-4 ecritures simultanees avec
 * "Unable to start a transaction in the given time" -- une erreur visible en
 * caisse alors que rien n'est anormal. Ces marges laissent la file s'ecouler
 * sans pour autant masquer un vrai blocage.
 */
const TX_OPTIONS = { maxWait: 15000, timeout: 30000 } as const;

interface ComputedLine {
  articleId: string;
  depotId: string;
  /** Quantite FACTUREE. Ne jamais s'en servir pour bouger du stock — voir qtyStock. */
  quantity: number;
  unitPriceHT: number;
  discountPercent: number;
  tvaRate: number;
  totalHT: number;
  totalTTC: number;
  purchaseCostPUMP: number;
  emballage: Emballage;
  nbColis: number | null;
  numeroColis: string | null;
  quantiteBonus: number;
  ristourne: number;
  /// Entrees uniquement: lot et peremption saisis a la reception.
  numeroLot: string | null;
  datePeremption: Date | null;
}

/**
 * Quantite qui bouge physiquement: facturee + offerte.
 *
 * C'est LA distinction du module. `quantity` est une grandeur monetaire (ce que
 * le client paie), `qtyStock` une grandeur physique (ce qui sort de l'entrepot).
 * Les confondre fait soit disparaitre la marchandise offerte des stocks, soit
 * la facturer au client.
 */
function qtyStock(line: Pick<ComputedLine, 'quantity' | 'quantiteBonus'>): number {
  return lineStockQuantity(line);
}

/**
 * Convertit une ligne stockee (Decimal cote Prisma) en ligne de calcul.
 *
 * Centralise parce que cette conversion etait recopiee a cinq endroits: a
 * chaque nouveau champ de ligne, en oublier un seul suffisait a le perdre
 * silencieusement lors d'une annulation ou d'une refacturation.
 */
function toComputedLine(l: {
  articleId: string;
  depotId: string;
  quantity: number;
  unitPriceHT: Prisma.Decimal | number;
  discountPercent: Prisma.Decimal | number;
  tvaRate: Prisma.Decimal | number;
  totalHT: Prisma.Decimal | number;
  totalTTC: Prisma.Decimal | number;
  purchaseCostPUMP: Prisma.Decimal | number;
  emballage: Emballage;
  nbColis: number | null;
  numeroColis: string | null;
  quantiteBonus: number;
  ristourne: Prisma.Decimal | number;
  numeroLot: string | null;
  datePeremption: Date | null;
}): ComputedLine {
  return {
    articleId: l.articleId,
    depotId: l.depotId,
    quantity: l.quantity,
    unitPriceHT: Number(l.unitPriceHT),
    discountPercent: Number(l.discountPercent),
    tvaRate: Number(l.tvaRate),
    totalHT: Number(l.totalHT),
    totalTTC: Number(l.totalTTC),
    purchaseCostPUMP: Number(l.purchaseCostPUMP),
    emballage: l.emballage,
    nbColis: l.nbColis,
    numeroColis: l.numeroColis,
    quantiteBonus: l.quantiteBonus,
    ristourne: Number(l.ristourne),
    numeroLot: l.numeroLot,
    datePeremption: l.datePeremption
  };
}

async function computeLines(tx: Tx, lines: CreateDocumentInput['lines']): Promise<ComputedLine[]> {
  const result: ComputedLine[] = [];
  for (const line of lines) {
    const article = await tx.article.findUnique({ where: { id: line.articleId } });
    if (!article) throw new Error('ARTICLE_NOT_FOUND');

    // En colisage la quantite est deduite du colisage de l'article et non de la
    // saisie: c'est le serveur qui fait foi, sinon un poste mal configure
    // pourrait facturer un nombre d'unites sans rapport avec ce qui part.
    const quantity =
      line.emballage === 'COLISAGE' ? quantiteDepuisColis(line.nbColis ?? 0, article.colisage) : line.quantity;

    const totalHT = lineTotalHT({
      quantity,
      unitPriceHT: line.unitPriceHT,
      discountPercent: line.discountPercent,
      tvaRate: line.tvaRate,
      purchaseCostPUMP: 0,
      ristourne: line.ristourne
    });
    const totalTVA = totalHT * (line.tvaRate / 100);
    const totalTTC = totalHT + totalTVA;

    result.push({
      articleId: line.articleId,
      depotId: line.depotId,
      quantity,
      unitPriceHT: line.unitPriceHT,
      discountPercent: line.discountPercent,
      tvaRate: line.tvaRate,
      totalHT,
      totalTTC,
      purchaseCostPUMP: Number(article.pump), // cost basis snapshot; refreshed again at validation
      emballage: line.emballage,
      nbColis: line.nbColis ?? null,
      numeroColis: line.numeroColis ?? null,
      quantiteBonus: line.quantiteBonus,
      ristourne: line.ristourne,
      numeroLot: line.numeroLot ?? null,
      datePeremption: line.datePeremption ? new Date(line.datePeremption) : null
    });
  }
  return result;
}

/**
 * Un article suivi par lot exige un numero de lot ET une peremption a l'entree.
 *
 * Le controle est fait a la saisie et non a la validation: accepter une entree
 * sans lot creerait du stock qu'aucun lot ne couvre, et la ventilation ne
 * pourrait plus jamais etre reconciliee avec le total.
 */
async function enforceLotsRequis(tx: Tx, type: DocumentType, lines: ComputedLine[]) {
  if (!isReceiving(type)) return;
  for (const line of lines) {
    const article = await tx.article.findUnique({ where: { id: line.articleId } });
    if (!article?.suiviLot) continue;
    if (!line.numeroLot || !line.datePeremption) {
      throw new Error(`LOT_REQUIS:${article.code}`);
    }
  }
}

/** Thin adapter over the shared totals function — the ONLY totals math in the app. */
function summarize(lines: ComputedLine[], remise: number, paymentMode: string) {
  return computeDocTotals(lines, remise, paymentMode as PaymentMode);
}

/** Preview totals for a not-yet-saved document (drives the live totals bar in the UI). */
export async function buildDocumentPreview(input: CreateDocumentInput) {
  return prisma.$transaction(async (tx) => {
    const lines = await computeLines(tx, input.lines);
    const summary = summarize(lines, input.remise, input.paymentMode);
    return { lines, ...summary };
  }, TX_OPTIONS);
}

/**
 * Reserve or release stock at draft time. Only `qtyReserved` moves — physical
 * `qtyInStock` is untouched until validation. This is what prevents a double stock
 * deduction (draft + validate both decrementing).
 *
 * - "Consuming" types (sales, prep slips, avoir achat, régule moins) reserve at
 *   their line depot.
 * - TRANSFERT reserves at the *source* depot only — the destination depot only
 *   receives stock once the transfer is actually validated.
 * - "Receiving" types (achats, avoir vente, régule plus) never reserve anything;
 *   there is nothing to protect against overselling on the way in.
 */
async function adjustReservations(tx: Tx, type: DocumentType, lines: ComputedLine[], sign: 1 | -1) {
  if (!isConsuming(type) && !isTransfer(type)) return;
  for (const line of lines) {
    const stock = await tx.articleStock.findUnique({
      where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } }
    });
    if (!stock) throw new Error('STOCK_NOT_FOUND');

    // Le bonus part avec le reste: il doit etre reserve, sinon on promettrait
    // au client une marchandise offerte deja vendue a quelqu'un d'autre.
    const sortant = qtyStock(line);

    if (sign === 1) {
      const available = stock.qtyInStock - stock.qtyReserved;
      if (available < sortant) throw new Error('INSUFFICIENT_STOCK');
    }

    await tx.articleStock.update({
      where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
      data: { qtyReserved: { increment: sign * sortant } }
    });
  }
}


/**
 * Contingentement: certains articles rares ont une quantite maximale par client
 * et par document, pour eviter qu'un seul client rafle tout le stock disponible
 * en laissant les references qui ne partent pas.
 *
 * Le controle est fait cote serveur: le desactiver depuis l'interface ne suffit
 * pas a le contourner.
 */
async function enforceRationing(tx: Tx, type: DocumentType, lines: CreateDocumentInput['lines']) {
  if (!isConsuming(type)) return;
  const byArticle = new Map<string, number>();
  for (const line of lines) {
    // Bonus inclus: sans cela un client contournerait le contingentement en se
    // faisant "offrir" les unites au-dela du plafond.
    byArticle.set(line.articleId, (byArticle.get(line.articleId) ?? 0) + line.quantity + (line.quantiteBonus ?? 0));
  }
  for (const [articleId, quantity] of byArticle) {
    const article = await tx.article.findUnique({ where: { id: articleId } });
    if (!article?.maxQtyPerClient) continue;
    if (quantity > article.maxQtyPerClient) {
      throw new Error(`RATIONED_ARTICLE:${article.code}:${article.maxQtyPerClient}`);
    }
  }
}

/**
 * Verrouille la ligne du document pour toute la duree de la transaction.
 *
 * Deux operations peuvent decider en meme temps du sort d'un meme document
 * (un caissier qui valide, le balayage des bons echus qui libere), et toutes
 * deux touchent qtyReserved. Sans verrou, les deux lisent "OUVERT", les deux
 * agissent, et la reservation est relachee deux fois: le stock reserve part en
 * negatif et l'article parait disponible au-dela du reel.
 *
 * Le verrou est pose AVANT la relecture du statut, sinon la relecture ne
 * protege de rien: c'est lui qui rend le controle de statut significatif.
 */
async function lockDocument(tx: Tx, documentId: string) {
  // $queryRaw et non $executeRaw: c'est un SELECT. Et pas de cast ::uuid — la
  // colonne id est du texte cote Postgres (Prisma String), le cast ferait
  // echouer la comparaison et le verrou ne porterait sur aucune ligne.
  await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
}

/**
 * Date limite de validite a poser sur un document neuf. Seuls les bons de
 * preparation en ont une: ce sont les seuls documents qui reservent du stock
 * sans jamais le sortir, donc les seuls qui peuvent l'immobiliser pour rien.
 */
async function computeDateValidite(tx: Tx, type: DocumentType): Promise<Date | null> {
  if (type !== 'BON_PREPARATION') return null;
  const setting = await tx.appSetting.findUnique({ where: { key: BP_DUREE_VALIDITE_KEY } });
  return dateValiditeBP(new Date(), parseDureeValiditeBP(setting?.value));
}

/** Identifiants des bons de preparation dont la date limite est depassee. */
export async function scanBonsPreparationEchus(now: Date = new Date()): Promise<string[]> {
  const echus = await prisma.document.findMany({
    where: { type: 'BON_PREPARATION', status: 'OUVERT', dateValidite: { not: null, lt: now } },
    select: { id: true }
  });
  return echus.map((d) => d.id);
}

/**
 * Libere un bon echu: la reservation tombe, le document passe EXPIRE et reste
 * consultable (le preparateur doit pouvoir comprendre pourquoi son bon n'est
 * plus validable).
 *
 * Renvoie la reference liberee, ou null si le bon n'etait plus a liberer.
 *
 * La fonction est separee du balayage pour une raison de correction, pas de
 * confort: entre le moment ou le balayage repere un bon et celui ou il le
 * traite, un poste du reseau peut l'avoir valide. C'est ce decalage qui est
 * dangereux — il conduirait a relacher deux fois la meme reservation — et le
 * decouper ainsi permet de l'eprouver pour de vrai.
 */
export async function libererBonPreparation(documentId: string, now: Date = new Date()): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await lockDocument(tx, documentId);
    // Relecture APRES le verrou: c'est elle qui rattrape la validation
    // concurrente. Sans elle, la reservation serait relachee ici ET a la
    // validation, et qtyReserved partirait en negatif.
    const document = await tx.document.findUnique({ where: { id: documentId }, include: { lines: true } });
    if (!document || document.status !== 'OUVERT') return null;

    await adjustReservations(
      tx,
      document.type as DocumentType,
      document.lines.map(toComputedLine),
      -1
    );

    // Un bon echu rend sa reservation de lots comme il rend sa reservation de
    // stock: les deux doivent tomber ensemble.
    await libererLotsDuDocument(tx, documentId);

    await tx.document.update({ where: { id: documentId }, data: { status: 'EXPIRE', expiredAt: now } });
    return document.reference;
  }, TX_OPTIONS);
}

/**
 * Balayage des bons de preparation echus.
 *
 * Chaque bon est traite dans sa propre transaction: un bon dont les lignes sont
 * incoherentes ne doit pas empecher les autres d'etre liberes.
 *
 * Renvoie les references liberees.
 */
export async function expireBonsPreparation(now: Date = new Date()): Promise<string[]> {
  const liberes: string[] = [];
  for (const id of await scanBonsPreparationEchus(now)) {
    try {
      const reference = await libererBonPreparation(id, now);
      if (reference) liberes.push(reference);
    } catch (error) {
      // Un bon impossible a liberer ne doit pas bloquer le balayage entier.
      console.error(`[BP] echec de liberation du document ${id}`, error);
    }
  }
  return liberes;
}

export async function createDocument(input: CreateDocumentInput, createdById?: string) {
  return prisma.$transaction(async (tx) => {
    if (input.partnerId) {
      const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
      if (!partner) throw new Error('PARTNER_NOT_FOUND');
    }
    if (input.destDepotId) {
      const destDepot = await tx.depot.findUnique({ where: { id: input.destDepotId } });
      if (!destDepot) throw new Error('DEST_DEPOT_NOT_FOUND');
    }

    await enforceRationing(tx, input.type, input.lines);

    const lines = await computeLines(tx, input.lines);
    await enforceLotsRequis(tx, input.type, lines);
    const summary = summarize(lines, input.remise, input.paymentMode);
    const reference = await nextReference(tx, input.type);

    // Draft creation only reserves stock for consuming/transfer documents; physical
    // stock and the article's weighted-average cost (P.U.M.P) only ever change at
    // validation.
    await adjustReservations(tx, input.type, lines, 1);

    const document = await tx.document.create({
      data: {
        type: input.type,
        reference,
        supplierInvoiceNum: input.supplierInvoiceNum ?? null,
        partnerId: input.partnerId ?? null,
        livreurId: input.livreurId ?? null,
        depotId: input.depotId,
        destDepotId: input.destDepotId ?? null,
        motif: input.motif ?? null,
        paymentMode: input.paymentMode,
        status: 'OUVERT',
        totalHT: summary.totalHT,
        remise: input.remise,
        totalTVA: summary.totalTVA,
        stampDuty: summary.stampDuty,
        totalTTC: summary.totalTTC,
        marginHT: summary.marginHT,
        marginPercent: summary.marginPercent,
        dateValidite: await computeDateValidite(tx, input.type),
        createdById: createdById ?? null,
        lines: { create: lines }
      },
      include: { lines: true, partner: true, depot: true, destDepot: true }
    });

    await reserverLotsDuDocument(tx, input.type, document.lines);

    return tx.document.findUniqueOrThrow({
      where: { id: document.id },
      include: { lines: { include: { lots: true } }, partner: true, depot: true, destDepot: true }
    });
  }, TX_OPTIONS);
}

/**
 * Reserve les lots des lignes sortantes d'un document et enregistre la
 * repartition retenue.
 *
 * La repartition est stockee parce qu'elle est la seule trace de QUEL lot est
 * parti chez QUEL client — exactement ce qu'un rappel de lot exige de savoir.
 */
async function reserverLotsDuDocument(
  tx: Tx,
  type: DocumentType,
  lignes: { id: string; articleId: string; depotId: string; quantity: number; quantiteBonus: number }[]
) {
  if (!isConsuming(type) && !isTransfer(type)) return;

  for (const ligne of lignes) {
    const article = await tx.article.findUnique({ where: { id: ligne.articleId } });
    if (!article?.suiviLot) continue;

    const allocations = await reserverLots(tx, {
      articleId: ligne.articleId,
      depotId: ligne.depotId,
      quantity: qtyStock(ligne)
    });

    for (const a of allocations) {
      await tx.documentLineLot.create({
        data: { documentLineId: ligne.id, lotId: a.lotId, quantity: a.quantity }
      });
    }
  }
}

/** Libere les lots reserves par un document et efface la repartition. */
async function libererLotsDuDocument(tx: Tx, documentId: string) {
  const allocations = await tx.documentLineLot.findMany({ where: { documentLine: { documentId } } });
  if (allocations.length === 0) return;
  await libererLots(tx, allocations);
  await tx.documentLineLot.deleteMany({ where: { documentLine: { documentId } } });
}

/** Replace the lines/totals of a draft (OUVERT) document, re-reserving stock from scratch. */
export async function updateDraftDocument(documentId: string, input: UpdateDocumentInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.document.findUnique({ where: { id: documentId }, include: { lines: true } });
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND');
    if (existing.status !== 'OUVERT') throw new Error('DOCUMENT_NOT_EDITABLE');

    const oldComputed: ComputedLine[] = existing.lines.map(toComputedLine);
    await adjustReservations(tx, existing.type as DocumentType, oldComputed, -1);
    // Liberer AVANT la suppression des lignes: la cascade effacerait les
    // allocations sans jamais decrementer qtyReserved des lots, et la
    // reservation resterait posee pour toujours sur du stock que plus aucun
    // document ne reclame.
    await libererLotsDuDocument(tx, documentId);
    await tx.documentLine.deleteMany({ where: { documentId } });

    if (input.partnerId) {
      const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
      if (!partner) throw new Error('PARTNER_NOT_FOUND');
    }
    if (input.destDepotId) {
      const destDepot = await tx.depot.findUnique({ where: { id: input.destDepotId } });
      if (!destDepot) throw new Error('DEST_DEPOT_NOT_FOUND');
    }

    const lines = await computeLines(tx, input.lines);
    await enforceLotsRequis(tx, input.type, lines);
    const summary = summarize(lines, input.remise, input.paymentMode);
    await adjustReservations(tx, input.type, lines, 1);

    return tx.document.update({
      where: { id: documentId },
      data: {
        type: input.type,
        supplierInvoiceNum: input.supplierInvoiceNum ?? null,
        partnerId: input.partnerId ?? null,
        livreurId: input.livreurId ?? null,
        depotId: input.depotId,
        destDepotId: input.destDepotId ?? null,
        motif: input.motif ?? null,
        paymentMode: input.paymentMode,
        totalHT: summary.totalHT,
        remise: input.remise,
        totalTVA: summary.totalTVA,
        stampDuty: summary.stampDuty,
        totalTTC: summary.totalTTC,
        marginHT: summary.marginHT,
        marginPercent: summary.marginPercent,
        lines: { create: lines }
      },
      include: { lines: true, partner: true, depot: true, destDepot: true }
    });
  }, TX_OPTIONS);
}

/** Delete a draft (OUVERT) document entirely, releasing any reservations it held. */
export async function deleteDraftDocument(documentId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.document.findUnique({ where: { id: documentId }, include: { lines: true } });
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND');
    if (existing.status !== 'OUVERT') throw new Error('DOCUMENT_NOT_EDITABLE');

    const computed: ComputedLine[] = existing.lines.map(toComputedLine);
    await adjustReservations(tx, existing.type as DocumentType, computed, -1);
    // Meme raison qu'a la modification: la cascade ne rendrait pas les lots.
    await libererLotsDuDocument(tx, documentId);
    await tx.document.delete({ where: { id: documentId } });
    return { id: documentId, deleted: true };
  }, TX_OPTIONS);
}

export async function validateDocument(documentId: string, validatedById?: string) {
  return prisma.$transaction(async (tx) => {
    // Verrou pris avant toute lecture: deux postes qui valident le meme document
    // en meme temps, ou une validation concurrente du balayage des bons echus,
    // sortiraient sinon le stock deux fois.
    await lockDocument(tx, documentId);

    const document = await tx.document.findUnique({
      where: { id: documentId },
      include: { lines: true, partner: true }
    });
    if (!document) throw new Error('DOCUMENT_NOT_FOUND');
    if (document.status === 'VALIDE') return document;
    if (document.status === 'ANNULE') throw new Error('DOCUMENT_CANCELLED');
    if (document.status === 'EXPIRE') throw new Error('DOCUMENT_EXPIRE');

    /**
     * Un bon echu mais pas encore balaye ne doit pas passer entre les mailles:
     * le balayage est periodique, la validation est immediate. Sans ce controle,
     * valider juste avant le passage du balayage sortirait du stock sur un bon
     * perime.
     */
    if (document.dateValidite && document.dateValidite < new Date()) {
      throw new Error('DOCUMENT_EXPIRE');
    }

    const type = document.type as DocumentType;

    /**
     * Une facture emise depuis un bon de livraison ne doit RIEN reimputer: le BL
     * a deja sorti le stock et debite le compte client. Sans ce garde-fou chaque
     * livraison serait comptee deux fois (stock et solde).
     */
    if (document.sourceDocumentId) {
      return tx.document.update({
        where: { id: document.id },
        data: { status: 'VALIDE', validatedAt: new Date(), createdById: validatedById ?? document.createdById },
        include: { lines: true, partner: true, depot: true, destDepot: true }
      });
    }

    const allocationsParLigne = await tx.documentLineLot.findMany({
      where: { documentLine: { documentId } }
    });

    for (const line of document.lines) {
      const stock = await tx.articleStock.findUnique({
        where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } }
      });
      if (!stock) throw new Error('STOCK_NOT_FOUND');
      const article = await tx.article.findUnique({ where: { id: line.articleId } });
      if (!article) throw new Error('ARTICLE_NOT_FOUND');

      // Tout ce qui suit bouge du stock: on raisonne en quantite sortante
      // (facturee + offerte), jamais en quantite facturee.
      const sortant = qtyStock(line);

      if (isTransfer(type)) {
        // Inter-depot transfer: release the source-depot reservation, decrement
        // source physical stock, and increment (or create) the destination depot's
        // stock row for the same article. No PUMP change — the goods never left the
        // company, so their cost basis doesn't change.
        if (!document.destDepotId) throw new Error('DEST_DEPOT_REQUIRED_FOR_TRANSFER');
        if (stock.qtyReserved < sortant) throw new Error('RESERVATION_MISMATCH');

        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
          data: { qtyReserved: { decrement: sortant }, qtyInStock: { decrement: sortant } }
        });
        await tx.articleStock.upsert({
          where: { articleId_depotId: { articleId: line.articleId, depotId: document.destDepotId } },
          create: { articleId: line.articleId, depotId: document.destDepotId, qtyInStock: sortant },
          update: { qtyInStock: { increment: sortant } }
        });
      } else if (isReceiving(type)) {
        if (recalculatesPump(type)) {
          // True purchases: increase physical stock and recompute the weighted-average
          // cost. This is the only place P.U.M.P changes.
          const oldQty = stock.qtyInStock;
          const oldPump = Number(article.pump);
          const incomingCost = Number(line.unitPriceHT);

          /**
           * Le bonus fournisseur entre en stock sans avoir ete paye: la valeur
           * acquise porte sur les unites FACTUREES, la quantite acquise sur les
           * unites RECUES. Un carton offert sur dix achetes baisse donc le
           * P.U.M.P d'environ 9 %, ce qui est exactement l'effet economique
           * recherche. Prendre `sortant` au numerateur reviendrait a payer le
           * cadeau; prendre `line.quantity` au denominateur reviendrait a
           * l'ignorer.
           */
          const valeurEntrante = line.quantity * incomingCost;
          const newPump = oldQty + sortant > 0 ? (oldQty * oldPump + valeurEntrante) / (oldQty + sortant) : incomingCost;

          await tx.articleStock.update({
            where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
            data: { qtyInStock: { increment: sortant } }
          });
          await tx.article.update({ where: { id: line.articleId }, data: { pump: newPump } });
          await tx.documentLine.update({ where: { id: line.id }, data: { purchaseCostPUMP: incomingCost } });

          // La marchandise entre aussi dans son lot. Le bonus fournisseur y
          // entre avec le reste: il est physiquement la, meme s'il n'a rien
          // coute.
          if (article.suiviLot && line.numeroLot && line.datePeremption) {
            await entrerEnLot(tx, {
              articleId: line.articleId,
              depotId: line.depotId,
              numeroLot: line.numeroLot,
              datePeremption: line.datePeremption,
              quantity: sortant
            });
          }
        } else {
          // Client returns (avoir vente) and stock-count corrections (régule plus):
          // stock comes back in, but this was never a real purchase, so the cost
          // basis (P.U.M.P) must not move.
          await tx.articleStock.update({
            where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
            data: { qtyInStock: { increment: sortant } }
          });

          if (article.suiviLot && line.numeroLot && line.datePeremption) {
            await entrerEnLot(tx, {
              articleId: line.articleId,
              depotId: line.depotId,
              numeroLot: line.numeroLot,
              datePeremption: line.datePeremption,
              quantity: sortant
            });
          }
        }
      } else if (isConsuming(type)) {
        // Sales, prep slips, avoir achat (return to supplier), régule moins: release
        // the draft-time reservation and decrement physical stock exactly once.
        // Snapshot P.U.M.P at validation for margin/valuation reporting.
        if (stock.qtyReserved < sortant) throw new Error('RESERVATION_MISMATCH');

        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
          data: { qtyReserved: { decrement: sortant }, qtyInStock: { decrement: sortant } }
        });

        // Les lots suivent le meme mouvement, sur la repartition FEFO figee au
        // brouillon. Le total et sa ventilation bougent donc du meme montant.
        await sortirLots(
          tx,
          allocationsParLigne.filter((a) => a.documentLineId === line.id)
        );

        await tx.documentLine.update({ where: { id: line.id }, data: { purchaseCostPUMP: Number(article.pump) } });
      }
      // PROFORMA: no stock effect at all.
    }

    const refreshedLines = await tx.documentLine.findMany({ where: { documentId } });
    const computed: ComputedLine[] = refreshedLines.map(toComputedLine);
    const summary = summarize(computed, Number(document.remise), document.paymentMode);

    const updated = await tx.document.update({
      where: { id: document.id },
      data: {
        status: 'VALIDE',
        validatedAt: new Date(),
        totalHT: summary.totalHT,
        totalTVA: summary.totalTVA,
        totalTTC: summary.totalTTC,
        stampDuty: summary.stampDuty,
        marginHT: summary.marginHT,
        marginPercent: summary.marginPercent,
        createdById: validatedById ?? document.createdById
      },
      include: { lines: true, partner: true, depot: true, destDepot: true }
    });

    // Ledger: direction depends on the document type, not just stock direction — a
    // purchase and an "avoir achat" (return to supplier) both move stock the same
    // way as their opposite number, but their financial effect is inverted.
    const effect = ledgerEffect(type);
    if (document.partnerId && effect.partnerBalanceSign !== 0) {
      await tx.partner.update({
        where: { id: document.partnerId },
        data: { balance: { increment: effect.partnerBalanceSign * summary.totalTTC } }
      });
    }

    if (document.paymentMode === 'ESPECE' && effect.cashType) {
      const label =
        type === 'ACHAT'
          ? 'Paiement Achat'
          : type === 'RETOUR_FOURNISSEUR'
          ? 'Remboursement Avoir Achat'
          : type === 'RETOUR_CLIENT'
          ? 'Remboursement Avoir Vente'
          : 'Règlement Vente';
      await tx.cashTransaction.create({
        data: {
          type: effect.cashType,
          amount: summary.totalTTC,
          paymentMode: 'ESPECE',
          documentId: document.id,
          description: `${label} Réf: ${document.reference}`
        }
      });
    }

    return updated;
  }, TX_OPTIONS);
}

/**
 * Cancel a validated document, reversing its stock and ledger effects.
 * PUMP reversal on purchase cancellation is a best-effort recomputation (removing
 * this batch's contribution to the weighted average), not a perfect undo — a true
 * reversal would need a full cost-layer ledger, out of scope here.
 */
export async function cancelDocument(documentId: string) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { id: documentId }, include: { lines: true } });
    if (!document) throw new Error('DOCUMENT_NOT_FOUND');
    if (document.status !== 'VALIDE') throw new Error('ONLY_VALIDATED_DOCUMENTS_CAN_BE_CANCELLED');

    const type = document.type as DocumentType;

    /**
     * Symetrique du garde-fou de validation: une facture emise depuis un bon de
     * livraison n'a jamais impute ni stock ni solde, il n'y a donc rien a
     * contrepasser. On se contente de l'annuler. Le BL source, lui, reste
     * annulable separement et c'est lui qui porte la contrepassation reelle.
     */
    if (document.sourceDocumentId) {
      return tx.document.update({
        where: { id: documentId },
        data: { status: 'ANNULE', cancelledAt: new Date() },
        include: { lines: true, partner: true, depot: true, destDepot: true }
      });
    }

    const allocationsAnnulees = await tx.documentLineLot.findMany({
      where: { documentLine: { documentId } }
    });

    for (const line of document.lines) {
      // La contrepassation doit rendre EXACTEMENT ce que la validation avait
      // pris — bonus compris, sinon chaque annulation ferait fondre le stock de
      // la quantite offerte.
      const sortant = qtyStock(line);

      if (isTransfer(type)) {
        if (!document.destDepotId) throw new Error('DEST_DEPOT_REQUIRED_FOR_TRANSFER');
        // Reverse: give the quantity back to the source depot, take it back off the
        // destination depot.
        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
          data: { qtyInStock: { increment: sortant } }
        });
        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: document.destDepotId } },
          data: { qtyInStock: { decrement: sortant } }
        });
        continue;
      }

      const stock = await tx.articleStock.findUnique({
        where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } }
      });
      if (!stock) throw new Error('STOCK_NOT_FOUND');

      if (isReceiving(type)) {
        if (recalculatesPump(type)) {
          const article = await tx.article.findUnique({ where: { id: line.articleId } });
          if (article) {
            // Miroir du calcul de validation: on retire la quantite RECUE du
            // stock et seulement la valeur FACTUREE de la masse.
            const remainingQty = stock.qtyInStock - sortant;
            const currentPump = Number(article.pump);
            const lineCost = Number(line.purchaseCostPUMP);
            const valeurRetiree = line.quantity * lineCost;
            const revertedPump =
              remainingQty > 0 ? (stock.qtyInStock * currentPump - valeurRetiree) / remainingQty : currentPump;
            await tx.article.update({ where: { id: line.articleId }, data: { pump: Math.max(revertedPump, 0) } });
          }
        }
        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
          data: { qtyInStock: { decrement: sortant } }
        });
      } else if (isConsuming(type)) {
        await tx.articleStock.update({
          where: { articleId_depotId: { articleId: line.articleId, depotId: line.depotId } },
          data: { qtyInStock: { increment: sortant } }
        });

        // La marchandise revient dans le lot d'ou elle etait sortie, et pas
        // dans un lot quelconque: son numero et sa peremption sont ceux-la.
        await rendreAuxLots(
          tx,
          allocationsAnnulees.filter((a) => a.documentLineId === line.id)
        );
      }
    }

    const effect = ledgerEffect(type);
    if (document.partnerId && effect.partnerBalanceSign !== 0) {
      await tx.partner.update({
        where: { id: document.partnerId },
        data: { balance: { decrement: effect.partnerBalanceSign * Number(document.totalTTC) } }
      });
    }

    if (document.paymentMode === 'ESPECE' && effect.cashType) {
      const reversedType = effect.cashType === 'RECETTE' ? 'DEPENSE' : 'RECETTE';
      await tx.cashTransaction.create({
        data: {
          type: reversedType,
          amount: Number(document.totalTTC),
          paymentMode: 'ESPECE',
          documentId: document.id,
          description: `Annulation Réf: ${document.reference}`
        }
      });
    }

    return tx.document.update({
      where: { id: documentId },
      data: { status: 'ANNULE', cancelledAt: new Date() },
      include: { lines: true, partner: true, depot: true, destDepot: true }
    });
  }, TX_OPTIONS);
}

/**
 * Receive a purchase order: generate a real ACHAT from the COMMANDE's lines and
 * validate it (stock in + PUMP recalculation + supplier ledger), then mark the
 * commande VALIDE with a motif linking it to the generated purchase.
 *
 * Runs as three atomic steps rather than one giant transaction: each step leaves
 * the database consistent on its own (a draft ACHAT with no validation has no
 * stock effect), and the commande is only marked received once the ACHAT is
 * fully validated.
 */
export async function receiveCommande(commandeId: string, receivedById?: string) {
  const commande = await prisma.document.findUnique({ where: { id: commandeId }, include: { lines: true } });
  if (!commande) throw new Error('DOCUMENT_NOT_FOUND');
  if (commande.type !== 'COMMANDE') throw new Error('NOT_A_COMMANDE');
  if (commande.status !== 'OUVERT') throw new Error('COMMANDE_ALREADY_RECEIVED_OR_CANCELLED');
  if (!commande.partnerId) throw new Error('PARTNER_REQUIRED_FOR_TYPE');

  const achat = await createDocument(
    {
      type: 'ACHAT',
      partnerId: commande.partnerId,
      livreurId: commande.livreurId,
      depotId: commande.depotId,
      destDepotId: null,
      supplierInvoiceNum: commande.supplierInvoiceNum,
      motif: `Réception commande ${commande.reference}`,
      paymentMode: commande.paymentMode as PaymentMode,
      remise: Number(commande.remise),
      // La reception reprend la commande a l'identique, bonus et conditionnement
      // compris: un carton offert commande doit entrer en stock a la reception.
      lines: commande.lines.map((l) => ({
        articleId: l.articleId,
        depotId: l.depotId,
        quantity: l.quantity,
        unitPriceHT: Number(l.unitPriceHT),
        discountPercent: Number(l.discountPercent),
        tvaRate: Number(l.tvaRate),
        emballage: l.emballage,
        nbColis: l.nbColis,
        numeroColis: l.numeroColis,
        quantiteBonus: l.quantiteBonus,
        ristourne: Number(l.ristourne)
      }))
    },
    receivedById
  );

  const validated = await validateDocument(achat.id, receivedById);

  const updatedCommande = await prisma.document.update({
    // Guard on status so two concurrent receptions cannot both generate an ACHAT.
    where: { id: commandeId, status: 'OUVERT' },
    data: { status: 'VALIDE', validatedAt: new Date(), motif: `Réceptionnée → ${validated.reference}` },
    include: { lines: true, partner: true, depot: true }
  });

  return { commande: updatedCommande, achat: validated };
}

/**
 * Emet la facture d'un bon de livraison valide (relation 1 BL -> 1 facture).
 *
 * La facture reprend a l'identique les lignes et les totaux du BL, mais porte
 * `sourceDocumentId`: sa validation n'a donc aucun effet sur le stock ni sur le
 * solde client, deja imputes par le bon de livraison. La contrainte d'unicite
 * sur `sourceDocumentId` empeche d'emettre deux factures pour un meme BL, y
 * compris en cas de double clic ou de requetes concurrentes.
 */
export async function factureFromBonLivraison(blId: string, createdById?: string) {
  return prisma.$transaction(async (tx) => {
    const bl = await tx.document.findUnique({ where: { id: blId }, include: { lines: true, facture: true } });
    if (!bl) throw new Error('DOCUMENT_NOT_FOUND');
    if (bl.type !== 'BON_LIVRAISON') throw new Error('NOT_A_BON_LIVRAISON');
    if (bl.status !== 'VALIDE') throw new Error('BON_LIVRAISON_NOT_VALIDATED');
    if (bl.facture) throw new Error('BON_LIVRAISON_ALREADY_INVOICED');

    const reference = await nextReference(tx, 'FACTURE');

    return tx.document.create({
      data: {
        type: 'FACTURE',
        reference,
        status: 'VALIDE',
        validatedAt: new Date(),
        sourceDocumentId: bl.id,
        partnerId: bl.partnerId,
        livreurId: bl.livreurId,
        depotId: bl.depotId,
        paymentMode: bl.paymentMode,
        motif: `Facturation du bon de livraison ${bl.reference}`,
        totalHT: bl.totalHT,
        remise: bl.remise,
        totalTVA: bl.totalTVA,
        stampDuty: bl.stampDuty,
        totalTTC: bl.totalTTC,
        marginHT: bl.marginHT,
        marginPercent: bl.marginPercent,
        createdById: createdById ?? null,
        lines: {
          create: bl.lines.map((l) => ({
            articleId: l.articleId,
            depotId: l.depotId,
            quantity: l.quantity,
            unitPriceHT: l.unitPriceHT,
            discountPercent: l.discountPercent,
            tvaRate: l.tvaRate,
            totalHT: l.totalHT,
            totalTTC: l.totalTTC,
            purchaseCostPUMP: l.purchaseCostPUMP
          }))
        }
      },
      include: { lines: true, partner: true, depot: true }
    });
  }, TX_OPTIONS);
}
