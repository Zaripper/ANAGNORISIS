import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { balanceOf, resetDatabase, seedFixtures, type Fixtures } from '../../test/fixtures';
import { cancelCashEntry, createCashEntry, validateCashEntry } from './caisse.service';
import { createDocument, validateDocument } from './document.service';

/**
 * Saisie de la caisse et validation.
 *
 * La regle centrale: seule une ecriture VALIDEE impute un solde. Tant qu'un
 * mouvement est en brouillon il n'existe pas comptablement, ce qui laisse le
 * temps de relire une saisie avant qu'elle ne touche le compte d'un client.
 *
 * L'autre enjeu est la non-regression: les ecritures nees d'un document ou d'un
 * cheque sont deja le reflet d'une operation validee ailleurs et ne doivent
 * surtout pas attendre une seconde validation.
 */

let f: Fixtures;

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();
  await prisma.partner.update({ where: { id: f.client.id }, data: { balance: 10000 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function entree(over: Record<string, unknown> = {}) {
  return {
    type: 'RECETTE' as const,
    amount: 3000,
    paymentMode: 'ESPECE' as const,
    description: 'Reglement client',
    partnerId: f.client.id,
    status: 'OUVERT' as const,
    ...over
  };
}

describe('saisie', () => {
  it("une ecriture en brouillon n'impute aucun solde", async () => {
    const saisie = await createCashEntry(entree() as never);

    expect(saisie.status).toBe('OUVERT');
    // Le client doit toujours ses 10 000: rien n'a encore ete valide.
    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });

  it('une ecriture validee a la saisie impute immediatement', async () => {
    // C'est le chemin des ecrans existants (transactions caissieres, virements),
    // qui ne doivent rien changer a leur comportement.
    await createCashEntry(entree({ status: 'VALIDE' }) as never);
    expect(await balanceOf(f.client.id)).toBeCloseTo(7000, 6);
  });

  it('le statut par defaut est VALIDE', async () => {
    // Un appelant qui ne precise rien doit obtenir le comportement d'avant.
    const { createCashTransactionSchema } = await import('../../../shared/src');
    const parsed = createCashTransactionSchema.parse({
      type: 'RECETTE',
      amount: 100,
      paymentMode: 'ESPECE',
      description: 'x'
    });
    expect(parsed.status).toBe('VALIDE');
  });

  it('refuse un partenaire inexistant', async () => {
    await expect(createCashEntry(entree({ partnerId: f.depotMain.id }) as never)).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('une ecriture sans partenaire ne touche aucun solde', async () => {
    // Depense de caisse courante: pas de contrepartie tiers.
    const saisie = await createCashEntry(
      entree({ type: 'DEPENSE', partnerId: null, description: 'Achat fournitures', status: 'VALIDE' }) as never
    );
    expect(saisie.partnerId).toBeNull();
    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });
});

describe('validation', () => {
  it("la validation est le seul moment ou le solde bouge", async () => {
    const saisie = await createCashEntry(entree() as never);
    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);

    const valide = await validateCashEntry(saisie.id, f.user.id);

    expect(valide.status).toBe('VALIDE');
    expect(valide.validatedAt).not.toBeNull();
    expect(await balanceOf(f.client.id)).toBeCloseTo(7000, 6);
  });

  it('rejouer une validation ne reimpute rien', async () => {
    const saisie = await createCashEntry(entree() as never);
    await validateCashEntry(saisie.id);
    await validateCashEntry(saisie.id);

    expect(await balanceOf(f.client.id)).toBeCloseTo(7000, 6);
  });

  it('deux validations simultanees ne soldent la creance qu une fois', async () => {
    // Deux postes qui valident la meme ecriture au meme instant: sans verrou de
    // ligne, le reglement serait impute deux fois.
    const saisie = await createCashEntry(entree() as never);

    await Promise.allSettled([validateCashEntry(saisie.id), validateCashEntry(saisie.id)]);

    expect(await balanceOf(f.client.id)).toBeCloseTo(7000, 6);
  });

  it('une ecriture annulee ne peut plus etre validee', async () => {
    const saisie = await createCashEntry(entree() as never);
    await cancelCashEntry(saisie.id);

    await expect(validateCashEntry(saisie.id)).rejects.toThrow('CASH_ENTRY_CANCELLED');
    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });

  it('un reglement fournisseur reduit aussi ce que nous devons', async () => {
    await prisma.partner.update({ where: { id: f.supplier.id }, data: { balance: 5000 } });
    const saisie = await createCashEntry(
      entree({ type: 'DEPENSE', partnerId: f.supplier.id, amount: 2000 }) as never
    );

    await validateCashEntry(saisie.id);

    // Un reglement solde l'encours quel que soit son sens.
    expect(await balanceOf(f.supplier.id)).toBeCloseTo(3000, 6);
  });
});

describe('annulation', () => {
  it("annuler un brouillon ne contrepasse rien", async () => {
    // Le brouillon n'avait rien impute: contrepasser creerait de la dette a
    // partir de rien.
    const saisie = await createCashEntry(entree() as never);
    await cancelCashEntry(saisie.id);

    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });

  it('annuler une ecriture validee contrepasse son imputation', async () => {
    const saisie = await createCashEntry(entree() as never);
    await validateCashEntry(saisie.id);
    expect(await balanceOf(f.client.id)).toBeCloseTo(7000, 6);

    await cancelCashEntry(saisie.id);

    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });

  it('rejouer une annulation ne contrepasse pas deux fois', async () => {
    const saisie = await createCashEntry(entree() as never);
    await validateCashEntry(saisie.id);
    await cancelCashEntry(saisie.id);
    await cancelCashEntry(saisie.id);

    expect(await balanceOf(f.client.id)).toBeCloseTo(10000, 6);
  });
});

describe('non-regression des ecritures automatiques', () => {
  it("l'ecriture nee d'une vente en especes est validee d'office", async () => {
    // Elle reflete une vente deja validee: la faire attendre une seconde
    // validation sortirait la recette du jour de la caisse.
    const vente = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 2, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }
      ]
    } as never);

    await validateDocument(vente.id);

    const ecritures = await prisma.cashTransaction.findMany({ where: { documentId: vente.id } });
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].status).toBe('VALIDE');
  });

  it("une ecriture nee d'un document ne s'annule pas depuis le journal", async () => {
    // Sinon la facture resterait "reglee" et la caisse dirait le contraire,
    // sans qu'aucun des deux ecrans ne signale l'incoherence.
    const vente = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'ESPECE',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 2, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }
      ]
    } as never);
    await validateDocument(vente.id);

    const ecriture = await prisma.cashTransaction.findFirstOrThrow({ where: { documentId: vente.id } });
    const soldeAvant = await balanceOf(f.client.id);

    await expect(cancelCashEntry(ecriture.id)).rejects.toThrow('CASH_ENTRY_FROM_DOCUMENT');
    expect(await balanceOf(f.client.id)).toBeCloseTo(soldeAvant, 6);
  });
});
