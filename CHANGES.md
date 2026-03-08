# Task Agent Routing Changes

## Latest: Refinement as Separate State/Column (2026-03-08)

**TheNexus now has a dedicated "Refinement" column in the kanban board.**

### Task Flow

```
todo → refinement → todo → in-progress → done
```

### What Changed

**Before:**
- Tasks created with optional `skipRefinement` checkbox
- Refinement happened automatically on task creation (async)
- No visibility into refinement progress
- Single "awaiting refinement" badge on todo tasks

**After:**
- All tasks start in "todo" status
- User chooses: "Start" (implement) or "Refine" (plan/design)
- Refinement is a separate status with its own column
- Agent selection dropdown when starting refinement
- Clear visibility of tasks being refined
- Agent moves task to refinement → enriches description → moves back to todo

### Backend Changes (`src/index.ts`)

1. **Removed `skipRefinement` logic** from task creation
2. **Added "refinement" status** to task schema and validation
3. **New endpoint:** `POST /api/tasks/:id/start-refinement`
   - Moves task to refinement status
   - Spawns selected agent with refinement instructions
   - Agent enriches description via Discord messaging
4. **Updated `PATCH /api/tasks/:id`** to support "refinement" status
5. **Agent workflow:**
   - Move task to refinement: `pm task move <id> refinement`
   - Enrich description with context, approach, acceptance criteria
   - Mark complete: `pm task refine <id> --complete`
   - Move back to todo: `pm task move <id> todo`

### Frontend Changes (`public/index.html`, `public/styles.css`)

1. **Added "Refinement" column** to kanban board (4-column layout)
2. **Removed "skip refinement" checkbox** from task creation form
3. **New "Refine" button** on todo task cards
4. **New "Refine Task Modal"** with agent selection dropdown
5. **Refinement action buttons:**
   - "Refined" (complete refinement, move back to todo)
   - "Cancel" (abort refinement, move back to todo)
6. **Styled refinement column** with purple accent/border
7. **Updated task rendering** to handle refinement status

### Project Manager Skill Updates

Added comprehensive section on refinement workflow:

**When assigned a refinement task:**
1. Move task to "refinement" status
2. Start threaded subagent to gather info (code review, websearch, tools)
3. Ask clarifying questions in Discord thread if ambiguity exists
4. Enrich task description with context, technical approach, acceptance criteria
5. Keep refinement focused and concise
6. Mark task refined: `pm task refine <id> --complete`
7. Move task back to "todo"

**Key principles:**
- Refinement is about planning/design, NOT implementation
- Use all available tools to understand the problem
- Ask questions early if requirements are unclear
- Output should be actionable for the next agent

### Benefits

1. **User control:** Choose which tasks need refinement
2. **Agent selection:** Pick the right agent for refinement (e.g., Aichan for research)
3. **Visibility:** See refinement progress in dedicated column
4. **Better planning:** Dedicated time for research and design before implementation
5. **Flexible workflow:** Can skip refinement for simple tasks by going straight to "Start"

### Migration

- Existing tasks with `skipRefinement: true` continue to work
- Tasks in "todo" status can be refined at any time via the "Refine" button
- No database migration needed

---

## Agent-Controlled Task State (2026-03-08)

**TheNexus no longer automatically changes task state when assigning tasks.**

### Before
When a user started a task via TheNexus UI:
- Backend set `task.status = 'in-progress'` immediately
- Frontend also called `updateTaskStatus(taskId, 'in-progress')`
- Agent received task already marked as in-progress

### After
When a user starts a task via TheNexus UI:
- TheNexus assigns the task to the selected agent
- Task remains in "todo" status
- **Agent is responsible for moving task to in-progress** via `pm task move <id> in-progress`
- Agent completes task via `pm task complete <id>`

### Why This Change?

1. **Agent autonomy**: The agent decides when it's truly ready to work
2. **Accurate state**: Task status reflects actual work state, not just assignment
3. **Consistent workflow**: Agents always control task state transitions
4. **Better tracking**: Clear distinction between "assigned" vs "actively being worked on"

