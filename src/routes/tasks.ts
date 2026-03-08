import { Hono } from 'hono';
import * as fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { loadProjects, saveProjects, generateTaskId, findTask } from '../lib/projects.js';
import { refineTaskDescriptionSync } from '../refinement.js';
import { openclaw } from '../lib/openclaw.js';
import { refinementStatus } from '../app.js';

const execFileAsync = promisify(execFile);

export const tasks = new Hono();

/**
 * GET /api/tasks
 * Get all tasks across all projects
 */
tasks.get('/tasks', async (c) => {
  try {
    const data = loadProjects();
    const allTasks: any[] = [];

    for (const [projectName, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        for (const task of proj.tasks) {
          allTasks.push({
            ...task,
            project: projectName,
          });
        }
      }
    }

    return c.json({ tasks: allTasks });
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
    const { title, description, project } = body;

    if (!title || !project) {
      return c.json({ error: 'Title and project are required' }, 400);
    }

    const data = loadProjects();

    if (!data.projects || !data.projects[project]) {
      return c.json({ error: `Project '${project}' not found` }, 404);
    }

    // Generate globally unique task ID
    const taskId = generateTaskId(data);
    const proj = data.projects[project] as any;

    // Create task - all tasks start in todo status
    const newTask: any = {
      id: taskId,
      title,
      description: description || '',
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Refinement metadata
      refined: false,
      refinedAt: null,
      refinedBy: null,
      originalDescription: description !== undefined ? description : null,
      awaitingRefinement: false,
    };

    // Add task to project
    if (!proj.tasks) {
      proj.tasks = [];
    }
    proj.tasks.push(newTask);
    proj.updatedAt = new Date().toISOString();

    // Write back to file
    saveProjects(data);

    console.log(`✓ Task created: ${taskId}`);

    return c.json({ success: true, task: newTask });
  } catch (error: any) {
    console.error('Error creating task:', error.message);
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
    const {
      title,
      description,
      project: newProject,
      priority,
      tags,
      refined,
      refinedAt,
      refinedBy,
      refinementSessionKey,
    } = body;

    const result = findTask(taskId, projectFilter || undefined);

    if (!result) {
      return c.json(
        { error: `Task '${taskId}' not found${projectFilter ? ` in project '${projectFilter}'` : ''}` },
        404
      );
    }

    const { task, project, projectName } = result;

    // Update fields if provided
    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (priority !== undefined) task.priority = priority;
    if (tags !== undefined) task.tags = tags;
    if (refined !== undefined) task.refined = refined;
    if (refinedAt !== undefined) task.refinedAt = refinedAt;
    if (refinedBy !== undefined) task.refinedBy = refinedBy;
    if (refinementSessionKey !== undefined) task.refinementSessionKey = refinementSessionKey;

    // Clear awaitingRefinement flag if refined
    if (refined === true) {
      task.awaitingRefinement = false;
    }

    // Clear refinement flag when task is manually edited (description changed)
    // BUT NOT if this update is setting refined: true
    if (description !== undefined && task.refined === true && refined !== true) {
      task.refined = false;
      task.refinedAt = null;
      task.refinedBy = null;
      console.log(`⚠️ Task ${taskId} edited - refinement flag cleared`);
    }

    task.updatedAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();

    // Handle project change
    if (newProject && newProject !== projectName) {
      const taskIndex = project.tasks.findIndex((t: any) => t.id === taskId);
      if (taskIndex !== -1) {
        const taskData = project.tasks[taskIndex];
        project.tasks.splice(taskIndex, 1);

        // Add to new project
        const data = loadProjects();
        if (data.projects[newProject]) {
          taskData.project = undefined;
          data.projects[newProject].tasks.push(taskData);
          data.projects[newProject].updatedAt = new Date().toISOString();
          saveProjects(data);
        }
      }
    } else {
      saveProjects({ projects: { [projectName]: project } });
      // Reload and save full data
      const fullData = loadProjects();
      fullData.projects[projectName] = project;
      saveProjects(fullData);
    }

    const updatedTask = { ...task, project: newProject || projectName };
    console.log(`✓ Task ${taskId} updated in project ${updatedTask.project}`);

    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
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

    const result = findTask(taskId);

    if (!result) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }

    const { task, project, projectName } = result;

    task.status = status;
    task.updatedAt = new Date().toISOString();

    if (status === 'done') {
      task.completedAt = new Date().toISOString();
    } else if (status === 'in-progress') {
      task.startedAt = new Date().toISOString();
    }

    project.updatedAt = new Date().toISOString();

    // Save
    const data = loadProjects();
    data.projects[projectName] = project;
    saveProjects(data);

    const updatedTask = { ...task, project: projectName };
    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
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

    const result = findTask(taskId);

    if (!result) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }

    const { project, projectName } = result;

    const taskIndex = project.tasks.findIndex((t: any) => t.id === taskId);
    if (taskIndex !== -1) {
      const deletedTask = { ...project.tasks[taskIndex], project: projectName };
      project.tasks.splice(taskIndex, 1);
      project.updatedAt = new Date().toISOString();

      // Save
      const data = loadProjects();
      data.projects[projectName] = project;
      saveProjects(data);

      return c.json({ success: true, task: deletedTask });
    }

    return c.json({ error: 'Task not found' }, 404);
  } catch (error: any) {
    console.error('Error deleting task:', error.message);
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

    const result = findTask(taskId, project || undefined);

    if (!result) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }

    const { task, projectName } = result;

    // Move task to refinement status
    task.status = 'refinement';
    task.assignedAgent = agentId;
    task.updatedAt = new Date().toISOString();

    // Save
    const data = loadProjects();
    data.projects[projectName].tasks = data.projects[projectName].tasks.map((t: any) =>
      t.id === taskId ? task : t
    );
    data.projects[projectName].updatedAt = new Date().toISOString();
    saveProjects(data);

    console.log(`🔄 Starting refinement for task ${taskId} with agent ${agentId}...`);

    // Find existing Discord channel session for this agent
    let sessionArg = `--agent ${agentId}`;
    try {
      const sessionsData = await openclaw.getSessions();
      const discordSession = sessionsData.find(
        (s) => s.agentId === agentId && s.key && s.key.includes('discord:channel:')
      );

      if (discordSession?.sessionId) {
        console.log(`📌 Found existing Discord session for ${agentId}: ${discordSession.key}`);
        sessionArg = `--session-id ${discordSession.sessionId}`;
      } else {
        console.log(`⚠️ No existing Discord session for ${agentId}, using --agent fallback`);
      }
    } catch (sessionError: any) {
      console.warn(`⚠️ Could not lookup sessions: ${sessionError.message}`);
    }

    // Build refinement message
    const refinementMessage = `🎯 **Refinement Assignment: ${task.id}**

**Project:** ${projectName}
**Title:** ${task.title}
**Current Description:** ${task.description || 'No description provided'}

## Your Task

You are assigned to **refine** this task. Refinement is about **planning and design**, NOT implementation.

### What to Do:

1. **Spawn a subagent in a Discord thread** to do the refinement work:
   - Use \`sessions_spawn\` with \`thread: true\` and \`mode: "session"\`

2. **Subagent workflow:**
   - Move task to refinement: \`pm task move ${task.id} refinement --project ${projectName}\`
   - Gather context from project files
   - Enrich description with: objective, technical approach, files to modify, acceptance criteria
   - Mark complete: \`pm task refine ${task.id} --complete\`
   - Move back to todo: \`pm task move ${task.id} todo --project ${projectName}\`

Start the refinement process now.`;

    // Parse sessionArg
    const args: string[] = ['agent'];
    if (sessionArg.startsWith('--session-id')) {
      const sessionId = sessionArg.split(' ')[1];
      args.push('--session-id', sessionId);
    } else if (sessionArg.startsWith('--agent')) {
      const agentIdFromArg = sessionArg.split(' ')[1];
      args.push('--agent', agentIdFromArg);
    }
    args.push('--message', refinementMessage);

    // Spawn agent asynchronously
    execFileAsync('openclaw', args, {
      timeout: 300000,
    })
      .then(({ stdout }) => {
        console.log(`✅ Refinement agent ${agentId} spawned for task ${taskId}`);

        // Extract session key
        const sessionKeyMatch = stdout.match(/session[:\s]+([^\s]+)/i);
        const sessionKey = sessionKeyMatch ? sessionKeyMatch[1] : null;

        if (sessionKey) {
          try {
            const projData = loadProjects();
            const taskResult = findTask(taskId);
            if (taskResult) {
              taskResult.task.refinementSessionKey = sessionKey;
              taskResult.task.updatedAt = new Date().toISOString();
              projData.projects[taskResult.projectName] = taskResult.project;
              saveProjects(projData);
              console.log(`💾 Stored refinement session key for task ${taskId}: ${sessionKey}`);
            }
          } catch (readError: any) {
            console.error(`❌ Error storing refinement session key: ${readError.message}`);
          }
        }
      })
      .catch((spawnError: any) => {
        console.error(`⚠️ Refinement agent spawn error for task ${taskId}:`, spawnError.message);
      });

    return c.json({
      success: true,
      message: `Task ${taskId} assigned to ${agentId} for refinement.`,
      agentId: agentId,
      status: 'refinement',
    });
  } catch (error: any) {
    console.error('Error starting refinement:', error.message);
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

    const result = findTask(taskId);

    if (!result) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }

    const { task, project, projectName } = result;

    // Store original description if not already stored
    if (!task.originalDescription || task.originalDescription === task.description) {
      task.originalDescription = task.description;
    }

    // Perform refinement synchronously
    console.log(`🔄 Manually refining task ${taskId}...`);
    task.description = await refineTaskDescriptionSync(task.title, task.description || '', projectName);
    task.refined = true;
    task.refinedAt = new Date().toISOString();
    task.refinedBy = 'agent:coder:manual-refine';
    task.awaitingRefinement = false;
    task.updatedAt = new Date().toISOString();

    project.updatedAt = new Date().toISOString();

    // Save
    const data = loadProjects();
    data.projects[projectName].tasks = data.projects[projectName].tasks.map((t: any) =>
      t.id === taskId ? task : t
    );
    saveProjects(data);

    const updatedTask = { ...task, project: projectName };
    console.log(`✓ Task manually refined: ${taskId}`);

    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error refining task:', error.message);
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

    const result = findTask(taskId, project || undefined);

    if (!result) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }

    const { task, projectName } = result;

    console.log(`🚀 Spawning agent ${agentId} for task ${taskId}...`);

    // Track which agent is assigned
    task.assignedAgent = agentId;
    task.updatedAt = new Date().toISOString();

    // Save
    const data = loadProjects();
    data.projects[projectName].tasks = data.projects[projectName].tasks.map((t: any) =>
      t.id === taskId ? task : t
    );
    data.projects[projectName].updatedAt = new Date().toISOString();
    saveProjects(data);

    // Find existing Discord channel session for this agent
    let sessionArg = `--agent ${agentId}`;
    try {
      const sessionsData = await openclaw.getSessions();
      const discordSession = sessionsData.find(
        (s) =>
          s.agentId === agentId && s.key && s.key.includes('discord:channel:')
      );

      if (discordSession?.sessionId) {
        console.log(`📌 Found existing Discord session for ${agentId}: ${discordSession.key}`);
        sessionArg = `--session-id ${discordSession.sessionId}`;
      } else {
        console.log(`⚠️ No existing Discord session for ${agentId}, using --agent fallback`);
      }
    } catch (sessionError: any) {
      console.warn(`⚠️ Could not lookup sessions: ${sessionError.message}`);
    }

    // Build enhanced task message
    const enhancedTaskMessage = `🎯 **Task Assignment: ${task.id}**

**Project:** ${projectName}
**Title:** ${task.title}
**Description:** ${task.description || 'No description provided'}

## Project Manager Skill Instructions

1. **Mark the task as in-progress** when you start working:
   - Run: \`pm task move ${task.id} in-progress --project ${projectName}\`

2. **Spawn a subagent in a Discord thread** to do the actual work:
   - Use \`sessions_spawn\` with \`thread: true\` and \`mode: "session"\`

3. **Complete the task** when work is done:
   - Run: \`pm task complete ${task.id} --project ${projectName} --message "summary"\`

Start working on this task now.`;

    // Parse sessionArg
    const args: string[] = ['agent'];
    if (sessionArg.startsWith('--session-id')) {
      const sessionId = sessionArg.split(' ')[1];
      args.push('--session-id', sessionId);
    } else if (sessionArg.startsWith('--agent')) {
      const agentIdFromArg = sessionArg.split(' ')[1];
      args.push('--agent', agentIdFromArg);
    }
    args.push('--message', enhancedTaskMessage);

    // Spawn agent asynchronously
    execFileAsync('openclaw', args, {
      timeout: 300000,
    })
      .then(({ stdout }) => {
        console.log(`✅ Agent ${agentId} spawned for task ${taskId}`);

        // Extract session key
        const sessionKeyMatch = stdout.match(/session[:\s]+([^\s]+)/i);
        const sessionKey = sessionKeyMatch ? sessionKeyMatch[1] : 'N/A';

        if (sessionKey && sessionKey !== 'N/A') {
          const projData = loadProjects();
          const taskResult = findTask(taskId);
          if (taskResult) {
            taskResult.task.sessionKey = sessionKey;
            taskResult.task.updatedAt = new Date().toISOString();
            projData.projects[taskResult.projectName] = taskResult.project;
            saveProjects(projData);
          }
        }
      })
      .catch((spawnError: any) => {
        console.error(`⚠️ Agent spawn error for task ${taskId}:`, spawnError.message);
      });

    // Return immediately - agent runs in background
    return c.json({
      success: true,
      message: `Task ${taskId} assigned to agent ${agentId}.`,
      agentId: agentId,
      status: 'todo',
    });
  } catch (error: any) {
    console.error('Error starting task:', error.message);
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
