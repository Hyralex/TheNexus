import { Hono } from 'hono';
import { projectService } from '../services/project-service.js';

export const projects = new Hono();

/**
 * GET /api/projects
 * Get all projects
 */
projects.get('/projects', async (c) => {
  try {
    const data = await projectService.findAll();
    return c.json(data);
  } catch (error: any) {
    console.error('Error reading projects:', error.message);
    return c.json({ error: error.message, projects: {}, activeProject: null });
  }
});

/**
 * POST /api/projects
 * Create a new project
 */
projects.post('/projects', async (c) => {
  try {
    const body = await c.req.json();
    const { name, description } = body;

    if (!name) {
      return c.json({ error: 'Project name is required' }, 400);
    }

    const project = await projectService.create({ name, description });
    return c.json({ success: true, project });
  } catch (error: any) {
    console.error('Error creating project:', error.message);
    if (error.message === 'Project already exists') {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PUT /api/projects/:name
 * Update a project
 */
projects.put('/projects/:name', async (c) => {
  try {
    const projectName = c.req.param('name');
    const body = await c.req.json();
    const { description, name: newName } = body;

    const project = await projectService.update(projectName, {
      description,
      newName,
    });
    return c.json({ success: true, project });
  } catch (error: any) {
    console.error('Error updating project:', error.message);
    if (error.message === 'Project not found') {
      return c.json({ error: error.message }, 404);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * DELETE /api/projects/:name
 * Delete a project
 */
projects.delete('/projects/:name', async (c) => {
  try {
    const projectName = c.req.param('name');
    await projectService.delete(projectName);
    return c.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    console.error('Error deleting project:', error.message);
    if (error.message === 'Project not found') {
      return c.json({ error: error.message }, 404);
    }
    if (error.message.includes('Cannot delete project with tasks')) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});
