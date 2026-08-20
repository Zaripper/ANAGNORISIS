/**
 * Passe de bout en bout contre la base REELLE.
 *
 * Precautions, dans l'ordre d'importance:
 *
 *  1. Tout ce qui est cree porte le prefixe AUDIT-TMP et son identifiant est
 *     conserve. Le nettoyage ne supprime que ces identifiants-la.
 *  2. Les scenarios n'utilisent qu'un article et un partenaire de test creees
 *     pour l'occasion: aucun P.U.M.P, aucun stock et aucun solde reel ne bouge.
 *  3. Les documents de test sont ANNULES avant d'etre supprimes, pour que leurs
 *     effets soient contrepasses par le code de production lui-meme.
 *  4. Les references de documents (2026VT000002...) sont recalculees depuis le
 *     dernier document existant: supprimer les documents de test rend donc les
 *     numeros, sans laisser de trou dans la numerotation -- ce qui serait un
 *     probleme fiscal.
 *  5. Un instantane est pris avant et apres; l'ecart doit etre nul.
 */
import { prisma } from '../src/prisma';
/**
 * GARDE-FOU: ce script ECRIT dans la base a laquelle il se connecte.
 *
 * Il cree des entites AUDIT-TMP, joue des scenarios complets, puis supprime
 * tout et verifie que l'instantane d'avant et celui d'apres sont identiques.
 * Le nettoyage est integral, mais une interruption en cours de route (Ctrl-C,
 * coupure) laisserait des entites AUDIT-TMP derriere elle.
 *
 * Il refuse donc de demarrer sans SMOKE_LIVE=1, pour qu'il ne puisse pas etre
 * lance par accident sur la base de production.
 */
if (process.env.SMOKE_LIVE !== '1') {
  console.error("Refus: ce script ecrit dans la base. Relancez avec SMOKE_LIVE=1 si c'est voulu.");
  process.exit(3);
}


const API = 'http://127.0.0.1:5000/api';
let TOKEN = '';

const cree = {
  documents: [] as string[],
  cash: [] as string[],
  cheques: [] as string[],
  lots: [] as string[],
  articles: [] as string[],
  partners: [] as string[]
};

let ok = 0;
const echecs: string[] = [];

function verifier(nom: string, condition: boolean, detail = '') {
  if (condition) {
    ok++;
    console.log(`  OK   ${nom}`);
  } else {
    echecs.push(`${nom} ${detail}`);
    console.log(`  ECHEC ${nom} ${detail}`);
  }
}

async function appel(methode: string, chemin: string, corps?: unknown) {
  const res = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: corps ? JSON.stringify(corps) : undefined
  });
  const texte = await res.text();
  let json: any = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { brut: texte };
  }
  return { status: res.status, body: json };
}

