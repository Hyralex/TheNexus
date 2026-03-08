import { serve } from '@hono/node-server';
import { app, setupStaticFiles } from './app.js';
import { pages } from './routes/pages.js';
import { api } from './routes/api.js';
import { websocketManager } from './lib/websocket.js';
import type { Server } from 'http';

// Mount routes
app.route('', pages);     // Page routes (/, /sessions, /projects, etc.)
app.route('/api', api);   // API routes (/api/*)

// Setup static file serving (must be last)
setupStaticFiles();

// Create WebSocket server
websocketManager.createServer();

// Start server
const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

const httpServer = serve({
  fetch: app.fetch,
  port: Number(port),
  overrideGlobalObjects: false,
});

// Handle WebSocket upgrades
httpServer.on('upgrade', (request, socket, head) => {
  // WebSocket upgrade handled by websocketManager
  if (request.url === '/api/ws') {
    websocketManager.wss?.handleUpgrade(request, socket, head, (ws) => {
      websocketManager.wss?.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
