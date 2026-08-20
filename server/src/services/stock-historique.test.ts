import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import { cancelDocument, createDocument, validateDocument } from './document.service';
import { stockALaDate } from './stock.service';

/**
 * Stock a une date passee.
 *
 * Le proprietaire veut pouvoir demander "qu'est-ce que j'avais en rayon le
 * 12 mars ?". La quantite courante ne le dit pas: il faut defaire les mouvements
 * posterieurs a cette date.
 *
 * Le piege est l'annulation. Un document valide le 10 puis annule le 20 ETAIT
 * en vigueur le 12. Son effet est aujourd'hui neutralise (applique puis
 * contrepasse), donc pour reconstituer le 12 il faut le RAJOUTER. L'oublier
 * ferait apparaitre du stock qui n'existait pas, ou disparaitre du stock qui
 * etait bien la.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function jour(n: number): Date {
  const d = new Date('2026-03-15T12:00:00.000Z');
  d.setDate(d.getDate() + n);
  return d;
}

/** Force les horodatages d'un document, faute de pouvoir voyager dans le temps. */
async function dater(documentId: string, validatedAt: Date | null, cancelledAt: Date | null = null) {
  await prisma.document.update({ where: { id: documentId }, data: { validatedAt, cancelledAt } });
}

async function achat(quantity: number) {
  const doc = await createDocument({
    type: 'ACHAT',
    partnerId: f.supplier.id,
    depotId: f.depotMain.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    lines: [{ articleId: f.articleA.id, depotId: f.depotMain.id, quantity, unitPriceHT: 100, discountPercent: 0, tvaRate: 19 }]
  } as never);
  await validateDocument(doc.id);
  return doc;
}

async function vente(quantity: number) {
  const doc = await createDocument({
    type: 'VENTE',
    partnerId: f.client.id,
    depotId: f.depotMain.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [{ articleId: f.articleA.id, depotId: f.depotMain.id, quantity, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }]
  } as never);
  await validateDocument(doc.id);
  return doc;
}

/** Quantite reconstituee pour articleA au depot principal. */
async function qteALaDate(d: Date) {
  const lignes = await stockALaDate(d);
  const l = lignes.find((x) => x.articleId === f.articleA.id && x.depotId === f.depotMain.id);
  return l?.qtyInStock ?? 0;
}

