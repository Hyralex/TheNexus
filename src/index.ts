import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

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

// Page routes - serve index.html for SPA routing
app.get('/', (c) => {
  return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
});

app.get('/sessions', (c) => {
  return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
});

app.get('/gateway', (c) => {
  return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
});

app.get('/session/:key', (c) => {
  return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
});

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

// All sessions endpoint - across all agents
app.get('/api/sessions', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --all-agents --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const sessions = JSON.parse(stdout);
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
});

// Active sessions (last 5 minutes) - across all agents
app.get('/api/sessions/active', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --all-agents --active 5 --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const sessions = JSON.parse(stdout);
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching active sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
});

// Activity feed - detects changes between polls - across all agents
app.get('/api/activity', async (c) => {
  try {
    const { stdout } = await execAsync('openclaw sessions --all-agents --active 30 --json', {
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
          message: `New session started`,
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

// Single session details with history
app.get('/api/session/:key', async (c) => {
  try {
    const sessionKey = decodeURIComponent(c.req.param('key'));
    
    // First get session metadata from all agents
    const { stdout: sessionsOut } = await execAsync('openclaw sessions --all-agents --json', {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const sessionsData = JSON.parse(sessionsOut);
    const session = sessionsData.sessions?.find((s: any) => s.key === sessionKey);
    
    if (!session) {
      return c.json({ error: 'Session not found', messages: [] });
    }
    
    // Read session store to get session file path
    const storePath = sessionsData.stores?.find((s: any) => s.agentId === session.agentId)?.path;
    if (!storePath) {
      return c.json({ error: 'Store not found', session, messages: [] });
    }
    
    const storeContent = fs.readFileSync(storePath, 'utf-8');
    const store = JSON.parse(storeContent);
    const sessionData = store[sessionKey];
    
    if (!sessionData?.sessionFile) {
      return c.json({ error: 'Session file not found', session, messages: [] });
    }
    
    // Read JSONL file and extract messages
    const jsonlContent = fs.readFileSync(sessionData.sessionFile, 'utf-8');
    const lines = jsonlContent.trim().split('\n').filter(line => line.trim());
    const messages: any[] = [];
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          messages.push({
            role: entry.message.role,
            content: entry.message.content,
            timestamp: entry.timestamp,
            toolCalls: entry.message.toolCalls || [],
          });
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
    
    return c.json({
      session,
      messages: messages.slice(-50), // Last 50 messages
    });
  } catch (error: any) {
    console.error('Error fetching session history:', error.message);
    return c.json({ error: error.message, session: null, messages: [] });
  }
});

// Kill session endpoint
app.post('/api/session/:key/kill', async (c) => {
  try {
    const sessionKey = decodeURIComponent(c.req.param('key'));
    
    // Use openclaw to abort the session
    await execAsync(`openclaw chat abort "${sessionKey}"`, {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    
    return c.json({ success: true, message: 'Session aborted' });
  } catch (error: any) {
    console.error('Error killing session:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
