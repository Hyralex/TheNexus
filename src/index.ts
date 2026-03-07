import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnRefinementAgent, refineTaskDescriptionSync } from './refinement.js';

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

app.get('/projects', (c) => {
  return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
});

app.get('/projects-manage', (c) => {
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

// Projects API - read from ~/dev/projects/projects.json
const PROJECTS_FILE = path.join(process.env.HOME || os.homedir(), 'dev', 'projects', 'projects.json');

// Get all projects
app.get('/api/projects', async (c) => {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ projects: [], activeProject: null });
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    return c.json(data);
  } catch (error: any) {
    console.error('Error reading projects:', error.message);
    return c.json({ error: error.message, projects: [], activeProject: null });
  }
});

// Create project endpoint
app.post('/api/projects', async (c) => {
  try {
    const body = await c.req.json();
    const { name, description } = body;
    
    if (!name) {
      return c.json({ error: 'Project name is required' }, 400);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
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
    fs.writeFileSync(path.join(data.projects[name].path, 'context.md'), `# ${name}\n\n${description ? description : ''}\n`);
    fs.writeFileSync(path.join(data.projects[name].path, 'memory.md'), `# Project Memory - ${name}\n\n`);
    fs.writeFileSync(path.join(data.projects[name].path, 'sessions.json'), JSON.stringify({ sessions: [] }, null, 2));
    
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    
    return c.json({ success: true, project: data.projects[name] });
  } catch (error: any) {
    console.error('Error creating project:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Update project endpoint
app.put('/api/projects/:name', async (c) => {
  try {
    const projectName = c.req.param('name');
    const body = await c.req.json();
    const { description, name: newName } = body;
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
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
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    
    return c.json({ success: true, project: data.projects[projectName || newName] });
  } catch (error: any) {
    console.error('Error updating project:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Delete project endpoint
app.delete('/api/projects/:name', async (c) => {
  try {
    const projectName = c.req.param('name');
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
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
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    
    return c.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    console.error('Error deleting project:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

app.get('/api/tasks', async (c) => {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ tasks: [] });
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
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

// Refinement logic - enriches task descriptions with context
async function refineTaskDescription(title: string, description: string, project: string): Promise<string> {
  try {
    console.log(`🤖 Spawning refinement agent for task: "${title}"`);
    
    // For now, use a placeholder that indicates agent-based refinement is needed
    // TODO: Implement proper agent-based refinement using sessions_spawn API
    // This will be replaced with actual subagent spawning that:
    // 1. Reads /home/azureuser/dev/projects/${project}/AGENTS.md
    // 2. Reads /home/azureuser/dev/projects/${project}/context.md  
    // 3. Enriches the task description with project-specific context
    // 4. Returns the refined description
    
    const refinementNote = `⚠️ **Awaiting Product Manager Agent Refinement**

This task has been queued for automatic refinement by a Product Manager agent.

**Original Task:**
- Title: ${title}
- Description: ${description || '(none provided)'}
- Project: ${project}

**What happens next:**
1. A Product Manager agent will read this task
2. The agent will review project context (AGENTS.md, context.md)
3. The agent will enrich this description with:
   - Clear objectives
   - Project-specific context
   - Technical approach
   - Files to modify
   - Acceptance criteria
   - Dependencies
   - Potential pitfalls

**Status:** Pending refinement (auto-refinement in progress)

---

*This task will be automatically updated once the Product Manager agent completes refinement.*`;

    console.log(`✅ Task queued for refinement: "${title}"`);
    
    // TODO: Spawn subagent asynchronously to refine this task
    // The subagent will update the task description via API call
    // For now, return the placeholder note
    
    return refinementNote;
  } catch (error: any) {
    console.error('❌ Error in task refinement:', error.message);
    return description || title;
  }
}


// Update task endpoint (used by refinement agent)
app.put('/api/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const projectFilter = c.req.query('project'); // Optional project filter
    const body = await c.req.json();
    // Accept all editable fields: title, description, project, priority, tags, and refinement fields
    const { title, description, project: newProject, priority, tags, refined, refinedAt, refinedBy } = body;
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task
    let found = false;
    let updatedTask: any = null;
    let oldProjectName: string | null = null;
    
    for (const [projectName, project] of Object.entries(data.projects || {})) {
      // If project filter is provided, only search in that project
      if (projectFilter && projectName !== projectFilter) {
        continue;
      }
      
      const proj = project as any;
      if (proj.tasks) {
        const task = proj.tasks.find((t: any) => t.id === taskId);
        if (task) {
          oldProjectName = projectName;
          
          // Update fields if provided
          if (title !== undefined) task.title = title;
          if (description !== undefined) task.description = description;
          if (priority !== undefined) task.priority = priority;
          if (tags !== undefined) task.tags = tags;
          if (refined !== undefined) task.refined = refined;
          if (refinedAt !== undefined) task.refinedAt = refinedAt;
          if (refinedBy !== undefined) task.refinedBy = refinedBy;
          
          // Clear awaitingRefinement flag if refined
          if (refined === true) {
            task.awaitingRefinement = false;
          }
          
          // Clear refinement flag when task is manually edited (description changed)
          if (description !== undefined && task.refined === true) {
            task.refined = false;
            task.refinedAt = null;
            task.refinedBy = null;
            console.log(`⚠️ Task ${taskId} edited - refinement flag cleared`);
          }
          
          task.updatedAt = new Date().toISOString();
          proj.updatedAt = new Date().toISOString();
          
          // Handle project change
          if (newProject && newProject !== projectName) {
            // Remove from old project
            const taskIndex = proj.tasks.findIndex((t: any) => t.id === taskId);
            if (taskIndex !== -1) {
              const taskData = proj.tasks[taskIndex];
              proj.tasks.splice(taskIndex, 1);
              
              // Add to new project
              if (data.projects[newProject]) {
                taskData.project = undefined; // Will be set when reading
                data.projects[newProject].tasks.push(taskData);
                data.projects[newProject].updatedAt = new Date().toISOString();
              }
            }
          }
          
          updatedTask = { ...task, project: newProject || projectName };
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      return c.json({ error: `Task '${taskId}' not found${projectFilter ? ` in project '${projectFilter}'` : ''}` }, 404);
    }
    
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    console.log(`✓ Task ${taskId} updated in project ${updatedTask.project}`);
    
    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Create new task endpoint
app.post('/api/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, project, skipRefinement } = body;
    
    if (!title || !project) {
      return c.json({ error: 'Title and project are required' }, 400);
    }
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    if (!data.projects || !data.projects[project]) {
      return c.json({ error: `Project '${project}' not found` }, 404);
    }
    
    // Generate task ID - find the highest existing task number and increment
    const proj = data.projects[project] as any;
    const existingTasks = proj.tasks || [];
    const maxTaskNum = existingTasks.reduce((max: number, task: any) => {
      const num = parseInt(task.id.replace('task-', ''), 10);
      return num > max ? num : max;
    }, 0);
    const taskId = `task-${String(maxTaskNum + 1).padStart(3, '0')}`;
    
    // Check if refinement should be skipped
    const shouldSkipRefinement = skipRefinement === true;
    
    // Create task immediately
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
      skipRefinement: shouldSkipRefinement,
      awaitingRefinement: !shouldSkipRefinement,
    };
    
    // Spawn refinement agent asynchronously (don't wait)
    if (!shouldSkipRefinement) {
      console.log(`🔄 Spawning refinement agent for task: ${taskId} - "${title}"`);
      spawnRefinementAgent(taskId, title, description || '', project);
    }
    
    // Add task to project
    if (!proj.tasks) {
      proj.tasks = [];
    }
    proj.tasks.push(newTask);
    proj.updatedAt = new Date().toISOString();
    
    // Write back to file
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    console.log(`✓ Task created: ${taskId}${!shouldSkipRefinement ? ' (awaiting refinement)' : ''}`);
    
    return c.json({ success: true, task: newTask, awaitingRefinement: !shouldSkipRefinement });
  } catch (error: any) {
    console.error('Error creating task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Manual refinement endpoint
app.post('/api/tasks/:id/refine', async (c) => {
  try {
    const taskId = c.req.param('id');
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task
    let found = false;
    let updatedTask: any = null;
    let projectName: string | null = null;
    
    for (const [name, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        const task = proj.tasks.find((t: any) => t.id === taskId);
        if (task) {
          projectName = name;
          
          // Store original description if not already stored
          if (!task.originalDescription || task.originalDescription === task.description) {
            task.originalDescription = task.description;
          }
          
          // Perform refinement synchronously
          console.log(`🔄 Manually refining task ${taskId}...`);
          task.description = await refineTaskDescriptionSync(task.title, task.description || '', name);
          task.refined = true;
          task.refinedAt = new Date().toISOString();
          task.refinedBy = 'agent:coder:manual-refine';
          task.awaitingRefinement = false;
          task.refinedBy = 'agent:coder:manual-refine';
          task.updatedAt = new Date().toISOString();
          task.skipRefinement = false;
          
          proj.updatedAt = new Date().toISOString();
          updatedTask = { ...task, project: name };
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    // Write back to file
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    console.log(`✓ Task manually refined: ${taskId}`);
    
    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error refining task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Update task status endpoint
app.patch('/api/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const { status } = body;
    
    if (!status || !['todo', 'in-progress', 'done'].includes(status)) {
      return c.json({ error: 'Invalid status. Must be todo, in-progress, or done' }, 400);
    }
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task across all projects
    let found = false;
    let updatedTask: any = null;
    
    for (const [projectName, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        const task = proj.tasks.find((t: any) => t.id === taskId);
        if (task) {
          task.status = status;
          task.updatedAt = new Date().toISOString();
          
          if (status === 'done') {
            task.completedAt = new Date().toISOString();
          } else if (status === 'in-progress') {
            task.startedAt = new Date().toISOString();
          }
          
          proj.updatedAt = new Date().toISOString();
          updatedTask = { ...task, project: projectName };
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    // Write back to file
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// Start task with agent endpoint - spawns a subagent
// Update task (full edit) endpoint
// Delete task endpoint
app.delete('/api/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find and delete the task across all projects
    let found = false;
    let deletedTask: any = null;
    
    for (const [projectName, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        const taskIndex = proj.tasks.findIndex((t: any) => t.id === taskId);
        if (taskIndex !== -1) {
          deletedTask = { ...proj.tasks[taskIndex], project: projectName };
          proj.tasks.splice(taskIndex, 1);
          proj.updatedAt = new Date().toISOString();
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    
    return c.json({ success: true, task: deletedTask });
  } catch (error: any) {
    console.error('Error deleting task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

// New /api/tasks/start endpoint with Tasker integration
app.post('/api/tasks/start', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, agentId, project } = body;
    
    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }
    
    // TESTING RULE: Default to testproject unless explicitly specified
    // NEVER test in thenexus - it's the production project
    const testProject = project || 'testproject';
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task
    let task: any = null;
    let projectName: string | null = null;
    
    for (const [name, projData] of Object.entries(data.projects || {})) {
      const proj = projData as any;
      if (proj.tasks) {
        const foundTask = proj.tasks.find((t: any) => t.id === taskId);
        if (foundTask) {
          if (project && name !== project) continue;
          task = foundTask;
          projectName = name;
          break;
        }
      }
    }
    
    if (!task) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    // Step 1: Create Discord thread in #task forum
    console.log(`Creating Discord thread for task ${taskId}...`);
    
    const taskNum = taskId.split('-')[1];
    const shortTitle = task.title.substring(0, 40);
    const threadTitle = `task-${taskNum}: ${shortTitle}`;
    
    // Truncate description for Discord (max 200 chars)
    const shortDesc = task.description 
      ? task.description.replace(/[#*`\[\]]/g, '').substring(0, 200) + '...' 
      : '(No description)';
    
    const threadMessage = `🎯 **New Task: ${task.title}**

**Task ID:** ${taskId}
**Project:** ${projectName}
**Priority:** ${task.priority || 'normal'}
**Tags:** ${Array.isArray(task.tags) ? task.tags.join(', ') : 'none'}

**Description:**
${shortDesc}

---

@Tasker please analyze and spawn appropriate agent.`;

    const { execSync } = await import('child_process');
    const threadResult = execSync(
      `openclaw message thread create ` +
      `--channel discord ` +
      `--target channel:1479614759916667051 ` +
      `--thread-name "${threadTitle.replace(/"/g, '\\"')}" ` +
      `--message "${threadMessage.replace(/"/g, '\\"')}" ` +
      `--json`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    
    const threadData = JSON.parse(threadResult);
    const threadId = threadData.payload?.thread?.id;
    
    if (!threadId) {
      throw new Error('Failed to create Discord thread');
    }
    
    console.log(`✅ Discord thread created: ${threadId}`);
    
    // Step 2: Store thread metadata in task
    task.discordThreadId = threadId;
    task.discordThreadUrl = `https://discord.com/channels/1474992983727407214/${threadId}`;
    task.status = 'in-progress';
    task.startedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    
    console.log(`✅ Discord thread created for task ${taskId}: ${threadId}`);
    
    // Step 2: Send task to Tasker via sessions_send (more reliable than Discord)
    console.log(`Sending task to @Tasker via sessions_send...`);
    
    const taskerTask = `🎯 **New Task Assignment**

**Task ID:** ${taskId}
**Title:** ${task.title}
**Project:** ${projectName}
**Priority:** ${task.priority || 'normal'}
**Tags:** ${Array.isArray(task.tags) ? task.tags.join(', ') : 'none'}

**Discord Thread:** <#${threadId}>
**Thread URL:** https://discord.com/channels/1474992983727407214/${threadId}

**Description:**
${shortDesc}

---

**INSTRUCTIONS:**
1. Analyze this task type (coding/research/writing/etc.)
2. Spawn the appropriate specialist subagent with thread: true
3. The subagent should be bound to the Discord thread above
4. Monitor for completion and ensure task is marked done

Please spawn the appropriate agent now.`;

    // Spawn Tasker as a subagent to handle orchestration
    console.log(`Spawning @Tasker as subagent...`);
    
    try {
      execSync(
        `openclaw agent --agent tasker --message "${taskerTask.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" &`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'ignore' }
      );
      console.log(`✅ @Tasker spawned to orchestrate task ${taskId}`);
    } catch (spawnError: any) {
      console.error('⚠️ Failed to spawn Tasker:', spawnError.message);
    }
    
    // Save project data
    const proj = data.projects[projectName!] as any;
    proj.updatedAt = new Date().toISOString();
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    return c.json({ 
      success: true, 
      message: `Task ${taskId} sent to @Tasker for orchestration`,
      discordThreadId: threadId,
      discordThreadUrl: task.discordThreadUrl,
    });
    
  } catch (error: any) {
    console.error('Error starting task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});
const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
