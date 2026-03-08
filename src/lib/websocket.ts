import WebSocket, { WebSocketServer } from 'ws';
import { eventEmitter } from './event-emitter.js';

/**
 * WebSocket manager - handles WebSocket connections and broadcasts events
 */
export class WebSocketManager {
  public wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  /**
   * Create WebSocket server (call before starting HTTP server)
   */
  createServer(): WebSocketServer {
    this.wss = new WebSocketServer({
      noServer: true,
      path: '/api/ws',
    });

    this.wss.on('connection', (ws) => {
      console.log('🔌 WebSocket client connected');
      this.clients.add(ws);

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        this.clients.delete(ws);
      });
    });

    // Subscribe to all app events and broadcast to clients
    this.subscribeToEvents();

    console.log('📡 WebSocket server created on /api/ws');

    return this.wss;
  }

  /**
   * Subscribe to event emitter and broadcast events to clients
   */
  private subscribeToEvents(): void {
    // Task events
    eventEmitter.on('task:created', (task) => {
      this.broadcast({ type: 'task:created', data: task });
    });

    eventEmitter.on('task:updated', (task, changes) => {
      this.broadcast({ type: 'task:updated', data: { task, changes } });
    });

    eventEmitter.on('task:deleted', (taskId) => {
      this.broadcast({ type: 'task:deleted', data: { taskId } });
    });

    eventEmitter.on('task:status-changed', (taskId, oldStatus, newStatus) => {
      this.broadcast({ type: 'task:status-changed', data: { taskId, oldStatus, newStatus } });
    });

    eventEmitter.on('task:agent-assigned', (taskId, agentId) => {
      this.broadcast({ type: 'task:agent-assigned', data: { taskId, agentId } });
    });

    // Project events
    eventEmitter.on('project:created', (project) => {
      this.broadcast({ type: 'project:created', data: project });
    });

    eventEmitter.on('project:updated', (project, changes) => {
      this.broadcast({ type: 'project:updated', data: { project, changes } });
    });

    eventEmitter.on('project:deleted', (projectName) => {
      this.broadcast({ type: 'project:deleted', data: { projectName } });
    });

    // Session events
    eventEmitter.on('session:activity', (sessionKey, tokenDiff) => {
      this.broadcast({ type: 'session:activity', data: { sessionKey, tokenDiff } });
    });

    eventEmitter.on('session:ended', (sessionKey) => {
      this.broadcast({ type: 'session:ended', data: { sessionKey } });
    });
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(event: { type: string; data: any }): void {
    const message = JSON.stringify(event);
    const deadClients: WebSocket[] = [];

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        deadClients.push(client);
      }
    }

    // Clean up dead connections
    deadClients.forEach((client) => this.clients.delete(client));
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections and shutdown
   */
  close(): void {
    this.clients.forEach((client) => client.close());
    this.clients.clear();
    this.wss?.close();
  }
}

// Export singleton instance
export const websocketManager = new WebSocketManager();
