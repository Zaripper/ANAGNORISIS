import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Taille du pool de connexions.
 *
 * Par défaut Prisma ouvre `nb_cœurs * 2 + 1` connexions, ce qui est juste pour un
 * déploiement LAN où plusieurs postes (caisse, bureau, dépôt) valident des
 * documents en même temps : les transactions se sérialisent sur le verrou de
 * numérotation et chacune immobilise une connexion pendant l'attente. Un pool
 * trop petit se traduit alors par des erreurs de transaction côté caisse.
 *
 * Réglable via DATABASE_CONNECTION_LIMIT si le serveur PostgreSQL est configuré
 * avec un max_connections différent (100 par défaut).
 */
function withConnectionLimit(url: string | undefined): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  const limit = Number(process.env.DATABASE_CONNECTION_LIMIT) || 20;
  return url.includes('?') ? `${url}&connection_limit=${limit}` : `${url}?connection_limit=${limit}`;
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    datasources: { db: { url: withConnectionLimit(process.env.DATABASE_URL) } }
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}
