import dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Validates the runtime environment and throws (fail-fast) if the configuration
 * is missing or internally inconsistent. Call this once at server boot, before
 * anything binds a port, so a misconfigured deploy crashes loudly instead of
 * silently running in an insecure or broken state.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  // --- Always required (except in the automated test runner) ---
  if (!isTest && !isSet('JWT_SECRET')) {
    errors.push('JWT_SECRET is required (used to sign auth tokens). Set a long, random value.');
  }

  // --- Production-only requirements ---
  if (isProd) {
    if (!isSet('DATABASE_URL')) {
      errors.push('DATABASE_URL is required in production (Postgres/Neon connection string).');
    }
    if (!isSet('FRONTEND_URL')) {
      errors.push('FRONTEND_URL is required in production (locks CORS to your frontend origin(s)).');
    }
  }

  // --- Cloudflare R2: all-or-nothing ---
  const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const r2Present = r2Keys.filter(isSet);
  if (r2Present.length > 0 && r2Present.length < r2Keys.length) {
    const missing = r2Keys.filter((k) => !isSet(k));
    errors.push(
      `Incomplete R2 storage config — set all of [${r2Keys.join(', ')}] or none. Missing: ${missing.join(', ')}.`
    );
  }
  if (isProd && r2Present.length === 0) {
    errors.push(
      'R2 storage is not configured in production. Local-disk uploads are ephemeral on most hosts ' +
        '(files vanish on redeploy/restart). Configure R2_* to persist uploads.'
    );
  }

  if (errors.length > 0) {
    console.error('\n❌ Environment validation failed. Fix the following before starting:');
    for (const e of errors) console.error(`   • ${e}`);
    console.error('');
    throw new Error('Invalid environment configuration');
  }
}
