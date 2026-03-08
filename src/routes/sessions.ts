import { Hono } from 'hono';
import { openclaw } from '../lib/openclaw.js';
import { activityLog, lastSessionsState } from '../app.js';

export const sessions = new Hono();

/**
 * GET /api/sessions
 * Get all sessions across all agents
 */
sessions.get('/sessions', async (c) => {
  try {
    const sessions = await openclaw.getSessions();
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
});

/**
 * GET /api/sessions/active
 * Get active sessions (last 5 minutes)
 */
sessions.get('/sessions/active', async (c) => {
  try {
    const sessions = await openclaw.getSessions({ activeMinutes: 5 });
    return c.json(sessions);
  } catch (error: any) {
    console.error('Error fetching active sessions:', error.message);
    return c.json({ error: error.message, sessions: [] });
  }
});

/**
 * GET /api/activity
 * Get activity feed - detects changes between polls
 */
sessions.get('/activity', async (c) => {
  try {
    const currentSessions = await openclaw.getSessions({ activeMinutes: 30 });

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
    activityLog.splice(0, 0, ...newActivities);
    activityLog.splice(50);

    // Update state
    lastSessionsState.splice(0, lastSessionsState.length, ...currentSessions);

    return c.json({
      active: currentSessions.length,
      recent: activityLog.slice(0, 20),
    });
  } catch (error: any) {
    console.error('Error fetching activity:', error.message);
    return c.json({ error: error.message, active: 0, recent: [] });
  }
});

/**
 * GET /api/session/:key
 * Get single session details with transcript
 */
sessions.get('/session/:key', async (c) => {
  try {
    const sessionKey = decodeURIComponent(c.req.param('key'));

    // First get session metadata from all agents
    const allSessions = await openclaw.getSessions();
    const session = allSessions.find(s => s.key === sessionKey);

    if (!session) {
      return c.json({ error: 'Session not found', messages: [] });
    }

    // Get stores to find session file path
    const stores = await openclaw.getStores();
    const store = stores.find((s: any) => s.agentId === session.agentId);

    if (!store?.path) {
      return c.json({ error: 'Store not found', session, messages: [] });
    }

    const fs = await import('fs');
    const storeContent = fs.readFileSync(store.path, 'utf-8');
    const storeData = JSON.parse(storeContent);
    const sessionData = storeData[sessionKey];

    if (!sessionData?.sessionFile) {
      return c.json({ error: 'Session file not found', session, messages: [] });
    }

    // Get transcript
    const messages = await openclaw.getSessionTranscript(
      session,
      store.path,
      sessionData.sessionFile
    );

    return c.json({
      session,
      messages,
    });
  } catch (error: any) {
    console.error('Error fetching session history:', error.message);
    return c.json({ error: error.message, session: null, messages: [] });
  }
});

/**
 * POST /api/session/:key/kill
 * Kill/abort a session
 */
sessions.post('/session/:key/kill', async (c) => {
  try {
    const sessionKey = decodeURIComponent(c.req.param('key'));

    await openclaw.killSession(sessionKey);

    return c.json({ success: true, message: 'Session aborted' });
  } catch (error: any) {
    console.error('Error killing session:', error.message);
    return c.json({ error: error.message }, 500);
  }
});
