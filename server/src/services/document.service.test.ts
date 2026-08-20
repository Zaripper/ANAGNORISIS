import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { balanceOf, pumpOf, resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import {
  cancelDocument,
  createDocument,
  deleteDraftDocument,
  factureFromBonLivraison,
  receiveCommande,
  updateDraftDocument,
  validateDocument
} from './document.service';

/**
 * Integration tests for the document lifecycle, running against a real Postgres
 * schema (erp_test). These cover the code paths that move money and stock —
 * everything the shared unit tests cannot reach because it depends on
 * transactions, row updates and the reservation state machine.
 *
 * Each test starts from a freshly seeded database so expectations are absolute.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Convenience: a single-line document input using fixture defaults. */
function lineOf(articleId: string, depotId: string, quantity: number, unitPriceHT: number, tvaRate = 19) {
  return { articleId, depotId, quantity, unitPriceHT, discountPercent: 0, tvaRate };
}

// ---------------------------------------------------------------------------
// Drafts and reservations
// ---------------------------------------------------------------------------
describe('draft creation and reservations', () => {
  it('a sales draft reserves stock without touching physical quantity', async () => {
    await createDocument({
      type: 'BON_PREPARATION',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 10 });
    // The client owes nothing until the document is validated.
    expect(await balanceOf(f.client.id)).toBe(0);
  });

  it('a purchase draft reserves nothing — there is no overselling risk on the way in', async () => {
    await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 25, 90)]
    } as never);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
  });

  it('refuses to reserve more than the available quantity', async () => {
    await expect(
      createDocument({
        type: 'BON_PREPARATION',
        partnerId: f.client.id,
        depotId: f.depotMain.id,
        paymentMode: 'CHEQUE',
        remise: 0,
        lines: [lineOf(f.articleA.id, f.depotMain.id, 101, 150)]
      } as never)
    ).rejects.toThrow('INSUFFICIENT_STOCK');

    // The failed transaction must leave no trace.
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
    expect(await prisma.document.count()).toBe(0);
  });

  it('counts existing reservations when checking availability', async () => {
    const draft = {
      type: 'BON_PREPARATION' as const,
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE' as const,
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 60, 150)]
    };
    await createDocument(draft as never);
    // 60 already reserved: a second 60 must fail even though qtyInStock is 100.
    await expect(createDocument(draft as never)).rejects.toThrow('INSUFFICIENT_STOCK');
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(60);
  });

  it('deleting a draft releases its reservation', async () => {
    const doc = await createDocument({
      type: 'BON_PREPARATION',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 30, 150)]
    } as never);

    await deleteDraftDocument(doc.id);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
    expect(await prisma.document.count()).toBe(0);
  });

  it('editing a draft re-reserves from scratch rather than accumulating', async () => {
    const doc = await createDocument({
      type: 'BON_PREPARATION',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 30, 150)]
    } as never);

    await updateDraftDocument(doc.id, {
      type: 'BON_PREPARATION',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 12, 150)]
    } as never);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(12);
  });

  it('refuses to edit a document that is already validated', async () => {
    const doc = await createDocument({
      type: 'BON_PREPARATION',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 5, 150)]
    } as never);
    await validateDocument(doc.id);

    await expect(
      updateDraftDocument(doc.id, {
        type: 'BON_PREPARATION',
        partnerId: f.client.id,
        depotId: f.depotMain.id,
        paymentMode: 'CHEQUE',
        remise: 0,
        lines: [lineOf(f.articleA.id, f.depotMain.id, 6, 150)]
      } as never)
    ).rejects.toThrow('DOCUMENT_NOT_EDITABLE');
  });
});

