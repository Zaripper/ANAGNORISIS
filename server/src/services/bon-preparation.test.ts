import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import {
  createDocument,
  expireBonsPreparation,
  libererBonPreparation,
  scanBonsPreparationEchus,
  validateDocument
} from './document.service';
import { BP_DUREE_VALIDITE_JOURS_DEFAUT, BP_DUREE_VALIDITE_KEY } from '../../../shared/src';

/**
 * Validite des bons de preparation.
 *
 * Le risque couvert ici est economique, pas technique: un bon prepare puis
 * jamais retire reserve du stock. Tant que la reservation tient, l'article est
 * invendable alors qu'il est physiquement en rayon. Ces tests verrouillent le
 * fait que la reservation finit toujours par tomber, et qu'elle ne tombe QUE
 * pour les bons reellement echus.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function bpInput(over: Record<string, unknown> = {}) {
  return {
    type: 'BON_PREPARATION' as const,
    partnerId: f.client.id,
    depotId: f.depotMain.id,
    paymentMode: 'ESPECE' as const,
    remise: 0,
    lines: [
      {
        articleId: f.articleA.id,
        depotId: f.depotMain.id,
        quantity: 10,
        unitPriceHT: 150,
        discountPercent: 0,
        tvaRate: 19
      }
    ],
    ...over
  };
}

/** Recule la date limite d'un bon pour simuler le temps qui passe. */
async function antidater(documentId: string, joursDansLePasse: number) {
  const date = new Date();
  date.setDate(date.getDate() - joursDansLePasse);
  await prisma.document.update({ where: { id: documentId }, data: { dateValidite: date } });
}

describe('date limite', () => {
  it('un bon de preparation recoit une date limite, calculee sur la duree par defaut', async () => {
    const bp = await createDocument(bpInput() as never);

    expect(bp.dateValidite).not.toBeNull();
    const jours = Math.round((bp.dateValidite!.getTime() - bp.createdAt.getTime()) / 86400000);
    expect(jours).toBe(BP_DUREE_VALIDITE_JOURS_DEFAUT);
  });

  it('la duree est prise dans les parametres quand elle y est', async () => {
    await prisma.appSetting.create({ data: { key: BP_DUREE_VALIDITE_KEY, value: '3' } });

    const bp = await createDocument(bpInput() as never);

    const jours = Math.round((bp.dateValidite!.getTime() - bp.createdAt.getTime()) / 86400000);
    expect(jours).toBe(3);
  });

  it('une duree aberrante retombe sur la valeur par defaut', async () => {
    // Un 0 saisi par erreur ferait expirer chaque bon a la seconde ou il est cree.
    await prisma.appSetting.create({ data: { key: BP_DUREE_VALIDITE_KEY, value: '0' } });

    const bp = await createDocument(bpInput() as never);

    const jours = Math.round((bp.dateValidite!.getTime() - bp.createdAt.getTime()) / 86400000);
    expect(jours).toBe(BP_DUREE_VALIDITE_JOURS_DEFAUT);
  });

  it("les autres documents n'ont pas de date limite", async () => {
    // Une vente ou un achat ne reserve pas de stock dans la duree: rien a liberer.
    const vente = await createDocument(bpInput({ type: 'VENTE' }) as never);
    expect(vente.dateValidite).toBeNull();
  });
});

describe('balayage des bons echus', () => {
  it('libere la reservation et passe le bon en EXPIRE', async () => {
    const bp = await createDocument(bpInput() as never);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(10);

    await antidater(bp.id, 1);
    const liberes = await expireBonsPreparation();

    expect(liberes).toEqual([bp.reference]);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    // Le stock physique n'a jamais bouge — seule la reservation tombe.
    expect(stock.qtyInStock).toBe(100);
    expect(stock.qtyReserved).toBe(0);

    const apres = await prisma.document.findUnique({ where: { id: bp.id } });
    expect(apres!.status).toBe('EXPIRE');
    expect(apres!.expiredAt).not.toBeNull();
  });

  it('laisse tranquille un bon encore valide', async () => {
    const bp = await createDocument(bpInput() as never);

    expect(await expireBonsPreparation()).toEqual([]);

    const apres = await prisma.document.findUnique({ where: { id: bp.id } });
    expect(apres!.status).toBe('OUVERT');
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(10);
  });

  it('ne touche pas a un bon deja valide, meme echu', async () => {
    // La marchandise est partie: il n'y a plus de reservation a liberer, et
    // reduire qtyReserved ici creerait une reservation negative.
    const bp = await createDocument(bpInput() as never);
    await validateDocument(bp.id);
    await antidater(bp.id, 30);

    expect(await expireBonsPreparation()).toEqual([]);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(90);
    expect(stock.qtyReserved).toBe(0);
  });

  it('rejouer le balayage est sans effet', async () => {
    const bp = await createDocument(bpInput() as never);
    await antidater(bp.id, 1);

    await expireBonsPreparation();
    expect(await expireBonsPreparation()).toEqual([]);

    // La reservation ne doit surtout pas etre liberee deux fois.
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(0);
  });

  it('libere plusieurs bons echus sans se laisser arreter', async () => {
    const a = await createDocument(bpInput() as never);
    const b = await createDocument(bpInput() as never);
    await antidater(a.id, 2);
    await antidater(b.id, 2);

    const liberes = await expireBonsPreparation();

    expect(liberes.sort()).toEqual([a.reference, b.reference].sort());
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(0);
  });
});

