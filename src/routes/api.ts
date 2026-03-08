import { Hono } from 'hono';
import { sessions } from './sessions.js';
import { tasks } from './tasks.js';
import { projects } from './projects.js';

// API route grouping - mounts all API routes under /api
export const api = new Hono();

// Health check endpoint (stays here, not in a separate file)
api.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Mount route groups
api.route('', sessions);  // /api/sessions, /api/activity, /api/session/:key
api.route('', tasks);     // /api/tasks, /api/tasks/:id, /api/refinement
api.route('', projects);  // /api/projects, /api/projects/:name
