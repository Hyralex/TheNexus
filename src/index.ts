import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

// Create new task endpoint
app.post('/api/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, project } = body;
    
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
    
    // Generate task ID
    const proj = data.projects[project] as any;
    const taskCount = (proj.tasks || []).length + 1;
    const taskId = `task-${String(taskCount).padStart(3, '0')}`;
    
    // Create new task
    const newTask = {
      id: taskId,
      title,
      description: description || '',
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Add task to project
    if (!proj.tasks) {
      proj.tasks = [];
    }
    proj.tasks.push(newTask);
    proj.updatedAt = new Date().toISOString();
    
    // Write back to file
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
    
    return c.json({ success: true, task: newTask });
  } catch (error: any) {
    console.error('Error creating task:', error.message);
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
app.put('/api/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const { title, description, project: newProject, priority, tags } = body;
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task
    let found = false;
    let updatedTask: any = null;
    let oldProjectName: string | null = null;
    
    for (const [projectName, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        const task = proj.tasks.find((t: any) => t.id === taskId);
        if (task) {
          oldProjectName = projectName;
          
          // Update fields if provided
          if (title) task.title = title;
          if (description !== undefined) task.description = description;
          if (priority) task.priority = priority;
          if (tags) task.tags = tags;
          
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
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    
    return c.json({ success: true, task: updatedTask });
  } catch (error: any) {
    console.error('Error updating task:', error.message);
    return c.json({ error: error.message }, 500);
  }
});

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

app.post('/api/tasks/start', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, agentId } = body;
    
    if (!taskId || !agentId) {
      return c.json({ error: 'taskId and agentId are required' }, 400);
    }
    
    if (!fs.existsSync(PROJECTS_FILE)) {
      return c.json({ error: 'Projects file not found' }, 404);
    }
    
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    
    // Find the task across all projects
    let task: any = null;
    let projectName: string | null = null;
    
    for (const [name, project] of Object.entries(data.projects || {})) {
      const proj = project as any;
      if (proj.tasks) {
        const foundTask = proj.tasks.find((t: any) => t.id === taskId);
        if (foundTask) {
          task = foundTask;
          projectName = name;
          break;
        }
      }
    }
    
    if (!task) {
      return c.json({ error: `Task '${taskId}' not found` }, 404);
    }
    
    // Build the task description for the subagent
    const taskDescription = `Work on this task: ${task.title}${task.description ? ' - ' + task.description : ''}. This is task ${taskId} from project ${projectName}.`;
    
    // Spawn a subagent using openclaw command
    try {
      // Spawn subagent with the task - use background execution
      // The agent will run the task and announce completion
      const spawnCommand = `openclaw agent --agent ${agentId} --message "${taskDescription.replace(/"/g, '\\"')}"`;
      
      console.log(`Spawning subagent: ${spawnCommand}`);
      
      // Execute in background (don't wait for completion)
      // Use spawn instead of exec for better background process handling
      const { spawn } = await import('child_process');
      const child = spawn('openclaw', ['agent', '--agent', agentId, '--message', taskDescription], {
        env: { ...process.env, FORCE_COLOR: '0' },
        detached: true,
        stdio: 'ignore',
      });
      
      child.unref(); // Allow parent to exit independently
      
      console.log(`Subagent ${agentId} spawned with PID ${child.pid}`);
      
      // Update task status to in-progress
      task.status = 'in-progress';
      task.startedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      
      const proj = data.projects[projectName!] as any;
      proj.updatedAt = new Date().toISOString();
      
      // Write back to file
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
      
      return c.json({ 
        success: true, 
        message: `Subagent ${agentId} spawned for task ${taskId}`,
        agentId,
        taskId,
        pid: child.pid,
      });
    } catch (spawnError: any) {
      console.error('Error spawning subagent:', spawnError.message);
      return c.json({ error: `Failed to spawn subagent: ${spawnError.message}` }, 500);
    }
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
