import { Hono } from 'hono';
import { sessionService } from '../services/session-service.js';

export const sessions = new Hono();

/**
 * GET /api/sessions
 * Get all sessions across all agents
 */
sessions.get('/sessions', async (c) => {
  try {
    const sessions = await sessionService.findAll();
    return c.json({ sessions });
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
    const sessions = await sessionService.findActive(5);
    return c.json({ sessions });
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
    const activity = await sessionService.getActivity();
    return c.json(activity);
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
    const { session, messages } = await sessionService.findByIdWithTranscript(sessionKey);

    if (!session) {
      return c.json({ error: 'Session not found', messages: [] });
    }

    return c.json({ session, messages });
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
    await sessionService.kill(sessionKey);
    return c.json({ success: true, message: 'Session aborted' });
  } catch (error: any) {
    console.error('Error killing session:', error.message);
    return c.json({ error: error.message }, 500);
  }
});
