// Read settings from a local .env file when there is one. Variables already set
// in the real environment take precedence, so hosting platforms are unaffected.
try {
  process.loadEnvFile();
} catch {
  // No .env file: settings come from the environment or the defaults below.
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export const config = {
  port: intFromEnv('PORT', 4000),
  /** Browser origins allowed to call the API. Use "*" to allow any origin. */
  corsOrigins: listFromEnv('CORS_ORIGIN', ['http://localhost:3000', 'http://127.0.0.1:3000']),
  /** Per-request timeout for each call made to YouTube. */
  youtubeTimeoutMs: intFromEnv('YOUTUBE_TIMEOUT_MS', 15_000),
  /** Requests allowed per client IP per minute on the processing endpoints. */
  rateLimitPerMinute: intFromEnv('RATE_LIMIT_PER_MINUTE', 30),
  /** Set to the number of proxies in front of the app so client IPs are read correctly. */
  // Vercel (which sets VERCEL=1) always sits behind exactly one proxy; elsewhere there is none unless configured.
  trustProxy: intFromEnv('TRUST_PROXY', process.env.VERCEL ? 1 : 0),
  /** Largest JSON body accepted by the PDF export endpoint. */
  exportBodyLimit: process.env.EXPORT_BODY_LIMIT || '8mb',
  isProduction: process.env.NODE_ENV === 'production',
} as const;
