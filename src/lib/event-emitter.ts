/**
 * EventEmitter - Simple pub/sub for internal events
 *
 * Used to broadcast state changes across the application.
 * In Phase 5, this will integrate with WebSocket for client notifications.
 */

type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventListener>> = new Map();

  /**
   * Subscribe to an event
   */
  on(event: string, listener: EventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Subscribe to an event once
   */
  once(event: string, listener: EventListener): () => void {
    const wrapped = (...args: any[]) => {
      listener(...args);
      this.off(event, wrapped);
    };
    return this.on(event, wrapped);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    // Copy to array to avoid issues if listener modifies the set
    Array.from(eventListeners).forEach(listener => {
      try {
        listener(...args);
      } catch (error: any) {
        console.error(`Error in event listener for '${event}':`, error.message);
      }
    });
  }

  /**
   * Remove all listeners for an event (or all events if no event specified)
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size || 0;
  }

  /**
   * Get all event names with listeners
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

// Export singleton instance for app-wide use
export const eventEmitter = new EventEmitter();

// Event types for documentation
export interface AppEvents {
  // Task events
  'task:created': (task: any) => void;
  'task:updated': (task: any, changes: Partial<any>) => void;
  'task:deleted': (taskId: string) => void;
  'task:status-changed': (taskId: string, oldStatus: string, newStatus: string) => void;
  'task:agent-assigned': (taskId: string, agentId: string) => void;

  // Project events
  'project:created': (project: any) => void;
  'project:updated': (project: any, changes: Partial<any>) => void;
  'project:deleted': (projectName: string) => void;

  // Session events
  'session:started': (session: any) => void;
  'session:ended': (sessionKey: string) => void;
  'session:activity': (sessionKey: string, tokenDiff: number) => void;
}
