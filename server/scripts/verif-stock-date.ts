/**
 * Verification independante de la reconstruction du stock a une date.
 *
 * Rejoue les mouvements d'un article a la main depuis le journal des documents
 * et compare avec ce que `stockALaDate` repond. Lecture seule.
 */
import { prisma } from '../src/prisma';
import { stockALaDate } from '../src/services/stock.service';
import { DocumentType, lineStockQuantity, stockConsumingTypes, stockReceivingTypes } from '../../shared/src';

async function main() {
  const articles = await prisma.article.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  const depots = await prisma.depot.findMany({ orderBy: { code: 'asc' } });

  for (const article of articles) {
    console.log(`\n=== ${article.code} — ${article.designation.slice(0, 44)} ===`);

    const lignes = await prisma.documentLine.findMany({
      // sourceDocumentId null: une facture issue d'un BL n'a pas bouge le stock.
      where: {
        articleId: article.id,
        document: { status: { in: ['VALIDE', 'ANNULE'] }, validatedAt: { not: null }, sourceDocumentId: null }
      },
      include: { document: true },
      orderBy: { document: { validatedAt: 'asc' } }
    });

    if (lignes.length === 0) {
      console.log('  aucun mouvement valide');
    }
    for (const l of lignes) {
      const d = l.document;
      const type = d.type as DocumentType;
      const sens = (stockReceivingTypes as string[]).includes(type)
        ? '+'
        : (stockConsumingTypes as string[]).includes(type)
          ? '-'
          : type === 'TRANSFERT'
            ? '>'
            : '0';
      console.log(
        `  ${d.validatedAt?.toISOString().slice(0, 10)}  ${d.reference}  ${type.padEnd(16)} ${sens}${lineStockQuantity(l)}` +
          `${d.status === 'ANNULE' ? `  (annule le ${d.cancelledAt?.toISOString().slice(0, 10) ?? '?'})` : ''}`
      );
    }

    const total = await prisma.articleStock.aggregate({ where: { articleId: article.id }, _sum: { qtyInStock: true } });
    const actuel = total._sum.qtyInStock ?? 0;

    // Recalcul a la main: on part du stock actuel et on defait, exactement comme
    // le ferait un humain avec le journal sous les yeux.
    for (const dateStr of ['2026-01-01', '2026-08-01', new Date().toISOString().slice(0, 10)]) {
      const limite = new Date(dateStr);
      limite.setHours(23, 59, 59, 999);

      let aLaMain = actuel;
      for (const l of lignes) {
        const d = l.document;
        const type = d.type as DocumentType;
        if (type === 'TRANSFERT') continue; // neutre sur le total tous depots
        const q = lineStockQuantity(l);
        const effet = (stockReceivingTypes as string[]).includes(type) ? q : (stockConsumingTypes as string[]).includes(type) ? -q : 0;
        if (effet === 0) continue;

        if (d.status === 'VALIDE') {
          if (d.validatedAt! > limite) aLaMain -= effet;
        } else {
          const enVigueur = d.validatedAt! <= limite && (d.cancelledAt === null || d.cancelledAt > limite);
          if (enVigueur) aLaMain += effet;
        }
      }

      const service = await stockALaDate(new Date(dateStr));
      const duService = service
        .filter((x) => x.articleId === article.id && depots.some((dp) => dp.id === x.depotId))
        .reduce((s, x) => s + x.qtyInStock, 0);

      const verdict = duService === aLaMain ? 'OK   ' : 'ECART';
      console.log(`  ${verdict} au ${dateStr}: service=${duService}  calcul manuel=${aLaMain}`);
    }
  }

  await prisma.$disconnect();
}

main();