// ---------------------------------------------------------------------------
// Validation: stock, ledger and cash effects
// ---------------------------------------------------------------------------
describe('validation of a sale', () => {
  it('consumes the reservation exactly once and charges the client', async () => {
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    const validated = await validateDocument(doc.id, f.user.id);

    // 10 units left stock; the reservation is gone (not double-counted).
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 90, qtyReserved: 0 });
    // HT 1500, TVA 285, no timbre on a cheque → 1785 owed.
    expect(Number(validated.totalTTC)).toBeCloseTo(1785, 6);
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
    // Margin uses the P.U.M.P snapshot: 1500 − 10×100.
    expect(Number(validated.marginHT)).toBeCloseTo(500, 6);
    expect(validated.createdById).toBe(f.user.id);
  });

  it('creates a cash entry and charges the timbre when paid in cash', async () => {
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    const validated = await validateDocument(doc.id);

    // Pre-stamp TTC 1785 → timbre 17.85 → 1802.85.
    expect(Number(validated.stampDuty)).toBeCloseTo(17.85, 6);
    expect(Number(validated.totalTTC)).toBeCloseTo(1802.85, 6);

    const cash = await prisma.cashTransaction.findMany({ where: { documentId: doc.id } });
    expect(cash).toHaveLength(1);
    expect(cash[0].type).toBe('RECETTE');
    expect(Number(cash[0].amount)).toBeCloseTo(1802.85, 6);
  });

  it('applies the 2 % timbre bracket on a large cash sale', async () => {
    await prisma.articleStock.update({
      where: { articleId_depotId: { articleId: f.articleB.id, depotId: f.depotMain.id } },
      data: { qtyInStock: 5000 }
    });
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleB.id, f.depotMain.id, 2000, 200, 0)]
    } as never);

    const validated = await validateDocument(doc.id);
    // 400 000 TTC → tranche « au-delà de 100 000 » → 2 % = 8 000. Aucun plafond.
    expect(Number(validated.stampDuty)).toBe(8000);
    expect(Number(validated.totalTTC)).toBeCloseTo(408000, 6);
  });

  it('applies the 1,5 % bracket between 30 000 and 100 000 DZD', async () => {
    await prisma.articleStock.update({
      where: { articleId_depotId: { articleId: f.articleB.id, depotId: f.depotMain.id } },
      data: { qtyInStock: 5000 }
    });
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleB.id, f.depotMain.id, 250, 200, 0)]
    } as never);

    const validated = await validateDocument(doc.id);
    // 50 000 TTC → 1,5 % = 750.
    expect(Number(validated.stampDuty)).toBe(750);
    expect(Number(validated.totalTTC)).toBeCloseTo(50750, 6);
  });

  it('is idempotent — validating twice does not move stock again', async () => {
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    await validateDocument(doc.id);
    await validateDocument(doc.id);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 90, qtyReserved: 0 });
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
  });
});

