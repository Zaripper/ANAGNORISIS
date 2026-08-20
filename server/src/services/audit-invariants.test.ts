import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { balanceOf, resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import {
  cancelDocument,
  createDocument,
  factureFromBonLivraison,
  receiveCommande,
  validateDocument
} from './document.service';

/**
 * Invariants de bout en bout.
 *
 * Ces tests ne couvrent pas une fonctionnalite mais une PROPRIETE qui doit
 * tenir sur tous les chemins: le total et sa ventilation en lots disent la meme
 * chose, aucune reservation ne fuit, et un document derive n'invente ni ne perd
 * de quantite. Ce sont precisement les endroits ou une suite organisee par
 * fonctionnalite ne regarde jamais.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
  await prisma.article.update({ where: { id: f.articleA.id }, data: { suiviLot: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function dansNJours(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function creerLot(numeroLot: string, qty: number, depotId = f.depotMain.id) {
  return prisma.lot.create({
    data: { articleId: f.articleA.id, depotId, numeroLot, datePeremption: dansNJours(200), qtyInStock: qty }
  });
}

/** Somme des lots d'un depot, a comparer au total ArticleStock du meme depot. */
async function lotsDuDepot(depotId: string) {
  const lots = await prisma.lot.findMany({ where: { articleId: f.articleA.id, depotId } });
  return {
    inStock: lots.reduce((s, l) => s + l.qtyInStock, 0),
    reserved: lots.reduce((s, l) => s + l.qtyReserved, 0)
  };
}

describe('transfert inter-depots', () => {
  it('la marchandise transferee suit ses lots jusqu au depot de destination', async () => {
    // Un transfert deplace du stock entre depots. Si les lots ne suivent pas,
    // le depot source affirme avoir vendu la marchandise tandis que ses lots la
    // montrent toujours presente: le total et sa ventilation divergent, et plus
    // personne ne sait ce qu'il y a en rayon.
    await creerLot('L1', 100);

    const transfert = await createDocument({
      type: 'TRANSFERT',
      depotId: f.depotMain.id,
      destDepotId: f.depotShop.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 30, unitPriceHT: 0, discountPercent: 0, tvaRate: 0 }
      ]
    } as never);

    await validateDocument(transfert.id);

    const stockSource = await stockOf(f.articleA.id, f.depotMain.id);
    const lotsSource = await lotsDuDepot(f.depotMain.id);
    const stockDest = await stockOf(f.articleA.id, f.depotShop.id);
    const lotsDest = await lotsDuDepot(f.depotShop.id);

    // Source: 100 - 30, et aucune reservation residuelle.
    expect(lotsSource.inStock).toBe(stockSource.qtyInStock);
    expect(lotsSource.reserved).toBe(0);
    // Destination: la marchandise arrive, et elle arrive DANS UN LOT.
    expect(lotsDest.inStock).toBe(30);
    expect(stockDest.qtyInStock).toBe(80); // 50 initial + 30
  });

  it("l'annulation d'un transfert ramene les lots au depot d'origine", async () => {
    await creerLot('L1', 100);

    const transfert = await createDocument({
      type: 'TRANSFERT',
      depotId: f.depotMain.id,
      destDepotId: f.depotShop.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 30, unitPriceHT: 0, discountPercent: 0, tvaRate: 0 }
      ]
    } as never);
    await validateDocument(transfert.id);
    await cancelDocument(transfert.id);

    expect((await lotsDuDepot(f.depotMain.id)).inStock).toBe(100);
    expect((await lotsDuDepot(f.depotShop.id)).inStock).toBe(0);
  });
});

