# Kanban Board Enhancement Ideas

**Date:** 2026-03-08
**Purpose:** Ideas for improving TheNexus task board to better leverage OpenClaw agents and subagents

---

## Current Architecture Summary

### TheNexus
Web dashboard that:
- Monitors OpenClaw agent sessions across all agents
- Provides kanban-style task board for projects
- Allows creating tasks, refining them via agents, and starting task execution
- Tracks activity and session history

### Project Manager Skill
CLI skill (`openclaw-project-manager`) that:
- Manages multiple projects with isolated contexts
- Provides `pm` CLI commands for task/project/memory management
- Auto-refines task descriptions using templates or AI agents
- Tracks sessions attached to tasks

### How They Work Together

```
UI (HTMX) ↔ TheNexus API (Hono) ↔ projects.json ↔ pm CLI ↔ OpenClaw agents
```

**Flow:**
1. **Task Creation**: User creates task via UI or `pm task add`
2. **Refinement** (optional): Task refined by spawning agent to enrich description
3. **Execution**: User selects agent → subagent spawned in Discord thread
4. **Completion**: Agent runs `pm task complete` when done

---

## Enhancement Ideas

### 1. Enhanced Kanban Board Features

**Current gaps:**
- No drag-and-drop (click-based status changes only)
- Limited task metadata utilization (priority, tags exist but underused)
- No task dependencies
- No assignee tracking beyond agent selection

**Suggestions:**
- [ ] Add **drag-and-drop** using lightweight library or HTML5 DnD
- [ ] Implement **task swimlanes** by project or priority
- [ ] Add **task dependencies** (blocked by / blocks)
- [ ] Show **agent avatar/name** on cards when assigned
- [ ] Add **time tracking** visualization (how long in each status)
- [ ] Add **task aging** indicator (highlight stale tasks)

---

### 2. Agent Pool Management

**Current state:** Agents hardcoded in modals (main, coder, aichan)

**Suggestions:**
- [ ] Dynamic agent discovery from OpenClaw (`openclaw agent list`)
- [ ] Agent **capabilities/specialties** display
- [ ] Agent **availability status** (busy/idle)
- [ ] **Agent load balancing** - suggest least busy agent
- [ ] **Agent history** - show which agents completed similar tasks
- [ ] Agent **performance metrics** (avg completion time, success rate)

---

### 3. Subagent Orchestration Improvements

**Current flow:** Main agent spawns subagent in Discord thread

**Suggestions:**
- [ ] **Parallel task execution** - spawn multiple subagents for independent subtasks
- [ ] **Subagent supervision** - parent agent monitors progress
- [ ] **Automatic task decomposition** - agent breaks large task into subtasks
- [ ] **Progress reporting** - subagents post % complete updates
- [ ] **Resource pooling** - shared context between subagents working on same project
- [ ] **Subagent templates** - pre-configured spawn templates for common patterns

---

### 4. Task Refinement Enhancements

**Current state:** Template-based or agent-based refinement

**Suggestions:**
- [ ] **Multi-agent refinement** - coder for technical, main for documentation
- [ ] **Refinement templates** per project (customizable in AGENTS.md)
- [ ] **Auto-detect complexity** - simple tasks skip refinement, complex get full treatment
- [ ] **Refinement quality score** - agent rates if description is "ready"
- [ ] **Similar task suggestions** - "This looks like task-042, check it for context"
- [ ] **Refinement history** - see how description evolved

---

### 5. Project Context Integration

**Current state:** AGENTS.md shown when switching projects

**Suggestions:**
- [ ] **Auto-attach relevant context** when task starts (files, related tasks)
- [ ] **Cross-project visibility** - see if similar work exists in other projects
- [ ] **Project templates** - bootstrap new projects with standard structure
- [ ] **Memory search** - "Have we solved this before?" across all project memories
- [ ] **Architecture diagrams** - visual project structure in UI
- [ ] **File watcher** - auto-update context when project files change

---

### 6. Enhanced Session Integration

**Current state:** Sessions tracked, can be attached to tasks

**Suggestions:**
- [ ] **Session replay** - watch what agent did step-by-step
- [ ] **Session comparison** - compare approaches between agents
- [ ] **Session bookmarks** - mark important moments in long sessions
- [ ] **Session templates** - "debugging session", "feature session", etc.
- [ ] **Cost tracking** - tokens/credits per task
- [ ] **Session highlights** - auto-extract key decisions/code snippets

---

### 7. Kanban Automation

**Suggestions:**
- [ ] **Auto-advance rules** - task moves to "Review" when agent finishes
- [ ] **Stale task detection** - highlight tasks stuck too long
- [ ] **WIP limits** - limit in-progress tasks per project
- [ ] **Sprint/iteration support** - group tasks into time-boxed iterations
- [ ] **Burndown charts** - visualize progress over time
- [ ] **Recurring tasks** - auto-create tasks on schedule

---

### 8. OpenClaw Gateway Integration

**Current state:** Gateway page exists but shows "Coming soon"

**Suggestions:**
- [ ] **Gateway health dashboard** - connection status, latency
- [ ] **Multi-gateway support** - load balance across gateway instances
- [ ] **Gateway logs** - debug agent communication issues
- [ ] **Config management** - change gateway settings from UI
- [ ] **Message queue view** - see pending agent messages

