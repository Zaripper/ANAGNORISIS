import { prisma } from '../prisma';

const SALE_TYPES = ['BON_PREPARATION', 'VENTE', 'FACTURE'] as const;
type SaleType = (typeof SALE_TYPES)[number];

function isSaleType(type: string): type is SaleType {
  return (SALE_TYPES as readonly string[]).includes(type);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Dashboard KPIs: current-month revenue/margin/purchases, open (unvalidated) document
 * count, blocked-partner count, total stock valuation at cost, and the créances/dettes
 * totals (same isSupplier-based split used by the Créances et dettes screen).
 */
export async function getDashboardSummary() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [monthDocs, openCount, partners, stocks] = await Promise.all([
    prisma.document.findMany({
      where: { status: 'VALIDE', validatedAt: { gte: monthStart } },
      select: { type: true, totalHT: true, marginHT: true }
    }),
    prisma.document.count({ where: { status: 'OUVERT' } }),
    prisma.partner.findMany({ select: { balance: true, seuilAutorise: true, category: { select: { isSupplier: true } } } }),
    prisma.articleStock.findMany({ select: { qtyInStock: true, article: { select: { pump: true } } } })
  ]);

  let ventesHT = 0;
  let avoirsVenteHT = 0;
  let achatsHT = 0;
  let avoirsAchatHT = 0;
  let margeHT = 0;

  for (const doc of monthDocs) {
    const ht = Number(doc.totalHT);
    if (isSaleType(doc.type)) {
      ventesHT += ht;
      margeHT += Number(doc.marginHT);
    } else if (doc.type === 'RETOUR_CLIENT') {
      avoirsVenteHT += ht;
    } else if (doc.type === 'ACHAT') {
      achatsHT += ht;
    } else if (doc.type === 'RETOUR_FOURNISSEUR') {
      avoirsAchatHT += ht;
    }
  }

  let totalCreances = 0;
  let totalDettes = 0;
  let blockedPartners = 0;
  for (const p of partners) {
    const balance = Number(p.balance);
    const seuil = Number(p.seuilAutorise);
    if (p.category.isSupplier) {
      if (balance > 0) totalDettes += balance;
    } else {
      if (balance > 0) totalCreances += balance;
    }
    if (seuil > 0 && balance > seuil) blockedPartners += 1;
  }

  const stockValue = stocks.reduce((sum, s) => sum + s.qtyInStock * Number(s.article.pump), 0);

  return {
    caMoisHT: ventesHT - avoirsVenteHT,
    margeMoisHT: margeHT,
    achatsMoisHT: achatsHT - avoirsAchatHT,
    documentsOuverts: openCount,
    partenairesBloques: blockedPartners,
    valeurStock: stockValue,
    totalCreances,
    totalDettes
  };
}

/**
 * Monthly revenue breakdown for the last `months` months: gross sales, sales
 * returns (avoir vente), net CA, gross purchases, purchase returns (avoir achat),
 * net purchases, and margin — all from VALIDE documents only (drafts and
 * cancelled documents never happened financially).
 */
export async function getChiffreAffaires(months: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const docs = await prisma.document.findMany({
    where: { status: 'VALIDE', validatedAt: { gte: start } },
    select: { type: true, totalHT: true, marginHT: true, validatedAt: true }
  });

  const buckets = new Map<
    string,
    { ventesHT: number; avoirsVenteHT: number; achatsHT: number; avoirsAchatHT: number; margeHT: number }
  >();

  // Pre-seed every month in range so the report never has a gap, even with no activity.
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), { ventesHT: 0, avoirsVenteHT: 0, achatsHT: 0, avoirsAchatHT: 0, margeHT: 0 });
  }

  for (const doc of docs) {
    if (!doc.validatedAt) continue;
    const key = monthKey(doc.validatedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const ht = Number(doc.totalHT);
    if (isSaleType(doc.type)) {
      bucket.ventesHT += ht;
      bucket.margeHT += Number(doc.marginHT);
    } else if (doc.type === 'RETOUR_CLIENT') {
      bucket.avoirsVenteHT += ht;
    } else if (doc.type === 'ACHAT') {
      bucket.achatsHT += ht;
    } else if (doc.type === 'RETOUR_FOURNISSEUR') {
      bucket.avoirsAchatHT += ht;
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      ventesHT: b.ventesHT,
      avoirsVenteHT: b.avoirsVenteHT,
      caNetHT: b.ventesHT - b.avoirsVenteHT,
      achatsHT: b.achatsHT,
      avoirsAchatHT: b.avoirsAchatHT,
      achatsNetHT: b.achatsHT - b.avoirsAchatHT,
      margeHT: b.margeHT
    }));
}

