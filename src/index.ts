import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import * as fs from 'fs';
import * as path from 'path';

const app = new Hono();

// Serve static files from /public
app.use('/*', serveStatic({ root: './public' }));

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Main route
app.get('/', (c) => {
  return c.html('<h1>The Nexus</h1>');
});

const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