describe('reception de commande', () => {
  it('une commande portant un article suivi par lot peut etre receptionnee', async () => {
    // La commande n'exige pas de lot (rien n'est encore entre), mais la
    // reception genere un ACHAT qui, lui, l'exige. Sans reprise du lot saisi a
    // la reception, un article suivi devient impossible a recevoir: on peut le
    // commander et jamais le rentrer.
    const commande = await createDocument({
      type: 'COMMANDE',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [
        {
          articleId: f.articleA.id,
          depotId: f.depotMain.id,
          quantity: 20,
          unitPriceHT: 100,
          discountPercent: 0,
          tvaRate: 19,
          numeroLot: 'CMD-LOT-1',
          datePeremption: dansNJours(300).toISOString()
        }
      ]
    } as never);

    await expect(receiveCommande(commande.id)).resolves.toBeTruthy();

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(120);
    expect((await lotsDuDepot(f.depotMain.id)).inStock).toBe(20);
  });
});

describe('facture emise depuis un bon de livraison', () => {
  it('reprend les UG et la ristourne, sinon ses lignes ne totalisent pas son propre total', async () => {
    // La facture recopie les totaux du BL. Si ses lignes perdent les UG et la
    // ristourne, le document imprime affiche des lignes qui ne font pas la
    // somme annoncee en pied de page — un client le verra avant nous.
    await creerLot('L1', 100);

    const bl = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [
        {
          articleId: f.articleA.id,
          depotId: f.depotMain.id,
          quantity: 10,
          unitPriceHT: 150,
          discountPercent: 0,
          tvaRate: 19,
          quantiteBonus: 2,
          ristourne: 100
        }
      ]
    } as never);
    await validateDocument(bl.id);

    const facture = await factureFromBonLivraison(bl.id);
    const ligne = facture.lines[0];

    expect(ligne.quantiteBonus).toBe(2);
    expect(Number(ligne.ristourne)).toBeCloseTo(100, 6);
    // Et la ligne recalculee doit bien redonner le total du document.
    expect(Number(ligne.totalHT)).toBeCloseTo(Number(facture.totalHT), 6);
  });

  it('ne bouge ni le stock ni le solde une seconde fois', async () => {
    await creerLot('L1', 100);

    const bl = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 10, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }
      ]
    } as never);
    await validateDocument(bl.id);

    const stockApresBL = await stockOf(f.articleA.id, f.depotMain.id);
    const soldeApresBL = await balanceOf(f.client.id);
    const lotsApresBL = await lotsDuDepot(f.depotMain.id);

    await factureFromBonLivraison(bl.id);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual(stockApresBL);
    expect(await balanceOf(f.client.id)).toBeCloseTo(soldeApresBL, 6);
    expect(await lotsDuDepot(f.depotMain.id)).toEqual(lotsApresBL);
  });
});

describe('regularisation sur un article suivi par lot', () => {
  it('une entree de regularisation accepte un lot', async () => {
    // Rentrer du stock sur un article suivi doit rester possible: sinon un
    // ecart d'inventaire positif est impossible a corriger.
    const regule = await createDocument({
      type: 'REGULE_PLUS',
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      typeReguleId: f.typeRegule.id,
      lines: [
        {
          articleId: f.articleA.id,
          depotId: f.depotMain.id,
          quantity: 5,
          unitPriceHT: 100,
          discountPercent: 0,
          tvaRate: 0,
          numeroLot: 'REG-1',
          datePeremption: dansNJours(150).toISOString()
        }
      ]
    } as never);

    await validateDocument(regule.id);

    expect((await lotsDuDepot(f.depotMain.id)).inStock).toBe(5);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(105);
  });

  it('une sortie de regularisation puise dans les lots', async () => {
    await creerLot('L1', 100);

    const regule = await createDocument({
      type: 'REGULE_MOINS',
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      typeReguleId: f.typeRegule.id,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 8, unitPriceHT: 100, discountPercent: 0, tvaRate: 0 }
      ]
    } as never);
    await validateDocument(regule.id);

    const lots = await lotsDuDepot(f.depotMain.id);
    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(lots.inStock).toBe(92);
    expect(lots.reserved).toBe(0);
    expect(stock.qtyInStock).toBe(92);
  });
});
