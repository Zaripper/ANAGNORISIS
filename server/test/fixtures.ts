import { prisma } from '../src/prisma';

/**
 * Test fixtures: a minimal but realistic business setup (two depots, a client
 * and a supplier category, two articles with per-tier prices and stock).
 *
 * Every test starts from a clean schema — see `resetDatabase` — so fixtures are
 * rebuilt per test rather than shared, keeping tests independent and their
 * expectations absolute (e.g. "stock is 100" rather than "stock decreased").
 */

/**
 * Truncates every table in dependency-safe order. TRUNCATE ... CASCADE on the
 * root tables is enough, but listing them explicitly documents the graph and
 * avoids surprises if a future model is added without a cascade.
 */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "DocumentLineLot", "Lot", "Cheque", "DocumentLine", "Document", "CashTransaction", "Charge", "ChargeClass",
      "ArticleStock", "ArticlePrice", "Article",
      "Partner", "PartnerCategory", "Zone", "Livreur", "TypeReglement",
      "Depot", "Comment", "AppSetting", "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface Fixtures {
  depotMain: { id: string };
  depotShop: { id: string };
  catClient: { id: string };
  catSupplier: { id: string };
  client: { id: string };
  supplier: { id: string };
  /** pump 100, TVA 19%, stock 100 (main) / 50 (shop) */
  articleA: { id: string };
  /** pump 200, TVA 0%, stock 40 (main only) */
  articleB: { id: string };
  user: { id: string };
}

export async function seedFixtures(): Promise<Fixtures> {
  const depotMain = await prisma.depot.create({ data: { code: 'MAIN', name: 'Dépôt principal', isDefault: true } });
  const depotShop = await prisma.depot.create({ data: { code: 'SHOP', name: 'Show room' } });

  const catClient = await prisma.partnerCategory.create({ data: { code: 'DETAIL', label: 'Détaillant', isSupplier: false } });
  const catSupplier = await prisma.partnerCategory.create({ data: { code: 'FOURN', label: 'Fournisseur', isSupplier: true } });

  const client = await prisma.partner.create({
    data: { code: 'CLI001', raisonSociale: 'Client Test', categoryId: catClient.id, seuilAutorise: 100000, balance: 0 }
  });
  const supplier = await prisma.partner.create({
    data: { code: 'FRN001', raisonSociale: 'Fournisseur Test', categoryId: catSupplier.id, balance: 0 }
  });

  const articleA = await prisma.article.create({
    data: {
      code: 'ART-A',
      designation: 'Article A',
      pump: 100,
      tvaRate: 19,
      prices: { create: [{ categoryId: catClient.id, priceHT: 150, priceTTC: 178.5 }] },
      stocks: {
        create: [
          { depotId: depotMain.id, qtyInStock: 100 },
          { depotId: depotShop.id, qtyInStock: 50 }
        ]
      }
    }
  });

  const articleB = await prisma.article.create({
    data: {
      code: 'ART-B',
      designation: 'Article B',
      pump: 200,
      tvaRate: 0,
      prices: { create: [{ categoryId: catClient.id, priceHT: 260, priceTTC: 260 }] },
      stocks: { create: [{ depotId: depotMain.id, qtyInStock: 40 }] }
    }
  });

  const user = await prisma.user.create({
    data: { username: 'tester', passwordHash: 'x', role: 'ADMINISTRATEUR' }
  });

  return { depotMain, depotShop, catClient, catSupplier, client, supplier, articleA, articleB, user };
}

/** Current physical + reserved quantities for one article in one depot. */
export async function stockOf(articleId: string, depotId: string) {
  const row = await prisma.articleStock.findUnique({ where: { articleId_depotId: { articleId, depotId } } });
  return { qtyInStock: row?.qtyInStock ?? 0, qtyReserved: row?.qtyReserved ?? 0 };
}

export async function pumpOf(articleId: string): Promise<number> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  return Number(article?.pump ?? 0);
}

export async function balanceOf(partnerId: string): Promise<number> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  return Number(partner?.balance ?? 0);
}