describe('concurrence LAN', () => {
  it("un poste qui valide pendant le balayage ne libere pas la reservation deux fois", async () => {
    // Scenario reel: le bon vient d'expirer, un caissier clique "Valider" a
    // l'instant ou l'ecran des bons declenche le balayage. Sans verrou de ligne,
    // les deux transactions lisent "OUVERT", agissent toutes les deux, et
    // qtyReserved est decremente deux fois pour une seule reservation.
    const bp = await createDocument(bpInput() as never);
    await antidater(bp.id, 1);

    const [balayage, validation] = await Promise.allSettled([
      expireBonsPreparation(),
      validateDocument(bp.id)
    ]);

    // Peu importe qui gagne — mais un seul des deux doit avoir agi.
    const aExpire = balayage.status === 'fulfilled' && balayage.value.length === 1;
    const aValide = validation.status === 'fulfilled';
    expect(aExpire !== aValide).toBe(true);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    // La reservation est retombee a zero exactement une fois, jamais en negatif.
    expect(stock.qtyReserved).toBe(0);
    // Et le stock physique n'a bouge que si la validation a gagne.
    expect(stock.qtyInStock).toBe(aValide ? 90 : 100);
  });

  it("un bon valide entre le reperage et la liberation n'est pas relache une seconde fois", async () => {
    // Le decalage exact que le balayage doit encaisser: il repere le bon comme
    // echu, puis un poste le valide avant que le balayage n'arrive a le traiter.
    const bp = await createDocument(bpInput() as never);
    await antidater(bp.id, 1);

    const reperes = await scanBonsPreparationEchus();
    expect(reperes).toEqual([bp.id]);

    // Entre les deux: la validation passe (elle a lieu avant l'expiration cote
    // caisse, le bon n'ayant pas encore ete marque EXPIRE).
    await prisma.document.update({ where: { id: bp.id }, data: { dateValidite: null } });
    await validateDocument(bp.id);

    // Le balayage arrive maintenant sur un bon qui n'est plus le sien.
    expect(await libererBonPreparation(reperes[0])).toBeNull();

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(90);
    // Le point critique: pas de -10 ici.
    expect(stock.qtyReserved).toBe(0);
  });

  it('deux validations simultanees ne sortent le stock qu une fois', async () => {
    const bp = await createDocument(bpInput() as never);

    await Promise.allSettled([validateDocument(bp.id), validateDocument(bp.id)]);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(90);
    expect(stock.qtyReserved).toBe(0);
  });
});

describe('validation', () => {
  it('un bon echu ne peut plus etre valide, meme avant le balayage', async () => {
    const bp = await createDocument(bpInput() as never);
    await antidater(bp.id, 1);

    // Le balayage n'est pas encore passe: c'est exactement la fenetre ou un bon
    // perime pourrait sortir du stock si la validation ne verifiait pas la date.
    await expect(validateDocument(bp.id)).rejects.toThrow('DOCUMENT_EXPIRE');

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(100);
  });

  it('un bon deja balaye ne peut plus etre valide', async () => {
    const bp = await createDocument(bpInput() as never);
    await antidater(bp.id, 1);
    await expireBonsPreparation();

    await expect(validateDocument(bp.id)).rejects.toThrow('DOCUMENT_EXPIRE');
  });

  it('un bon encore valide se valide normalement', async () => {
    const bp = await createDocument(bpInput() as never);

    const valide = await validateDocument(bp.id);

    expect(valide.status).toBe('VALIDE');
    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(90);
    expect(stock.qtyReserved).toBe(0);
  });
});
