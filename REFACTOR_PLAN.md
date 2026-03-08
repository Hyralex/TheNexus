# TheNexus Refactor Plan

**Goal:** Make TheNexus scalable while keeping it lightweight and local-first

**Principles:**
- SQLite for data persistence (no server required)
- WebSocket for real-time updates (where easy, otherwise SSE)
- Keep HTMX - no heavy frontend framework
- Maintain `pm` CLI compatibility
- One phase at a time - test before moving on

---

## Phase 1: Database Foundation

**Goal:** Replace `projects.json` with SQLite

### Tasks

- [ ] **1.1** Add SQLite dependency (`@libsql/client` - WebSocket-enabled SQLite)
- [ ] **1.2** Create `src/db/database.ts` - connection singleton
- [ ] **1.3** Create `src/db/schema.ts` - table definitions
- [ ] **1.4** Create `src/db/migrate.ts` - migration runner
- [ ] **1.5** Create initial migration: projects, tasks, sessions tables
- [ ] **1.6** Add startup migration check in `src/index.ts`
- [ ] **1.7** Create `src/repositories/types.ts` - TypeScript interfaces

### Schema

```sql
-- projects table
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- tasks table
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  original_description TEXT,
  status TEXT DEFAULT 'todo',  -- todo, refinement, in-progress, done
  priority TEXT,              -- low, medium, high, urgent
  tags TEXT,                  -- JSON array
  assigned_agent TEXT,
  refined BOOLEAN DEFAULT FALSE,
  refined_at DATETIME,
  refined_by TEXT,
  work_session_key TEXT,
  refinement_session_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

-- sessions table (for tracking, mirrors openclaw data)
CREATE TABLE sessions (
  key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME,
  total_tokens INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'  -- active, completed, killed
);

-- Indexes for common queries
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
```

### Migration from JSON

```typescript
// On first run, if projects.json exists:
// 1. Read JSON
// 2. Insert all projects
// 3. Insert all tasks (with project_id mapping)
// 4. Rename projects.json to projects.json.backup
```

### Success Criteria
- [ ] Database created on first run
- [ ] JSON data migrated successfully
- [ ] App starts without errors
- [ ] Existing `pm` CLI still works (reads/writes to DB via JSON fallback or direct DB)

---

## Phase 2: Repository Layer

**Goal:** Decouple data access from business logic

### Tasks

- [ ] **2.1** Create `src/repositories/project-repository.ts`
- [ ] **2.2** Create `src/repositories/task-repository.ts`
- [ ] **2.3** Create `src/repositories/session-repository.ts`
- [ ] **2.4** Update `src/index.ts` to use repositories (temporary, before service layer)

### Repository Interfaces

```typescript
// ProjectRepository
interface ProjectRepository {
  findAll(): Promise<Project[]>;
  findById(id: string): Promise<Project | null>;
  findByName(name: string): Promise<Project | null>;
  findActive(): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, input: Partial<Project>): Promise<Project>;
  delete(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
}

// TaskRepository
interface TaskRepository {
  findAll(projectId?: string, status?: string): Promise<Task[]>;
  findById(id: string): Promise<Task | null>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;
  moveToStatus(id: string, status: string): Promise<Task>;
  assignAgent(id: string, agentId: string): Promise<Task>;
  markRefined(id: string, description: string): Promise<Task>;
}
```

### Success Criteria
- [ ] All current API endpoints work with repositories
- [ ] No direct database calls in routes
- [ ] Unit tests pass for repositories (if we add tests)

---

## Phase 3: Service Layer

**Goal:** Extract business logic, add OpenClaw client singleton

### Tasks

- [ ] **3.1** Create `src/lib/openclaw.ts` - OpenClawClient singleton
- [ ] **3.2** Create `src/lib/event-emitter.ts` - internal events
- [ ] **3.3** Create `src/services/task-service.ts`
- [ ] **3.4** Create `src/services/project-service.ts`
- [ ] **3.5** Create `src/services/session-service.ts`
- [ ] **3.6** Create `src/services/refinement-service.ts`
- [ ] **3.7** Update routes to use services

### OpenClawClient

```typescript
export class OpenClawClient {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 5000; // 5 seconds

  async getSessions(options?: GetSessionsOptions): Promise<Session[]>;
  async getSession(key: string): Promise<Session | null>;
  async spawnAgent(options: SpawnAgentOptions): Promise<SpawnResult>;
  async killSession(key: string): Promise<void>;
  async getAgents(): Promise<Agent[]>;  // New: discover available agents
}
```

### Event System

```typescript
// Events emitted by services:
// - task:created
// - task:updated
// - task:deleted
// - task:status-changed
// - task:agent-assigned
// - project:created
// - project:updated
// - session:started
// - session:ended
```

### Success Criteria
- [ ] No business logic in route handlers
- [ ] OpenClaw calls go through singleton
- [ ] Events emitted on state changes

---

## Phase 4: Route Refactoring

**Goal:** Split monolithic `index.ts` into organized route files

### Tasks

