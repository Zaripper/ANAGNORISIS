import { prisma } from '../prisma';
import { CreateChequeInput, ChequeEtat, canTransitionCheque, initialChequeEtat } from '../../../shared/src';

/**
 * Cycle de vie d'un cheque.
 *
 * Le logiciel actuel suit un cheque dans le temps plutot que de l'ecrire une
 * fois pour toutes en caisse. Les effets comptables sont repartis sur ce cycle,
 * et cette repartition est le coeur du module:
 *
 *  - CREATION      le solde du partenaire est impute immediatement: remettre un
 *                  cheque vaut reglement, meme s'il n'est pas encore encaisse.
 *  - PAYE          l'ecriture de banque est generee a ce moment-la seulement,
 *                  parce que c'est la que l'argent bouge reellement.
 *  - ANNULE        tout ce qui a ete impute est contrepasse: le solde revient,
 *                  et l'ecriture de banque est neutralisee si elle existait.
 *
 * Sans cette separation, un cheque impaye laisserait une recette fantome en
 * banque et un client considere comme a jour.
 */

const TX_OPTIONS = { maxWait: 15000, timeout: 30000 } as const;

/**
 * Un reglement diminue TOUJOURS ce qui est en jeu dans la relation, quel que
 * soit son sens: le client qui paie reduit sa dette, le fournisseur que nous
 * payons voit reduire ce que nous lui devons. `Partner.balance` etant un
 * encours non signe, l'imputation est donc negative dans les deux cas — c'est
 * la meme convention que les ecritures de caisse existantes.
 */
const REGLEMENT_SIGN = -1;

export async function createCheque(input: CreateChequeInput, createdById?: string) {
  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) throw new Error('PARTNER_NOT_FOUND');

    const cheque = await tx.cheque.create({
      data: {
        type: input.type,
        etat: initialChequeEtat(input.type),
        numeroPiece: input.numeroPiece ?? null,
        datePiece: input.datePiece ? new Date(input.datePiece) : new Date(),
        partnerId: input.partnerId,
        numeroCheque: input.numeroCheque,
        dateCheque: input.dateCheque ? new Date(input.dateCheque) : null,
        banque: input.banque ?? null,
        montant: input.montant,
        libelle: input.libelle ?? null,
        createdById: createdById ?? null
      },
      include: { partner: true }
    });

    // Le cheque vaut reglement des sa remise: le solde bouge maintenant.
    await tx.partner.update({
      where: { id: input.partnerId },
      data: { balance: { increment: REGLEMENT_SIGN * input.montant } }
    });

    return cheque;
  }, TX_OPTIONS);
}

export async function changeChequeEtat(chequeId: string, to: ChequeEtat) {
  return prisma.$transaction(async (tx) => {
    const cheque = await tx.cheque.findUnique({ where: { id: chequeId } });
    if (!cheque) throw new Error('CHEQUE_NOT_FOUND');

    const from = cheque.etat as ChequeEtat;
    if (from === to) return cheque;
    if (!canTransitionCheque(from, to)) throw new Error(`TRANSITION_INTERDITE:${from}:${to}`);

    const montant = Number(cheque.montant);

    if (to === 'PAYE') {
      // L'argent bouge: on genere l'ecriture de banque correspondante.
      const entry = await tx.cashTransaction.create({
        data: {
          type: cheque.type,
          amount: montant,
          paymentMode: 'CHEQUE',
          partnerId: cheque.partnerId,
          reference: cheque.numeroCheque,
          bankName: cheque.banque,
          // Le solde a deja ete impute a la remise: cette ecriture ne doit pas
          // le retoucher. Elle n'existe que pour le journal de banque.
          description: `Cheque ${cheque.numeroCheque} encaisse`
        }
      });
      return tx.cheque.update({
        where: { id: chequeId },
        data: { etat: to, cashTransactionId: entry.id },
        include: { partner: true }
      });
    }

    if (to === 'ANNULE') {
      // Contrepassation du solde impute a la remise.
      await tx.partner.update({
        where: { id: cheque.partnerId },
        data: { balance: { decrement: REGLEMENT_SIGN * montant } }
      });

      // Si le cheque avait ete encaisse, l'ecriture de banque est neutralisee
      // par une ecriture inverse plutot que supprimee: le journal doit garder
      // la trace de l'aller-retour.
      if (cheque.cashTransactionId) {
        await tx.cashTransaction.create({
          data: {
            type: cheque.type === 'RECETTE' ? 'DEPENSE' : 'RECETTE',
            amount: montant,
            paymentMode: 'CHEQUE',
            partnerId: cheque.partnerId,
            reference: cheque.numeroCheque,
            bankName: cheque.banque,
            description: `Annulation cheque ${cheque.numeroCheque}`
          }
        });
      }

      return tx.cheque.update({ where: { id: chequeId }, data: { etat: to }, include: { partner: true } });
    }

    // MIS_EN_PAIEMENT: simple suivi, aucun mouvement comptable.
    return tx.cheque.update({ where: { id: chequeId }, data: { etat: to }, include: { partner: true } });
  }, TX_OPTIONS);
}

export async function listCheques(type: 'RECETTE' | 'DEPENSE') {
  return prisma.cheque.findMany({
    where: { type },
    include: { partner: { select: { code: true, raisonSociale: true, balance: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
}
