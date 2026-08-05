import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves the DATABASE_URL for integration tests: the developer's configured
 * database with a dedicated `erp_test` schema appended, so tests run against a
 * REAL Postgres (transactions, advisory locks, constraints) while never touching
 * the application's data in the `public` schema.
 */
export function resolveTestDatabaseUrl(): string {
  const candidates = [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')];
  let base: string | undefined = process.env.DATABASE_URL;

  for (const file of candidates) {
    if (base) break;
    if (!fs.existsSync(file)) continue;
    const match = /^DATABASE_URL=(.+)$/m.exec(fs.readFileSync(file, 'utf-8'));
    if (match) base = match[1].trim().replace(/^"|"$/g, '');
  }

  if (!base) throw new Error('DATABASE_URL not found in environment, server/.env or root .env — integration tests need a Postgres instance.');
  if (/schema=erp_test/.test(base)) return base;
  return base.includes('?') ? `${base}&schema=erp_test` : `${base}?schema=erp_test`;
}
