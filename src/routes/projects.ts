import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { loadProjects, saveProjects, getProjectsFilePath } from '../lib/projects.js';

export const projects = new Hono();

/**
 * GET /api/projects
 * Get all projects
 */
projects.get('/projects', async (c) => {
  try {
    const PROJECTS_FILE = getProjectsFilePath();
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ projects: {}, activeProject: null });
    }

    const data = loadProjects();
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

    const PROJECTS_FILE = getProjectsFilePath();
    const data = loadProjects();

    if (data.projects[name]) {
      return c.json({ error: 'Project already exists' }, 400);
    }

    // Create project
    data.projects[name] = {
      name,
      path: path.join(path.dirname(PROJECTS_FILE), name),
      active: true,
      createdAt: new Date().toISOString(),
      description: description || '',
      tasks: [],
    };

    // Create project folder and files
    fs.mkdirSync(data.projects[name].path, { recursive: true });
    fs.writeFileSync(
      path.join(data.projects[name].path, 'context.md'),
      `# ${name}\n\n${description ? description : ''}\n`
    );
    fs.writeFileSync(
      path.join(data.projects[name].path, 'memory.md'),
      `# Project Memory - ${name}\n\n`
    );
    fs.writeFileSync(
      path.join(data.projects[name].path, 'sessions.json'),
      JSON.stringify({ sessions: [] }, null, 2)
    );

    saveProjects(data);

    return c.json({ success: true, project: data.projects[name] });
  } catch (error: any) {
    console.error('Error creating project:', error.message);
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

    const PROJECTS_FILE = getProjectsFilePath();
    const data = loadProjects();

    if (!data.projects[projectName]) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (description !== undefined) {
      data.projects[projectName].description = description;
    }

    if (newName && newName !== projectName) {
      // Rename project
      data.projects[newName] = { ...data.projects[projectName], name: newName };
      delete data.projects[projectName];
    }

    data.projects[projectName || newName].updatedAt = new Date().toISOString();
    saveProjects(data);

    return c.json({ success: true, project: data.projects[projectName || newName] });
  } catch (error: any) {
    console.error('Error updating project:', error.message);
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

    const PROJECTS_FILE = getProjectsFilePath();
    const data = loadProjects();

    if (!data.projects[projectName]) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Check if project has tasks
    if (data.projects[projectName].tasks && data.projects[projectName].tasks.length > 0) {
      return c.json({ error: 'Cannot delete project with tasks. Remove all tasks first.' }, 400);
    }

    // Delete project folder
    const projectPath = data.projects[projectName].path;
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true });
    }

    delete data.projects[projectName];
    saveProjects(data);

    return c.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    console.error('Error deleting project:', error.message);
    return c.json({ error: error.message }, 500);
  }
});
