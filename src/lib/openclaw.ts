import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface Session {
  key: string;
  agentId: string;
  sessionId?: string;
  totalTokens?: number;
  ageMs?: number;
  [key: string]: any;
}

export interface GetSessionsOptions {
  allAgents?: boolean;
  activeMinutes?: number;
}

export interface SpawnAgentOptions {
  agentId?: string;
  sessionId?: string;
  message: string;
  timeout?: number;
}

export interface SpawnResult {
  sessionKey?: string;
  stdout: string;
  stderr: string;
}

/**
 * OpenClawClient - Singleton for interacting with OpenClaw CLI
 *
 * Provides cached access to sessions and agent spawning capabilities.
 */
export class OpenClawClient {
  private static instance: OpenClawClient;
  private sessionCache = new Map<string, { sessions: Session[]; timestamp: number }>();
  private readonly CACHE_TTL = 5000; // 5 seconds

  private constructor() {}

  static getInstance(): OpenClawClient {
    if (!OpenClawClient.instance) {
      OpenClawClient.instance = new OpenClawClient();
    }
    return OpenClawClient.instance;
  }

  /**
   * Get all sessions from OpenClaw
   */
  async getSessions(options?: GetSessionsOptions): Promise<Session[]> {
    const cacheKey = JSON.stringify(options || {});
    const cached = this.sessionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.sessions;
    }

    try {
      const args = ['sessions', '--all-agents', '--json'];
      if (options?.activeMinutes) {
        args.push('--active', options.activeMinutes.toString());
      }

      const { stdout } = await execAsync(`openclaw ${args.join(' ')}`, {
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const data = JSON.parse(stdout);
      const sessions = data.sessions || [];

      this.sessionCache.set(cacheKey, { sessions, timestamp: Date.now() });
      return sessions;
    } catch (error: any) {
      console.error('Error fetching sessions:', error.message);
      return [];
    }
  }

  /**
   * Get single session by key
   */
  async getSession(key: string): Promise<Session | null> {
    const sessions = await this.getSessions();
    return sessions.find(s => s.key === key) || null;
  }

  /**
   * Get session stores info (for finding session file paths)
   */
  async getStores(): Promise<any[]> {
    try {
      const { stdout } = await execAsync('openclaw sessions --all-agents --json', {
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      const data = JSON.parse(stdout);
      return data.stores || [];
    } catch (error: any) {
      console.error('Error fetching stores:', error.message);
      return [];
    }
  }

  /**
   * Spawn an agent with a message
   */
  async spawnAgent(options: SpawnAgentOptions): Promise<SpawnResult> {
    const args: string[] = ['agent'];

    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    } else if (options.agentId) {
      args.push('--agent', options.agentId);
    }

    args.push('--message', options.message);

    try {
      const { stdout, stderr } = await execFileAsync('openclaw', args, {
        timeout: options.timeout || 300000, // 5 minute default timeout
      });

      // Extract session key from output
      const sessionKeyMatch = stdout.match(/session[:\s]+([^\s]+)/i);
      const sessionKey = sessionKeyMatch ? sessionKeyMatch[1] : undefined;

      return { sessionKey, stdout, stderr };
    } catch (error: any) {
      console.error('Error spawning agent:', error.message);
      throw error;
    }
  }

  /**
   * Spawn agent asynchronously (fire and forget)
   */
  spawnAgentAsync(options: SpawnAgentOptions): void {
    const args: string[] = ['agent'];

    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    } else if (options.agentId) {
      args.push('--agent', options.agentId);
    }

    args.push('--message', options.message);

    execFileAsync('openclaw', args, {
      timeout: options.timeout || 300000,
    }).then(({ stdout, stderr }) => {
      console.log(`✅ Agent spawned successfully`);
      const sessionKeyMatch = stdout.match(/session[:\s]+([^\s]+)/i);
      if (sessionKeyMatch) {
        console.log(`   Session: ${sessionKeyMatch[1]}`);
      }
    }).catch((error: any) => {
      console.error(`⚠️ Agent spawn error:`, error.message);
    });
  }

  /**
   * Kill/abort a session
   */
  async killSession(key: string): Promise<void> {
    try {
      await execAsync(`openclaw chat abort "${key}"`, {
        env: { ...process.env, FORCE_COLOR: '0' },
      });
    } catch (error: any) {
      console.error('Error killing session:', error.message);
      throw error;
    }
  }

  /**
   * Get session transcript (messages from JSONL file)
   */
  async getSessionTranscript(session: Session, storePath: string, sessionFile: string): Promise<any[]> {
    const fs = await import('fs');

    try {
      const jsonlContent = fs.readFileSync(sessionFile, 'utf-8');
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

      return messages.slice(-50); // Last 50 messages
    } catch (error: any) {
      console.error('Error reading session transcript:', error.message);
      return [];
    }
  }

  /**
   * Clear session cache
   */
  clearCache(): void {
    this.sessionCache.clear();
  }
}

// Export singleton instance
export const openclaw = OpenClawClient.getInstance();
