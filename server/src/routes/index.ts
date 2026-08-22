import { Router } from 'express';
import { ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import { cancelCashEntry, createCashEntry, validateCashEntry } from '../services/caisse.service';
import { alerteJours, listerLots, valeurLotsPerimes } from '../services/lot.service';
import { consultationStocks } from '../services/stock.service';
import {
  buildDocumentPreview,
  cancelDocument,
  createDocument,
  deleteDraftDocument,
  expireBonsPreparation,
  factureFromBonLivraison,
  receiveCommande,
  updateDraftDocument,
  validateDocument
} from '../services/document.service';
import { changeChequeEtat, createCheque, listCheques } from '../services/cheque.service';
import {
  getArticleMovements,
  getCAByLivreur,
  getChiffreAffaires,
  getDashboardSummary,
  getEtat104,
  getFiscalSummary,
  getReorderAlerts,
  getVentesArticles
} from '../services/report.service';
import {
  createArticleSchema,
  cashStatuses,
  createCashTransactionSchema,
  createChargeClassSchema,
  createChargeSchema,
  createChequeSchema,
  createCommentSchema,
  createDepotSchema,
  createDocumentSchema,
  createLivreurSchema,
  createPartnerCategorySchema,
  createPartnerSchema,
  createTypeReguleSchema,
  createUserSchema,
  createZoneSchema,
  loginSchema,
  updateChequeEtatSchema,
  updateSettingsSchema,
  updateUserAccessSchema,
  updateUserSchema,
  paymentModes,
  updateArticleSchema,
  updateChargeClassSchema,
  updateChargeSchema,
  updateDepotSchema,
  updateDocumentSchema,
  updateLivreurSchema,
  updatePartnerCategorySchema,
  updatePartnerSchema,
  updateTypeReguleSchema,
  updateZoneSchema
} from '../../../shared/src';
import { prisma } from '../prisma';
import { config } from '../config';
import { requireAuth, requireRole, signToken } from '../middleware/auth';

export const api = Router();

/**
 * Reponse d'erreur.
 *
 * Les erreurs de validation Zod sont traitees a part: `ZodError.message` est le
 * tableau des problemes serialise en JSON, et le renvoyer tel quel affichait un
 * pave de JSON a l'ecran. Pire, les regles metier exprimees en `superRefine`
 * (PARTNER_REQUIRED_FOR_TYPE, TYPE_REGULE_REQUIRED, LINE_QUANTITY_REQUIRED)
 * passent par ce chemin: noyees dans le JSON, elles n'arrivaient jamais au
 * client sous forme de code exploitable. On remonte donc le premier message
 * personnalise s'il existe, et VALIDATION_ERROR sinon.
 */
function handleError(res: any, error: unknown) {
  if (error instanceof ZodError) {
    // Le code metier n'est remonte que si TOUS les problemes en sont: quand la
    // saisie est aussi mal formee (uuid invalide, lignes absentes), c'est cela
    // qu'il faut signaler d'abord — annoncer "partenaire obligatoire" sur un
    // corps de requete casse enverrait l'utilisateur corriger le mauvais champ.
    const tousMetier = error.issues.every((i) => i.code === 'custom' && /^[A-Z_]+$/.test(i.message));
    const custom = tousMetier ? error.issues[0] : undefined;
    const champs = error.issues.map((i) => i.path.join('.')).filter(Boolean);
    return res.status(400).json({
      message: custom ? custom.message : 'VALIDATION_ERROR',
      fields: [...new Set(champs)]
    });
  }

  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const status = message.endsWith('_NOT_FOUND') ? 404 : 400;
  res.status(status).json({ message });
}

api.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'anagnorisis-erp-api' });
});

