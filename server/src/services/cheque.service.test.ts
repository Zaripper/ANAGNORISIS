import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { balanceOf, resetDatabase, seedFixtures, type Fixtures } from '../../test/fixtures';
import { changeChequeEtat, createCheque, listCheques } from './cheque.service';

/**
 * Cycle de vie des cheques.
 *
 * Ces tests verrouillent la repartition des effets comptables sur le cycle:
 * le solde bouge a la remise, la banque bouge a l'encaissement, et une
 * annulation contrepasse exactement ce qui avait ete impute — ni plus, ni moins.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function chequeInput(over: Record<string, unknown> = {}) {
  return {
    type: 'RECETTE' as const,
    partnerId: f.client.id,
    numeroCheque: 'CHQ-001',
    montant: 5000,
    banque: 'BNA',
    ...over
  };
}

async function bankEntries() {
  return prisma.cashTransaction.findMany({ where: { paymentMode: 'CHEQUE' }, orderBy: { createdAt: 'asc' } });
}

describe('creation', () => {
  it('un cheque recu part "en instance" et impute immediatement le solde client', async () => {
    // Le client doit 20 000 avant remise du cheque.
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });

    const cheque = await createCheque(chequeInput() as never, f.user.id);

    expect(cheque.etat).toBe('EN_INSTANCE');
    // Remettre un cheque vaut reglement: la dette tombe tout de suite.
    expect(await balanceOf(f.client.id)).toBeCloseTo(15000, 6);
    // …mais rien n'est encore passe en banque.
    expect(await bankEntries()).toHaveLength(0);
  });

  it('un cheque emis part directement "mis en paiement"', async () => {
    const cheque = await createCheque(chequeInput({ type: 'DEPENSE', partnerId: f.supplier.id }) as never);
    expect(cheque.etat).toBe('MIS_EN_PAIEMENT');
  });

  it('refuse un partenaire inexistant', async () => {
    await expect(createCheque(chequeInput({ partnerId: f.depotMain.id }) as never)).rejects.toThrow('PARTNER_NOT_FOUND');
  });
});

describe('transitions', () => {
  it('la remise en banque ne bouge ni le solde ni la banque', async () => {
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });
    const cheque = await createCheque(chequeInput() as never);

    await changeChequeEtat(cheque.id, 'MIS_EN_PAIEMENT');

    expect(await balanceOf(f.client.id)).toBeCloseTo(15000, 6);
    expect(await bankEntries()).toHaveLength(0);
  });

  it("l'encaissement genere l'ecriture de banque sans retoucher le solde", async () => {
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });
    const cheque = await createCheque(chequeInput() as never);

    const paid = await changeChequeEtat(cheque.id, 'PAYE');

    expect(paid.etat).toBe('PAYE');
    // Le solde reste celui impute a la remise: pas de double imputation.
    expect(await balanceOf(f.client.id)).toBeCloseTo(15000, 6);

    const entries = await bankEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('RECETTE');
    expect(Number(entries[0].amount)).toBeCloseTo(5000, 6);
    expect(entries[0].reference).toBe('CHQ-001');
    expect(paid.cashTransactionId).toBe(entries[0].id);
  });

  it('un cheque emis encaisse genere une depense en banque', async () => {
    const cheque = await createCheque(chequeInput({ type: 'DEPENSE', partnerId: f.supplier.id }) as never);
    await changeChequeEtat(cheque.id, 'PAYE');

    const entries = await bankEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('DEPENSE');
  });

  it('rejouer le meme etat est sans effet', async () => {
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });
    const cheque = await createCheque(chequeInput() as never);
    await changeChequeEtat(cheque.id, 'PAYE');
    await changeChequeEtat(cheque.id, 'PAYE');

    expect(await bankEntries()).toHaveLength(1);
    expect(await balanceOf(f.client.id)).toBeCloseTo(15000, 6);
  });

  it('un cheque encaisse ne revient jamais en arriere', async () => {
    const cheque = await createCheque(chequeInput() as never);
    await changeChequeEtat(cheque.id, 'PAYE');

    // Revenir a un etat anterieur ferait diverger banque et solde sans trace.
    await expect(changeChequeEtat(cheque.id, 'MIS_EN_PAIEMENT')).rejects.toThrow(/TRANSITION_INTERDITE/);
    // …mais un rejet apres encaissement doit rester possible (voir "annulation").
  });

  it('un cheque annule est terminal', async () => {
    const cheque = await createCheque(chequeInput() as never);
    await changeChequeEtat(cheque.id, 'ANNULE');

    await expect(changeChequeEtat(cheque.id, 'PAYE')).rejects.toThrow(/TRANSITION_INTERDITE/);
  });
});

describe('annulation', () => {
  it("un impaye avant encaissement rend la dette au client et ne touche pas la banque", async () => {
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });
    const cheque = await createCheque(chequeInput() as never);
    expect(await balanceOf(f.client.id)).toBeCloseTo(15000, 6);

    await changeChequeEtat(cheque.id, 'ANNULE');

    // La dette revient exactement a son niveau d'avant remise.
    expect(await balanceOf(f.client.id)).toBeCloseTo(20000, 6);
    expect(await bankEntries()).toHaveLength(0);
  });

  it("un impaye apres encaissement contrepasse aussi l'ecriture de banque", async () => {
    await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 20000 } });
    const cheque = await createCheque(chequeInput() as never);
    await changeChequeEtat(cheque.id, 'PAYE');
    await changeChequeEtat(cheque.id, 'ANNULE');

    expect(await balanceOf(f.client.id)).toBeCloseTo(20000, 6);

    // L'ecriture initiale est conservee et neutralisee par son inverse: le
    // journal doit garder la trace de l'aller-retour, pas l'effacer.
    const entries = await bankEntries();
    expect(entries.map((e) => e.type)).toEqual(['RECETTE', 'DEPENSE']);
    const net = entries.reduce((sum, e) => sum + (e.type === 'RECETTE' ? 1 : -1) * Number(e.amount), 0);
    expect(net).toBeCloseTo(0, 6);
  });
});

describe('listing', () => {
  it('separe les cheques recus des cheques emis', async () => {
    await createCheque(chequeInput({ numeroCheque: 'R1' }) as never);
    await createCheque(chequeInput({ numeroCheque: 'D1', type: 'DEPENSE', partnerId: f.supplier.id }) as never);

    const recettes = await listCheques('RECETTE');
    const depenses = await listCheques('DEPENSE');

    expect(recettes.map((c) => c.numeroCheque)).toEqual(['R1']);
    expect(depenses.map((c) => c.numeroCheque)).toEqual(['D1']);
  });
});
