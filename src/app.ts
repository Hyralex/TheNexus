import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import * as fs from 'fs';

// Create Hono app
export const app = new Hono();

// Refinement status tracking (task ID -> status)
// Note: This is temporary state until Phase 3 database integration
export const refinementStatus = new Map<string, {
  status: 'pending' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
}>();

// Cleanup old refinement statuses (keep last 24 hours)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [taskId, status] of refinementStatus.entries()) {
    const completedAt = status.completedAt ? new Date(status.completedAt).getTime() : 0;
    const startedAt = new Date(status.startedAt).getTime();
    const age = completedAt > 0 ? now - completedAt : now - startedAt;

    if (age > maxAge) {
      refinementStatus.delete(taskId);
      console.log(`🧹 Cleaned up old refinement status for ${taskId}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// Static file serving - must be registered after specific routes
export function setupStaticFiles(): void {
  app.use('/*', serveStatic({ root: './public' }));
}

// Helper to serve index.html for SPA routing
export function serveIndex() {
  return fs.readFileSync('./public/index.html', 'utf-8');
}