// ---------- Auth ----------
api.post('/auth/login', async (req, res) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return res.status(401).json({ message: 'INVALID_CREDENTIALS' });
    }
    const authUser = { id: user.id, username: user.username, role: user.role };
    /*
     * Les droits d'ecran accompagnent la session mais ne sont PAS dans le jeton:
     * un jeton est valable douze heures, et un droit retire doit prendre effet
     * a la connexion suivante, pas a l'expiration du jeton. Ils sont donc relus
     * a chaque `/auth/me`.
     */
    res.json({
      token: signToken(authUser),
      user: { ...authUser, accesPersonnalise: user.accesPersonnalise, screenAccess: user.screenAccess },
      mustChangePassword: user.mustChangePassword
    });
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/auth/me', requireAuth, async (req, res) => {
  // Relecture en base: un droit retire pendant la session doit s'appliquer au
  // prochain rafraichissement, sans attendre l'expiration du jeton.
  const frais = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, username: true, role: true, active: true, accesPersonnalise: true, screenAccess: true }
  });
  if (!frais || !frais.active) return res.status(401).json({ message: 'SESSION_EXPIRED' });
  res.json(frais);
});

// Every route below requires a valid session.
api.use(requireAuth);

// ---------- Partner categories ----------
api.get('/partner-categories', async (_req, res) => {
  res.json(await prisma.partnerCategory.findMany({ orderBy: { label: 'asc' } }));
});

api.post('/partner-categories', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createPartnerCategorySchema.parse(req.body);
    res.status(201).json(await prisma.partnerCategory.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/partner-categories/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updatePartnerCategorySchema.parse(req.body);
    res.json(await prisma.partnerCategory.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Partners ----------
api.get('/partners', async (req, res) => {
  const { limit, offset, q } = paging(req);
  res.json(
    await prisma.partner.findMany({
      where: q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { raisonSociale: { contains: q, mode: 'insensitive' } }] } : undefined,
      include: { category: true, zone: true },
      orderBy: { raisonSociale: 'asc' },
      take: limit,
      skip: offset
    })
  );
});

api.post('/partners', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createPartnerSchema.parse(req.body);
    const partner = await prisma.partner.create({ data: input, include: { category: true, zone: true } });
    res.status(201).json(partner);
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/partners/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updatePartnerSchema.parse(req.body);
    const partner = await prisma.partner.update({ where: { id: req.params.id }, data: input, include: { category: true, zone: true } });
    res.json(partner);
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/partners/:id/history', async (req, res) => {
  const partner = await prisma.partner.findUnique({
    where: { id: req.params.id },
    include: {
      category: true,
      documents: { orderBy: { createdAt: 'desc' }, include: { lines: true } },
      cashTransactions: { orderBy: { createdAt: 'desc' } }
    }
  });
  if (!partner) return res.status(404).json({ message: 'PARTNER_NOT_FOUND' });
  res.json(partner);
});

// ---------- Articles ----------
/** Shared paging: ?limit (≤1000), ?offset, ?q. Defaults keep existing clients working. */
function paging(req: any, defLimit = 20000) {
  const limit = Math.min(Math.max(Number(req.query.limit) || defLimit, 1), 50000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  return { limit, offset, q };
}

api.get('/articles', async (req, res) => {
  const { limit, offset, q } = paging(req);
  res.json(
    await prisma.article.findMany({
      where: q
        ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { designation: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q } }] }
        : undefined,
      include: {
        prices: { include: { category: true } },
        stocks: { include: { depot: true } },
        mainSupplier: true,
        // Le lot qui perime le plus tot: c'est celui qui partira en premier
        // (FEFO), donc la seule date qui interesse le vendeur au moment de
        // choisir l'article.
        lots: {
          where: { qtyInStock: { gt: 0 } },
          orderBy: { datePeremption: 'asc' },
          take: 1,
          select: { numeroLot: true, datePeremption: true }
        }
      },
      orderBy: { designation: 'asc' },
      take: limit,
      skip: offset
    })
  );
});

api.get('/comments', async (req, res) => {
  const { entityType, entityId } = req.query;
  if (typeof entityType !== 'string' || typeof entityId !== 'string') return res.json([]);
  res.json(await prisma.comment.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'asc' } }));
});

