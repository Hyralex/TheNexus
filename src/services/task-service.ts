import { eventEmitter } from '../lib/event-emitter.js';
import { loadProjects, saveProjects, generateTaskId, findTask } from '../lib/projects.js';
import { refineTaskDescriptionSync } from '../refinement.js';
import { openclaw } from '../lib/openclaw.js';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

export interface CreateTaskInput {
  title: string;
  description?: string;
  project: string;
  priority?: string;
  tags?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  project?: string;
  priority?: string;
  tags?: string[];
  refined?: boolean;
  refinedAt?: string;
  refinedBy?: string;
  refinementSessionKey?: string;
}

export interface Task extends CreateTaskInput {
  id: string;
  status: 'todo' | 'refinement' | 'in-progress' | 'done';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  refined: boolean;
  refinedAt: string | null;
  refinedBy: string | null;
  originalDescription: string | null;
  awaitingRefinement: boolean;
  assignedAgent?: string;
  sessionKey?: string;
  refinementSessionKey?: string;
}

/**
 * TaskService - Business logic for task operations
 */
export class TaskService {
  /**
   * Get all tasks across all projects
   */
  async findAll(projectFilter?: string, statusFilter?: string): Promise<Task[]> {
    const data = loadProjects();
    const allTasks: Task[] = [];

    for (const [projectName, project] of Object.entries(data.projects || {})) {
      if (projectFilter && projectName !== projectFilter) continue;

      const proj = project as any;
      if (proj.tasks) {
        for (const task of proj.tasks) {
          if (statusFilter && task.status !== statusFilter) continue;
          allTasks.push({
            ...task,
            project: projectName,
          });
        }
      }
    }

    return allTasks;
  }

  /**
   * Find a task by ID
   */
  async findById(taskId: string): Promise<{ task: Task; projectName: string } | null> {
    const result = findTask(taskId);
    if (!result) return null;
    return { task: result.task, projectName: result.projectName };
  }

  /**
   * Create a new task
   */
  async create(input: CreateTaskInput): Promise<Task> {
    const data = loadProjects();

    if (!data.projects || !data.projects[input.project]) {
      throw new Error(`Project '${input.project}' not found`);
    }

    const taskId = generateTaskId(data);
    const proj = data.projects[input.project] as any;

    const newTask: Task = {
      id: taskId,
      title: input.title,
      description: input.description || '',
      project: input.project,
      status: 'todo',
      priority: input.priority,
      tags: input.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      refined: false,
      refinedAt: null,
      refinedBy: null,
      originalDescription: input.description || null,
      awaitingRefinement: false,
    };

    if (!proj.tasks) {
      proj.tasks = [];
    }
    proj.tasks.push(newTask);
    proj.updatedAt = new Date().toISOString();

    saveProjects(data);

    console.log(`✓ Task created: ${taskId}`);

    // Emit event
    eventEmitter.emit('task:created', newTask);

    return newTask;
  }

  /**
   * Update a task
   */
  async update(taskId: string, input: UpdateTaskInput, projectFilter?: string): Promise<Task> {
    const result = findTask(taskId, projectFilter || undefined);

    if (!result) {
      throw new Error(`Task '${taskId}' not found${projectFilter ? ` in project '${projectFilter}'` : ''}`);
    }

    const { task, project, projectName } = result;

    // Track changes for event emission
    const changes: Partial<Task> = {};
    const oldStatus = task.status;

    // Update fields if provided
    if (input.title !== undefined) {
      task.title = input.title;
      changes.title = input.title;
    }
    if (input.description !== undefined) {
      task.description = input.description;
      changes.description = input.description;
    }
    if (input.priority !== undefined) {
      task.priority = input.priority;
      changes.priority = input.priority;
    }
    if (input.tags !== undefined) {
      task.tags = input.tags;
      changes.tags = input.tags;
    }
    if (input.refined !== undefined) {
      task.refined = input.refined;
      changes.refined = input.refined;
    }
    if (input.refinedAt !== undefined) {
      task.refinedAt = input.refinedAt;
      changes.refinedAt = input.refinedAt;
    }
    if (input.refinedBy !== undefined) {
      task.refinedBy = input.refinedBy;
      changes.refinedBy = input.refinedBy;
    }
    if (input.refinementSessionKey !== undefined) {
      task.refinementSessionKey = input.refinementSessionKey;
      changes.refinementSessionKey = input.refinementSessionKey;
    }

    // Clear awaitingRefinement flag if refined
    if (input.refined === true) {
      task.awaitingRefinement = false;
    }

    // Clear refinement flag when task is manually edited (description changed)
    // BUT NOT if this update is setting refined: true
    if (input.description !== undefined && task.refined === true && input.refined !== true) {
      task.refined = false;
      task.refinedAt = null;
      task.refinedBy = null;
      console.log(`⚠️ Task ${taskId} edited - refinement flag cleared`);
    }

    // Handle project change
    if (input.project && input.project !== projectName) {
      const taskIndex = project.tasks.findIndex((t: any) => t.id === taskId);
      if (taskIndex !== -1) {
        const taskData = project.tasks[taskIndex];
        project.tasks.splice(taskIndex, 1);

        const newData = loadProjects();
        if (newData.projects[input.project]) {
          taskData.project = undefined;
          newData.projects[input.project].tasks.push(taskData);
          newData.projects[input.project].updatedAt = new Date().toISOString();
          saveProjects(newData);
          changes.project = input.project;
        }
      }
    } else {
      task.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();
      saveProjects({ projects: { [projectName]: project } });
      const fullData = loadProjects();
      fullData.projects[projectName] = project;
      saveProjects(fullData);
    }

    const updatedTask = { ...task, project: input.project || projectName };

    // Emit status change event if status changed
    if (oldStatus !== task.status) {
      eventEmitter.emit('task:status-changed', taskId, oldStatus, task.status);
    }

    console.log(`✓ Task ${taskId} updated in project ${updatedTask.project}`);
    eventEmitter.emit('task:updated', updatedTask, changes);

    return updatedTask;
  }

