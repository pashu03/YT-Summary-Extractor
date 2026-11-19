import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as helmetModule from 'helmet';
import type { HelmetOptions } from 'helmet';
import { config } from './config.js';
import { AppError, logUpstreamFailure, toAppError } from './errors.js';
import { exportRouter } from './routes/export.js';
import { transcriptRouter } from './routes/transcript.js';

/**
 * helmet ships separate ESM and CommonJS type files. Vercel's build type-checks
 * with CommonJS resolution, where the default export is nested one level deeper
 * than under ESM, so neither a default import nor `.default` type-checks in both.
 * The middleware factory is therefore unwrapped at runtime. Node always loads
 * helmet's ESM build here, where `.default` is the function itself.
 */
const exported: unknown = helmetModule.default;
const helmet = (typeof exported === 'function' ? exported : (exported as { default: unknown }).default) as (
  options?: HelmetOptions,
) => RequestHandler;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );
  app.use(compression());

  // Responses are specific to one request and must never be stored by browsers or proxies.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Access log without the URL query or body: no video links or transcripts are ever logged.
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`);
    });
    next();
  });

  // A short description at the root, so visiting the API's address (or a host's preview bot) gets a useful answer.
  app.get('/', (_req, res) => {
    res.json({
      service: 'YouTube Transcript & Summary API',
      status: 'ok',
      endpoints: ['GET /api/health', 'POST /api/transcript', 'POST /api/export/pdf'],
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Counters live in memory for one minute and hold nothing but a hit count per client address.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });

  app.use('/api/transcript', limiter, express.json({ limit: '16kb' }), transcriptRouter);
  app.use('/api/export', limiter, express.json({ limit: config.exportBodyLimit }), exportRouter);

  app.use((_req, _res, next) => {
    next(new AppError('NOT_FOUND'));
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error handlers by their four arguments.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = normaliseError(err);
    if (error.code === 'INTERNAL') console.error('[api] unexpected failure:', err);
    logUpstreamFailure(error, 'api');
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(error.status).json({ error: error.toBody() });
  });

  return app;
}

/** Map body-parser failures onto our error format; everything else goes through toAppError. */
function normaliseError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    return new AppError('INVALID_REQUEST', { message: 'The request is too large to process.' });
  }
  if (type === 'entity.parse.failed') {
    return new AppError('INVALID_REQUEST', { message: 'The request body is not valid JSON.' });
  }
  return toAppError(err);
}