describe('reconstruction', () => {
  it("aujourd'hui, la reconstruction egale le stock reel", async () => {
    await achat(50);
    await vente(20);

    const reel = (await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock;
    expect(await qteALaDate(new Date())).toBe(reel);
  });

  it('defait une entree posterieure a la date demandee', async () => {
    // Stock initial 100. Achat de 50 le jour 10.
    const a = await achat(50);
    await dater(a.id, jour(10));

    expect(await qteALaDate(jour(5))).toBe(100); // avant l'achat
    expect(await qteALaDate(jour(15))).toBe(150); // apres l'achat
  });

  it('defait une sortie posterieure a la date demandee', async () => {
    const v = await vente(30);
    await dater(v.id, jour(10));

    expect(await qteALaDate(jour(5))).toBe(100);
    expect(await qteALaDate(jour(15))).toBe(70);
  });

  it('reconstitue une suite de mouvements dans le bon ordre', async () => {
    const a1 = await achat(50);
    await dater(a1.id, jour(1));
    const v1 = await vente(30);
    await dater(v1.id, jour(5));
    const a2 = await achat(20);
    await dater(a2.id, jour(9));

    expect(await qteALaDate(jour(0))).toBe(100);
    expect(await qteALaDate(jour(2))).toBe(150);
    expect(await qteALaDate(jour(6))).toBe(120);
    expect(await qteALaDate(jour(10))).toBe(140);
  });
});

describe('documents annules', () => {
  it("un document valide avant la date et annule apres etait bien en vigueur ce jour-la", async () => {
    // Valide le jour 5, annule le jour 20. Le jour 10, la marchandise etait la.
    const a = await achat(50);
    await dater(a.id, jour(5));
    await cancelDocument(a.id);
    await dater(a.id, jour(5), jour(20));

    expect(await qteALaDate(jour(10))).toBe(150);
  });

  it('le meme document ne compte plus apres son annulation', async () => {
    const a = await achat(50);
    await dater(a.id, jour(5));
    await cancelDocument(a.id);
    await dater(a.id, jour(5), jour(20));

    expect(await qteALaDate(jour(25))).toBe(100);
  });

  it("un document annule avant la date demandee n'a aucun effet", async () => {
    const a = await achat(50);
    await dater(a.id, jour(1));
    await cancelDocument(a.id);
    await dater(a.id, jour(1), jour(2));

    expect(await qteALaDate(jour(10))).toBe(100);
  });
});

describe('cas particuliers', () => {
  it('les UG comptent dans la reconstruction', async () => {
    const doc = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [
        {
          articleId: f.articleA.id,
          depotId: f.depotMain.id,
          quantity: 10,
          quantiteBonus: 5,
          unitPriceHT: 100,
          discountPercent: 0,
          tvaRate: 19
        }
      ]
    } as never);
    await validateDocument(doc.id);
    await dater(doc.id, jour(10));

    expect(await qteALaDate(jour(5))).toBe(100);
    expect(await qteALaDate(jour(15))).toBe(115);
  });

  it('un transfert deplace la quantite entre les deux depots a la date', async () => {
    const doc = await createDocument({
      type: 'TRANSFERT',
      depotId: f.depotMain.id,
      destDepotId: f.depotShop.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [{ articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 40, unitPriceHT: 0, discountPercent: 0, tvaRate: 0 }]
    } as never);
    await validateDocument(doc.id);
    await dater(doc.id, jour(10));

    const avant = await stockALaDate(jour(5));
    const apres = await stockALaDate(jour(15));
    const trouver = (l: typeof avant, depotId: string) =>
      l.find((x) => x.articleId === f.articleA.id && x.depotId === depotId)?.qtyInStock ?? 0;

    expect(trouver(avant, f.depotMain.id)).toBe(100);
    expect(trouver(avant, f.depotShop.id)).toBe(50);
    expect(trouver(apres, f.depotMain.id)).toBe(60);
    expect(trouver(apres, f.depotShop.id)).toBe(90);
  });

  it("un brouillon jamais valide n'a jamais compte", async () => {
    // Il reserve du stock mais n'en sort pas: la quantite physique est
    // inchangee, hier comme aujourd'hui.
    await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [{ articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 30, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }]
    } as never);

    expect(await qteALaDate(jour(-30))).toBe(100);
    expect(await qteALaDate(new Date())).toBe(100);
  });

  it('une date anterieure a toute activite rend le stock de depart', async () => {
    const a = await achat(50);
    await dater(a.id, jour(1));
    expect(await qteALaDate(jour(-365))).toBe(100);
  });
});

describe('article cree puis achete', () => {
  it('un article neuf peut etre receptionne en stock', async () => {
    // Un article cree depuis Fichier > Articles n'a aucune ligne de stock.
    // S'il faut une ligne preexistante pour recevoir la marchandise, un article
    // neuf est inutilisable: on peut le creer et jamais le rentrer.
    const neuf = await prisma.article.create({
      data: { code: 'NEUF-001', designation: 'Article sans stock initial', pump: 0, tvaRate: 19 }
    });

    const doc = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [{ articleId: neuf.id, depotId: f.depotMain.id, quantity: 25, unitPriceHT: 80, discountPercent: 0, tvaRate: 19 }]
    } as never);

    await expect(validateDocument(doc.id)).resolves.toBeTruthy();
    expect((await stockOf(neuf.id, f.depotMain.id)).qtyInStock).toBe(25);
  });
});