  /**
   * Update task status
   */
  async updateStatus(taskId: string, status: 'todo' | 'refinement' | 'in-progress' | 'done'): Promise<Task> {
    const result = findTask(taskId);

    if (!result) {
      throw new Error(`Task '${taskId}' not found`);
    }

    const { task, project, projectName } = result;
    const oldStatus = task.status;

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

    console.log(`✓ Task ${taskId} moved from ${oldStatus} to ${status}`);
    eventEmitter.emit('task:status-changed', taskId, oldStatus, status);
    eventEmitter.emit('task:updated', updatedTask, { status });

    return updatedTask;
  }

  /**
   * Delete a task
   */
  async delete(taskId: string): Promise<Task> {
    const result = findTask(taskId);

    if (!result) {
      throw new Error(`Task '${taskId}' not found`);
    }

    const { project, projectName } = result;

    const taskIndex = project.tasks.findIndex((t: any) => t.id === taskId);
    if (taskIndex === -1) {
      throw new Error('Task not found');
    }

    const deletedTask = { ...project.tasks[taskIndex], project: projectName };
    project.tasks.splice(taskIndex, 1);
    project.updatedAt = new Date().toISOString();

    // Save
    const data = loadProjects();
    data.projects[projectName] = project;
    saveProjects(data);

    console.log(`✓ Task ${taskId} deleted`);
    eventEmitter.emit('task:deleted', taskId);

    return deletedTask;
  }

  /**
   * Start refinement for a task - spawns agent asynchronously
   */
  async startRefinement(taskId: string, agentId: string, project?: string): Promise<{
    success: boolean;
    message: string;
    agentId: string;
    status: string;
  }> {
    const result = findTask(taskId, project || undefined);

    if (!result) {
      throw new Error(`Task '${taskId}' not found`);
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

    // Emit event
    eventEmitter.emit('task:agent-assigned', taskId, agentId);

    return {
      success: true,
      message: `Task ${taskId} assigned to ${agentId} for refinement.`,
      agentId,
      status: 'refinement',
    };
  }

  /**
   * Manual refinement (synchronous)
   */
  async refine(taskId: string): Promise<Task> {
    const result = findTask(taskId);

    if (!result) {
      throw new Error(`Task '${taskId}' not found`);
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

    eventEmitter.emit('task:updated', updatedTask, { refined: true, description: task.description });

    return updatedTask;
  }

  /**
   * Start a task with an agent - spawns subagent asynchronously
   */
  async start(taskId: string, agentId: string, project?: string): Promise<{
    success: boolean;
    message: string;
    agentId: string;
    status: string;
  }> {
    const result = findTask(taskId, project || undefined);

    if (!result) {
      throw new Error(`Task '${taskId}' not found`);
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

    // Build enhanced task message
    const enhancedTaskMessage = `🎯 **Task Assignment: ${task.id}**

**Project:** ${projectName}
**Title:** ${task.title}
**Description:** ${task.description || 'No description provided'}

## Project Manager Skill Instructions

1. **Mark the task as in-progress** when you start working:
   - Run: \`pm task move ${task.id} in-progress --project ${projectName}\`

2. **Attach your session to the task** (CRITICAL - enables session tracking):
   - Run: \`pm task session attach ${task.id} <your-session-key> --type work --project ${projectName}\`
   - Your session key is in the session context or run \`openclaw status\` to find it

3. **Spawn a subagent in a Discord thread** to do the actual work:
   - Use \`sessions_spawn\` with \`thread: true\` and \`mode: "session"\`
   - Pass the task details to the subagent so it can also attach its session

4. **Complete the task** when work is done:
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
            // Store as workSessionKey to match pm task session attach convention
            taskResult.task.workSessionKey = sessionKey;
            taskResult.task.updatedAt = new Date().toISOString();
            projData.projects[taskResult.projectName] = taskResult.project;
            saveProjects(projData);
          }
        }
      })
      .catch((spawnError: any) => {
        console.error(`⚠️ Agent spawn error for task ${taskId}:`, spawnError.message);
      });

    // Emit event
    eventEmitter.emit('task:agent-assigned', taskId, agentId);

    // Return immediately - agent runs in background
    return {
      success: true,
      message: `Task ${taskId} assigned to agent ${agentId}.`,
      agentId,
      status: 'todo', // Task remains in todo until agent starts working
    };
  }
}

// Export singleton instance
export const taskService = new TaskService();
