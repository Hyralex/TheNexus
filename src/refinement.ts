/**
 * Task Refinement Service
 * Spawns subagents to enrich task descriptions with project context
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Spawn a subagent to refine a task description
 * Runs asynchronously - doesn't wait for completion
 * The subagent will call PUT /api/tasks/:id to update the description
 */
export async function spawnRefinementAgent(
  taskId: string,
  title: string,
  description: string,
  project: string
): Promise<void> {
  console.log(`🤖 Spawning refinement agent for task ${taskId}: "${title}"`);
  
  const refinementPrompt = `You are a Product Manager agent. Your job is to refine task descriptions.

**Task to Refine:**
- Task ID: ${taskId}
- Title: ${title}
- Description: ${description || '(no description provided)'}
- Project: ${project}

**Instructions:**
1. Read the project context:
   - /home/azureuser/dev/projects/${project}/AGENTS.md
   - /home/azureuser/dev/projects/${project}/context.md
   
2. Enrich the task description with:
   - Clear objective (what does "done" look like?)
   - Project-specific context (why this matters for THIS project)
   - Technical approach (relevant to the project's tech stack)
   - Specific files likely to be modified
   - Acceptance criteria (how to test)
   - Dependencies
   - Potential pitfalls specific to this project

3. Fix any grammar issues in title and description

4. Update the task by calling:
   curl -X PUT http://localhost:3000/api/tasks/${taskId} \\
     -H "Content-Type: application/json" \\
     -d '{"description": "<your refined description>", "refined": true, "refinedAt": "<ISO timestamp>", "refinedBy": "agent:coder:refinement"}'

**Output:** Only output the refined description in markdown. No meta-commentary.`;

  try {
    // Spawn subagent and capture its output
    const command = `openclaw agent --agent coder --message "${refinementPrompt.replace(/"/g, '\\"')}"`;
    
    console.log(`✓ Refinement agent spawned for task ${taskId}`);
    
    // Execute and capture output
    const { stdout } = await execAsync(command, { timeout: 60000 });
    
    // The agent's output IS the refined description
    const refinedDescription = stdout.trim();
    
    if (refinedDescription) {
      // Update the task via API - include project to avoid ID collisions
      const updateCommand = `curl -s -X PUT "http://localhost:3000/api/tasks/${taskId}?project=${project}" \\
        -H "Content-Type: application/json" \\
        -d '${JSON.stringify({
          description: refinedDescription,
          refined: true,
          refinedAt: new Date().toISOString(),
          refinedBy: 'agent:coder:refinement',
        }).replace(/'/g, "'\"'\"'")}'`;
      
      await execAsync(updateCommand);
      
      console.log(`✅ Task ${taskId} refined successfully in project ${project}`);
    } else {
      console.warn(`⚠️ Refinement agent returned empty output for task ${taskId}`);
    }
  } catch (error: any) {
    console.error(`❌ Error in refinement for task ${taskId}:`, error.message);
  }
}
