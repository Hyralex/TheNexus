import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const PROJECTS_FILE = path.join(process.env.HOME || os.homedir(), 'dev', 'projects', 'projects.json');

/**
 * Get the projects file path
 */
export function getProjectsFilePath(): string {
  return PROJECTS_FILE;
}

/**
 * Load projects data from JSON file
 */
export function loadProjects(): any {
  if (!fs.existsSync(PROJECTS_FILE)) {
    return { projects: {}, activeProject: null };
  }

  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch (error: any) {
    console.error('Error loading projects.json:', error.message);
    return { projects: {}, activeProject: null };
  }
}

/**
 * Save projects data to JSON file
 */
export function saveProjects(data: any): void {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Find a task by ID across all projects
 * Returns { task, project, projectName } or null if not found
 */
export function findTask(taskId: string, projectFilter?: string): { task: any; project: any; projectName: string } | null {
  const data = loadProjects();

  for (const [projectName, project] of Object.entries(data.projects || {})) {
    if (projectFilter && projectName !== projectFilter) {
      continue;
    }

    const proj = project as any;
    if (proj.tasks) {
      const task = proj.tasks.find((t: any) => t.id === taskId);
      if (task) {
        return { task, project: proj, projectName };
      }
    }
  }

  return null;
}

/**
 * Generate a globally unique task ID
 */
export function generateTaskId(data: any): string {
  const globalCounter = data.globalTaskCounter || 0;
  const taskId = `task-${String(globalCounter + 1).padStart(3, '0')}`;
  data.globalTaskCounter = globalCounter + 1;
  return taskId;
}
