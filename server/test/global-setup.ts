import { execSync } from 'node:child_process';
import path from 'node:path';
import { resolveTestDatabaseUrl } from './test-env';

/**
 * Runs once before the test workers: applies the committed migrations to the
 * `erp_test` schema (creating it on first run). This doubles as a regression
 * test of the migration files themselves — if they cannot build a database from
 * scratch, the suite fails before a single test runs.
 */
export default function globalSetup() {
  const url = resolveTestDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  });
}
