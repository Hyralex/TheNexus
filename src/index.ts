import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

// Sessions endpoint - calls OpenClaw CLI
app.get('/api/sessions', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const sessions = JSON.parse(stdout);
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
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
