/**
 * GET /api/version — Returns the application version from package.json.
 */

import { Hono } from 'hono';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { packageMetadata } from '../lib/package-metadata.js';

const app = new Hono();

app.get('/api/version', rateLimitGeneral, (c) => c.json({
  version: packageMetadata.version,
  name: packageMetadata.name,
}));

export default app;