### Changes Made

**Backend (`src/index.ts`):**
- Removed automatic `task.status = 'in-progress'` when spawning agent
- Removed `task.startedAt` timestamp (set by agent when starting)
- Updated task message to instruct agents to call `pm task move <id> in-progress`
- Return status remains 'todo' in API response

**Frontend (`public/index.html`):**
- Removed automatic `updateTaskStatus(taskId, 'in-progress')` after starting task
- Updated alert message to clarify agent will move task to in-progress

**Documentation (`~/.openclaw/skills/project-manager/SKILL.md`):**
- Added "When Assigned a Task via TheNexus" section
- Clarified that agents must move tasks to in-progress themselves
- Updated spawning subagents section with explicit instructions

### Migration

Existing tasks in "in-progress" status are unaffected. New tasks will remain in "todo" until the agent explicitly moves them.

---

## Original: Direct Agent Routing

## Before (Tasker Pattern)

```
User selects agent → API → Wake Tasker → Tasker spawns specialist → Task completed
```

**Problems:**
- Extra hop through Tasker
- Tasker had to analyze task and choose agent (redundant since user already selected)
- Hardcoded Tasker session key
- No direct agent-task association

## After (Direct Routing)

```
User selects agent → API → Spawn agent directly → Task completed
```

**Benefits:**
- ✅ Direct agent assignment (user's choice is respected)
- ✅ One less intermediary
- ✅ Agent has full context from start
- ✅ Session-per-task (agent spawns fresh for each task)
- ✅ Track which agent worked on which task

## Changes Made

### 1. Backend (`src/index.ts`)

**Old:** `/api/tasks/start` woke Tasker with hardcoded session
```typescript
execSync(`openclaw gateway call chat.send --params '{
  sessionKey: "agent:tasker:discord:channel:..."
  message: "Please spawn the appropriate specialist..."
}'`)
```

**New:** `/api/tasks/start` spawns selected agent directly
```typescript
execSync(`openclaw agent --agent ${agentId} --message "${taskMessage}"`)
```

**New fields on task:**
- `assignedAgent`: Which agent is working on this task
- `sessionKey`: The session created for this task

### 2. Frontend (`public/index.html`)

**Updated agent dropdown:**
- Removed "Tasker" option (no longer needed)
- Added "Aichan" for research tasks
- Clearer descriptions for each agent

**New task card displays:**
- Assigned agent badge (shows which agent is working on task)
- Session link indicator (when task has active session)

## Agent Roles

| Agent | Use For |
|-------|---------|
| 🌙 Main | General tasks, writing, documentation, coordination |
| 👨💻 Coder | Development, bugs, features, API work, UI |
| 🎀 Aichan | Research, analysis, investigation, documentation review |

## Task Flow

1. **Create task** → Optional refinement → Task in "todo"
2. **Start task** → User selects agent → Agent spawned with task context
3. **Agent works** → Session created, task shows assigned agent
4. **Agent completes** → Runs `pm task done <taskId>` → Task moves to "done"

## Session Model

Each task gets its **own session** with the assigned agent:

```
Task-001 → Agent: coder → Session: agent:coder:subagent:task-001
Task-002 → Agent: main  → Session: agent:main:subagent:task-002
```

**Benefits:**
- Clean context per task
- No cross-task pollution
- Easy to trace what happened on each task
- Agent can work on multiple tasks simultaneously (different sessions)

## Testing

To test:
1. Create a task in TheNexus UI
2. Click "Start" on the task
3. Select an agent (Main/Coder/Aichan)
4. Agent should spawn and receive the task details
5. Task card shows assigned agent badge
6. Agent completes work and marks task done

## Future Improvements

- [ ] Click session badge to view task session transcript
- [ ] Allow reassigning task to different agent
- [ ] Show agent status (active/idle) on task card
- [ ] Agent can request clarification via task comments
- [ ] Task history shows which agents worked on it over time
