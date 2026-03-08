import { eventEmitter } from '../lib/event-emitter.js';
import { openclaw, Session } from '../lib/openclaw.js';

export interface ActivityEntry {
  timestamp: string;
  type: 'new_session' | 'activity' | 'completed';
  agent: string;
  message: string;
}

export interface ActivityResult {
  active: number;
  recent: ActivityEntry[];
}

/**
 * SessionService - Business logic for session operations
 *
 * Wraps OpenClawClient and adds activity tracking.
 */
export class SessionService {
  private lastSessionsState: Session[] = [];
  private activityLog: ActivityEntry[] = [];

  /**
   * Get all sessions
   */
  async findAll(): Promise<Session[]> {
    return openclaw.getSessions();
  }

  /**
   * Get active sessions (last N minutes)
   */
  async findActive(minutes: number = 5): Promise<Session[]> {
    return openclaw.getSessions({ activeMinutes: minutes });
  }

  /**
   * Get a single session by key
   */
  async findById(key: string): Promise<Session | null> {
    return openclaw.getSession(key);
  }

  /**
   * Get session with transcript
   */
  async findByIdWithTranscript(key: string): Promise<{
    session: Session | null;
    messages: any[];
  }> {
    const session = await openclaw.getSession(key);

    if (!session) {
      return { session: null, messages: [] };
    }

    const stores = await openclaw.getStores();
    const store = stores.find((s: any) => s.agentId === session.agentId);

    if (!store?.path) {
      return { session, messages: [] };
    }

    const fs = await import('fs');
    const storeContent = fs.readFileSync(store.path, 'utf-8');
    const storeData = JSON.parse(storeContent);
    const sessionData = storeData[session.key];

    if (!sessionData?.sessionFile) {
      return { session, messages: [] };
    }

    const messages = await openclaw.getSessionTranscript(
      session,
      store.path,
      sessionData.sessionFile
    );

    return { session, messages };
  }

  /**
   * Kill/abort a session
   */
  async kill(key: string): Promise<void> {
    await openclaw.killSession(key);
    console.log(`✓ Session aborted: ${key}`);
    eventEmitter.emit('session:ended', key);
  }

  /**
   * Get activity feed with change detection
   */
  async getActivity(): Promise<ActivityResult> {
    const currentSessions = await openclaw.getSessions({ activeMinutes: 30 });

    // Detect new/changed sessions
    const newActivities: ActivityEntry[] = [];

    for (const session of currentSessions) {
      const existing = this.lastSessionsState.find(s => s.key === session.key);

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

          // Emit event for real-time updates
          eventEmitter.emit('session:activity', session.key, tokenDiff);
        }
      }
    }

    // Check for completed sessions (was active, now gone)
    for (const oldSession of this.lastSessionsState) {
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
    this.activityLog.splice(0, 0, ...newActivities);
    this.activityLog.splice(50);

    // Update state
    this.lastSessionsState.splice(0, this.lastSessionsState.length, ...currentSessions);

    return {
      active: currentSessions.length,
      recent: this.activityLog.slice(0, 20),
    };
  }

  /**
   * Get current activity log
   */
  getActivityLog(): ActivityEntry[] {
    return this.activityLog.slice(0, 20);
  }

  /**
   * Clear activity log and state
   */
  clearState(): void {
    this.activityLog = [];
    this.lastSessionsState = [];
  }
}

// Export singleton instance
export const sessionService = new SessionService();