- [ ] **4.1** Create `src/app.ts` - Hono app setup, middleware
- [ ] **4.2** Create `src/routes/api.ts` - API route grouping
- [ ] **4.3** Create `src/routes/pages.ts` - Page routes (SPA routing)
- [ ] **4.4** Create `src/routes/sessions.ts` - /api/sessions/* handlers
- [ ] **4.5** Create `src/routes/tasks.ts` - /api/tasks/* handlers
- [ ] **4.6** Create `src/routes/projects.ts` - /api/projects/* handlers
- [ ] **4.7** Create `src/routes/agents.ts` - /api/agents/* handlers (new)
- [ ] **4.8** Update `src/index.ts` - thin entry point, just bootstrap

### New Structure

```
src/
├── index.ts          # Entry point (50 lines max)
├── app.ts            # App setup, middleware
├── routes/
│   ├── api.ts        # Groups all API routes
│   ├── pages.ts      # Page routes
│   ├── tasks.ts      # Task endpoints
│   ├── projects.ts   # Project endpoints
│   ├── sessions.ts   # Session endpoints
│   └── agents.ts     # Agent endpoints (new)
├── services/
├── repositories/
└── db/
```

### New Endpoints

```typescript
// agents.ts - New endpoints
GET  /api/agents              // List available agents
GET  /api/agents/:id/status   // Agent availability
GET  /api/agents/:id/history  // Recent tasks by agent
```

### Success Criteria
- [ ] No file > 300 lines (except schema/types)
- [ ] `index.ts` is just bootstrap
- [ ] All existing endpoints work
- [ ] New `/api/agents` endpoint works

---

## Phase 5: Real-time Updates (WebSocket)

**Goal:** Replace polling with WebSocket for live updates

### Tasks

- [ ] **5.1** Add WebSocket dependency (`ws` or `hono/websocket`)
- [ ] **5.2** Create `src/lib/websocket.ts` - WebSocket manager
- [ ] **5.3** Create `GET /api/ws` endpoint for WebSocket upgrade
- [ ] **5.4** Subscribe to event emitter, broadcast to clients
- [ ] **5.5** Update frontend to use WebSocket instead of polling
- [ ] **5.6** Remove HTMX polling triggers (`every 5s`, etc.)

### Frontend Changes

```javascript
// Before (HTMX polling)
<div hx-get="/api/activity" hx-trigger="every 5s">

// After (WebSocket)
const ws = new WebSocket(`ws://${window.location.host}/api/ws`);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleUpdate(data);
};
```

### Success Criteria
- [ ] WebSocket connection established on page load
- [ ] Updates received in real-time (< 100ms latency)
- [ ] No more polling in network tab
- [ ] Fallback to polling if WebSocket fails

---

## Phase 6: pm CLI Migration

**Goal:** Update `pm` CLI to use SQLite directly

### Options

**Option A: Keep JSON, sync to DB** (easier, but duplication)
- `pm` CLI writes to `projects.json`
- TheNexus detects changes, syncs to DB
- Risk: race conditions, stale data

**Option B: CLI uses SQLite** (cleaner, recommended)
- Add `better-sqlite3` to `openclaw-project-manager`
- CLI reads/writes directly to same DB
- Remove JSON file entirely

**Option C: CLI calls TheNexus API** (simplest for CLI)
- `pm` CLI makes HTTP calls to localhost:3000
- Single source of truth (TheNexus DB)
- Requires TheNexus running

### Recommended: Option B

### Tasks

- [ ] **6.1** Add `@libsql/client` to `openclaw-project-manager/package.json`
- [ ] **6.2** Create `openclaw-project-manager/lib/db.js` - shared DB connection
- [ ] **6.3** Update `openclaw-project-manager/lib/project.js` - use SQL instead of JSON
- [ ] **6.4** Update all CLI commands in `commands/*.js`
- [ ] **6.5** Remove `projects.json` reading/writing
- [ ] **6.6** Test all CLI commands

### Success Criteria
- [ ] All `pm` commands work
- [ ] CLI and UI see same data
- [ ] No JSON file needed
- [ ] No race conditions

---

## Phase 7: Cleanup & Polish

**Goal:** Remove technical debt, improve DX

### Tasks

- [ ] **7.1** Add structured logging (`pino`)
- [ ] **7.2** Add request logging middleware
- [ ] **7.3** Add error handling middleware
- [ ] **7.4** Add input validation (`zod`)
- [ ] **7.5** Add TypeScript types for all API responses
- [ ] **7.6** Add health check endpoint with DB status
- [ ] **7.7** Add database backup command
- [ ] **7.8** Update documentation

### Success Criteria
- [ ] Structured logs in console
- [ ] Graceful error handling
- [ ] Invalid input returns 400 with details
- [ ] `/api/health` shows system status

---

## Timeline Estimate

| Phase | Sessions | Complexity |
|-------|----------|------------|
| Phase 1: Database | 1-2 | Low |
| Phase 2: Repositories | 1 | Low |
| Phase 3: Services | 2 | Medium |
| Phase 4: Routes | 1-2 | Medium |
| Phase 5: WebSocket | 1-2 | Medium |
| Phase 6: CLI Migration | 2 | Medium |
| Phase 7: Cleanup | 1 | Low |
| **Total** | **9-11** | |

---

## Getting Started: Phase 1 Checklist

```bash
# Install dependency
bun add @libsql/client

# Create directory structure
mkdir -p src/db src/repositories src/services src/routes src/lib
```

Then tackle each task in Phase 1 one at a time.

---

## Notes

- **libsql** chosen because it's SQLite-compatible but has WebSocket sync built-in (future-proof)
- **Keep JSON during transition** - migrate to DB on read, write to both during Phase 1
- **Test after each phase** - don't move on until current phase works
- **Backwards compatibility** - `pm` CLI should work throughout (may need dual-write temporarily)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Backup `projects.json` before migration |
| CLI breaks | Keep JSON fallback until Phase 6 complete |
| WebSocket too complex | Fall back to SSE (simpler, same result) |
| Scope creep | Stick to plan, no new features during refactor |

---

## Ready to Start?

Say "Start Phase 1" and I'll begin with task 1.1 (add SQLite dependency and create database module).