api.post('/comments', requireRole('ADMINISTRATEUR', 'CAISSIER', 'AGENT'), async (req, res) => {
  try {
    const input = createCommentSchema.parse(req.body);
    res.status(201).json(await prisma.comment.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/articles', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createArticleSchema.parse(req.body);
    const article = await prisma.article.create({
      data: {
        code: input.code,
        barcode: input.barcode ?? null,
        designation: input.designation,
        category: input.category ?? null,
        pump: input.pump,
        tvaRate: input.tvaRate,
        seuilReappro: input.seuilReappro ?? null,
        quantiteReappro: input.quantiteReappro ?? null,
        securite: input.securite ?? null,
        colisage: input.colisage ?? 0,
        tauxRefaction: input.tauxRefaction ?? 0,
        mainSupplierId: input.mainSupplierId ?? null,
        preferred: input.preferred ?? false,
        suiviLot: input.suiviLot ?? false,
        ppa: input.ppa ?? 0,
        tauxUGAutorise: input.tauxUGAutorise ?? 0,
        maxQtyPerClient: input.maxQtyPerClient ?? null,
        prices: { create: input.prices }
      },
      include: { prices: { include: { category: true } } }
    });
    res.status(201).json(article);
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/articles/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateArticleSchema.parse(req.body);
    const { prices, ...rest } = input;
    const article = await prisma.$transaction(async (tx) => {
      const updated = await tx.article.update({ where: { id: req.params.id }, data: rest });
      if (prices) {
        for (const price of prices) {
          await tx.articlePrice.upsert({
            where: { articleId_categoryId: { articleId: updated.id, categoryId: price.categoryId } },
            update: { priceHT: price.priceHT, priceTTC: price.priceTTC, policy: price.policy, taux: price.taux },
            create: {
              articleId: updated.id,
              categoryId: price.categoryId,
              priceHT: price.priceHT,
              priceTTC: price.priceTTC,
              policy: price.policy,
              taux: price.taux
            }
          });
        }
      }
      return tx.article.findUnique({
        where: { id: updated.id },
        include: { prices: { include: { category: true } }, stocks: { include: { depot: true } } }
      });
    });
    res.json(article);
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/articles/:id/details', async (req, res) => {
  const article = await prisma.article.findUnique({
    where: { id: req.params.id },
    include: { prices: { include: { category: true } }, stocks: { include: { depot: true } } }
  });
  if (!article) return res.status(404).json({ message: 'ARTICLE_NOT_FOUND' });
  res.json(article);
});

// ---------- Master data ----------
api.get('/livreurs', async (_req, res) => {
  res.json(await prisma.livreur.findMany({ orderBy: { name: 'asc' } }));
});

api.post('/livreurs', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createLivreurSchema.parse(req.body);
    res.status(201).json(await prisma.livreur.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/livreurs/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateLivreurSchema.parse(req.body);
    res.json(await prisma.livreur.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/zones', async (_req, res) => {
  res.json(await prisma.zone.findMany({ orderBy: { name: 'asc' } }));
});

api.post('/zones', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createZoneSchema.parse(req.body);
    res.status(201).json(await prisma.zone.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/zones/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateZoneSchema.parse(req.body);
    res.json(await prisma.zone.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/charge-classes', async (_req, res) => {
  res.json(await prisma.chargeClass.findMany({ orderBy: { label: 'asc' } }));
});

api.post('/charge-classes', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createChargeClassSchema.parse(req.body);
    res.status(201).json(await prisma.chargeClass.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/charge-classes/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateChargeClassSchema.parse(req.body);
    res.json(await prisma.chargeClass.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/types-regules', async (_req, res) => {
  res.json(await prisma.typeRegule.findMany({ orderBy: { label: 'asc' } }));
});

api.post('/types-regules', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createTypeReguleSchema.parse(req.body);
    res.status(201).json(await prisma.typeRegule.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/types-regules/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateTypeReguleSchema.parse(req.body);
    res.json(await prisma.typeRegule.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/charges', async (_req, res) => {
  res.json(await prisma.charge.findMany({ include: { chargeClass: true, document: true }, orderBy: { date: 'desc' } }));
});

/**
 * `date` arrives as an optional ISO string but the column is non-nullable with a
 * `now()` default, so an explicit null must be dropped rather than forwarded —
 * passing it through would make Prisma reject the write at runtime.
 */
function chargeDateFields(date: string | null | undefined): { date?: Date } {
  if (!date) return {};
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_DATE');
  return { date: parsed };
}

api.post('/charges', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    const { date, ...input } = createChargeSchema.parse(req.body);
    const charge = await prisma.charge.create({
      data: { ...input, ...chargeDateFields(date) },
      include: { chargeClass: true, document: true }
    });
    res.status(201).json(charge);
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/charges/:id', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    const { date, ...input } = updateChargeSchema.parse(req.body);
    const charge = await prisma.charge.update({
      where: { id: req.params.id },
      data: { ...input, ...chargeDateFields(date) },
      include: { chargeClass: true, document: true }
    });
    res.json(charge);
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Depots ----------
api.get('/depots', async (_req, res) => {
  res.json(await prisma.depot.findMany({ orderBy: { code: 'asc' } }));
});

api.post('/depots', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createDepotSchema.parse(req.body);
    res.status(201).json(await prisma.depot.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/depots/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateDepotSchema.parse(req.body);
    res.json(await prisma.depot.update({ where: { id: req.params.id }, data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Stock ----------
// ---------- Documents ----------
api.post('/documents/preview', async (req, res) => {
  try {
    res.json(await buildDocumentPreview(createDocumentSchema.parse(req.body)));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/documents', async (req, res) => {
  try {
    const document = await createDocument(createDocumentSchema.parse(req.body), req.user?.id);
    res.status(201).json(document);
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/documents', async (req, res) => {
  const { type, status, partnerId } = req.query;
  res.json(
    await prisma.document.findMany({
      where: {
        type: typeof type === 'string' ? (type as any) : undefined,
        status: typeof status === 'string' ? (status as any) : undefined,
        partnerId: typeof partnerId === 'string' ? partnerId : undefined
      },
      include: { partner: true, depot: true, destDepot: true, lines: true },
      orderBy: { createdAt: 'desc' },
      take: paging(req, 300).limit,
      skip: paging(req).offset
    })
  );
});

api.get('/documents/:id', async (req, res) => {
  const document = await prisma.document.findUnique({
    where: { id: req.params.id },
    include: { partner: true, depot: true, destDepot: true, lines: { include: { article: true, depot: true } } }
  });
  if (!document) return res.status(404).json({ message: 'DOCUMENT_NOT_FOUND' });
  res.json(document);
});

api.put('/documents/:id', async (req, res) => {
  try {
    res.json(await updateDraftDocument(req.params.id, updateDocumentSchema.parse(req.body)));
  } catch (error) {
    handleError(res, error);
  }
});

api.delete('/documents/:id', async (req, res) => {
  try {
    res.json(await deleteDraftDocument(req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/documents/:id/validate', async (req, res) => {
  try {
    res.json(await validateDocument(req.params.id, req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/documents/:id/cancel', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    res.json(await cancelDocument(req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * Balayage des bons de preparation echus. Declenche a l'ouverture de l'ecran des
 * bons plutot que par une tache planifiee: le poste serveur d'une petite
 * structure n'est pas toujours allume, et une reservation ne doit pas survivre a
 * un week-end machine eteinte.
 */
api.post('/documents/expire-bons-preparation', async (_req, res) => {
  try {
    const liberes = await expireBonsPreparation();
    res.json({ liberes, count: liberes.length });
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Consultation des stocks ----------
/**
 * `?date=YYYY-MM-DD` reconstitue le stock tel qu'il etait a la fin de ce jour.
 * Sans parametre, l'etat courant (avec les quantites reservees, qui n'ont de
 * sens qu'au present).
 */
api.get('/stocks', async (req, res) => {
  try {
    const brut = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    let date: Date | undefined;
    if (brut) {
      const d = new Date(brut);
      if (Number.isNaN(d.getTime())) throw new Error('INVALID_DATE');
      date = d;
    }
    res.json(await consultationStocks(date));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Lots et peremption ----------
api.get('/lots', async (req, res) => {
  try {
    const perimesSeulement = req.query.perimes === '1';
    const [lots, jours, valeurPerimee] = await Promise.all([
      listerLots({ perimesSeulement }),
      alerteJours(),
      valeurLotsPerimes()
    ]);
    res.json({ lots, alerteJours: jours, valeurPerimee });
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Cash journal ----------
api.get('/cash', async (req, res) => {
  const { paymentMode, status } = req.query;
  let paymentModeFilter: any;
  if (paymentMode === 'NON_ESPECE') {
    paymentModeFilter = { not: 'ESPECE' };
  } else if (typeof paymentMode === 'string' && paymentModes.includes(paymentMode as any)) {
    paymentModeFilter = paymentMode;
  }

  const statusFilter =
    typeof status === 'string' && (cashStatuses as readonly string[]).includes(status) ? (status as any) : undefined;

  const transactions = await prisma.cashTransaction.findMany({
    where: { paymentMode: paymentModeFilter, status: statusFilter },
    include: { partner: true },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  // Le solde de caisse ne compte que les ecritures validees: un brouillon n'a
  // pas encore d'existence comptable, et l'inclure ferait afficher un fonds de
  // caisse que personne n'a compte.
  const totalBalance = transactions
    .filter((tx) => tx.status === 'VALIDE')
    .reduce((sum: number, tx) => sum + Number(tx.amount) * (tx.type === 'RECETTE' ? 1 : -1), 0);
  res.json({ transactions, totalBalance });
});

/**
 * Une ecriture liee a un partenaire est un reglement: elle solde ce qui est en
 * jeu dans la relation, que le partenaire nous doive ou que nous lui devions.
 * L'imputation vit desormais dans caisse.service, seul endroit qui touche un
 * solde depuis la caisse.
 */
api.post('/cash', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    const input = createCashTransactionSchema.parse(req.body);
    res.status(201).json(await createCashEntry(input, req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/cash/:id/validate', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    res.json(await validateCashEntry(req.params.id, req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

api.post('/cash/:id/cancel', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    res.json(await cancelCashEntry(req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Dashboard summary ----------
api.get('/summary', async (_req, res) => {
  const [partners, articles, depots, documents, stocks] = await Promise.all([
    prisma.partner.count(),
    prisma.article.count(),
    prisma.depot.count(),
    prisma.document.count(),
    prisma.articleStock.count()
  ]);
  res.json({ partners, articles, depots, documents, stocks });
});

// ---------- Reports ----------
api.get('/reports/dashboard', async (_req, res) => {
  try {
    res.json(await getDashboardSummary());
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/reports/chiffre-affaires', async (req, res) => {
  try {
    const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
    res.json(await getChiffreAffaires(months));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/reports/ventes-articles', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    res.json(await getVentesArticles(limit));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/config/server-url', (_req, res) => {
  res.json({ serverUrl: process.env.CORS_ORIGIN || `http://127.0.0.1:${config.port}` });
});

// ---------- Article intelligence ----------
api.get('/articles/reorder-alerts', async (_req, res) => {
  try {
    res.json(await getReorderAlerts());
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * Barcode/code lookup for the POS scan input. Exact barcode match first (that is
 * what a scanner emits), then exact article code, case-insensitively.
 */
api.get('/articles/lookup', async (req, res) => {
  const raw = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!raw) return res.status(400).json({ message: 'CODE_REQUIRED' });
  const article =
    (await prisma.article.findFirst({
      where: { barcode: raw, active: true },
      include: { prices: { include: { category: true } }, stocks: { include: { depot: true } } }
    })) ??
    (await prisma.article.findFirst({
      where: { code: { equals: raw, mode: 'insensitive' }, active: true },
      include: { prices: { include: { category: true } }, stocks: { include: { depot: true } } }
    }));
  if (!article) return res.status(404).json({ message: 'ARTICLE_NOT_FOUND' });
  res.json(article);
});

api.get('/articles/:id/movements', async (req, res) => {
  try {
    res.json(await getArticleMovements(req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Commandes (purchase orders) ----------
api.post('/documents/:id/receive', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    res.json(await receiveCommande(req.params.id, req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Facturation d'un bon de livraison ----------
api.post('/documents/:id/facturer', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    res.status(201).json(await factureFromBonLivraison(req.params.id, req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Users (admin only) ----------
api.get('/users', requireRole('ADMINISTRATEUR'), async (_req, res) => {
  res.json(
    await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        accesPersonnalise: true,
        screenAccess: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { username: 'asc' }
    })
  );
});

api.post('/users', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash: await bcrypt.hash(input.password, 10),
        role: input.role,
        active: input.active
      },
      select: { id: true, username: true, role: true, active: true, createdAt: true }
    });
    res.status(201).json(user);
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * Droits d'ecran d'un compte.
 *
 * Rappel volontaire: cocher un ecran decide de ce que la personne peut OUVRIR,
 * pas de ce que le serveur l'autorise a faire. Les routes sensibles restent
 * gardees par `requireRole` — masquer un menu n'a jamais protege une API.
 */
api.put('/users/:id/access', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateUserAccessSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        accesPersonnalise: input.accesPersonnalise,
        // Les doublons ne servent a rien et rendraient la comparaison bruyante.
        screenAccess: [...new Set(input.screenAccess)]
      },
      select: { id: true, username: true, role: true, active: true, accesPersonnalise: true, screenAccess: true }
    });
    res.json(user);
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/users/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateUserSchema.parse(req.body);

    // An admin cannot lock themselves out mid-session…
    if (req.params.id === req.user?.id && (input.active === false || (input.role && input.role !== 'ADMINISTRATEUR'))) {
      return res.status(400).json({ message: 'CANNOT_DEMOTE_SELF' });
    }
    // …and the system must always keep at least one active administrator.
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: 'USER_NOT_FOUND' });
    if (target.role === 'ADMINISTRATEUR' && (input.active === false || (input.role && input.role !== 'ADMINISTRATEUR'))) {
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMINISTRATEUR', active: true, id: { not: target.id } }
      });
      if (otherAdmins === 0) return res.status(400).json({ message: 'LAST_ADMIN_PROTECTED' });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        role: input.role,
        active: input.active,
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10), mustChangePassword: true } : {})
      },
      select: { id: true, username: true, role: true, active: true, updatedAt: true }
    });
    res.json(user);
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Application settings ----------
api.get('/settings', async (_req, res) => {
  const rows = await prisma.appSetting.findMany();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

api.put('/settings', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateSettingsSchema.parse(req.body);
    await prisma.$transaction(
      Object.entries(input).map(([key, value]) =>
        prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );
    const rows = await prisma.appSetting.findMany();
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Extended reports ----------
api.get('/reports/ca-livreurs', async (req, res) => {
  try {
    const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
    res.json(await getCAByLivreur(months));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/reports/etat-104', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(await getEtat104(year));
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/reports/fiscal', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(await getFiscalSummary(year));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Self-service password change (forced rotation lands here) ----------
api.post('/auth/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ message: 'PASSWORD_TOO_SHORT' });
    }
    if (newPassword === currentPassword) return res.status(400).json({ message: 'PASSWORD_UNCHANGED' });
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ message: 'INVALID_CREDENTIALS' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false }
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Backup & archive export (admin) ----------
/**
 * Logical JSON export of the whole database (or one year's operational data when
 * ?year= is given — the Archivage screen). This is a data escape hatch and an
 * off-machine backup the manager can download from any client station; the
 * README additionally documents pg_dump for full binary backups.
 */
api.get('/backup/export', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const year = Number(req.query.year) || null;
    const range = year ? { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } : undefined;

    const [users, depots, categories, zones, livreurs, chargeClasses, typesRegules, partners, articles, prices, stocks, documents, lines, charges, cash, comments, settings] =
      await Promise.all([
        prisma.user.findMany({ select: { id: true, username: true, role: true, active: true, createdAt: true } }),
        prisma.depot.findMany(),
        prisma.partnerCategory.findMany(),
        prisma.zone.findMany(),
        prisma.livreur.findMany(),
        prisma.chargeClass.findMany(),
        prisma.typeRegule.findMany(),
        prisma.partner.findMany(),
        prisma.article.findMany(),
        prisma.articlePrice.findMany(),
        prisma.articleStock.findMany(),
        prisma.document.findMany({ where: range ? { createdAt: range } : undefined }),
        prisma.documentLine.findMany({ where: range ? { document: { createdAt: range } } : undefined }),
        prisma.charge.findMany({ where: range ? { date: range } : undefined }),
        prisma.cashTransaction.findMany({ where: range ? { createdAt: range } : undefined }),
        prisma.comment.findMany(),
        prisma.appSetting.findMany()
      ]);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="anagnorisis-${year ? 'archive-' + year : 'backup'}-${stamp}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      scope: year ? { year } : 'full',
      counts: { partners: partners.length, articles: articles.length, documents: documents.length, cash: cash.length },
      data: { users, depots, categories, zones, livreurs, chargeClasses, typesRegules, partners, articles, prices, stocks, documents, lines, charges, cash, comments, settings }
    });
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- Raw table browser (admin, read-only, allowlisted) ----------
const BROWSABLE_TABLES = {
  User: () => prisma.user.findMany({ take: 200, select: { id: true, username: true, role: true, active: true, mustChangePassword: true, createdAt: true } }),
  Depot: () => prisma.depot.findMany({ take: 200 }),
  PartnerCategory: () => prisma.partnerCategory.findMany({ take: 200 }),
  Zone: () => prisma.zone.findMany({ take: 200 }),
  Livreur: () => prisma.livreur.findMany({ take: 200 }),
  ChargeClass: () => prisma.chargeClass.findMany({ take: 200 }),
  TypeRegule: () => prisma.typeRegule.findMany({ take: 200 }),
  Partner: () => prisma.partner.findMany({ take: 200 }),
  Article: () => prisma.article.findMany({ take: 200 }),
  ArticlePrice: () => prisma.articlePrice.findMany({ take: 200 }),
  ArticleStock: () => prisma.articleStock.findMany({ take: 200 }),
  Document: () => prisma.document.findMany({ take: 200, orderBy: { createdAt: 'desc' } }),
  DocumentLine: () => prisma.documentLine.findMany({ take: 200 }),
  Charge: () => prisma.charge.findMany({ take: 200 }),
  CashTransaction: () => prisma.cashTransaction.findMany({ take: 200, orderBy: { createdAt: 'desc' } }),
  Comment: () => prisma.comment.findMany({ take: 200 }),
  AppSetting: () => prisma.appSetting.findMany({ take: 200 })
} as const;

api.get('/admin/tables', requireRole('ADMINISTRATEUR'), (_req, res) => {
  res.json(Object.keys(BROWSABLE_TABLES));
});

api.get('/admin/tables/:name', requireRole('ADMINISTRATEUR'), async (req, res) => {
  const loader = BROWSABLE_TABLES[req.params.name as keyof typeof BROWSABLE_TABLES];
  if (!loader) return res.status(404).json({ message: 'TABLE_NOT_FOUND' });
  res.json(await loader());
});

// ---------- Cheques (cycle de vie) ----------
api.get('/cheques', async (req, res) => {
  const type = req.query.type === 'DEPENSE' ? 'DEPENSE' : 'RECETTE';
  res.json(await listCheques(type));
});

api.post('/cheques', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    res.status(201).json(await createCheque(createChequeSchema.parse(req.body), req.user?.id));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/cheques/:id/etat', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    const { etat } = updateChequeEtatSchema.parse(req.body);
    res.json(await changeChequeEtat(req.params.id, etat));
  } catch (error) {
    handleError(res, error);
  }
});
