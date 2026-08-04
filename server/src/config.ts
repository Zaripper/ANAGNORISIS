import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Environment is validated once at boot and the process refuses to start on a bad
 * configuration, rather than failing later in a request with a confusing error.
 *
 * Security note: JWT_SECRET previously fell back to the literal string
 * 'dev-secret-change-me'. Because that value is committed in source, anyone with
 * access to the repository could mint a valid ADMINISTRATEUR token for any
 * deployment that had not overridden it — and no .env in this project set it. In
 * production a missing or weak secret is now a hard startup failure; in
 * development we generate a random per-boot secret (which invalidates existing
 * sessions on restart, an acceptable trade for never shipping a known key).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * Comma-separated list of allowed origins, or '*' for any. '*' is rejected in
   * production: this API is reachable across the LAN and its cookies/tokens should
   * not be readable by arbitrary origins.
   */
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().optional(),
  /** How long an issued session token stays valid. */
  JWT_EXPIRES_IN: z.string().default('12h')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  console.error(`Invalid server environment:\n${details}`);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';

const MIN_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = new Set(['dev-secret-change-me', 'secret', 'changeme', 'password']);

function resolveJwtSecret(): string {
  const provided = env.JWT_SECRET?.trim();

  if (isProduction) {
    if (!provided) {
      console.error(
        'JWT_SECRET is required in production.\n' +
          'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
      );
      process.exit(1);
    }
    if (KNOWN_WEAK_SECRETS.has(provided) || provided.length < MIN_SECRET_LENGTH) {
      console.error(`JWT_SECRET is too weak. Use at least ${MIN_SECRET_LENGTH} random characters.`);
      process.exit(1);
    }
    return provided;
  }

  if (provided && !KNOWN_WEAK_SECRETS.has(provided)) return provided;

  // Development without a configured secret: never fall back to a known constant.
  const ephemeral = crypto.randomBytes(48).toString('base64url');
  console.warn('JWT_SECRET not set — generated an ephemeral development secret. Sessions end when the server restarts.');
  return ephemeral;
}

function resolveCorsOrigin(): true | string[] {
  const raw = env.CORS_ORIGIN.trim();
  if (raw === '*') {
    if (isProduction) {
      console.error("CORS_ORIGIN='*' is not allowed in production. List the client origins explicitly.");
      process.exit(1);
    }
    return true;
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  corsOrigin: resolveCorsOrigin(),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: env.JWT_EXPIRES_IN
};
