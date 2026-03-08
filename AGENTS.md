# TheNexus - Agent Instructions

**Project:** TheNexus - OpenClaw Gateway Dashboard
**Type:** Node.js + Hono + HTMX web application
**Runtime:** Bun (development), Node.js (production)

---

## Quick Start

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production mode
npm run start
```

Server runs on `http://localhost:3000`

---

## Project Structure

```
TheNexus/
├── src/
│   ├── index.ts              # Entry point (thin bootstrap)
│   ├── app.ts                # Hono app setup, shared state
│   ├── refinement.ts         # Task refinement service
│   ├── lib/
│   │   ├── openclaw.ts       # OpenClawClient singleton
│   │   └── projects.ts       # Project file utilities
│   └── routes/
│       ├── api.ts            # API route grouping
│       ├── pages.ts          # SPA page routes
│       ├── sessions.ts       # /api/sessions/* handlers
│       ├── tasks.ts          # /api/tasks/* handlers
│       └── projects.ts       # /api/projects/* handlers
├── public/
│   ├── index.html            # Main dashboard (HTMX + Bootstrap)
│   ├── styles.css            # Custom styles
│   ├── pico.min.css          # CSS framework
│   └── bootstrap-icons.min.css
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js / Bun |
| Framework | Hono (web framework) |
| Frontend | HTMX (dynamic interactions) |
| Styling | Pico CSS + Bootstrap Icons |
| Language | TypeScript (ES modules) |

---

## Key Concepts

### OpenClaw Integration

TheNexus is a dashboard for the **OpenClaw** agent system. It:
- Monitors agent sessions across all agents
- Displays real-time activity and token usage
- Allows spawning agents for task work
- Integrates with the **Project Manager** skill (`pm` CLI)

### Project Manager Integration

Tasks are stored in `~/dev/projects/projects.json` and managed via:
- **UI:** `/projects` - Kanban board
- **CLI:** `pm task add`, `pm task move`, `pm task complete`

### Task Workflow

```
todo → refinement → todo → in-progress → done
```

1. **Create:** Task starts in `todo`
2. **Refine** (optional): Agent enriches description with details
3. **Start:** User selects agent, subagent spawned in Discord thread
4. **Complete:** Agent runs `pm task complete` when done

---

## Available Commands

```bash
# Development
npm run dev          # Start with hot reload (tsx watch)
npm run start        # Production start

# Type checking
npx tsc --noEmit     # Check types without emitting
```

---

## API Endpoints

### Sessions
- `GET /api/sessions` - All sessions
- `GET /api/sessions/active` - Active sessions (last 5 min)
- `GET /api/activity` - Activity feed with change detection
- `GET /api/session/:key` - Session details with transcript
- `POST /api/session/:key/kill` - Abort a session

### Projects
- `GET /api/projects` - All projects
- `POST /api/projects` - Create project
- `PUT /api/projects/:name` - Update project
- `DELETE /api/projects/:name` - Delete project

### Tasks
- `GET /api/tasks` - All tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task (full edit)
- `PATCH /api/tasks/:id` - Update task status
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/start` - Start task with agent
- `POST /api/tasks/:id/start-refinement` - Start refinement
- `POST /api/tasks/:id/refine` - Manual refinement
- `GET /api/refinement/:id` - Refinement status
- `GET /api/refinement` - All refinement statuses

### Health
- `GET /api/health` - Health check

---

## Coding Conventions

### Imports Order
```typescript
// 1. External packages
import { Hono } from 'hono';
import * as fs from 'fs';

// 2. Node.js built-ins
import { promisify } from 'util';
import { execFile } from 'child_process';

// 3. Internal modules
import { openclaw } from '../lib/openclaw.js';
import { loadProjects } from '../lib/projects.js';

// 4. Relative imports
import { refinementStatus } from '../app.js';
```

### Error Handling
```typescript
try {
  // ...
} catch (error: any) {
  console.error('Error description:', error.message);
  return c.json({ error: error.message }, 500);
}
```

### Route Pattern
```typescript
export const tasks = new Hono();

tasks.get('/tasks', async (c) => {
  // Handler logic
  return c.json({ result });
});
```

### Async Operations
- Use `promisify` for callback-based APIs
- Fire-and-forget async ops use `.then().catch()` pattern
- Always log success/failure for background operations

---

## Database Status (Phase 3 Pending)

**Current:** File-based JSON storage (`~/dev/projects/projects.json`)

**Planned:** SQLite with libsql

When Phase 3 is complete:
- Data access via repository pattern
- Migrations in `src/db/migrations/`
- Connection singleton in `src/db/database.ts`

---

## Testing Checklist

After making changes:

```bash
# 1. Type check
./node_modules/.bin/tsc --noEmit

# 2. Start server
npm run dev

# 3. Test endpoints
curl http://localhost:3000/api/health
curl http://localhost:3000/api/projects
curl http://localhost:3000/api/tasks

# 4. Test UI
open http://localhost:3000
```

---

## Common Tasks

### Adding a New Route

1. Create route file in `src/routes/`:
```typescript
// src/routes/agents.ts
import { Hono } from 'hono';

export const agents = new Hono();

agents.get('/agents', async (c) => {
  return c.json({ agents: [] });
});
```

2. Mount in `src/routes/api.ts`:
```typescript
import { agents } from './agents.js';
api.route('', agents);
```

### Adding a New Dependency

```bash
npm install package-name
# TypeScript types if needed:
npm install -D @types/package-name
```

### Modifying Shared State

In `src/app.ts`:
```typescript
export const myState = new Map<string, any>();
```

Import in routes:
```typescript
import { myState } from '../app.js';
```

---

## Refactoring Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Route refactoring | ✅ Complete |
| Phase 2 | Service layer | ⏳ Pending |
| Phase 3 | Database (SQLite) | ⏳ Pending |
| Phase 4 | WebSocket real-time | ⏳ Pending |
| Phase 5 | CLI migration | ⏳ Pending |

---

## Troubleshooting

### "Cannot find module" errors
- Ensure all imports use `.js` extension (ES module requirement)
- Run `npm install` if dependencies missing

### Port already in use
```bash
# Kill process on port 3000 (Windows)
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### TypeScript errors
```bash
# Check types
./node_modules/.bin/tsc --noEmit
```

### Sessions not showing
- Ensure OpenClaw is installed and configured
- Run `openclaw sessions --json` to verify CLI works

---

## Related Projects

- **OpenClaw:** Agent gateway system
- **Project Manager:** `~/openclaw-project-manager/` - CLI skill for task management

---

## Getting Help

1. Check existing sessions: `openclaw sessions --all-agents`
2. View projects file: `cat ~/dev/projects/projects.json`
3. Inspect logs in console output
4. Review route files for endpoint logic