/**
 * Net units sold and net revenue per article: sales-type lines minus
 * avoir-vente (RETOUR_CLIENT) lines for the same article, from VALIDE documents
 * only. Sorted by quantity sold, descending.
 */
export async function getVentesArticles(limit: number) {
  const lines = await prisma.documentLine.findMany({
    where: { document: { status: 'VALIDE', type: { in: [...SALE_TYPES, 'RETOUR_CLIENT'] as any } } },
    select: {
      articleId: true,
      quantity: true,
      totalHT: true,
      document: { select: { type: true } },
      article: { select: { code: true, designation: true } }
    }
  });

  const byArticle = new Map<string, { code: string; designation: string; quantity: number; totalHT: number }>();

  for (const line of lines) {
    const sign = line.document.type === 'RETOUR_CLIENT' ? -1 : 1;
    const existing = byArticle.get(line.articleId) ?? {
      code: line.article.code,
      designation: line.article.designation,
      quantity: 0,
      totalHT: 0
    };
    existing.quantity += sign * line.quantity;
    existing.totalHT += sign * Number(line.totalHT);
    byArticle.set(line.articleId, existing);
  }

  return Array.from(byArticle.entries())
    .map(([articleId, v]) => ({ articleId, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
}

/**
 * Net revenue per livreur/agent for the last `months` months. Same VALIDE-only,
 * sales-minus-returns convention as getChiffreAffaires, grouped by the document's
 * livreur. Documents with no livreur are grouped under "Sans agent" so the total
 * always reconciles with the CA report.
 */
export async function getCAByLivreur(months: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const docs = await prisma.document.findMany({
    where: { status: 'VALIDE', validatedAt: { gte: start }, type: { in: [...SALE_TYPES, 'RETOUR_CLIENT'] as any } },
    select: { type: true, totalHT: true, marginHT: true, livreur: { select: { id: true, code: true, name: true } } }
  });

  const byLivreur = new Map<string, { code: string; name: string; ventesHT: number; avoirsHT: number; margeHT: number; documents: number }>();

  for (const doc of docs) {
    const key = doc.livreur?.id ?? '__none__';
    const entry = byLivreur.get(key) ?? {
      code: doc.livreur?.code ?? '—',
      name: doc.livreur?.name ?? 'Sans agent',
      ventesHT: 0,
      avoirsHT: 0,
      margeHT: 0,
      documents: 0
    };
    const ht = Number(doc.totalHT);
    if (doc.type === 'RETOUR_CLIENT') entry.avoirsHT += ht;
    else {
      entry.ventesHT += ht;
      entry.margeHT += Number(doc.marginHT);
    }
    entry.documents += 1;
    byLivreur.set(key, entry);
  }

  return Array.from(byLivreur.values())
    .map((e) => ({ ...e, caNetHT: e.ventesHT - e.avoirsHT }))
    .sort((a, b) => b.caNetHT - a.caNetHT);
}

/**
 * Chronological stock ledger for one article across all VALIDE documents, with a
 * signed quantity per movement and a running global balance. Transfers appear
 * twice (out of the source depot, into the destination) and net to zero globally.
 */
export async function getArticleMovements(articleId: string) {
  const receiving = new Set(['ACHAT', 'RETOUR_CLIENT', 'REGULE_PLUS']);
  const consuming = new Set(['BON_PREPARATION', 'VENTE', 'FACTURE', 'RETOUR_FOURNISSEUR', 'REGULE_MOINS']);

  const lines = await prisma.documentLine.findMany({
    where: { articleId, document: { status: 'VALIDE' } },
    select: {
      quantity: true,
      unitPriceHT: true,
      depot: { select: { name: true } },
      document: {
        select: {
          reference: true,
          type: true,
          validatedAt: true,
          partner: { select: { raisonSociale: true } },
          destDepot: { select: { name: true } }
        }
      }
    }
  });

  interface Movement {
    date: Date;
    reference: string;
    type: string;
    depot: string;
    partner: string | null;
    qty: number;
    unitPriceHT: number;
  }

  const movements: Movement[] = [];
  for (const l of lines) {
    const doc = l.document;
    if (!doc.validatedAt) continue;
    const base = {
      date: doc.validatedAt,
      reference: doc.reference,
      type: doc.type as string,
      partner: doc.partner?.raisonSociale ?? null,
      unitPriceHT: Number(l.unitPriceHT)
    };
    if (doc.type === 'TRANSFERT') {
      movements.push({ ...base, depot: l.depot.name, qty: -l.quantity });
      movements.push({ ...base, depot: doc.destDepot?.name ?? '?', qty: l.quantity });
    } else if (receiving.has(doc.type)) {
      movements.push({ ...base, depot: l.depot.name, qty: l.quantity });
    } else if (consuming.has(doc.type)) {
      movements.push({ ...base, depot: l.depot.name, qty: -l.quantity });
    }
    // PROFORMA / COMMANDE: never a stock movement.
  }

  movements.sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = 0;
  return movements.map((m) => ({ ...m, runningQty: (running += m.qty) }));
}

/**
 * Articles whose global available stock (in stock minus reserved) has fallen
 * below their reorder threshold. Articles without a threshold never alert.
 */
export async function getReorderAlerts() {
  const articles = await prisma.article.findMany({
    where: { active: true, seuilReappro: { not: null } },
    select: { id: true, code: true, designation: true, seuilReappro: true, stocks: { select: { qtyInStock: true, qtyReserved: true } } }
  });

  return articles
    .map((a) => {
      const available = a.stocks.reduce((sum, s) => sum + s.qtyInStock - s.qtyReserved, 0);
      return { id: a.id, code: a.code, designation: a.designation, seuilReappro: a.seuilReappro ?? 0, available };
    })
    .filter((a) => a.available < a.seuilReappro)
    .sort((a, b) => a.available - b.available);
}

/**
 * Monthly fiscal aggregates for one calendar year, intended as a working paper to
 * hand to the company's accountant — NOT an authoritative filing. TVA collectée
 * comes from validated sales (minus avoirs), TVA déductible from validated
 * purchases (minus avoirs), timbre from the stamp actually charged on cash sales.
 */
export async function getFiscalSummary(year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const docs = await prisma.document.findMany({
    where: { status: 'VALIDE', validatedAt: { gte: start, lt: end } },
    select: { type: true, totalHT: true, totalTVA: true, stampDuty: true, validatedAt: true }
  });

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    ventesHT: 0,
    tvaCollectee: 0,
    achatsHT: 0,
    tvaDeductible: 0,
    timbre: 0
  }));

  for (const doc of docs) {
    if (!doc.validatedAt) continue;
    const bucket = months[doc.validatedAt.getMonth()];
    const ht = Number(doc.totalHT);
    const tva = Number(doc.totalTVA);
    if (isSaleType(doc.type)) {
      bucket.ventesHT += ht;
      bucket.tvaCollectee += tva;
      bucket.timbre += Number(doc.stampDuty);
    } else if (doc.type === 'RETOUR_CLIENT') {
      bucket.ventesHT -= ht;
      bucket.tvaCollectee -= tva;
    } else if (doc.type === 'ACHAT') {
      bucket.achatsHT += ht;
      bucket.tvaDeductible += tva;
    } else if (doc.type === 'RETOUR_FOURNISSEUR') {
      bucket.achatsHT -= ht;
      bucket.tvaDeductible -= tva;
    }
  }

  return months.map((m) => ({ ...m, tvaAPayer: m.tvaCollectee - m.tvaDeductible }));
}