describe('validation of a purchase', () => {
  it('adds stock and re-bases the weighted average cost', async () => {
    // Start: 100 units @ PUMP 100 (main) + 50 (shop). Buy 100 @ 200 into main.
    const doc = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 100, 200)]
    } as never);

    await validateDocument(doc.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(200);
    // PUMP is computed against the DEPOT's quantity: (100×100 + 100×200)/200 = 150.
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(150, 6);
    // We owe the supplier the full TTC.
    expect(await balanceOf(f.supplier.id)).toBeCloseTo(100 * 200 * 1.19, 6);
  });

  it('books a cash outflow when the purchase is paid in cash', async () => {
    const doc = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleB.id, f.depotMain.id, 10, 180, 0)]
    } as never);

    await validateDocument(doc.id);

    const cash = await prisma.cashTransaction.findMany({ where: { documentId: doc.id } });
    expect(cash).toHaveLength(1);
    expect(cash[0].type).toBe('DEPENSE');
  });

  it('a client return adds stock back WITHOUT disturbing the cost basis', async () => {
    const doc = await createDocument({
      type: 'RETOUR_CLIENT',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    await validateDocument(doc.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(110);
    // Critical: a return is not a purchase — PUMP must stay at 100.
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
    // An avoir reduces what the client owes.
    expect(await balanceOf(f.client.id)).toBeCloseTo(-1785, 6);
  });

  it('a stock-count correction (régule plus) leaves the cost basis untouched', async () => {
    const doc = await createDocument({
      type: 'REGULE_PLUS',
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      // Une regularisation doit desormais porter un motif choisi dans la table
      // de reference: c'est ce qui rend un etat des pertes exploitable.
      typeReguleId: f.typeRegule.id,
      motif: 'Inventaire',
      lines: [lineOf(f.articleA.id, f.depotMain.id, 5, 100, 0)]
    } as never);

    await validateDocument(doc.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(105);
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
    // Internal movement: no partner ledger, no cash entry even though mode is ESPECE.
    expect(await prisma.cashTransaction.count()).toBe(0);
  });
});

describe('transfers', () => {
  it('moves stock between depots and nets to zero globally', async () => {
    const doc = await createDocument({
      type: 'TRANSFERT',
      depotId: f.depotMain.id,
      destDepotId: f.depotShop.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 20, 100, 0)]
    } as never);

    // Reserved at the source only, until validation.
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 20 });
    expect(await stockOf(f.articleA.id, f.depotShop.id)).toEqual({ qtyInStock: 50, qtyReserved: 0 });

    await validateDocument(doc.id);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 80, qtyReserved: 0 });
    expect(await stockOf(f.articleA.id, f.depotShop.id)).toEqual({ qtyInStock: 70, qtyReserved: 0 });
    // Goods never left the company: cost basis and ledgers untouched.
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
    expect(await prisma.cashTransaction.count()).toBe(0);
  });

  it('creates the destination stock row when the article was never held there', async () => {
    const doc = await createDocument({
      type: 'TRANSFERT',
      depotId: f.depotMain.id,
      destDepotId: f.depotShop.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleB.id, f.depotMain.id, 15, 200, 0)]
    } as never);

    await validateDocument(doc.id);

    // Article B had no row in the shop depot before this transfer.
    expect(await stockOf(f.articleB.id, f.depotShop.id)).toEqual({ qtyInStock: 15, qtyReserved: 0 });
    expect((await stockOf(f.articleB.id, f.depotMain.id)).qtyInStock).toBe(25);
  });
});

