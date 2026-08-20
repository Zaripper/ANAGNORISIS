import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import { cancelDocument, createDocument, deleteDraftDocument, validateDocument } from './document.service';
import { valeurLotsPerimes } from './lot.service';

/**
 * Lots et dates de peremption, de bout en bout.
 *
 * Deux exigences gouvernent ces tests:
 *
 *  1. On ne sert jamais un lot perime, et on sert toujours le plus proche de la
 *     peremption. C'est une obligation sanitaire avant d'etre une commodite.
 *  2. Le total (ArticleStock) et sa ventilation (Lot) ne divergent JAMAIS. Des
 *     lots qui mentent sont pires que pas de lots du tout: on croirait savoir
 *     ce qu'il y a en rayon.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
  // articleA passe en suivi par lot; son stock initial (100/50) est repris en lots.
  await prisma.article.update({ where: { id: f.articleA.id }, data: { suiviLot: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function jours(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function creerLot(numeroLot: string, datePeremption: Date, qty: number) {
  return prisma.lot.create({
    data: { articleId: f.articleA.id, depotId: f.depotMain.id, numeroLot, datePeremption, qtyInStock: qty }
  });
}

function venteInput(quantity: number, over: Record<string, unknown> = {}) {
  return {
    type: 'VENTE' as const,
    partnerId: f.client.id,
    depotId: f.depotMain.id,
    paymentMode: 'CHEQUE' as const,
    remise: 0,
    lines: [
      {
        articleId: f.articleA.id,
        depotId: f.depotMain.id,
        quantity,
        unitPriceHT: 150,
        discountPercent: 0,
        tvaRate: 19,
        ...over
      }
    ]
  };
}

function achatInput(over: Record<string, unknown> = {}) {
  return {
    type: 'ACHAT' as const,
    partnerId: f.supplier.id,
    depotId: f.depotMain.id,
    paymentMode: 'VIREMENT' as const,
    remise: 0,
    lines: [
      {
        articleId: f.articleA.id,
        depotId: f.depotMain.id,
        quantity: 20,
        unitPriceHT: 100,
        discountPercent: 0,
        tvaRate: 19,
        numeroLot: 'L-2027',
        datePeremption: jours(400).toISOString(),
        ...over
      }
    ]
  };
}

/** Somme des quantites de lots pour l'article suivi, dans le depot principal. */
async function totalLots() {
  const lots = await prisma.lot.findMany({ where: { articleId: f.articleA.id, depotId: f.depotMain.id } });
  return {
    inStock: lots.reduce((s, l) => s + l.qtyInStock, 0),
    reserved: lots.reduce((s, l) => s + l.qtyReserved, 0)
  };
}

describe('entree en lot', () => {
  it('un achat cree le lot et incremente le stock', async () => {
    const achat = await createDocument(achatInput() as never);
    await validateDocument(achat.id);

    const lot = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'L-2027' } });
    expect(lot.qtyInStock).toBe(20);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(120);
  });

  it('deux receptions du meme lot alimentent le meme lot', async () => {
    // Meme numero, meme peremption: c'est le meme lot physique.
    const a1 = await createDocument(achatInput() as never);
    await validateDocument(a1.id);
    const a2 = await createDocument(achatInput() as never);
    await validateDocument(a2.id);

    const lots = await prisma.lot.findMany({ where: { numeroLot: 'L-2027' } });
    expect(lots).toHaveLength(1);
    expect(lots[0].qtyInStock).toBe(40);
  });

  it('les UG entrent en lot avec le reste', async () => {
    // Elles sont physiquement la, meme si elles n'ont rien coute.
    const achat = await createDocument(achatInput({ quantiteBonus: 5 }) as never);
    await validateDocument(achat.id);

    const lot = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'L-2027' } });
    expect(lot.qtyInStock).toBe(25);
  });

  it('un article suivi refuse une entree sans lot ni peremption', async () => {
    await expect(createDocument(achatInput({ numeroLot: null, datePeremption: null }) as never)).rejects.toThrow(
      /LOT_REQUIS/
    );
  });

  it("un article non suivi n'exige rien", async () => {
    // articleB n'est pas en suivi par lot: le catalogue existant doit continuer
    // de fonctionner sans qu'on lui invente des lots.
    const achat = await createDocument(
      achatInput({ articleId: f.articleB.id, numeroLot: null, datePeremption: null }) as never
    );
    await validateDocument(achat.id);
    expect((await stockOf(f.articleB.id, f.depotMain.id)).qtyInStock).toBe(60);
  });
});

