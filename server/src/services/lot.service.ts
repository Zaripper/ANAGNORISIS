import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import {
  LOT_ALERTE_KEY,
  allouerFEFO,
  lotEstPerime,
  parseAlerteJours,
  type AllocationLot
} from '../../../shared/src';

type Tx = Prisma.TransactionClient;

/**
 * Lots et dates de peremption.
 *
 * Le principe qui gouverne tout ce module: `ArticleStock` reste le total qui
 * fait foi, les lots en sont la ventilation. Chaque mouvement touche les deux du
 * meme montant. Les laisser diverger serait pire que de ne pas suivre les lots
 * du tout: on croirait savoir ce qu'il y a en rayon.
 *
 * Le suivi est optionnel article par article. Le catalogue existant (plus de
 * 4 000 references) n'a aucun lot enregistre, et l'exiger bloquerait chaque
 * vente des la mise en service.
 */

/** Delai d'alerte avant peremption, en jours (parametrable). */
export async function alerteJours(tx: Tx | typeof prisma = prisma): Promise<number> {
  const setting = await tx.appSetting.findUnique({ where: { key: LOT_ALERTE_KEY } });
  return parseAlerteJours(setting?.value);
}

/**
 * Entree de marchandise dans un lot: cree le lot s'il n'existe pas, l'incremente
 * sinon.
 *
 * Deux receptions du meme numero de lot avec la meme peremption sont le meme
 * lot physique — d'ou l'upsert sur cette cle plutot qu'une ligne par reception.
 */
export async function entrerEnLot(
  tx: Tx,
  params: { articleId: string; depotId: string; numeroLot: string; datePeremption: Date; quantity: number }
) {
  const { articleId, depotId, numeroLot, datePeremption, quantity } = params;
  if (quantity <= 0) return null;

  return tx.lot.upsert({
    where: { articleId_depotId_numeroLot_datePeremption: { articleId, depotId, numeroLot, datePeremption } },
    create: { articleId, depotId, numeroLot, datePeremption, qtyInStock: quantity },
    update: { qtyInStock: { increment: quantity } }
  });
}

/**
 * Reserve une quantite sur les lots d'un article, au plus proche de la
 * peremption d'abord.
 *
 * Renvoie la repartition retenue pour qu'elle soit enregistree sur la ligne: en
 * cas de rappel de lot, c'est cette trace qui dit quel client a recu quoi.
 */
export async function reserverLots(
  tx: Tx,
  params: { articleId: string; depotId: string; quantity: number },
  now: Date = new Date()
): Promise<AllocationLot[]> {
  const lots = await tx.lot.findMany({
    where: { articleId: params.articleId, depotId: params.depotId },
    orderBy: { datePeremption: 'asc' }
  });

  const allocations = allouerFEFO(
    lots.map((l) => ({
      id: l.id,
      datePeremption: l.datePeremption,
      qtyInStock: l.qtyInStock,
      qtyReserved: l.qtyReserved
    })),
    params.quantity,
    now
  );

  for (const a of allocations) {
    await tx.lot.update({ where: { id: a.lotId }, data: { qtyReserved: { increment: a.quantity } } });
  }
  return allocations;
}

/** Libere une reservation de lots (suppression d'un brouillon, bon echu). */
export async function libererLots(tx: Tx, allocations: { lotId: string; quantity: number }[]) {
  for (const a of allocations) {
    await tx.lot.update({ where: { id: a.lotId }, data: { qtyReserved: { decrement: a.quantity } } });
  }
}

/**
 * Sortie physique: la reservation tombe et le stock du lot diminue d'autant.
 * Miroir exact de ce que `reserverLots` avait pose.
 */
export async function sortirLots(tx: Tx, allocations: { lotId: string; quantity: number }[]) {
  for (const a of allocations) {
    await tx.lot.update({
      where: { id: a.lotId },
      data: { qtyReserved: { decrement: a.quantity }, qtyInStock: { decrement: a.quantity } }
    });
  }
}

/** Contrepassation d'une sortie: la marchandise revient dans son lot d'origine. */
export async function rendreAuxLots(tx: Tx, allocations: { lotId: string; quantity: number }[]) {
  for (const a of allocations) {
    await tx.lot.update({ where: { id: a.lotId }, data: { qtyInStock: { increment: a.quantity } } });
  }
}

export interface LotConsultation {
  id: string;
  numeroLot: string;
  datePeremption: Date;
  qtyInStock: number;
  qtyReserved: number;
  article: { code: string; designation: string };
  depot: { name: string };
}

/**
 * Lots en stock, du plus proche de la peremption au plus lointain: l'ordre dans
 * lequel il faut s'en occuper.
 */
export async function listerLots(filtre?: { perimesSeulement?: boolean }): Promise<LotConsultation[]> {
  const lots = await prisma.lot.findMany({
    where: { qtyInStock: { gt: 0 } },
    include: { article: { select: { code: true, designation: true } }, depot: { select: { name: true } } },
    orderBy: { datePeremption: 'asc' },
    take: 2000
  });

  if (!filtre?.perimesSeulement) return lots;
  const now = new Date();
  return lots.filter((l) => lotEstPerime(l.datePeremption, now));
}

/**
 * Valeur immobilisee dans les lots perimes, au P.U.M.P de l'article.
 *
 * Chiffre volontairement mis en avant: c'est de l'argent deja perdu qui dort en
 * rayon, et le seul moyen de faire admettre qu'il faut sortir la marchandise.
 */
export async function valeurLotsPerimes(): Promise<number> {
  const now = new Date();
  const lots = await prisma.lot.findMany({
    where: { qtyInStock: { gt: 0 }, datePeremption: { lte: now } },
    include: { article: { select: { pump: true } } }
  });
  return lots.reduce((total, l) => total + l.qtyInStock * Number(l.article.pump), 0);
}
