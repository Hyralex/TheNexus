import { Hono } from 'hono';
import { openclaw } from '../lib/openclaw.js';
import { taskService } from '../services/task-service.js';

// Agents route - /api/agents
export const agents = new Hono();

/**
 * GET /api/agents
 * List all available agents
 */
agents.get('/', async (c) => {
  try {
    const agents = await openclaw.getAgents();
    return c.json({ agents });
  } catch (error: any) {
    console.error('Error listing agents:', error.message);
    return c.json({ error: 'Failed to list agents' }, 500);
  }
});

/**
 * GET /api/agents/:id
 * Get agent details
 */
agents.get('/:id', async (c) => {
  const agentId = c.req.param('id');

  try {
    const agents = await openclaw.getAgents();
    const agent = agents.find((a) => a.id === agentId);

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    return c.json({ agent });
  } catch (error: any) {
    console.error('Error fetching agent:', error.message);
    return c.json({ error: 'Failed to fetch agent' }, 500);
  }
});

/**
 * GET /api/agents/:id/status
 * Get agent availability status
 */
agents.get('/:id/status', async (c) => {
  const agentId = c.req.param('id');

  try {
    const sessions = await openclaw.getSessions({ allAgents: true });
    const activeSessions = sessions.filter((s) => s.agentId === agentId && s.ageMs && s.ageMs < 300000);

    return c.json({
      agentId,
      available: activeSessions.length === 0,
      activeSessions: activeSessions.length,
      currentSession: activeSessions[0]?.key || null,
    });
  } catch (error: any) {
    console.error('Error fetching agent status:', error.message);
    return c.json({ error: 'Failed to fetch agent status' }, 500);
  }
});

/**
 * GET /api/agents/:id/history
 * Get recent tasks assigned to agent
 */
agents.get('/:id/history', async (c) => {
  const agentId = c.req.param('id');

  try {
    const allTasks = await taskService.findAll();
    const agentTasks = allTasks.filter((t) => t.assignedAgent === agentId);

    // Sort by updatedAt descending
    agentTasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return c.json({
      agentId,
      totalTasks: agentTasks.length,
      tasks: agentTasks.slice(0, 20), // Last 20 tasks
    });
  } catch (error: any) {
    console.error('Error fetching agent history:', error.message);
    return c.json({ error: 'Failed to fetch agent history' }, 500);
  }
});