---

### 9. Notification System

**Current gaps:** No proactive notifications

**Suggestions:**
- [ ] **Task completion notifications** (Discord webhook, email)
- [ ] **Agent alerts** - when agent is stuck or needs input
- [ ] **Daily digest** - summary of completed work
- [ ] **Mention system** - @agent for specific help requests
- [ ] **Escalation rules** - "If task stuck > 2 hours, notify user"
- [ ] **Milestone celebrations** - acknowledge big completions

---

### 10. API Enhancements

**Missing endpoints:**

```typescript
GET  /api/agents              // List available agents with status
POST /api/tasks/decompose     // Break task into subtasks
GET  /api/projects/:name/stats // Project analytics
POST /api/sessions/bulk-kill  // Stop multiple sessions
GET  /api/search              // Search across tasks, memories, sessions
GET  /api/activities          // Extended activity feed with filtering
POST /api/tasks/bulk-move     // Move multiple tasks at once
GET  /api/agents/:id/history  // Agent work history
```

---

### 11. Multi-Project Features

**Suggestions:**
- [ ] **Global kanban view** - all projects in one board (grouped/swimlaned)
- [ ] **Cross-project dependencies** - task in project A blocks task in project B
- [ ] **Resource allocation** - see which agents work across which projects
- [ ] **Portfolio dashboard** - high-level view of all projects
- [ ] **Project comparison** - velocity, completion rates between projects

---

### 12. UI/UX Improvements

**Suggestions:**
- [ ] **Dark/light theme toggle**
- [ ] **Customizable columns** - add/remove/rename status columns
- [ ] **Card preview on hover** - show description without clicking
- [ ] **Quick-add task** - inline task creation in any column
- [ ] **Keyboard shortcuts** - navigate board, create tasks, filter
- [ ] **Mobile-optimized** card layout
- [ ] **Export board** - PNG, PDF, or markdown export
- [ ] **Board presets** - "Dev Board", "Planning Board", "Bug Triage"

---

## Implementation Priority Matrix

| Priority | Feature | Effort | Impact | Notes |
|----------|---------|--------|--------|-------|
| 🔴 High | Drag-and-drop kanban | Medium | High | Core UX improvement |
| 🔴 High | Dynamic agent discovery | Low | High | Enables agent scaling |
| 🔴 High | Task decomposition | High | Very High | Force multiplier |
| 🟠 Medium | Agent availability status | Medium | Medium | Better assignment UX |
| 🟠 Medium | Session replay | High | Medium | Debugging/learning |
| 🟠 Medium | Project templates | Low | Medium | Faster onboarding |
| 🟠 Medium | Gateway health UI | Low | Medium | Operational visibility |
| 🟢 Low | Task dependencies | Medium | Low-Medium | Complex but niche |
| 🟢 Low | Notification system | Medium | Medium | Nice to have |
| 🟢 Low | Sprint/iterations | High | Medium | May overcomplicate |

---

## Quick Wins (Low Effort, High Impact)

These can be implemented in a single session:

1. **Dynamic agent list** - Call `openclaw agents` and populate dropdown
2. **Agent status badges** - Show busy/idle based on active sessions
3. **Task aging highlight** - CSS class for tasks > 24h in same status
4. **Quick task creation** - Double-click column to add task
5. **Project memory search** - Simple text search across memory.md files
6. **Keyboard shortcuts** - `n` for new task, `/` for search, etc.

---

## Technical Debt Considerations

- [ ] **File-based persistence** - projects.json works but consider SQLite for scale
- [ ] **Race conditions** - ensure atomic updates when multiple agents modify same task
- [ ] **API rate limiting** - prevent UI from hammering endpoints during auto-refresh
- [ ] **Session cleanup** - auto-archive old sessions to prevent bloat
- [ ] **Error handling** - graceful degradation when OpenClaw unavailable

---

## Architecture Principles

When implementing features, maintain:

1. **Keep it lightweight** - Current stack (Hono + HTMX) is intentionally minimal
2. **Discord-first** - Thread-based subagent work is a strong pattern
3. **Agent-agnostic** - Support any OpenClaw agent, not just hardcoded ones
4. **Progressive enhancement** - Features should work without heavy JS where possible
5. **File-based simplicity** - Prefer readable JSON over complex databases
6. **CLI parity** - UI features should have `pm` CLI equivalents

---

## Related Files

- `src/index.ts` - Main server, API endpoints
- `public/index.html` - Dashboard UI, kanban board
- `public/styles.css` - Custom styles
- `src/refinement.ts` - Task refinement service
- `../openclaw-project-manager/SKILL.md` - Full skill documentation
- `../openclaw-project-manager/commands/task.js` - Task CLI commands
- `../openclaw-project-manager/lib/project.js` - Core project library

---

## Notes from Initial Review

- TheNexus already has refinement column in kanban (⭐ status)
- Subagents are spawned with `thread: true` for Discord isolation
- Task refinement moves: `todo` → `refinement` → `todo` → `in-progress` → `done`
- Agents responsible for moving their own tasks (not auto-moved by system)
- Session keys stored on tasks for tracking work history