function dansNJours(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Empreinte de tout ce qui ne doit pas bouger. */
async function instantane() {
  const [partners, stocks, articles, documents, cash, lots, cheques] = await Promise.all([
    prisma.partner.findMany({ select: { id: true, balance: true }, orderBy: { id: 'asc' } }),
    prisma.articleStock.findMany({ select: { articleId: true, depotId: true, qtyInStock: true, qtyReserved: true }, orderBy: [{ articleId: 'asc' }, { depotId: 'asc' }] }),
    prisma.article.findMany({ select: { id: true, pump: true }, orderBy: { id: 'asc' } }),
    prisma.document.count(),
    prisma.cashTransaction.count(),
    prisma.lot.count(),
    prisma.cheque.count()
  ]);
  return JSON.stringify({
    partners: partners.map((p) => [p.id, String(p.balance)]),
    stocks: stocks.map((s) => [s.articleId, s.depotId, s.qtyInStock, s.qtyReserved]),
    articles: articles.map((a) => [a.id, String(a.pump)]),
    documents,
    cash,
    lots,
    cheques
  });
}

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Djemroud2026' })
  });
  TOKEN = (await login.json()).token;

  console.log('=== INSTANTANE AVANT ===');
  const avant = await instantane();
  const avantObj = JSON.parse(avant);
  console.log(`  ${avantObj.partners.length} partenaires, ${avantObj.stocks.length} lignes de stock, ${avantObj.documents} documents, ${avantObj.cash} ecritures, ${avantObj.lots} lots`);

  // ---------- Preparation: entites de test ----------
  const depots = await prisma.depot.findMany({ orderBy: { code: 'asc' } });
  const depotA = depots[0];
  const depotB = depots[1] ?? depots[0];
  const catClient = await prisma.partnerCategory.findFirstOrThrow({ where: { isSupplier: false } });
  const catFourn = await prisma.partnerCategory.findFirst({ where: { isSupplier: true } });
  const motifMoins = await prisma.typeRegule.findFirstOrThrow({ where: { code: 'CASSE' } });
  const motifPlus = await prisma.typeRegule.findFirstOrThrow({ where: { code: 'DON' } });

  const client = await prisma.partner.create({
    data: { code: 'AUDIT-TMP-CLI', raisonSociale: 'AUDIT-TMP Client', categoryId: catClient.id, balance: 0 }
  });
  cree.partners.push(client.id);
  const fournisseur = await prisma.partner.create({
    data: { code: 'AUDIT-TMP-FRN', raisonSociale: 'AUDIT-TMP Fournisseur', categoryId: (catFourn ?? catClient).id, balance: 0 }
  });
  cree.partners.push(fournisseur.id);

  const article = await prisma.article.create({
    data: {
      code: 'AUDIT-TMP-ART',
      designation: 'AUDIT-TMP Article suivi par lot',
      pump: 100,
      tvaRate: 19,
      suiviLot: true,
      colisage: 12,
      stocks: { create: [{ depotId: depotA.id, qtyInStock: 0 }, { depotId: depotB.id, qtyInStock: 0 }] },
      prices: { create: [{ categoryId: catClient.id, priceHT: 150, priceTTC: 178.5 }] }
    }
  });
  cree.articles.push(article.id);

  const ligne = (over: Record<string, unknown> = {}) => ({
    articleId: article.id,
    depotId: depotA.id,
    quantity: 10,
    unitPriceHT: 150,
    discountPercent: 0,
    tvaRate: 19,
    ...over
  });

  console.log('\n=== A. ACHAT AVEC LOT ET UG ===');
  const achat = await appel('POST', '/documents', {
    type: 'ACHAT',
    partnerId: fournisseur.id,
    depotId: depotA.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    lines: [ligne({ quantity: 100, unitPriceHT: 200, quantiteBonus: 20, numeroLot: 'AUDIT-L1', datePeremption: dansNJours(400).toISOString() })]
  });
  verifier('achat cree', achat.status === 201, JSON.stringify(achat.body).slice(0, 120));
  cree.documents.push(achat.body.id);
  const vAchat = await appel('POST', `/documents/${achat.body.id}/validate`);
  verifier('achat valide', vAchat.status === 200);

  const stockA1 = await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depotA.id } });
  const lotsA1 = await prisma.lot.findMany({ where: { articleId: article.id, depotId: depotA.id } });
  cree.lots.push(...lotsA1.map((l) => l.id));
  verifier('120 unites en stock (100 payees + 20 offertes)', stockA1.qtyInStock === 120, `recu ${stockA1.qtyInStock}`);
  verifier('le lot contient les 120', lotsA1.reduce((s, l) => s + l.qtyInStock, 0) === 120);
  const art1 = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  // Valeur acquise 100 x 200 = 20 000 pour 120 unites => 166,67
  verifier('P.U.M.P baisse grace aux UG', Math.abs(Number(art1.pump) - 20000 / 120) < 0.01, `pump=${art1.pump}`);

  console.log('\n=== B. LOT PERIME BLOQUE LA VENTE ===');
  const lotPerime = await prisma.lot.create({
    data: { articleId: article.id, depotId: depotA.id, numeroLot: 'AUDIT-PERIME', datePeremption: dansNJours(-3), qtyInStock: 500 }
  });
  cree.lots.push(lotPerime.id);
  await prisma.articleStock.update({ where: { id: stockA1.id }, data: { qtyInStock: { increment: 500 } } });

  const venteTrop = await appel('POST', '/documents', {
    type: 'VENTE',
    partnerId: client.id,
    depotId: depotA.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [ligne({ quantity: 400 })]
  });
  verifier('vente refusee: le perime ne compte pas', venteTrop.status === 400 && venteTrop.body.message === 'LOT_STOCK_INSUFFISANT', JSON.stringify(venteTrop.body));

  console.log('\n=== C. VENTE FEFO ===');
  const lotProche = await prisma.lot.create({
    data: { articleId: article.id, depotId: depotA.id, numeroLot: 'AUDIT-PROCHE', datePeremption: dansNJours(20), qtyInStock: 30 }
  });
  cree.lots.push(lotProche.id);
  await prisma.articleStock.update({ where: { id: stockA1.id }, data: { qtyInStock: { increment: 30 } } });

  const vente = await appel('POST', '/documents', {
    type: 'VENTE',
    partnerId: client.id,
    depotId: depotA.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [ligne({ quantity: 40 })]
  });
  verifier('vente creee', vente.status === 201, JSON.stringify(vente.body).slice(0, 120));
  cree.documents.push(vente.body.id);

  const alloc = await prisma.documentLineLot.findMany({
    where: { documentLine: { documentId: vente.body.id } },
    include: { lot: true }
  });
  const parLot = Object.fromEntries(alloc.map((a) => [a.lot.numeroLot, a.quantity]));
  verifier('FEFO: 30 du lot proche puis 10 du lot lointain', parLot['AUDIT-PROCHE'] === 30 && parLot['AUDIT-L1'] === 10, JSON.stringify(parLot));
  verifier('aucune allocation sur le lot perime', !parLot['AUDIT-PERIME']);

  await appel('POST', `/documents/${vente.body.id}/validate`);
  const soldeClient = await prisma.partner.findUniqueOrThrow({ where: { id: client.id } });
  verifier('solde client debite du TTC', Math.abs(Number(soldeClient.balance) - 40 * 150 * 1.19) < 0.01, `solde=${soldeClient.balance}`);

  console.log('\n=== D. TRANSFERT AVEC LOTS ===');
  const transfert = await appel('POST', '/documents', {
    type: 'TRANSFERT',
    depotId: depotA.id,
    destDepotId: depotB.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    lines: [ligne({ quantity: 25, unitPriceHT: 0, tvaRate: 0 })]
  });
  verifier('transfert cree', transfert.status === 201, JSON.stringify(transfert.body).slice(0, 120));
  cree.documents.push(transfert.body.id);
  await appel('POST', `/documents/${transfert.body.id}/validate`);

  const lotsB = await prisma.lot.findMany({ where: { articleId: article.id, depotId: depotB.id } });
  cree.lots.push(...lotsB.map((l) => l.id));
  const stockB = await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depotB.id } });
  verifier('la marchandise arrive au depot B', stockB.qtyInStock === 25, `stock=${stockB.qtyInStock}`);
  verifier('les lots suivent au depot B', lotsB.reduce((s, l) => s + l.qtyInStock, 0) === 25, `lots=${lotsB.reduce((s, l) => s + l.qtyInStock, 0)}`);
  verifier('le numero de lot est conserve', lotsB.every((l) => l.numeroLot.startsWith('AUDIT-')), JSON.stringify(lotsB.map((l) => l.numeroLot)));

  const stockAapresT = await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depotA.id } });
  const lotsAapresT = await prisma.lot.findMany({ where: { articleId: article.id, depotId: depotA.id } });
  verifier(
    'depot A: total et ventilation concordent',
    stockAapresT.qtyInStock === lotsAapresT.reduce((s, l) => s + l.qtyInStock, 0),
    `stock=${stockAapresT.qtyInStock} lots=${lotsAapresT.reduce((s, l) => s + l.qtyInStock, 0)}`
  );
  verifier('aucune reservation residuelle au depot A', lotsAapresT.every((l) => l.qtyReserved === 0));

  console.log('\n=== E. REGULES: motif obligatoire et sens ===');
  const reguleSansMotif = await appel('POST', '/documents', {
    type: 'REGULE_MOINS',
    depotId: depotA.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    lines: [ligne({ quantity: 1, unitPriceHT: 100, tvaRate: 0 })]
  });
  verifier('regule sans motif refusee', reguleSansMotif.body.message === 'TYPE_REGULE_REQUIRED', JSON.stringify(reguleSansMotif.body));

  const reguleMauvaisSens = await appel('POST', '/documents', {
    type: 'REGULE_PLUS',
    depotId: depotA.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    typeReguleId: motifMoins.id,
    lines: [ligne({ quantity: 1, unitPriceHT: 100, tvaRate: 0, numeroLot: 'AUDIT-L1', datePeremption: dansNJours(400).toISOString() })]
  });
  verifier(
    'casse refusee sur une entree',
    String(reguleMauvaisSens.body.message).startsWith('TYPE_REGULE_MAUVAIS_SENS'),
    JSON.stringify(reguleMauvaisSens.body)
  );

  const regulePlus = await appel('POST', '/documents', {
    type: 'REGULE_PLUS',
    depotId: depotA.id,
    paymentMode: 'VIREMENT',
    remise: 0,
    typeReguleId: motifPlus.id,
    lines: [ligne({ quantity: 5, unitPriceHT: 100, tvaRate: 0, numeroLot: 'AUDIT-L1', datePeremption: dansNJours(400).toISOString() })]
  });
  verifier('regule plus avec bon motif acceptee', regulePlus.status === 201, JSON.stringify(regulePlus.body).slice(0, 120));
  if (regulePlus.body?.id) {
    cree.documents.push(regulePlus.body.id);
    await appel('POST', `/documents/${regulePlus.body.id}/validate`);
  }

  console.log('\n=== F. CONTINGENTEMENT (UG comprises) ===');
  await prisma.article.update({ where: { id: article.id }, data: { maxQtyPerClient: 10 } });
  const contingent = await appel('POST', '/documents', {
    type: 'VENTE',
    partnerId: client.id,
    depotId: depotA.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [ligne({ quantity: 8, quantiteBonus: 5 })]
  });
  verifier('plafond contourne par les UG refuse', String(contingent.body.message).startsWith('RATIONED_ARTICLE'), JSON.stringify(contingent.body));
  await prisma.article.update({ where: { id: article.id }, data: { maxQtyPerClient: null } });

  console.log('\n=== G. CAISSE: brouillon -> validation -> annulation ===');
  const soldeAvantCaisse = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  const ecriture = await appel('POST', '/cash', {
    type: 'RECETTE',
    amount: 500,
    paymentMode: 'ESPECE',
    description: 'AUDIT-TMP reglement',
    partnerId: client.id,
    status: 'OUVERT'
  });
  verifier('ecriture creee en brouillon', ecriture.status === 201 && ecriture.body.status === 'OUVERT');
  cree.cash.push(ecriture.body.id);
  const soldeApresSaisie = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('un brouillon n impute rien', Math.abs(soldeApresSaisie - soldeAvantCaisse) < 0.001);

  await appel('POST', `/cash/${ecriture.body.id}/validate`);
  const soldeApresValid = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('la validation impute', Math.abs(soldeApresValid - (soldeAvantCaisse - 500)) < 0.001, `solde=${soldeApresValid}`);

  await appel('POST', `/cash/${ecriture.body.id}/cancel`);
  const soldeApresAnnul = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('l annulation contrepasse', Math.abs(soldeApresAnnul - soldeAvantCaisse) < 0.001, `solde=${soldeApresAnnul}`);

  console.log('\n=== H. CHEQUE: cycle complet ===');
  const cheque = await appel('POST', '/cheques', {
    type: 'RECETTE',
    partnerId: client.id,
    numeroCheque: 'AUDIT-TMP-CHQ',
    montant: 1000,
    banque: 'BNA'
  });
  verifier('cheque cree en instance', cheque.status === 201 && cheque.body.etat === 'EN_INSTANCE', JSON.stringify(cheque.body).slice(0, 120));
  cree.cheques.push(cheque.body.id);
  const soldeApresCheque = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('la remise impute le solde', Math.abs(soldeApresCheque - (soldeApresAnnul - 1000)) < 0.001);

  await appel('PUT', `/cheques/${cheque.body.id}/etat`, { etat: 'PAYE' });
  const ecritureBanque = await prisma.cashTransaction.findFirst({ where: { reference: 'AUDIT-TMP-CHQ' } });
  verifier('l encaissement genere l ecriture de banque', !!ecritureBanque);
  if (ecritureBanque) cree.cash.push(ecritureBanque.id);

  await appel('PUT', `/cheques/${cheque.body.id}/etat`, { etat: 'ANNULE' });
  const contrepassation = await prisma.cashTransaction.findMany({ where: { reference: 'AUDIT-TMP-CHQ' } });
  cree.cash.push(...contrepassation.map((c) => c.id));
  const soldeApresImpaye = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('l impaye rend la dette', Math.abs(soldeApresImpaye - soldeApresAnnul) < 0.001, `solde=${soldeApresImpaye}`);
  verifier('le journal garde l aller-retour', contrepassation.length === 2, `ecritures=${contrepassation.length}`);

  console.log('\n=== I. BON DE PREPARATION: expiration ===');
  const bp = await appel('POST', '/documents', {
    type: 'BON_PREPARATION',
    partnerId: client.id,
    depotId: depotA.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [ligne({ quantity: 10 })]
  });
  verifier('BP cree', bp.status === 201, JSON.stringify(bp.body).slice(0, 120));
  cree.documents.push(bp.body.id);
  const lotsReserves = await prisma.lot.findMany({ where: { articleId: article.id, depotId: depotA.id } });
  verifier('le BP reserve les lots', lotsReserves.some((l) => l.qtyReserved > 0));

  await prisma.document.update({ where: { id: bp.body.id }, data: { dateValidite: dansNJours(-1) } });
  const balayage = await appel('POST', '/documents/expire-bons-preparation');
  verifier('le balayage libere le BP echu', balayage.body.count === 1, JSON.stringify(balayage.body));
  const lotsApresBalayage = await prisma.lot.findMany({ where: { articleId: article.id, depotId: depotA.id } });
  verifier('les lots sont liberes', lotsApresBalayage.every((l) => l.qtyReserved === 0));
  const valideApresExpire = await appel('POST', `/documents/${bp.body.id}/validate`);
  verifier('un BP echu ne se valide plus', valideApresExpire.body.message === 'DOCUMENT_EXPIRE', JSON.stringify(valideApresExpire.body));

  console.log('\n=== J. TIMBRE FISCAL PROGRESSIF ===');
  const venteEspece = await appel('POST', '/documents/preview', {
    type: 'VENTE',
    partnerId: client.id,
    depotId: depotA.id,
    paymentMode: 'ESPECE',
    remise: 0,
    lines: [ligne({ quantity: 1, unitPriceHT: 50000, tvaRate: 0 })]
  });
  if (venteEspece.status === 200) {
    // 50 000 TTC => tranche 1,5 % => 750
    verifier('timbre 1,5 % dans la tranche 30k-100k', Math.abs(venteEspece.body.stampDuty - 750) < 0.01, `timbre=${venteEspece.body.stampDuty}`);
  } else {
    console.log(`  (apercu indisponible: ${venteEspece.status})`);
  }

  // ---------- NETTOYAGE ----------
  console.log('\n=== NETTOYAGE ===');
  for (const id of [...cree.documents].reverse()) {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) continue;
    if (doc.status === 'VALIDE') await appel('POST', `/documents/${id}/cancel`);
  }
  await prisma.documentLineLot.deleteMany({ where: { documentLine: { documentId: { in: cree.documents } } } });
  await prisma.documentLine.deleteMany({ where: { documentId: { in: cree.documents } } });
  await prisma.cheque.deleteMany({ where: { id: { in: cree.cheques } } });
  await prisma.cashTransaction.deleteMany({ where: { documentId: { in: cree.documents } } });
  await prisma.cashTransaction.deleteMany({ where: { id: { in: cree.cash } } });
  await prisma.document.deleteMany({ where: { id: { in: cree.documents } } });
  await prisma.lot.deleteMany({ where: { articleId: { in: cree.articles } } });
  await prisma.articlePrice.deleteMany({ where: { articleId: { in: cree.articles } } });
  await prisma.articleStock.deleteMany({ where: { articleId: { in: cree.articles } } });
  await prisma.article.deleteMany({ where: { id: { in: cree.articles } } });
  await prisma.partner.deleteMany({ where: { id: { in: cree.partners } } });
  console.log('  entites de test supprimees');

  console.log('\n=== INSTANTANE APRES ===');
  const apres = await instantane();
  verifier('la base est revenue a son etat initial', avant === apres);
  if (avant !== apres) {
    const a = JSON.parse(avant);
    const b = JSON.parse(apres);
    for (const cle of Object.keys(a)) {
      if (JSON.stringify(a[cle]) !== JSON.stringify(b[cle])) {
        console.log(`  DIFFERENCE sur ${cle}:`);
        console.log(`    avant: ${JSON.stringify(a[cle]).slice(0, 300)}`);
        console.log(`    apres: ${JSON.stringify(b[cle]).slice(0, 300)}`);
      }
    }
  }

  console.log(`\n=== RESULTAT: ${ok} verifications OK, ${echecs.length} echec(s) ===`);
  echecs.forEach((e) => console.log(`  - ${e}`));

  await prisma.$disconnect();
  process.exit(echecs.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERREUR FATALE', e);
  await prisma.$disconnect();
  process.exit(2);
});
