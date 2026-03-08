/**
 * Task Refinement Service
 * Spawns subagents to enrich task descriptions with project context
 * 
 * Loads prompt template from external markdown file for customization.
 * Custom prompt path can be set via REFINEMENT_PROMPT_PATH env var.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);

// ES module workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the refinement prompt template from file
 * Falls back to default prompt if custom file is missing or invalid
 */
function loadRefinementPrompt(): string {
  // Check for custom prompt path via environment variable
  const customPromptPath = process.env.REFINEMENT_PROMPT_PATH;
  
  // Default prompt location (relative to project root)
  const defaultPromptPath = path.join(__dirname, '..', 'refinement-prompt.md');
  
  const promptPath = customPromptPath || defaultPromptPath;
  
  try {
    if (!fs.existsSync(promptPath)) {
      console.warn(`⚠️ Refinement prompt file not found: ${promptPath}`);
      console.warn(`   Using fallback prompt template`);
      return getDefaultPromptTemplate();
    }
    
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    
    // Basic validation - check for essential placeholders
    if (!promptContent.includes('{{title}}') || !promptContent.includes('{{description}}')) {
      console.warn(`⚠️ Refinement prompt file missing required placeholders: ${promptPath}`);
      console.warn(`   Required: {{title}}, {{description}}, {{project}}`);
      console.warn(`   Using fallback prompt template`);
      return getDefaultPromptTemplate();
    }
    
    console.log(`✓ Loaded refinement prompt from: ${promptPath}`);
    return promptContent;
  } catch (error: any) {
    console.error(`❌ Error loading refinement prompt: ${error.message}`);
    console.warn(`   Using fallback prompt template`);
    return getDefaultPromptTemplate();
  }
}

/**
 * Default fallback prompt template (used if file is missing/invalid)
 */
function getDefaultPromptTemplate(): string {
  return `You are a Product Manager agent. Your job is to refine task descriptions.

**Task to Refine:**
- Title: {{title}}
- Description: {{description}}
- Project: {{project}}

**Instructions:**
1. Read the project context files at /home/azureuser/dev/projects/{{project}}/
2. Enrich the task description with clear objective, context, technical approach, files to modify, acceptance criteria, dependencies, and potential pitfalls
3. Fix any grammar issues

**Output:** Return ONLY the refined description in markdown format. No meta-commentary.`;
}

/**
 * Replace placeholders in prompt template with actual values
 */
function interpolatePrompt(template: string, values: {
  title: string;
  description: string;
  project: string;
  taskId?: string;
}): string {
  return template
    .replace(/{{title}}/g, values.title)
    .replace(/{{description}}/g, values.description || '(no description provided)')
    .replace(/{{project}}/g, values.project)
    .replace(/{{taskId}}/g, values.taskId || 'N/A');
}

/**
 * Synchronously refine a task description using an agent
 * Waits for agent to complete and returns the refined description
 */
export async function refineTaskDescriptionSync(
  title: string,
  description: string,
  project: string
): Promise<string> {
  try {
    const promptTemplate = loadRefinementPrompt();
    const refinementPrompt = interpolatePrompt(promptTemplate, { title, description, project });

    const command = `openclaw agent --agent coder --message "${refinementPrompt.replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(command, { timeout: 120000 }); // 2 minute timeout
    return stdout.trim() || description;
  } catch (error: any) {
    console.error('Error in sync refinement:', error.message);
    return description;
  }
}

/**
 * Spawn a subagent to refine a task description
 * Runs asynchronously - doesn't wait for completion
 * The subagent will call PUT /api/tasks/:id to update the description
 * 
 * @param callback - Optional callback invoked when refinement completes: (success: boolean, error?: string, sessionKey?: string) => void
 */
export async function spawnRefinementAgent(
  taskId: string,
  title: string,
  description: string,
  project: string,
  callback?: (success: boolean, error?: string, sessionKey?: string) => void
): Promise<void> {
  console.log(`🤖 Spawning refinement agent for task ${taskId}: "${title}"`);
  
  try {
    const promptTemplate = loadRefinementPrompt();
    const refinementPrompt = interpolatePrompt(promptTemplate, { taskId, title, description, project });
    
    // Use JSON output for clean parsing (filters out gateway status messages)
    const command = `openclaw agent --agent coder --message "${refinementPrompt.replace(/"/g, '\\"')}" --json`;
    
    console.log(`✓ Refinement agent spawned for task ${taskId}`);
    
    // Execute and capture output
    const { stdout } = await execAsync(command, { timeout: 120000 }); // 2 minute timeout
    
    // Extract session key from output
    const sessionKeyMatch = stdout.match(/session[:\s]+([^\s]+)/i);
    const sessionKey = sessionKeyMatch ? sessionKeyMatch[1] : null;
    
    // Parse JSON output to extract the message text
    let refinedDescription = '';
    try {
      // Extract JSON from stdout (may have "Process exited..." or other text after)
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
      
      const result = JSON.parse(jsonStr);
      // Extract text from the nested JSON structure: result.payloads[0].text
      if (result.result?.payloads?.[0]?.text) {
        refinedDescription = result.result.payloads[0].text;
      } else if (result.message) {
        refinedDescription = result.message;
      } else if (result.output) {
        refinedDescription = result.output;
      } else {
        console.warn(`⚠️ Unexpected JSON structure: ${JSON.stringify(result).substring(0, 200)}...`);
        refinedDescription = stdout;
      }
    } catch (parseError: any) {
      console.warn(`⚠️ JSON parse error: ${parseError.message}`);
      console.warn(`   stdout preview: ${stdout.substring(0, 200)}...`);
      // Fallback: use stdout directly if not JSON
      refinedDescription = stdout.trim();
    }
    
    // Filter out any gateway/cli status lines (lines starting with special chars or keywords)
    const lines = refinedDescription.split('\n');
    const cleanLines = lines.filter(line => {
      const trimmed = line.trim();
      // Keep lines that look like markdown content
      return trimmed && 
             !trimmed.startsWith('Gateway') && 
             !trimmed.startsWith('🦞') &&
             !trimmed.startsWith('Error:') &&
             !trimmed.startsWith('Config:') &&
             !trimmed.startsWith('Source:') &&
             !trimmed.startsWith('Bind:') &&
             trimmed !== 'Process exited with code 0.';
    });
    refinedDescription = cleanLines.join('\n').trim();
    
    if (refinedDescription && refinedDescription.length > 50) {
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
      console.log(`   Description length: ${refinedDescription.length} chars`);
      callback?.(true, undefined, sessionKey || undefined);
    } else {
      console.warn(`⚠️ Refinement agent returned empty or too-short output for task ${taskId}`);
      console.log(`   Output preview: ${refinedDescription.substring(0, 100)}...`);
      callback?.(false, 'Empty or insufficient refinement output', sessionKey || undefined);
    }
  } catch (error: any) {
    console.error(`❌ Error in refinement for task ${taskId}:`, error.message);
    console.error(`   Stack:`, error.stack);
    callback?.(false, error.message, undefined);
  }
}
