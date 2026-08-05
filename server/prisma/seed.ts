import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Users
  const adminHash = await bcrypt.hash('admin123', 10);
  const cashierHash = await bcrypt.hash('caissier123', 10);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminHash, role: 'ADMINISTRATEUR' },
    create: { username: 'admin', passwordHash: adminHash, role: 'ADMINISTRATEUR', mustChangePassword: true }
  });
  await prisma.user.upsert({
    where: { username: 'caissier' },
    update: { passwordHash: cashierHash, role: 'CAISSIER' },
    create: { username: 'caissier', passwordHash: cashierHash, role: 'CAISSIER', mustChangePassword: true }
  });

  // 2. Depots (matching the depot names already hardcoded in the UI dropdown)
  const depotShowroom = await prisma.depot.upsert({
    where: { code: 'SHOW_ROOM' },
    update: { name: 'SHOW ROOM', isDefault: true },
    create: { code: 'SHOW_ROOM', name: 'SHOW ROOM', isDefault: true }
  });
  const depotPrincipal = await prisma.depot.upsert({
    where: { code: 'DEPOT_PRINCIPAL' },
    update: { name: 'DEPOT PRINCIPAL' },
    create: { code: 'DEPOT_PRINCIPAL', name: 'DEPOT PRINCIPAL' }
  });

  // 3. Partner categories (admin-defined; isSupplier drives Achats vs Ventes screens)
  const catDetaillant = await prisma.partnerCategory.upsert({
    where: { code: 'DETAILLANT' },
    update: { label: 'Détaillant', isSupplier: false },
    create: { code: 'DETAILLANT', label: 'Détaillant', isSupplier: false }
  });
  const catGrossiste = await prisma.partnerCategory.upsert({
    where: { code: 'GROSSISTE' },
    update: { label: 'Grossiste', isSupplier: false },
    create: { code: 'GROSSISTE', label: 'Grossiste', isSupplier: false }
  });
  const catVenteDirecte = await prisma.partnerCategory.upsert({
    where: { code: 'VENTE_DIRECTE' },
    update: { label: 'Vente Directe', isSupplier: false },
    create: { code: 'VENTE_DIRECTE', label: 'Vente Directe', isSupplier: false }
  });
  const catFournisseur = await prisma.partnerCategory.upsert({
    where: { code: 'FOURNISSEUR' },
    update: { label: 'Fournisseur', isSupplier: true },
    create: { code: 'FOURNISSEUR', label: 'Fournisseur', isSupplier: true }
  });

  // 4. Partners (matching the demo data already in the UI mockup)
  await prisma.partner.upsert({
    where: { code: 'BOUOUA161' },
    update: { raisonSociale: 'BOUFEKANE OUAHID', categoryId: catDetaillant.id },
    create: { code: 'BOUOUA161', raisonSociale: 'BOUFEKANE OUAHID', categoryId: catDetaillant.id, balance: 0 }
  });
  await prisma.partner.upsert({
    where: { code: 'PHARM_AL_CHIFA' },
    update: { raisonSociale: 'PHARMACIE AL CHIFA', categoryId: catDetaillant.id, seuilAutorise: 20000 },
    create: {
      code: 'PHARM_AL_CHIFA',
      raisonSociale: 'PHARMACIE AL CHIFA',
      categoryId: catDetaillant.id,
      seuilAutorise: 20000,
      balance: 14500
    }
  });
  await prisma.partner.upsert({
    where: { code: 'GROSS_SANTE' },
    update: { raisonSociale: 'GROSSISTE SANTE & BEAUTE', categoryId: catGrossiste.id, seuilAutorise: 500000 },
    create: {
      code: 'GROSS_SANTE',
      raisonSociale: 'GROSSISTE SANTE & BEAUTE',
      categoryId: catGrossiste.id,
      seuilAutorise: 500000,
      balance: 320000
    }
  });
  await prisma.partner.upsert({
    where: { code: 'FOUR_LABO' },
    update: { raisonSociale: 'LABORATOIRE FOURNISSEUR SA', categoryId: catFournisseur.id },
    create: {
      code: 'FOUR_LABO',
      raisonSociale: 'LABORATOIRE FOURNISSEUR SA',
      categoryId: catFournisseur.id,
      balance: 0,
      phone: '+213 70 111 222'
    }
  });
  // Walk-in counter client used as the default customer on the POS (Caisse) screen.
  await prisma.partner.upsert({
    where: { code: 'COMPTOIR' },
    update: { raisonSociale: 'CLIENT COMPTOIR', categoryId: catVenteDirecte.id },
    create: { code: 'COMPTOIR', raisonSociale: 'CLIENT COMPTOIR', categoryId: catVenteDirecte.id, balance: 0 }
  });

  // Company identity shown on printed invoices/tickets. Only created if missing so
  // an admin's edits from the Paramètres screen survive re-seeding.
  const defaultSettings: Record<string, string> = {
    'company.name': 'ETS DJEMROUD',
    'company.activity': 'Parapharmacie — Gros & Détail',
    'company.address': '',
    'company.phone': '',
    'company.rc': '',
    'company.nif': '',
    'company.ai': '',
    'company.nis': '',
    'print.footer': 'Merci de votre confiance.'
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    if (!existing) await prisma.appSetting.create({ data: { key, value } });
  }

  // 5. Articles (matching the demo catalog already in the UI mockup) with multi-tier
  //    prices and multi-depot stock.
  const articlesData = [
    {
      code: 'G22111',
      barcode: '6130001000017',
      designation: 'ACNET AZELIKE PLUS SOIN INTENSIF 30ML',
      pump: 1050.0,
      tvaRate: 19,
      prices: { DETAILLANT: 1320.0, GROSSISTE: 1190.0, VENTE_DIRECTE: 1250.0 },
      stock: { SHOW_ROOM: 90, DEPOT_PRINCIPAL: 60 }
    },
    {
      code: '22251',
      barcode: '6130001000024',
      designation: 'ACTEEN EAU NETTOYANTE REEQUILIBRANTE 150ML',
      pump: 1100.0,
      tvaRate: 19,
      prices: { DETAILLANT: 1394.0, GROSSISTE: 1260.0, VENTE_DIRECTE: 1320.0 },
      stock: { SHOW_ROOM: 50, DEPOT_PRINCIPAL: 30 }
    },
    {
      code: 'BEMACOS03',
      barcode: '6130001000031',
      designation: 'SHP BEMASEBO REGULATEUR 200ML',
      pump: 873.0,
      tvaRate: 19,
      prices: { DETAILLANT: 1104.0, GROSSISTE: 990.0, VENTE_DIRECTE: 1040.0 },
      stock: { SHOW_ROOM: 120, DEPOT_PRINCIPAL: 80 }
    },
    {
      code: 'DERM_C50',
      barcode: '6130001000048',
      designation: 'DERMOCREM SOIN PROTECTEUR 50ML',
      pump: 650.0,
      tvaRate: 19,
      prices: { DETAILLANT: 890.0, GROSSISTE: 800.0, VENTE_DIRECTE: 840.0 },
      stock: { SHOW_ROOM: 200, DEPOT_PRINCIPAL: 110 }
    }
  ];

  const categoryByCode: Record<string, string> = {
    DETAILLANT: catDetaillant.id,
    GROSSISTE: catGrossiste.id,
    VENTE_DIRECTE: catVenteDirecte.id
  };
  const depotByCode: Record<string, string> = {
    SHOW_ROOM: depotShowroom.id,
    DEPOT_PRINCIPAL: depotPrincipal.id
  };

  for (const art of articlesData) {
    const article = await prisma.article.upsert({
      where: { code: art.code },
      update: { designation: art.designation, pump: art.pump, tvaRate: art.tvaRate, barcode: art.barcode ?? null },
      create: { code: art.code, designation: art.designation, pump: art.pump, tvaRate: art.tvaRate, barcode: art.barcode ?? null }
    });

    for (const [categoryCode, priceHT] of Object.entries(art.prices)) {
      const categoryId = categoryByCode[categoryCode];
      const priceTTC = priceHT * (1 + art.tvaRate / 100);
      await prisma.articlePrice.upsert({
        where: { articleId_categoryId: { articleId: article.id, categoryId } },
        update: { priceHT, priceTTC },
        create: { articleId: article.id, categoryId, priceHT, priceTTC }
      });
    }

    for (const [depotCode, qty] of Object.entries(art.stock)) {
      const depotId = depotByCode[depotCode];
      await prisma.articleStock.upsert({
        where: { articleId_depotId: { articleId: article.id, depotId } },
        update: { qtyInStock: qty },
        create: { articleId: article.id, depotId, qtyInStock: qty }
      });
    }
  }

  console.log('Seed complete: 2 users, 2 depots, 4 partner categories, 4 partners, 4 articles.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
