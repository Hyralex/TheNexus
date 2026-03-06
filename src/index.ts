import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = new Hono();

// In-memory state for activity tracking
let lastSessionsState: any[] = [];
let activityLog: Array<{
  timestamp: string;
  type: string;
  agent: string;
  message: string;
}> = [];

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

// All sessions endpoint
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

// Active sessions (last 5 minutes)
app.get('/api/sessions/active', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --active 5 --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const sessions = JSON.parse(stdout);
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching active sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
});

// Activity feed - detects changes between polls
app.get('/api/activity', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --active 30 --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const data = JSON.parse(stdout);
    const currentSessions = data.sessions || [];
    
    // Detect new/changed sessions
    const newActivities: typeof activityLog = [];
    
    for (const session of currentSessions) {
      const existing = lastSessionsState.find(s => s.key === session.key);
      
      if (!existing) {
        // New session detected
        newActivities.push({
          timestamp: new Date().toISOString(),
          type: 'new_session',
          agent: session.agentId || 'unknown',
          message: `New ${session.kind} session started`,
        });
      } else if (session.totalTokens !== existing.totalTokens) {
        // Session has new activity
        const tokenDiff = (session.totalTokens || 0) - (existing.totalTokens || 0);
        if (tokenDiff > 0) {
          newActivities.push({
            timestamp: new Date().toISOString(),
            type: 'activity',
            agent: session.agentId || 'unknown',
            message: `Used ${tokenDiff.toLocaleString()} tokens`,
          });
        }
      }
    }
    
    // Check for completed sessions (was active, now gone)
    for (const oldSession of lastSessionsState) {
      const stillActive = currentSessions.find(s => s.key === oldSession.key);
      if (!stillActive && oldSession.ageMs && oldSession.ageMs < 1800000) {
        newActivities.push({
          timestamp: new Date().toISOString(),
          type: 'completed',
          agent: oldSession.agentId || 'unknown',
          message: `Session completed`,
        });
      }
    }
    
    // Add to activity log (keep last 50)
    activityLog = [...newActivities, ...activityLog].slice(0, 50);
    
    // Update state
    lastSessionsState = currentSessions;
    
    return c.json({
      active: currentSessions.length,
      recent: activityLog.slice(0, 20),
    });
  } catch (error: any) {
    console.error('Error fetching activity:', error.message);
    return c.json({ error: error.message, active: 0, recent: [] });
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
