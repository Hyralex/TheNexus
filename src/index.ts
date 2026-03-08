import { serve } from '@hono/node-server';
import { app, setupStaticFiles } from './app.js';
import { pages } from './routes/pages.js';
import { api } from './routes/api.js';

// Mount routes
app.route('', pages);     // Page routes (/, /sessions, /projects, etc.)
app.route('/api', api);   // API routes (/api/*)

// Setup static file serving (must be last)
setupStaticFiles();

// Start server
const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