describe('sortie FEFO', () => {
  it('sert le lot qui perime le plus tot', async () => {
    await creerLot('TARD', jours(300), 100);
    await creerLot('TOT', jours(20), 100);

    const vente = await createDocument(venteInput(30) as never);

    const allocations = await prisma.documentLineLot.findMany({ include: { lot: true } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].lot.numeroLot).toBe('TOT');
    expect(allocations[0].quantity).toBe(30);

    await validateDocument(vente.id);

    const tot = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'TOT' } });
    const tard = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'TARD' } });
    expect(tot.qtyInStock).toBe(70);
    expect(tard.qtyInStock).toBe(100);
  });

  it('enchaine sur le lot suivant quand le premier ne suffit pas', async () => {
    await creerLot('A', jours(20), 40);
    await creerLot('B', jours(200), 100);

    const vente = await createDocument(venteInput(60) as never);
    await validateDocument(vente.id);

    const a = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'A' } });
    const b = await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'B' } });
    expect(a.qtyInStock).toBe(0);
    expect(b.qtyInStock).toBe(80);
  });

  it('refuse de servir un lot perime, meme si la marchandise est la', async () => {
    // 500 unites physiquement presentes mais perimees: la vente doit echouer
    // plutot que de les livrer.
    await creerLot('PERIME', jours(-1), 500);

    await expect(createDocument(venteInput(10) as never)).rejects.toThrow('LOT_STOCK_INSUFFISANT');
  });

  it('sert le lot valide en ignorant le perime', async () => {
    await creerLot('PERIME', jours(-1), 500);
    await creerLot('BON', jours(200), 50);

    const vente = await createDocument(venteInput(30) as never);
    const allocations = await prisma.documentLineLot.findMany({ include: { lot: true } });

    expect(allocations.map((a) => a.lot.numeroLot)).toEqual(['BON']);
    await validateDocument(vente.id);
    expect((await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'PERIME' } })).qtyInStock).toBe(500);
  });

  it('la repartition retenue est conservee: on sait quel lot est parti chez qui', async () => {
    // C'est l'information meme qu'un rappel de lot exige.
    await creerLot('A', jours(20), 40);
    await creerLot('B', jours(200), 100);

    const vente = await createDocument(venteInput(60) as never);
    await validateDocument(vente.id);

    const allocations = await prisma.documentLineLot.findMany({
      where: { documentLine: { documentId: vente.id } },
      include: { lot: true }
    });
    const parLot = Object.fromEntries(allocations.map((a) => [a.lot.numeroLot, a.quantity]));
    expect(parLot).toEqual({ A: 40, B: 20 });
  });

  it('les UG sortent des lots comme le reste', async () => {
    await creerLot('A', jours(100), 100);

    const vente = await createDocument(venteInput(10, { quantiteBonus: 3 }) as never);
    await validateDocument(vente.id);

    expect((await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'A' } })).qtyInStock).toBe(87);
  });
});

describe('coherence entre le total et sa ventilation', () => {
  it('la reservation au brouillon touche les deux', async () => {
    await creerLot('A', jours(100), 100);

    await createDocument(venteInput(30) as never);

    expect((await totalLots()).reserved).toBe(30);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(30);
  });

  it('supprimer un brouillon rend la reservation des lots', async () => {
    // Sans liberation explicite, la cascade effacerait les allocations sans
    // jamais decrementer qtyReserved: la reservation resterait posee a jamais.
    await creerLot('A', jours(100), 100);
    const vente = await createDocument(venteInput(30) as never);

    await deleteDraftDocument(vente.id);

    expect((await totalLots()).reserved).toBe(0);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(0);
  });

  it("annuler une vente rend la marchandise a son lot d'origine", async () => {
    await creerLot('A', jours(20), 40);
    await creerLot('B', jours(200), 100);

    const vente = await createDocument(venteInput(60) as never);
    await validateDocument(vente.id);
    await cancelDocument(vente.id);

    // Chaque lot retrouve exactement ce qu'il avait fourni, et pas un lot au hasard.
    expect((await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'A' } })).qtyInStock).toBe(40);
    expect((await prisma.lot.findFirstOrThrow({ where: { numeroLot: 'B' } })).qtyInStock).toBe(100);
  });

  it('apres un cycle complet, lots et stock disent la meme chose', async () => {
    await creerLot('A', jours(20), 40);
    await creerLot('B', jours(200), 100);
    // Le stock total de l'article doit refleter les lots des le depart.
    await prisma.articleStock.update({
      where: { articleId_depotId: { articleId: f.articleA.id, depotId: f.depotMain.id } },
      data: { qtyInStock: 140 }
    });

    const v1 = await createDocument(venteInput(50) as never);
    await validateDocument(v1.id);
    const v2 = await createDocument(venteInput(30) as never);
    await validateDocument(v2.id);
    await cancelDocument(v1.id);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    const lots = await totalLots();
    expect(lots.inStock).toBe(stock.qtyInStock);
    expect(lots.reserved).toBe(stock.qtyReserved);
  });
});

describe('valeur des lots perimes', () => {
  it('chiffre ce qui dort en rayon, au P.U.M.P', async () => {
    await creerLot('PERIME', jours(-5), 12);
    await creerLot('BON', jours(200), 100);

    // articleA a un P.U.M.P de 100 dans les fixtures.
    expect(await valeurLotsPerimes()).toBeCloseTo(1200, 6);
  });

  it('ne compte pas les lots encore valides', async () => {
    await creerLot('BON', jours(200), 100);
    expect(await valeurLotsPerimes()).toBe(0);
  });
});
