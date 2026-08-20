import { prisma } from '../prisma';
import { DocumentType, lineStockQuantity, stockConsumingTypes, stockReceivingTypes } from '../../../shared/src';

/**
 * Stock tel qu'il etait a une date passee.
 *
 * La quantite courante ne dit pas ce qu'on avait en rayon le 12 mars: il faut
 * defaire les mouvements posterieurs. La reconstruction part donc du stock
 * actuel et remonte le temps, plutot que de rejouer l'histoire depuis zero --
 * ce qui supposerait un stock de depart nul, faux pour un catalogue repris d'un
 * autre logiciel.
 *
 * Trois cas, et le troisieme est celui qu'on oublie:
 *
 *  - document VALIDE apres la date: son effet est dans le stock actuel mais
 *    n'existait pas ce jour-la -> on le retranche.
 *  - document VALIDE avant la date et toujours valide: present des deux cotes
 *    -> rien a faire.
 *  - document VALIDE avant la date puis ANNULE apres: il ETAIT en vigueur ce
 *    jour-la, alors qu'aujourd'hui son effet est neutralise (applique puis
 *    contrepasse) -> on le rajoute. L'oublier ferait disparaitre du stock qui
 *    etait bien la.
 *
 * Un brouillon, un bon echu ou un document jamais valide n'a jamais touche la
 * quantite physique: il n'entre pas dans le calcul.
 */

export interface LigneStockHistorique {
  articleId: string;
  depotId: string;
  qtyInStock: number;
}

function estReceptrice(type: DocumentType) {
  return (stockReceivingTypes as string[]).includes(type);
}

function estConsommatrice(type: DocumentType) {
  return (stockConsumingTypes as string[]).includes(type);
}

/**
 * Reconstitue les quantites physiques a la fin de la journee `date`.
 *
 * On se place a la fin du jour demande: "le stock au 12 mars" s'entend comme ce
 * qu'il restait en fermant, pas a minuit une minute.
 */
export async function stockALaDate(date: Date): Promise<LigneStockHistorique[]> {
  const limite = new Date(date);
  limite.setHours(23, 59, 59, 999);

  const stocks = await prisma.articleStock.findMany({
    select: { articleId: true, depotId: true, qtyInStock: true }
  });

  // Cle "article|depot" -> quantite, pour appliquer les corrections a plat.
  const quantites = new Map<string, number>();
  for (const s of stocks) quantites.set(`${s.articleId}|${s.depotId}`, s.qtyInStock);

  const ajuster = (articleId: string, depotId: string, delta: number) => {
    const cle = `${articleId}|${depotId}`;
    quantites.set(cle, (quantites.get(cle) ?? 0) + delta);
  };

  /**
   * Seuls les documents ayant reellement touche le stock comptent, et seulement
   * ceux dont la periode d'effet ne coincide pas avec la date demandee.
   */
  const documents = await prisma.document.findMany({
    where: {
      validatedAt: { not: null },
      status: { in: ['VALIDE', 'ANNULE'] },
      /**
       * Une facture emise depuis un bon de livraison n'a JAMAIS touche le
       * stock: le BL l'avait deja sorti. La defaire rendrait au stock une
       * quantite qui n'en etait pas sortie, et toute date passee serait
       * surevaluee du montant de la facture.
       */
      sourceDocumentId: null,
      OR: [
        // Valides apres la date: a retrancher.
        { status: 'VALIDE', validatedAt: { gt: limite } },
        // Annules: a rajouter s'ils etaient en vigueur ce jour-la.
        { status: 'ANNULE' }
      ]
    },
    include: { lines: true }
  });

  for (const doc of documents) {
    const type = doc.type as DocumentType;
    const validePendant = doc.validatedAt !== null && doc.validatedAt <= limite;

    let sens: -1 | 1;
    if (doc.status === 'VALIDE') {
      // Necessairement valide APRES la date (la requete l'a filtre): on defait.
      sens = -1;
    } else {
      // ANNULE: il ne compte que s'il etait en vigueur a la date, c'est-a-dire
      // valide avant et annule apres. Sinon son effet net est deja nul.
      const annuleApres = doc.cancelledAt === null || doc.cancelledAt > limite;
      if (!validePendant || !annuleApres) continue;
      sens = 1;
    }

    for (const ligne of doc.lines) {
      const quantite = lineStockQuantity(ligne);

      /**
       * `effet` est ce que le document a fait au stock au moment de sa
       * validation; la correction vaut `sens * effet`. Ecrire directement le
       * signe corrige ici serait le negatif du negatif: une entree defaite
       * ajouterait de la marchandise au lieu d'en retirer.
       */
      if (type === 'TRANSFERT') {
        if (!doc.destDepotId) continue;
        // Un transfert retire au depot de depart et ajoute a celui d'arrivee.
        ajuster(ligne.articleId, ligne.depotId, sens * -quantite);
        ajuster(ligne.articleId, doc.destDepotId, sens * quantite);
      } else if (estReceptrice(type)) {
        ajuster(ligne.articleId, ligne.depotId, sens * quantite);
      } else if (estConsommatrice(type)) {
        ajuster(ligne.articleId, ligne.depotId, sens * -quantite);
      }
      // PROFORMA, COMMANDE: aucun effet stock, ni hier ni aujourd'hui.
    }
  }

  return [...quantites.entries()].map(([cle, qtyInStock]) => {
    const [articleId, depotId] = cle.split('|');
    return { articleId, depotId, qtyInStock };
  });
}

/**
 * Vue "consultation des stocks" a une date: une ligne par article, avec le
 * detail par depot. A la date du jour, les quantites reservees sont connues; a
 * une date passee elles ne le sont pas — une reservation est un etat courant,
 * pas un mouvement historise — et valent donc zero.
 */
export async function consultationStocks(date?: Date) {
  const [articles, depots] = await Promise.all([
    prisma.article.findMany({
      where: { active: true },
      select: { id: true, code: true, designation: true, pump: true },
      orderBy: { code: 'asc' }
    }),
    prisma.depot.findMany({ orderBy: { code: 'asc' } })
  ]);

  const historique = date ? await stockALaDate(date) : null;
  const reserves = new Map<string, number>();
  const quantites = new Map<string, number>();

  if (historique) {
    for (const l of historique) quantites.set(`${l.articleId}|${l.depotId}`, l.qtyInStock);
  } else {
    const stocks = await prisma.articleStock.findMany({ select: { articleId: true, depotId: true, qtyInStock: true, qtyReserved: true } });
    for (const s of stocks) {
      quantites.set(`${s.articleId}|${s.depotId}`, s.qtyInStock);
      reserves.set(`${s.articleId}|${s.depotId}`, s.qtyReserved);
    }
  }

  const lignes = articles.map((a) => {
    const parDepot = depots.map((d) => {
      const cle = `${a.id}|${d.id}`;
      const qtyInStock = quantites.get(cle) ?? 0;
      const qtyReserved = reserves.get(cle) ?? 0;
      return { depotId: d.id, depotName: d.name, qtyInStock, qtyReserved };
    });
    return {
      articleId: a.id,
      code: a.code,
      designation: a.designation,
      pump: Number(a.pump),
      parDepot,
      total: parDepot.reduce((s, d) => s + d.qtyInStock, 0)
    };
  });

  return {
    date: date ? date.toISOString() : null,
    depots: depots.map((d) => ({ id: d.id, name: d.name })),
    lignes,
    valeurTotale: lignes.reduce((s, l) => s + l.total * l.pump, 0)
  };
}
