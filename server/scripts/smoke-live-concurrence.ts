/**
 * Deuxieme passe live: concurrence reelle et controle des roles.
 *
 * Memes precautions que audit-live.ts: entites AUDIT-TMP, nettoyage integral,
 * instantane avant/apres.
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
let ADMIN = '';
let CAISSIER = '';

const cree = { documents: [] as string[], articles: [] as string[], partners: [] as string[], users: [] as string[] };
let ok = 0;
const echecs: string[] = [];

function verifier(nom: string, cond: boolean, detail = '') {
  if (cond) {
    ok++;
    console.log(`  OK   ${nom}`);
  } else {
    echecs.push(`${nom} ${detail}`);
    console.log(`  ECHEC ${nom} ${detail}`);
  }
}

async function appel(token: string, methode: string, chemin: string, corps?: unknown) {
  const res = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corps ? JSON.stringify(corps) : undefined
  });
  const t = await res.text();
  let body: any = null;
  try {
    body = t ? JSON.parse(t) : null;
  } catch {
    body = { brut: t };
  }
  return { status: res.status, body };
}

async function connexion(username: string, password: string) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return (await r.json()).token as string;
}

async function instantane() {
  const [partners, stocks, docs, cash] = await Promise.all([
    prisma.partner.findMany({ select: { id: true, balance: true }, orderBy: { id: 'asc' } }),
    prisma.articleStock.findMany({ select: { articleId: true, depotId: true, qtyInStock: true, qtyReserved: true }, orderBy: [{ articleId: 'asc' }, { depotId: 'asc' }] }),
    prisma.document.count(),
    prisma.cashTransaction.count()
  ]);
  return JSON.stringify({ partners: partners.map((p) => [p.id, String(p.balance)]), stocks, docs, cash });
}

async function main() {
  ADMIN = await connexion('admin', 'Djemroud2026');
  const avant = await instantane();

  const depot = await prisma.depot.findFirstOrThrow({ orderBy: { code: 'asc' } });
  const cat = await prisma.partnerCategory.findFirstOrThrow({ where: { isSupplier: false } });

  const client = await prisma.partner.create({
    data: { code: 'AUDIT-TMP-C2', raisonSociale: 'AUDIT-TMP Client 2', categoryId: cat.id, balance: 0 }
  });
  cree.partners.push(client.id);
  const article = await prisma.article.create({
    data: {
      code: 'AUDIT-TMP-A2',
      designation: 'AUDIT-TMP Article simple',
      pump: 100,
      tvaRate: 19,
      stocks: { create: [{ depotId: depot.id, qtyInStock: 1000 }] },
      prices: { create: [{ categoryId: cat.id, priceHT: 150, priceTTC: 178.5 }] }
    }
  });
  cree.articles.push(article.id);

  const corpsVente = {
    type: 'VENTE',
    partnerId: client.id,
    depotId: depot.id,
    paymentMode: 'CHEQUE',
    remise: 0,
    lines: [{ articleId: article.id, depotId: depot.id, quantity: 10, unitPriceHT: 150, discountPercent: 0, tvaRate: 19 }]
  };

  console.log('=== A. VALIDATIONS SIMULTANEES DU MEME DOCUMENT ===');
  const doc = await appel(ADMIN, 'POST', '/documents', corpsVente);
  cree.documents.push(doc.body.id);
  const stockAvant = (await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depot.id } })).qtyInStock;

  await Promise.all([
    appel(ADMIN, 'POST', `/documents/${doc.body.id}/validate`),
    appel(ADMIN, 'POST', `/documents/${doc.body.id}/validate`),
    appel(ADMIN, 'POST', `/documents/${doc.body.id}/validate`)
  ]);

  const stockApres = await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depot.id } });
  verifier('trois validations simultanees ne sortent le stock qu une fois', stockApres.qtyInStock === stockAvant - 10, `avant=${stockAvant} apres=${stockApres.qtyInStock}`);
  verifier('aucune reservation residuelle', stockApres.qtyReserved === 0, `reserve=${stockApres.qtyReserved}`);
  const solde = Number((await prisma.partner.findUniqueOrThrow({ where: { id: client.id } })).balance);
  verifier('le solde n est impute qu une fois', Math.abs(solde - 10 * 150 * 1.19) < 0.01, `solde=${solde}`);

  console.log('\n=== B. VENTES CONCURRENTES SUR LE MEME STOCK ===');
  const stockB0 = (await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depot.id } })).qtyInStock;
  const docs = await Promise.all([1, 2, 3, 4, 5].map(() => appel(ADMIN, 'POST', '/documents', corpsVente)));
  docs.forEach((d) => d.body?.id && cree.documents.push(d.body.id));
  const crees = docs.filter((d) => d.status === 201).length;
  verifier('cinq brouillons concurrents crees', crees === 5, `crees=${crees}`);

  await Promise.all(docs.filter((d) => d.body?.id).map((d) => appel(ADMIN, 'POST', `/documents/${d.body.id}/validate`)));
  const stockB1 = await prisma.articleStock.findFirstOrThrow({ where: { articleId: article.id, depotId: depot.id } });
  verifier('cinq ventes de 10 sortent exactement 50', stockB1.qtyInStock === stockB0 - 50, `attendu=${stockB0 - 50} obtenu=${stockB1.qtyInStock}`);
  verifier('references toutes distinctes', new Set(docs.map((d) => d.body?.reference)).size === 5);

  console.log('\n=== C. CONTROLE DES ROLES ===');
  const motDePasse = 'AuditTmp2026!';
  const u = await appel(ADMIN, 'POST', '/users', { username: 'audit-tmp-caissier', password: motDePasse, role: 'CAISSIER', active: true });
  if (u.status === 201) {
    cree.users.push(u.body.id);
    CAISSIER = await connexion('audit-tmp-caissier', motDePasse);
    verifier('le caissier obtient une session', !!CAISSIER);

    const creerArticle = await appel(CAISSIER, 'POST', '/articles', {
      code: 'AUDIT-TMP-INTERDIT',
      designation: 'interdit',
      pump: 1,
      tvaRate: 19,
      prices: []
    });
    verifier('un caissier ne cree pas d article', creerArticle.status === 403, `status=${creerArticle.status}`);

    const params = await appel(CAISSIER, 'PUT', '/settings', { 'company.name': 'PIRATE' });
    verifier('un caissier ne modifie pas les parametres', params.status === 403, `status=${params.status}`);

    const annuler = await appel(CAISSIER, 'POST', `/documents/${doc.body.id}/cancel`);
    verifier('un caissier n annule pas un document', annuler.status === 403, `status=${annuler.status}`);

    const lire = await appel(CAISSIER, 'GET', '/articles?limit=1');
    verifier('un caissier lit le catalogue', lire.status === 200, `status=${lire.status}`);

    const sansJeton = await fetch(`${API}/articles`);
    verifier('sans jeton, acces refuse', sansJeton.status === 401, `status=${sansJeton.status}`);
  } else {
    console.log('  (creation du caissier impossible: ' + JSON.stringify(u.body).slice(0, 100) + ')');
  }

  console.log('\n=== NETTOYAGE ===');
  for (const id of [...cree.documents].reverse()) {
    const d = await prisma.document.findUnique({ where: { id } });
    if (d?.status === 'VALIDE') await appel(ADMIN, 'POST', `/documents/${id}/cancel`);
  }
  await prisma.documentLineLot.deleteMany({ where: { documentLine: { documentId: { in: cree.documents } } } });
  await prisma.documentLine.deleteMany({ where: { documentId: { in: cree.documents } } });
  await prisma.cashTransaction.deleteMany({ where: { documentId: { in: cree.documents } } });
  await prisma.document.deleteMany({ where: { id: { in: cree.documents } } });
  await prisma.articlePrice.deleteMany({ where: { articleId: { in: cree.articles } } });
  await prisma.articleStock.deleteMany({ where: { articleId: { in: cree.articles } } });
  await prisma.article.deleteMany({ where: { id: { in: cree.articles } } });
  await prisma.article.deleteMany({ where: { code: { startsWith: 'AUDIT-TMP' } } });
  await prisma.partner.deleteMany({ where: { id: { in: cree.partners } } });
  await prisma.user.deleteMany({ where: { id: { in: cree.users } } });
  console.log('  supprime');

  const apres = await instantane();
  verifier('base revenue a son etat initial', avant === apres);
  if (avant !== apres) {
    console.log('  avant:', avant.slice(0, 400));
    console.log('  apres:', apres.slice(0, 400));
  }

  console.log(`\n=== RESULTAT: ${ok} OK, ${echecs.length} echec(s) ===`);
  echecs.forEach((e) => console.log('  - ' + e));
  await prisma.$disconnect();
  process.exit(echecs.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERREUR FATALE', e);
  await prisma.$disconnect();
  process.exit(2);
});
