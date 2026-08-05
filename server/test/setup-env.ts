import { resolveTestDatabaseUrl } from './test-env';

// Runs in each worker BEFORE test files (and therefore the Prisma client) are
// imported: every connection in the suite goes to the erp_test schema.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
