import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { balanceOf, pumpOf, resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import { cancelDocument, createDocument, validateDocument } from './document.service';

/**
 * Lignes de vente au modele du logiciel actuel: colisage, bonus, ristourne.
 *
 * Le fil conducteur de ces tests est une seule distinction, celle qui fait tout
 * le danger du module: `quantity` est ce que le client PAIE, la quantite
 * sortante est ce qui QUITTE l'entrepot. Les confondre fait soit disparaitre la
 * marchandise offerte des stocks, soit la facturer au client.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function venteInput(ligne: Record<string, unknown> = {}, doc: Record<string, unknown> = {}) {
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
        quantity: 10,
        unitPriceHT: 150,
        discountPercent: 0,
        tvaRate: 19,
        ...ligne
      }
    ],
    ...doc
  };
}

describe('bonus', () => {
  it('la marchandise offerte sort du stock sans etre facturee', async () => {
    const vente = await createDocument(venteInput({ quantity: 10, quantiteBonus: 2 }) as never);

    // 12 unites sont reservees des le brouillon: le bonus est promis lui aussi.
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(12);
    // Mais le client ne paie que 10 x 150.
    expect(Number(vente.totalHT)).toBeCloseTo(1500, 6);

    await validateDocument(vente.id);

    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(88); // 100 - 12
    expect(stock.qtyReserved).toBe(0);
  });

  it('le solde client ne porte que sur ce qui est facture', async () => {
    const vente = await createDocument(venteInput({ quantity: 10, quantiteBonus: 5 }) as never);
    await validateDocument(vente.id);

    // 1500 HT + 19 % = 1785. Le bonus n'ajoute pas un dinar a la dette.
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
  });

  it('une ligne entierement bonus est acceptee et sort quand meme du stock', async () => {
    const vente = await createDocument(venteInput({ quantity: 0, quantiteBonus: 3 }) as never);
    await validateDocument(vente.id);

    expect(Number(vente.totalHT)).toBe(0);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(97);
  });

  it('une ligne sans quantite ni bonus est refusee a la saisie', async () => {
    const { createDocumentSchema } = await import('../../../shared/src');
    const parsed = createDocumentSchema.safeParse(venteInput({ quantity: 0, quantiteBonus: 0 }));
    expect(parsed.success).toBe(false);
  });

  it('le stock disponible est controle sur la quantite sortante, bonus compris', async () => {
    // 95 payes + 10 offerts = 105 demandes pour 100 en stock. Si le controle ne
    // portait que sur les 95 factures, on promettrait une marchandise absente.
    await expect(createDocument(venteInput({ quantity: 95, quantiteBonus: 10 }) as never)).rejects.toThrow(
      'INSUFFICIENT_STOCK'
    );
  });

  it("l'annulation rend le bonus au stock, pas seulement la partie facturee", async () => {
    const vente = await createDocument(venteInput({ quantity: 10, quantiteBonus: 2 }) as never);
    await validateDocument(vente.id);
    await cancelDocument(vente.id);

    // Rendre 10 au lieu de 12 ferait fondre le stock de 2 unites a chaque
    // aller-retour, sans la moindre trace.
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(100);
    expect(await balanceOf(f.client.id)).toBeCloseTo(0, 6);
  });

  it('le contingentement compte le bonus', async () => {
    // Sinon un client contourne le plafond en se faisant "offrir" le reste.
    await prisma.article.update({ where: { id: f.articleA.id }, data: { maxQtyPerClient: 10 } });

    await expect(createDocument(venteInput({ quantity: 8, quantiteBonus: 5 }) as never)).rejects.toThrow(
      /RATIONED_ARTICLE/
    );
    await expect(createDocument(venteInput({ quantity: 8, quantiteBonus: 2 }) as never)).resolves.toBeTruthy();
  });
});

describe('bonus fournisseur (achat)', () => {
  it('le bonus recu entre en stock et fait baisser le P.U.M.P', async () => {
    // Stock initial: 100 a 100 de P.U.M.P. On achete 10 payes 200 + 2 offerts.
    const achat = await createDocument({
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
          quantiteBonus: 2,
          unitPriceHT: 200,
          discountPercent: 0,
          tvaRate: 19
        }
      ]
    } as never);

    await validateDocument(achat.id);

    // 112 unites en stock: les 2 offertes existent physiquement.
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(112);

    // Valeur: 100x100 + 10x200 = 12 000, repartie sur 112 unites.
    const attendu = (100 * 100 + 10 * 200) / 112;
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(attendu, 6);

    // Et ce P.U.M.P est bien inferieur a celui qu'on aurait sans le bonus:
    // c'est tout l'interet commercial de l'operation.
    expect(await pumpOf(f.articleA.id)).toBeLessThan((100 * 100 + 10 * 200) / 110);
  });

  it("l'annulation d'un achat avec bonus restitue le stock et le P.U.M.P d'origine", async () => {
    const achat = await createDocument({
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
          quantiteBonus: 2,
          unitPriceHT: 200,
          discountPercent: 0,
          tvaRate: 19
        }
      ]
    } as never);

    await validateDocument(achat.id);
    await cancelDocument(achat.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(100);
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
  });
});

describe('colisage', () => {
  it('la quantite est deduite du colisage de l’article, pas de la saisie', async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { colisage: 12 } });

    const vente = await createDocument(
      venteInput({ emballage: 'COLISAGE', nbColis: 3, quantity: 999 }) as never
    );

    // 3 colis x 12 = 36, et surtout PAS les 999 envoyes par le poste client.
    expect(vente.lines[0].quantity).toBe(36);
    expect(Number(vente.totalHT)).toBeCloseTo(36 * 150, 6);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(36);
  });

  it('un article sans colisage compte un colis pour une unite', async () => {
    // Le colisage de l'article de test est nul: sans repli, la vente sortirait
    // zero unite du stock tout en etant facturee.
    const vente = await createDocument(venteInput({ emballage: 'COLISAGE', nbColis: 4 }) as never);
    expect(vente.lines[0].quantity).toBe(4);
  });

  it('le numero de colis est conserve pour le suivi physique', async () => {
    const vente = await createDocument(venteInput({ numeroColis: 'COL-2026-114' }) as never);
    expect(vente.lines[0].numeroColis).toBe('COL-2026-114');
  });

  it('en vrac la quantite saisie fait foi', async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { colisage: 12 } });
    const vente = await createDocument(venteInput({ emballage: 'VRAC', quantity: 7 }) as never);
    expect(vente.lines[0].quantity).toBe(7);
  });
});

describe('ristourne', () => {
  it('se retranche du montant de la ligne apres la remise', async () => {
    const vente = await createDocument(
      venteInput({ quantity: 10, unitPriceHT: 100, discountPercent: 10, ristourne: 50, tvaRate: 0 }) as never
    );

    // 10 x 100 = 1000 → -10 % = 900 → -50 = 850
    expect(Number(vente.totalHT)).toBeCloseTo(850, 6);
  });

  it('ne peut pas rendre une ligne negative', async () => {
    const vente = await createDocument(
      venteInput({ quantity: 1, unitPriceHT: 100, ristourne: 5000, tvaRate: 19 }) as never
    );
    expect(Number(vente.totalHT)).toBe(0);
    expect(Number(vente.totalTTC)).toBe(0);
  });
});

describe('retro-compatibilite', () => {
  it('une ligne sans les nouveaux champs se comporte exactement comme avant', async () => {
    const vente = await createDocument(venteInput({ quantity: 10 }) as never);
    await validateDocument(vente.id);

    expect(Number(vente.totalHT)).toBeCloseTo(1500, 6);
    const stock = await stockOf(f.articleA.id, f.depotMain.id);
    expect(stock.qtyInStock).toBe(90);
    expect(stock.qtyReserved).toBe(0);

    const ligne = vente.lines[0];
    expect(ligne.emballage).toBe('VRAC');
    expect(ligne.quantiteBonus).toBe(0);
    expect(Number(ligne.ristourne)).toBe(0);
  });
});
