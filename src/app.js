import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { authRouter } from './auth.js';
import { readingsRouter } from './readings.js';
import { catalogRouter } from './catalog.js';
import { ApiError, errorHandler } from './errors.js';
import { acceptJson } from './http.js';

const openapi = YAML.parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));

export const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));

app.get('/health', async (_request, response) => {
  await pool.query('SELECT 1');
  response.json({ status: 'ok' });
});
app.get('/openapi.json', (_request, response) => response.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.use('/api/v1', acceptJson);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', readingsRouter, catalogRouter);
app.use((_request, _response, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found')));
app.use(errorHandler);
