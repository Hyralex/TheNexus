import { Hono } from 'hono';
import { taskService } from '../services/task-service.js';
import { refinementStatus } from '../app.js';

export const tasks = new Hono();

/**
 * GET /api/tasks
 * Get all tasks across all projects
 */
tasks.get('/tasks', async (c) => {
  try {
    const projectFilter = c.req.query('project');
    const statusFilter = c.req.query('status');
    const tasks = await taskService.findAll(projectFilter || undefined, statusFilter || undefined);
    return c.json({ tasks });
  } catch (error: any) {
    console.error('Error reading tasks:', error.message);
    return c.json({ error: error.message, tasks: [] });
  }
});

/**
 * POST /api/tasks
 * Create a new task
 */
tasks.post('/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, project, priority, tags } = body;

    if (!title || !project) {
      return c.json({ error: 'Title and project are required' }, 400);
    }

    const task = await taskService.create({
      title,
      description,
      project,
      priority,
      tags,
    });
    return c.json({ success: true, task });
  } catch (error: any) {
    console.error('Error creating task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PUT /api/tasks/:id
 * Update a task (used by refinement agent)
 */
tasks.put('/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const projectFilter = c.req.query('project');
    const body = await c.req.json();

    const task = await taskService.update(taskId, body, projectFilter || undefined);
    return c.json({ success: true, task });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PATCH /api/tasks/:id
 * Update task status
 */
tasks.patch('/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const { status } = body;

    if (!status || !['todo', 'refinement', 'in-progress', 'done'].includes(status)) {
      return c.json(
        { error: 'Invalid status. Must be todo, refinement, in-progress, or done' },
        400
      );
    }

    const task = await taskService.updateStatus(taskId, status);
    return c.json({ success: true, task });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task
 */
tasks.delete('/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const deletedTask = await taskService.delete(taskId);
    return c.json({ success: true, task: deletedTask });
  } catch (error: any) {
    console.error('Error deleting task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/tasks/:id/start-refinement
 * Start refinement for a task - moves to refinement status and spawns agent
 */
tasks.post('/tasks/:id/start-refinement', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, agentId, project } = body;

    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }

    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    const result = await taskService.startRefinement(taskId, agentId, project || undefined);
    return c.json(result);
  } catch (error: any) {
    console.error('Error starting refinement:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/tasks/:id/refine
 * Manual refinement (synchronous)
 */
tasks.post('/tasks/:id/refine', async (c) => {
  try {
    const taskId = c.req.param('id');
    const task = await taskService.refine(taskId);
    return c.json({ success: true, task });
  } catch (error: any) {
    console.error('Error refining task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/tasks/start
 * Start a task with an agent - spawns subagent asynchronously
 */
tasks.post('/tasks/start', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, agentId, project } = body;

    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }

    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    const result = await taskService.start(taskId, agentId, project || undefined);
    return c.json(result);
  } catch (error: any) {
    console.error('Error starting task:', error.message);
    if (error.message.includes('not found')) {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

// Note: refinement endpoints access in-memory state from app.ts
// These are kept here for now but will move to a service layer in Phase 3

/**
 * GET /api/refinement/:id
 * Get refinement status for a task
 */
tasks.get('/refinement/:id', (c) => {
  const taskId = c.req.param('id');
  const status = refinementStatus.get(taskId);

  if (!status) {
    return c.json({ error: 'No refinement status found for this task', taskId }, 404);
  }

  return c.json({
    taskId,
    ...status,
  });
});

/**
 * GET /api/refinement
 * Get all refinement statuses
 */
tasks.get('/refinement', (c) => {
  const allStatuses = Array.from(refinementStatus.entries()).map(([taskId, status]) => ({
    taskId,
    ...status,
  }));

  return c.json({
    total: allStatuses.length,
    pending: allStatuses.filter((s) => s.status === 'pending').length,
    completed: allStatuses.filter((s) => s.status === 'completed').length,
    failed: allStatuses.filter((s) => s.status === 'failed').length,
    refinements: allStatuses,
  });
});
