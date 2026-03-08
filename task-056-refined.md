## Objective

Replace all OpenClaw CLI command executions in TheNexus with direct Gateway WebSocket API calls. "Done" means TheNexus communicates with OpenClaw Gateway via the WebSocket protocol instead of spawning CLI subprocesses, resulting in faster response times, better error handling, real-time event streaming, and reduced system overhead.

**Done looks like:**
- All `execFileAsync('openclaw', ...)` calls replaced with Gateway WebSocket API requests
- Session data fetched via Gateway `sessions.list` RPC method instead of CLI JSON output
- Subagent spawning uses Gateway `agent.spawn` RPC method instead of CLI `openclaw agent` command
- Session abort uses Gateway `chat.abort` RPC method instead of CLI `openclaw chat abort`
- Error handling improved with proper RPC error codes and retry logic
- No regressions in existing functionality (sessions, tasks, activity feed)

## Context

### Current CLI-based Architecture

TheNexus currently relies on executing OpenClaw CLI commands via `child_process.execFile()` to interact with OpenClaw:

**Files using CLI:**
1. `/home/azureuser/dev/TheNexus/src/lib/openclaw.ts` - Main OpenClaw client wrapper (8 CLI calls)
   - `getSessions()` - `openclaw sessions --all-agents --json`
   - `getStores()` - `openclaw sessions --all-agents --json`
   - `spawnAgent()` - `openclaw agent --session-id/--agent --message`
   - `spawnAgentAsync()` - `openclaw agent` (fire-and-forget)
   - `killSession()` - `openclaw chat abort "<key>"`
   - `getAgents()` - `openclaw agent --list --json`

2. `/home/azureuser/dev/TheNexus/src/services/task-service.ts` - Task service (2 CLI calls)
   - Line 390: `execFileAsync('openclaw', args, ...)` for refinement agent spawning
   - Line 560: `execFileAsync('openclaw', args, ...)` for task agent spawning

3. `/home/azureuser/dev/TheNexus/src/refinement.ts` - Refinement service (2 CLI calls)
   - `refineTaskDescriptionSync()` - `openclaw agent --agent coder --message`
   - `spawnRefinementAgent()` - `openclaw agent --agent coder --message --json`

**Total: 12 CLI execution points across 4 files**

### Why Gateway API is Better

**Performance:**
- CLI: ~100-300ms subprocess spawn overhead per request
- Gateway WS: ~5-20ms for established connection, request/response multiplexing

**Reliability:**
- CLI: Fragile stdout/stderr parsing, JSON can break with warnings
- Gateway WS: Structured JSON-RPC responses, typed error codes

**Real-time capabilities:**
- CLI: Polling only, no event streaming
- Gateway WS: Can subscribe to session events, agent progress, health ticks

**Deployment:**
- CLI: Requires OpenClaw CLI installed in PATH
- Gateway WS: Only requires Gateway service running (already a dependency)

**Connection efficiency:**
- CLI: New process per request, no connection reuse
- Gateway WS: Single persistent connection, request pipelining

### Technical Constraints

- Gateway must be running on configured port (default: 18789)
- Gateway authentication required (token mode configured in `/home/azureuser/.openclaw/openclaw.json`)
- WebSocket connection must handle reconnect logic
- Gateway protocol version must be compatible (current: v3)

## Technical Approach

### Gateway API Endpoints (WebSocket RPC)

The OpenClaw Gateway uses a WebSocket-based JSON-RPC protocol. Key methods:

**Sessions:**
- `sessions.list(params)` - List sessions (replaces `openclaw sessions --json`)
- `sessions.get(params)` - Get single session details
- `chat.abort(params)` - Abort/kill session (replaces `openclaw chat abort`)

**Agents:**
- `agent.spawn(params)` - Spawn agent with message (replaces `openclaw agent`)
- `agent.list(params)` - List available agents (replaces `openclaw agent --list`)

**Connection:**
- First frame must be `connect` with auth token
- Gateway returns `hello-ok` with protocol version and capabilities
- Use `req(method, params)` → `res(ok/payload|error)` pattern

### Implementation Strategy

1. **Create Gateway WebSocket Client** (`src/lib/gateway-client.ts`):
```typescript
import WebSocket from 'ws';

export class GatewayClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  
  async connect(url: string, token: string): Promise<void> {
    // Connect to Gateway WS endpoint
    // Send connect frame with auth token
    // Handle hello-ok response
  }
  
  async sessionsList(options?: { allAgents?: boolean; activeMinutes?: number }): Promise<Session[]> {
    return this.rpc('sessions.list', options);
  }
  
  async agentSpawn(params: { agentId?: string; sessionId?: string; message: string }): Promise<SpawnResult> {
    return this.rpc('agent.spawn', params);
  }
  
  async chatAbort(sessionKey: string): Promise<void> {
    return this.rpc('chat.abort', { sessionKey });
  }
  
  private rpc<T>(method: string, params: any): Promise<T> {
    // Send RPC request, return promise resolved by response handler
  }
}
```

