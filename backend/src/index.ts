import type { Express } from 'express';
import { config } from './config.js';
import { createApp } from './create-app.js';

const app: Express = createApp();

/**
 * Vercel imports this file and serves the default export as a function, so a
 * server is only started when running as a normal Node.js process
 * (`npm run dev`, `npm start`, Docker).
 */
if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`Allowed origins: ${config.corsOrigins.join(', ')}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT to a free port and start again.`);
    } else {
      console.error('The server failed to start:', err);
    }
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    // Do not let a stuck connection keep the process alive.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export default app;
