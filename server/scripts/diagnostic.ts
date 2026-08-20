import { prisma } from '../src/prisma';

async function main() {
  const docs = await prisma.document.findMany({
    select: { reference: true, type: true, status: true },
    orderBy: { reference: 'asc' }
  });
  console.log('documents en base:', docs.length);
  for (const d of docs) console.log('  ', d.reference, d.type, d.status);

  const residus = {
    documents: await prisma.document.count({ where: { motif: { contains: 'AUDIT' } } }),
    articles: await prisma.article.count({ where: { code: { startsWith: 'AUDIT' } } }),
    partenaires: await prisma.partner.count({ where: { code: { startsWith: 'AUDIT' } } }),
    caisse: await prisma.cashTransaction.count({ where: { description: { contains: 'AUDIT' } } }),
    lots: await prisma.lot.count({ where: { numeroLot: { startsWith: 'AUDIT' } } }),
    cheques: await prisma.cheque.count({ where: { numeroCheque: { contains: 'AUDIT' } } }),
    lignes: await prisma.documentLine.count({ where: { article: { code: { startsWith: 'AUDIT' } } } })
  };
  console.log('\nresidus AUDIT:', JSON.stringify(residus));

  // Coherence globale: chaque ligne de stock doit egaler la somme de ses lots
  // pour les articles suivis. Les articles non suivis n'ont pas de lots.
  const suivis = await prisma.article.findMany({ where: { suiviLot: true }, select: { id: true, code: true } });
  console.log('\narticles suivis par lot:', suivis.length);
  for (const a of suivis) {
    const stocks = await prisma.articleStock.findMany({ where: { articleId: a.id } });
    for (const s of stocks) {
      const lots = await prisma.lot.findMany({ where: { articleId: a.id, depotId: s.depotId } });
      const somme = lots.reduce((t, l) => t + l.qtyInStock, 0);
      const etat = somme === s.qtyInStock ? 'OK' : 'ECART';
      console.log(`   ${etat} ${a.code} depot=${s.depotId.slice(0, 8)} stock=${s.qtyInStock} lots=${somme}`);
    }
  }

  // Reservations orphelines: du stock reserve sans document ouvert pour le reclamer.
  const stocksReserves = await prisma.articleStock.findMany({ where: { qtyReserved: { gt: 0 } }, include: { article: true } });
  console.log('\nlignes de stock avec reservation:', stocksReserves.length);
  for (const s of stocksReserves) {
    const ouverts = await prisma.documentLine.count({
      where: { articleId: s.articleId, depotId: s.depotId, document: { status: 'OUVERT' } }
    });
    console.log(`   ${s.article.code} reserve=${s.qtyReserved} lignes de documents ouverts=${ouverts} ${ouverts === 0 ? '<-- ORPHELINE' : ''}`);
  }

  const lotsReserves = await prisma.lot.count({ where: { qtyReserved: { gt: 0 } } });
  console.log('lots avec reservation:', lotsReserves);

  // Soldes partenaires
  const partners = await prisma.partner.findMany({ select: { code: true, raisonSociale: true, balance: true }, orderBy: { code: 'asc' } });
  console.log('\nsoldes partenaires:');
  for (const p of partners) console.log(`   ${p.code.padEnd(12)} ${String(p.balance).padStart(12)}  ${p.raisonSociale}`);

  await prisma.$disconnect();
}

main();