2. **Update OpenClawClient** (`src/lib/openclaw.ts`):
- Replace `execAsync`/`execFileAsync` calls with `GatewayClient` methods
- Maintain same public interface for backward compatibility
- Add reconnection logic and connection pooling

3. **Update Task Service** (`src/services/task-service.ts`):
- Replace CLI calls at lines 390 and 560 with `GatewayClient.agentSpawn()`
- Handle async response and session key extraction from RPC response

4. **Update Refinement Service** (`src/refinement.ts`):
- Replace CLI calls with `GatewayClient.agentSpawn()`
- Use streaming mode for real-time refinement progress (optional enhancement)

### HTTP Client vs WebSocket

**Decision: Use WebSocket** (not HTTP)

Rationale:
- Gateway's primary protocol is WebSocket (HTTP endpoints like `/v1/chat/completions` are secondary)
- WebSocket supports bidirectional streaming (agent progress events)
- Single connection for all operations (more efficient than HTTP per-request)
- Better alignment with OpenClaw architecture

**Library:** Use `ws` package (already in TheNexus dependencies)

### Authentication Strategy

Gateway is configured with `gateway.auth.mode="token"` using `${GATEWAY_TOKEN}` env var.

**Implementation:**
```typescript
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN;

// In connect frame:
{
  "type": "req",
  "method": "connect",
  "params": {
    "auth": { "token": GATEWAY_TOKEN },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"]
  }
}
```

### Error Handling and Retry Strategy

```typescript
interface GatewayError {
  code: number;    // RPC error code
  message: string;
  data?: any;
}

// Retry strategy for transient failures:
- Network errors: Exponential backoff (100ms, 200ms, 400ms, max 3 retries)
- RPC errors (5xx): Retry once after 500ms
- RPC errors (4xx): No retry, surface to user
- Connection lost: Auto-reconnect with exponential backoff
```

### Connection Management

**Singleton pattern:**
- One GatewayClient instance per application lifecycle
- Auto-reconnect on connection loss
- Request queue during reconnection
- Health check ping every 30 seconds

## Files to Modify

### New Files to Create

1. **`/home/azureuser/dev/TheNexus/src/lib/gateway-client.ts`** (NEW)
   - GatewayClient class with WebSocket connection management
   - RPC request/response handling
   - Authentication and reconnection logic
   - ~300 lines

### Files to Modify

2. **`/home/azureuser/dev/TheNexus/src/lib/openclaw.ts`** (MODIFY)
   - Lines 1-10: Replace `child_process` imports with `ws` import
   - Lines 60-90: Update `getSessions()` to use `GatewayClient.sessionsList()`
   - Lines 95-110: Update `getStores()` to use `GatewayClient.sessionsList()`
   - Lines 115-145: Update `spawnAgent()` to use `GatewayClient.agentSpawn()`
   - Lines 150-175: Update `spawnAgentAsync()` to use `GatewayClient.agentSpawn()`
   - Lines 178-190: Update `killSession()` to use `GatewayClient.chatAbort()`
   - Lines 225-245: Update `getAgents()` to use `GatewayClient.agentList()`
   - Keep `getSessionTranscript()` as-is (file system operation)
   - ~180 lines modified

3. **`/home/azureuser/dev/TheNexus/src/services/task-service.ts`** (MODIFY)
   - Line ~390: Replace `execFileAsync('openclaw', ...)` with `GatewayClient.agentSpawn()`
   - Line ~560: Replace `execFileAsync('openclaw', ...)` with `GatewayClient.agentSpawn()`
   - Import `GatewayClient` at top of file
   - ~20 lines modified

4. **`/home/azureuser/dev/TheNexus/src/refinement.ts`** (MODIFY)
   - Lines 1-10: Remove `child_process` imports
   - Lines 90-110: Update `refineTaskDescriptionSync()` to use `GatewayClient.agentSpawn()`
   - Lines 120-200: Update `spawnRefinementAgent()` to use `GatewayClient.agentSpawn()`
   - ~50 lines modified

5. **`/home/azureuser/dev/TheNexus/.env.example`** (CREATE/MODIFY)
   - Add `OPENCLAW_GATEWAY_URL=ws://localhost:18789`
   - Add `OPENCLAW_GATEWAY_TOKEN=your-token-here`

6. **`/home/azureuser/dev/TheNexus/README.md`** (MODIFY)
   - Add Gateway setup requirements
   - Update installation instructions

### Files to Delete

None - `child_process` may still be used for other purposes

## Acceptance Criteria

