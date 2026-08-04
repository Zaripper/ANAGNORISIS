import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  buildDocumentPreview,
  cancelDocument,
  createDocument,
  deleteDraftDocument,
  updateDraftDocument,
  validateDocument
} from '../services/document.service';
import { getChiffreAffaires, getDashboardSummary, getVentesArticles } from '../services/report.service';
import {
  createArticleSchema,
  createCashTransactionSchema,
  createChargeClassSchema,
  createChargeSchema,
  createCommentSchema,
  createDepotSchema,
  createDocumentSchema,
  createLivreurSchema,
  createPartnerCategorySchema,
  createPartnerSchema,
  createTypeReglementSchema,
  createZoneSchema,
  loginSchema,
  paymentModes,
  updateArticleSchema,
  updateChargeClassSchema,
  updateChargeSchema,
  updateDepotSchema,
  updateDocumentSchema,
  updateLivreurSchema,
  updatePartnerCategorySchema,
  updatePartnerSchema,
  updateTypeReglementSchema,
  updateZoneSchema
} from '../../../shared/src';
import { prisma } from '../prisma';
import { config } from '../config';
import { requireAuth, requireRole, signToken } from '../middleware/auth';

export const api = Router();

function handleError(res: any, error: unknown) {
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
    res.json({ token: signToken(authUser), user: authUser });
  } catch (error) {
    handleError(res, error);
  }
});

api.get('/auth/me', requireAuth, (req, res) => res.json(req.user));

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
api.get('/partners', async (_req, res) => {
  res.json(await prisma.partner.findMany({ include: { category: true, zone: true }, orderBy: { raisonSociale: 'asc' } }));
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
api.get('/articles', async (_req, res) => {
  res.json(
    await prisma.article.findMany({
      include: { prices: { include: { category: true } }, stocks: { include: { depot: true } } },
      orderBy: { designation: 'asc' }
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
            update: { priceHT: price.priceHT, priceTTC: price.priceTTC },
            create: { articleId: updated.id, categoryId: price.categoryId, priceHT: price.priceHT, priceTTC: price.priceTTC }
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

api.get('/type-reglements', async (_req, res) => {
  res.json(await prisma.typeReglement.findMany({ orderBy: { label: 'asc' } }));
});

api.post('/type-reglements', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = createTypeReglementSchema.parse(req.body);
    res.status(201).json(await prisma.typeReglement.create({ data: input }));
  } catch (error) {
    handleError(res, error);
  }
});

api.put('/type-reglements/:id', requireRole('ADMINISTRATEUR'), async (req, res) => {
  try {
    const input = updateTypeReglementSchema.parse(req.body);
    res.json(await prisma.typeReglement.update({ where: { id: req.params.id }, data: input }));
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
api.get('/stocks', async (_req, res) => {
  res.json(await prisma.articleStock.findMany({ include: { article: true, depot: true } }));
});

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
      take: 100
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

// ---------- Cash journal ----------
api.get('/cash', async (req, res) => {
  const { paymentMode } = req.query;
  let paymentModeFilter: any;
  if (paymentMode === 'NON_ESPECE') {
    paymentModeFilter = { not: 'ESPECE' };
  } else if (typeof paymentMode === 'string' && paymentModes.includes(paymentMode as any)) {
    paymentModeFilter = paymentMode;
  }

  const transactions = await prisma.cashTransaction.findMany({
    where: { paymentMode: paymentModeFilter },
    include: { partner: true },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  const totalBalance = transactions.reduce((sum: number, tx) => sum + Number(tx.amount) * (tx.type === 'RECETTE' ? 1 : -1), 0);
  res.json({ transactions, totalBalance });
});

api.post('/cash', requireRole('ADMINISTRATEUR', 'CAISSIER'), async (req, res) => {
  try {
    const input = createCashTransactionSchema.parse(req.body);

    const transaction = await prisma.$transaction(async (tx) => {
      if (input.partnerId) {
        const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
        if (!partner) throw new Error('PARTNER_NOT_FOUND');
      }

      const created = await tx.cashTransaction.create({ data: input, include: { partner: true } });

      // A cash/cheque/virement entry tied to a partner is a settlement: it always
      // pays down whatever is outstanding in that relationship (whether they owed
      // us or we owed them), so it always decrements the balance — regardless of
      // whether it's booked as a RECETTE or a DEPENSE in the cash journal itself.
      if (input.partnerId) {
        await tx.partner.update({ where: { id: input.partnerId }, data: { balance: { decrement: input.amount } } });
      }

      return created;
    });

    res.status(201).json(transaction);
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
