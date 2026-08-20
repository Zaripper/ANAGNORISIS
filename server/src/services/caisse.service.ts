import { prisma } from '../prisma';
import { CashStatus, CreateCashTransactionInput, cashEntryImputesBalance } from '../../../shared/src';

/**
 * Ecritures de caisse.
 *
 * Le logiciel actuel separe la saisie de la validation: un caissier enregistre
 * les mouvements de la journee, un responsable les valide. Tant qu'une ecriture
 * est en brouillon elle n'existe pas comptablement — elle n'impute aucun solde.
 * Sans cette separation, une erreur de saisie touche le compte client avant que
 * qui que ce soit ait pu la relire.
 *
 * Ce module est aussi devenu le SEUL endroit qui impute un solde depuis la
 * caisse. La logique vivait auparavant dans la route, ce qui rendait impossible
 * d'ajouter un etat sans risquer d'oublier un chemin.
 */

const TX_OPTIONS = { maxWait: 15000, timeout: 30000 } as const;

/**
 * Un reglement diminue TOUJOURS l'encours de la relation, quel que soit son
 * sens: le client qui paie reduit sa dette, le fournisseur que nous payons voit
 * reduire ce que nous lui devons. `Partner.balance` etant un encours non signe,
 * l'imputation est donc negative dans les deux cas.
 */
const REGLEMENT_SIGN = -1;

async function lockCashEntry(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], id: string) {
  // Voir document.service: le verrou doit preceder la relecture du statut,
  // sinon deux validations simultanees imputent deux fois le meme reglement.
  await tx.$queryRaw`SELECT id FROM "CashTransaction" WHERE id = ${id} FOR UPDATE`;
}

export async function createCashEntry(input: CreateCashTransactionInput, createdById?: string) {
  return prisma.$transaction(async (tx) => {
    if (input.partnerId) {
      const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
      if (!partner) throw new Error('PARTNER_NOT_FOUND');
    }

    const created = await tx.cashTransaction.create({
      data: {
        type: input.type,
        amount: input.amount,
        paymentMode: input.paymentMode,
        description: input.description,
        partnerId: input.partnerId ?? null,
        reference: input.reference ?? null,
        bankName: input.bankName ?? null,
        status: input.status,
        createdById: createdById ?? null,
        validatedAt: input.status === 'VALIDE' ? new Date() : null,
        validatedById: input.status === 'VALIDE' ? createdById ?? null : null
      },
      include: { partner: true }
    });

    if (input.partnerId && cashEntryImputesBalance(input.status)) {
      await tx.partner.update({
        where: { id: input.partnerId },
        data: { balance: { increment: REGLEMENT_SIGN * input.amount } }
      });
    }

    return created;
  }, TX_OPTIONS);
}

/** Valide une ecriture en brouillon: c'est ici, et seulement ici, que le solde bouge. */
export async function validateCashEntry(id: string, validatedById?: string) {
  return prisma.$transaction(async (tx) => {
    await lockCashEntry(tx, id);
    const entry = await tx.cashTransaction.findUnique({ where: { id } });
    if (!entry) throw new Error('CASH_ENTRY_NOT_FOUND');
    // Rejouer une validation ne doit rien reimputer.
    if (entry.status === 'VALIDE') return entry;
    if (entry.status === 'ANNULE') throw new Error('CASH_ENTRY_CANCELLED');

    if (entry.partnerId) {
      await tx.partner.update({
        where: { id: entry.partnerId },
        data: { balance: { increment: REGLEMENT_SIGN * Number(entry.amount) } }
      });
    }

    return tx.cashTransaction.update({
      where: { id },
      data: { status: 'VALIDE', validatedAt: new Date(), validatedById: validatedById ?? null },
      include: { partner: true }
    });
  }, TX_OPTIONS);
}

/**
 * Annule une ecriture.
 *
 * Une ecriture jamais validee n'a rien impute: il n'y a rien a contrepasser, et
 * le faire quand meme creerait de la dette a partir de rien.
 */
export async function cancelCashEntry(id: string) {
  return prisma.$transaction(async (tx) => {
    await lockCashEntry(tx, id);
    const entry = await tx.cashTransaction.findUnique({ where: { id } });
    if (!entry) throw new Error('CASH_ENTRY_NOT_FOUND');
    if (entry.status === 'ANNULE') return entry;

    /**
     * Une ecriture nee d'un document en est le reflet: la contrepasser depuis le
     * journal laisserait la facture "reglee" et la caisse en desaccord, sans
     * qu'aucun des deux ecrans ne signale l'incoherence. C'est l'annulation du
     * document qui doit faire le travail, et elle contrepasse deja l'ecriture.
     */
    if (entry.documentId) throw new Error('CASH_ENTRY_FROM_DOCUMENT');

    if (entry.partnerId && cashEntryImputesBalance(entry.status as CashStatus)) {
      await tx.partner.update({
        where: { id: entry.partnerId },
        data: { balance: { decrement: REGLEMENT_SIGN * Number(entry.amount) } }
      });
    }

    return tx.cashTransaction.update({
      where: { id },
      data: { status: 'ANNULE', cancelledAt: new Date() },
      include: { partner: true }
    });
  }, TX_OPTIONS);
}