- [ ] New `GatewayClient` class created in `src/lib/gateway-client.ts` with WebSocket support
- [ ] `GatewayClient` implements connect, sessions.list, agent.spawn, chat.abort, agent.list methods
- [ ] `src/lib/openclaw.ts` has zero `execAsync` or `execFileAsync` calls to `openclaw` CLI
- [ ] `src/services/task-service.ts` has zero `execFileAsync('openclaw'...)` calls
- [ ] `src/refinement.ts` has zero `execAsync('openclaw'...)` calls
- [ ] All CLI command strings removed from codebase (`openclaw sessions`, `openclaw agent`, `openclaw chat abort`)
- [ ] Gateway URL configurable via `OPENCLAW_GATEWAY_URL` environment variable
- [ ] Gateway token configurable via `OPENCLAW_GATEWAY_TOKEN` environment variable
- [ ] Auto-reconnection implemented with exponential backoff (max 3 retries)
- [ ] Error handling distinguishes between network errors and RPC errors
- [ ] All existing API endpoints functional (`/api/sessions`, `/api/activity`, `/api/tasks/*`)
- [ ] Session list endpoint returns data in <100ms (vs ~300ms with CLI)
- [ ] Agent spawn endpoint returns session key correctly
- [ ] Session abort endpoint works without errors
- [ ] Graceful degradation when Gateway is unreachable (return 503 with retry message)
- [ ] No `child_process` imports for OpenClaw operations (may remain for other uses)
- [ ] `.env.example` updated with Gateway configuration
- [ ] README.md updated with Gateway dependency note

## Dependencies

### Gateway API Endpoints Required

All endpoints exist in OpenClaw Gateway (confirmed via protocol docs):
- ✅ `sessions.list` - List all sessions
- ✅ `agent.spawn` - Spawn agent with message
- ✅ `chat.abort` - Abort session
- ✅ `agent.list` - List available agents

### NPM Packages

Already installed:
- ✅ `ws` - WebSocket library (in dependencies)

No new packages needed.

### Configuration Changes

**Gateway configuration** (already configured):
- Gateway running on port 18789 (systemd service)
- Auth mode: token (`GATEWAY_TOKEN` env var)
- Bind: loopback (127.0.0.1)

**TheNexus configuration** (to add):
- `OPENCLAW_GATEWAY_URL` in `.env` (default: `ws://localhost:18789`)
- `OPENCLAW_GATEWAY_TOKEN` in `.env` (from same source as Gateway)

### Environment Setup

```bash
# Gateway must be running
openclaw gateway status

# Token available (check in ~/.openclaw/openclaw.json or env)
echo $GATEWAY_TOKEN
```

## Potential Pitfalls

### API Availability and Versioning

**Risk:** Gateway protocol may change between versions

**Mitigation:**
- Check `hello-ok.protocol` version on connect
- Set `minProtocol` and `maxProtocol` in connect frame
- Log protocol version mismatch as warning
- Gateway is stable (running as systemd service, unlikely to change unexpectedly)

### Authentication and Security

**Risk:** Token exposure in logs or error messages

**Mitigation:**
- Never log full token (mask: `tok******`)
- Store token in environment variable, not code
- Use `.env` file (gitignored) for local dev
- Token already required for Gateway access (no new security surface)

### Error Handling Differences

**Risk:** CLI exit codes ≠ RPC error codes

**Mitigation:**
- Map RPC errors to HTTP status codes for API responses:
  - Network error → 503 Service Unavailable
  - Auth error → 401 Unauthorized
  - Not found → 404 Not Found
  - Invalid params → 400 Bad Request
  - Server error → 500 Internal Server Error
- Include RPC error message in response for debugging

### Testing Challenges

**Risk:** Gateway must be running for tests

**Mitigation:**
- Add Gateway health check in test setup
- Mock `GatewayClient` for unit tests
- Integration tests require Gateway (document in README)
- Consider adding `GATEWAY_MOCK=true` env var for local dev without Gateway

### Connection Management

**Risk:** WebSocket connection exhaustion or memory leaks

**Mitigation:**
- Singleton pattern (one connection per app lifecycle)
- Implement proper cleanup on process exit
- Add connection timeout (30 seconds)
- Implement ping/pong health checks
- Limit pending request queue size (max 100)

### Deployment Considerations

**Risk:** Gateway URL differs between environments

**Mitigation:**
- Use environment variables for Gateway URL
- Default to `ws://localhost:18789` for local dev
- Document production Gateway URL configuration
- Consider service discovery for dynamic Gateway locations

### Backwards Compatibility

**Risk:** Breaking changes during transition

**Mitigation:**
- Maintain same public interface in `OpenClawClient`
- Add feature flag `USE_GATEWAY_API=true` for gradual rollout (optional)
- Keep CLI code commented but not deleted until verified (first commit only)
- Test all endpoints before removing CLI fallback

### Real-time Event Handling

**Risk:** Agent spawn is async; need to handle streaming events

**Mitigation:**
- `agent.spawn` returns immediately with session key
- Agent progress events streamed via WebSocket (future enhancement)
- For now, fire-and-forget matches current CLI behavior
- Can add event subscription later for real-time progress updates

### Gateway Downtime

**Risk:** Gateway service unavailable

**Mitigation:**
- Health check endpoint: `GET /health` before operations
- Return 503 with retry-after header if Gateway down
- Log Gateway connection state (connected/disconnected)
- Consider fallback to CLI if Gateway unavailable (optional, not in scope)
