import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { api } from './routes';
import { config } from './config';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'anagnorisis-erp-api',
    docs: '/api/health',
    version: '0.1.0'
  });
});

// Central JSON error handler so every failure (validation, DB, unexpected) comes
// back as structured JSON instead of Express's default HTML/stack-trace page.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'VALIDATION_ERROR', issues: err.issues });
  }
  console.error(err);
  res.status(500).json({ message: 'INTERNAL_SERVER_ERROR' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`API listening on http://0.0.0.0:${config.port}`);
});
