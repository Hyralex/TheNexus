import * as fs from 'fs';
import * as path from 'path';
import { eventEmitter } from '../lib/event-emitter.js';
import { getProjectsFilePath, loadProjects, saveProjects } from '../lib/projects.js';

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface Project {
  name: string;
  path: string;
  active: boolean;
  description: string;
  createdAt: string;
  updatedAt?: string;
  tasks?: any[];
}

/**
 * ProjectService - Business logic for project operations
 */
export class ProjectService {
  /**
   * Get all projects
   */
  async findAll(): Promise<{ projects: Record<string, Project>; activeProject: string | null }> {
    const data = loadProjects();
    return {
      projects: data.projects || {},
      activeProject: data.activeProject || null,
    };
  }

  /**
   * Find a project by name
   */
  async findByName(name: string): Promise<Project | null> {
    const data = loadProjects();
    return data.projects[name] || null;
  }

  /**
   * Create a new project
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const PROJECTS_FILE = getProjectsFilePath();
    const data = loadProjects();

    if (data.projects[input.name]) {
      throw new Error('Project already exists');
    }

    // Create project entry
    const project: Project = {
      name: input.name,
      path: path.join(path.dirname(PROJECTS_FILE), input.name),
      active: true,
      description: input.description || '',
      createdAt: new Date().toISOString(),
      tasks: [],
    };

    data.projects[input.name] = project;

    // Create project folder and files
    fs.mkdirSync(project.path, { recursive: true });
    fs.writeFileSync(
      path.join(project.path, 'context.md'),
      `# ${input.name}\n\n${input.description ? input.description : ''}\n`
    );
    fs.writeFileSync(
      path.join(project.path, 'memory.md'),
      `# Project Memory - ${input.name}\n\n`
    );
    fs.writeFileSync(
      path.join(project.path, 'sessions.json'),
      JSON.stringify({ sessions: [] }, null, 2)
    );

    saveProjects(data);

    console.log(`✓ Project created: ${input.name}`);

    // Emit event
    eventEmitter.emit('project:created', project);

    return project;
  }

  /**
   * Update a project
   */
  async update(name: string, input: { description?: string; newName?: string }): Promise<Project> {
    const data = loadProjects();

    if (!data.projects[name]) {
      throw new Error('Project not found');
    }

    const changes: Partial<Project> = {};

    if (input.description !== undefined) {
      data.projects[name].description = input.description;
      changes.description = input.description;
    }

    if (input.newName && input.newName !== name) {
      // Rename project
      data.projects[input.newName] = { ...data.projects[name], name: input.newName };
      delete data.projects[name];
      changes.name = input.newName;

      // Rename folder
      const oldPath = data.projects[input.newName].path;
      const newPath = path.join(path.dirname(oldPath), input.newName);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        data.projects[input.newName].path = newPath;
      }
    }

    data.projects[name || input.newName!].updatedAt = new Date().toISOString();
    saveProjects(data);

    const project = data.projects[name || input.newName!];
    console.log(`✓ Project updated: ${project.name}`);

    eventEmitter.emit('project:updated', project, changes);

    return project;
  }

  /**
   * Delete a project
   */
  async delete(name: string): Promise<void> {
    const data = loadProjects();

    if (!data.projects[name]) {
      throw new Error('Project not found');
    }

    // Check if project has tasks
    if (data.projects[name].tasks && data.projects[name].tasks!.length > 0) {
      throw new Error('Cannot delete project with tasks. Remove all tasks first.');
    }

    // Delete project folder
    const projectPath = data.projects[name].path;
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true });
    }

    delete data.projects[name];
    saveProjects(data);

    console.log(`✓ Project deleted: ${name}`);

    eventEmitter.emit('project:deleted', name);
  }

  /**
   * Set active project
   */
  async setActive(name: string): Promise<Project> {
    const data = loadProjects();

    if (!data.projects[name]) {
      throw new Error('Project not found');
    }

    // Deactivate all projects
    for (const projectName of Object.keys(data.projects)) {
      data.projects[projectName].active = false;
    }

    // Activate selected project
    data.projects[name].active = true;
    data.activeProject = name;
    saveProjects(data);

    console.log(`✓ Active project set to: ${name}`);

    return data.projects[name];
  }

  /**
   * Get active project
   */
  async getActive(): Promise<Project | null> {
    const data = loadProjects();
    if (!data.activeProject) return null;
    return data.projects[data.activeProject] || null;
  }
}

// Export singleton instance
export const projectService = new ProjectService();
