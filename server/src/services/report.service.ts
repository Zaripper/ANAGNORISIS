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