describe('proforma', () => {
  it('has no stock, ledger or cash effect at all', async () => {
    const doc = await createDocument({
      type: 'PROFORMA',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);

    await validateDocument(doc.id);

    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
    expect(await balanceOf(f.client.id)).toBe(0);
    expect(await prisma.cashTransaction.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------
describe('cancellation', () => {
  it('reverses a validated sale: stock back, balance back, compensating cash entry', async () => {
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);
    await validateDocument(doc.id);

    const cancelled = await cancelDocument(doc.id);

    expect(cancelled.status).toBe('ANNULE');
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(100);
    expect(await balanceOf(f.client.id)).toBeCloseTo(0, 6);

    const cash = await prisma.cashTransaction.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: 'asc' } });
    expect(cash.map((c) => c.type)).toEqual(['RECETTE', 'DEPENSE']);
  });

  it('reverses a purchase and restores the previous cost basis', async () => {
    const doc = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 100, 200)]
    } as never);
    await validateDocument(doc.id);
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(150, 6);

    await cancelDocument(doc.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(100);
    // (200×150 − 100×200) / 100 = 100 — back to the original weighted average.
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
    expect(await balanceOf(f.supplier.id)).toBeCloseTo(0, 6);
  });

  it('refuses to cancel a document that was never validated', async () => {
    const doc = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 1, 150)]
    } as never);

    await expect(cancelDocument(doc.id)).rejects.toThrow('ONLY_VALIDATED_DOCUMENTS_CAN_BE_CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
describe('commande → réception', () => {
  it('has no effect until received, then generates a validated purchase', async () => {
    const commande = await createDocument({
      type: 'COMMANDE',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 50, 100)]
    } as never);

    // A purchase order is a promise, not a movement.
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
    expect(await balanceOf(f.supplier.id)).toBe(0);

    const { achat, commande: updated } = await receiveCommande(commande.id, f.user.id);

    expect(updated.status).toBe('VALIDE');
    expect(achat.type).toBe('ACHAT');
    expect(achat.status).toBe('VALIDE');
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(150);
    // Received at exactly the current PUMP → the average must not drift.
    expect(await pumpOf(f.articleA.id)).toBeCloseTo(100, 6);
    expect(updated.motif).toContain(achat.reference);
  });

  it('cannot be received twice', async () => {
    const commande = await createDocument({
      type: 'COMMANDE',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 100)]
    } as never);

    await receiveCommande(commande.id);
    await expect(receiveCommande(commande.id)).rejects.toThrow('COMMANDE_ALREADY_RECEIVED_OR_CANCELLED');

    // Only one purchase was generated.
    expect(await prisma.document.count({ where: { type: 'ACHAT' } })).toBe(1);
  });

  it('rejects receiving a document that is not a commande', async () => {
    const vente = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 1, 150)]
    } as never);

    await expect(receiveCommande(vente.id)).rejects.toThrow('NOT_A_COMMANDE');
  });
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------
describe('document references', () => {
  it('are sequential per type and year, and unique', async () => {
    const mk = (type: 'VENTE' | 'ACHAT') =>
      createDocument({
        type,
        partnerId: type === 'ACHAT' ? f.supplier.id : f.client.id,
        depotId: f.depotMain.id,
        paymentMode: 'CHEQUE',
        remise: 0,
        lines: [lineOf(f.articleA.id, f.depotMain.id, 1, 150)]
      } as never);

    const v1 = await mk('VENTE');
    const v2 = await mk('VENTE');
    const a1 = await mk('ACHAT');

    const year = new Date().getFullYear();
    expect(v1.reference).toBe(`${year}VT000001`);
    expect(v2.reference).toBe(`${year}VT000002`);
    // Sequences are independent per type.
    expect(a1.reference).toBe(`${year}AC000001`);
  });

  it('assigns distinct references to concurrent writers', async () => {
    // The advisory lock in nextReference must serialise these.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createDocument({
          type: 'VENTE',
          partnerId: f.client.id,
          depotId: f.depotMain.id,
          paymentMode: 'CHEQUE',
          remise: 0,
          lines: [lineOf(f.articleA.id, f.depotMain.id, 1, 150)]
        } as never)
      )
    );

    const refs = results.map((r) => r.reference);
    expect(new Set(refs).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Bon de livraison → facture
// ---------------------------------------------------------------------------
describe('bon de livraison et sa facture', () => {
  async function deliveredBL() {
    const bl = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 10, 150)]
    } as never);
    return validateDocument(bl.id, f.user.id);
  }

  it('le bon de livraison sort le stock et debite le compte client', async () => {
    const bl = await deliveredBL();

    expect(bl.reference).toMatch(/BL\d{6}$/);
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 90, qtyReserved: 0 });
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
  });

  it("la facture emise depuis un BL ne rededuit ni le stock ni le solde", async () => {
    const bl = await deliveredBL();
    const facture = await factureFromBonLivraison(bl.id, f.user.id);

    expect(facture.type).toBe('FACTURE');
    expect(facture.status).toBe('VALIDE');
    expect(facture.sourceDocumentId).toBe(bl.id);
    // Les montants sont repris a l'identique...
    expect(Number(facture.totalTTC)).toBeCloseTo(Number(bl.totalTTC), 6);
    // ...mais rien n'est reimpute: c'est tout l'enjeu de la relation BL -> facture.
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 90, qtyReserved: 0 });
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
  });

  it('revalider la facture issue du BL reste sans effet', async () => {
    const bl = await deliveredBL();
    const facture = await factureFromBonLivraison(bl.id);

    await validateDocument(facture.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(90);
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);
  });

  it('un bon de livraison ne peut etre facture deux fois', async () => {
    const bl = await deliveredBL();
    await factureFromBonLivraison(bl.id);

    await expect(factureFromBonLivraison(bl.id)).rejects.toThrow('BON_LIVRAISON_ALREADY_INVOICED');
    expect(await prisma.document.count({ where: { type: 'FACTURE' } })).toBe(1);
  });

  it('refuse de facturer un bon de livraison non valide', async () => {
    const bl = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 5, 150)]
    } as never);

    await expect(factureFromBonLivraison(bl.id)).rejects.toThrow('BON_LIVRAISON_NOT_VALIDATED');
  });

  it("refuse de facturer un document qui n'est pas un bon de livraison", async () => {
    const vente = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 1, 150)]
    } as never);

    await expect(factureFromBonLivraison(vente.id)).rejects.toThrow('NOT_A_BON_LIVRAISON');
  });

  it("annuler la facture ne contrepasse rien: c'est le BL qui porte les effets", async () => {
    const bl = await deliveredBL();
    const facture = await factureFromBonLivraison(bl.id);

    const cancelled = await cancelDocument(facture.id);

    expect(cancelled.status).toBe('ANNULE');
    // Stock et solde restent ceux imputes par le BL: aucune contrepassation en double.
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(90);
    expect(await balanceOf(f.client.id)).toBeCloseTo(1785, 6);

    // C'est l'annulation du BL lui-meme qui restitue le stock et le solde.
    await cancelDocument(bl.id);
    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(100);
    expect(await balanceOf(f.client.id)).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// Contingentement des produits rares
// ---------------------------------------------------------------------------
describe('contingentement (produits rares)', () => {
  it('refuse une quantite superieure au maximum autorise par client', async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { maxQtyPerClient: 3 } });

    await expect(
      createDocument({
        type: 'BON_LIVRAISON',
        partnerId: f.client.id,
        depotId: f.depotMain.id,
        paymentMode: 'CHEQUE',
        remise: 0,
        lines: [lineOf(f.articleA.id, f.depotMain.id, 4, 150)]
      } as never)
    ).rejects.toThrow(/RATIONED_ARTICLE:ART-A:3/);

    // La tentative refusee ne doit rien avoir reserve.
    expect(await stockOf(f.articleA.id, f.depotMain.id)).toEqual({ qtyInStock: 100, qtyReserved: 0 });
  });

  it('additionne les lignes du meme article avant de comparer au plafond', async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { maxQtyPerClient: 3 } });

    await expect(
      createDocument({
        type: 'BON_LIVRAISON',
        partnerId: f.client.id,
        depotId: f.depotMain.id,
        paymentMode: 'CHEQUE',
        remise: 0,
        lines: [lineOf(f.articleA.id, f.depotMain.id, 2, 150), lineOf(f.articleA.id, f.depotMain.id, 2, 150)]
      } as never)
    ).rejects.toThrow(/RATIONED_ARTICLE/);
  });

  it('accepte la quantite exactement egale au plafond', async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { maxQtyPerClient: 3 } });

    const doc = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 3, 150)]
    } as never);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyReserved).toBe(3);
    expect(doc.id).toBeTruthy();
  });

  it("ne contingente pas les entrees de stock: un achat n'est pas concerne", async () => {
    await prisma.article.update({ where: { id: f.articleA.id }, data: { maxQtyPerClient: 3 } });

    const achat = await createDocument({
      type: 'ACHAT',
      partnerId: f.supplier.id,
      depotId: f.depotMain.id,
      paymentMode: 'VIREMENT',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 500, 100)]
    } as never);

    expect(achat.id).toBeTruthy();
  });

  it("un article sans plafond n'est jamais limite", async () => {
    const doc = await createDocument({
      type: 'BON_LIVRAISON',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [lineOf(f.articleA.id, f.depotMain.id, 90, 150)]
    } as never);

    expect(doc.id).toBeTruthy();
  });
});
