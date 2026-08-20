import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { resetDatabase, seedFixtures, stockOf, type Fixtures } from '../../test/fixtures';
import { createDocument, validateDocument } from './document.service';

/**
 * Motifs de regularisation de stock.
 *
 * La table existe pour une raison precise: sans liste fermee, "casse",
 * "Casse", "cassé" et "carton tombé" deviennent quatre motifs distincts, et
 * plus aucun etat des pertes n'est exploitable. Ces tests verrouillent donc
 * deux choses: une regule sans motif est refusee, et un motif ne peut pas etre
 * employe dans un sens ou il n'a pas de sens.
 */

let f: Fixtures;
let casse: { id: string };
let don: { id: string };
let ecart: { id: string };

beforeEach(async () => {
  await resetDatabase();
  f = await seedFixtures();

  casse = await prisma.typeRegule.create({ data: { code: 'CASSE', label: 'Casse', sens: 'MOINS' } });
  don = await prisma.typeRegule.create({ data: { code: 'DON', label: 'Don recu', sens: 'PLUS' } });
  ecart = await prisma.typeRegule.create({ data: { code: 'ECART', label: "Ecart d'inventaire", sens: 'TOUS' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function reguleInput(type: 'REGULE_PLUS' | 'REGULE_MOINS', typeReguleId: string | null, over: Record<string, unknown> = {}) {
  return {
    type,
    depotId: f.depotMain.id,
    paymentMode: 'VIREMENT' as const,
    remise: 0,
    typeReguleId,
    lines: [
      { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 5, unitPriceHT: 100, discountPercent: 0, tvaRate: 0 }
    ],
    ...over
  };
}

describe('motif obligatoire', () => {
  it('une regule sans motif est refusee', async () => {
    await expect(createDocument(reguleInput('REGULE_MOINS', null) as never)).rejects.toThrow();
  });

  it('une regule avec motif est acceptee et applique le stock', async () => {
    const regule = await createDocument(reguleInput('REGULE_MOINS', casse.id) as never);
    await validateDocument(regule.id);

    expect((await stockOf(f.articleA.id, f.depotMain.id)).qtyInStock).toBe(95);
    const stocke = await prisma.document.findUniqueOrThrow({ where: { id: regule.id } });
    expect(stocke.typeReguleId).toBe(casse.id);
  });

  it("les autres documents n'exigent aucun motif", async () => {
    // Une vente n'est pas une regularisation: lui imposer un motif bloquerait
    // toute l'activite courante.
    const vente = await createDocument({
      type: 'VENTE',
      partnerId: f.client.id,
      depotId: f.depotMain.id,
      paymentMode: 'CHEQUE',
      remise: 0,
      lines: [
        { articleId: f.articleA.id, depotId: f.depotMain.id, quantity: 2, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }
      ]
    } as never);
    expect(vente.id).toBeTruthy();
  });
});

describe('sens du motif', () => {
  it("une casse n'explique pas une entree de stock", async () => {
    await expect(createDocument(reguleInput('REGULE_PLUS', casse.id) as never)).rejects.toThrow(
      /TYPE_REGULE_MAUVAIS_SENS/
    );
  });

  it("un don recu n'explique pas une sortie de stock", async () => {
    await expect(createDocument(reguleInput('REGULE_MOINS', don.id) as never)).rejects.toThrow(
      /TYPE_REGULE_MAUVAIS_SENS/
    );
  });

  it("un ecart d'inventaire vaut dans les deux sens", async () => {
    await expect(createDocument(reguleInput('REGULE_PLUS', ecart.id) as never)).resolves.toBeTruthy();
    await expect(createDocument(reguleInput('REGULE_MOINS', ecart.id) as never)).resolves.toBeTruthy();
  });

  it('le controle est fait cote serveur, pas seulement dans la liste deroulante', async () => {
    // Un poste qui enverrait directement la mauvaise combinaison doit etre
    // refuse: sinon l'etat des pertes melange des ecarts sans rapport.
    await expect(createDocument(reguleInput('REGULE_PLUS', casse.id) as never)).rejects.toThrow();
    const documents = await prisma.document.findMany({ where: { type: 'REGULE_PLUS' } });
    expect(documents).toHaveLength(0);
  });
});

describe('motif desactive', () => {
  it('un motif retire du catalogue ne peut plus etre employe', async () => {
    await prisma.typeRegule.update({ where: { id: casse.id }, data: { active: false } });

    await expect(createDocument(reguleInput('REGULE_MOINS', casse.id) as never)).rejects.toThrow(
      /TYPE_REGULE_INACTIF/
    );
  });

  it('un motif inexistant est refuse', async () => {
    await expect(
      createDocument(reguleInput('REGULE_MOINS', '00000000-0000-0000-0000-000000000000') as never)
    ).rejects.toThrow('TYPE_REGULE_NOT_FOUND');
  });
});
