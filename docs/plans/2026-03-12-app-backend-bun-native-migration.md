# App Backend Bun Native Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all `node:` imports from `apps/app-backend/src` by migrating the backend sandbox and helper code to Bun-native APIs.

**Architecture:** Update the small set of affected backend files in place, using Bun and web-standard APIs directly. Keep request handling, sandbox execution, and error shapes behaviorally equivalent while removing Node runtime dependencies.

**Tech Stack:** TypeScript, Bun runtime, Bun.serve, Bun.spawn, web-standard Request/Response APIs, Redis

---

### Task 1: Document the approved migration

**Files:**
- Create: `docs/plans/2026-03-12-app-backend-bun-native-migration-design.md`

**Step 1: Save the approved design**

Write the approved architecture, scope, file list, and verification strategy into the design doc.

**Step 2: Confirm the file exists**

Run: `ls 'docs/plans/2026-03-12-app-backend-bun-native-migration-design.md'`
Expected: The design file is present.

---

### Task 2: Replace simple runtime imports

**Files:**
- Modify: `apps/app-backend/src/lib/db/index.ts`
- Modify: `apps/app-backend/src/lib/sandbox/runner.ts`

**Step 1: Remove `node:path` from the DB helper**

Build the migrations folder path without importing Node path helpers.

**Step 2: Remove `node:fs/promises`, `node:os`, and `node:path` from the runner helper**

Use Bun-native file writing and deletion APIs plus straightforward temp path construction.

**Step 3: Confirm no behavior changes were introduced**

Check that the runner still creates a unique script path, writes the runner source, exposes the path, and cleans it up.

---

### Task 3: Migrate sandbox process helpers to Bun

**Files:**
- Modify: `apps/app-backend/src/lib/sandbox/utils.ts`
- Modify: `apps/app-backend/src/lib/sandbox/service.ts`

**Step 1: Update shared sandbox helper types**

Replace Node-only process and response typing with Bun subprocess typing and Bun/web-compatible helpers.

**Step 2: Replace process spawning in the sandbox service**

Switch from `spawn` to `Bun.spawn`, keep stdin piping, stderr/stdout reading, exit waiting, and timeout-driven termination.

**Step 3: Replace crypto usage**

Generate the execution token with global `crypto` instead of `node:crypto`.

---

### Task 4: Migrate the sandbox bridge server to Bun

**Files:**
- Modify: `apps/app-backend/src/lib/sandbox/bridge.ts`

**Step 1: Replace Node HTTP server lifecycle with `Bun.serve`**

Start, stop, and expose the bridge port through Bun's server object.

**Step 2: Port request handling to Fetch APIs**

Read method, URL, headers, and body from `Request`, enforce the existing request size limit, and return `Response` objects with the same status codes and JSON payloads.

**Step 3: Preserve RPC semantics**

Keep the Redis-backed session lookup, bearer token verification, function dispatch, and error handling unchanged from the API caller perspective.

---

### Task 5: Verify the Bun-native migration

**Files:**
- Modify: `apps/app-backend/src/lib/db/index.ts`
- Modify: `apps/app-backend/src/lib/sandbox/utils.ts`
- Modify: `apps/app-backend/src/lib/sandbox/service.ts`
- Modify: `apps/app-backend/src/lib/sandbox/runner.ts`
- Modify: `apps/app-backend/src/lib/sandbox/bridge.ts`

**Step 1: Confirm all `node:` imports are gone**

Run a search scoped to `apps/app-backend/src`.

**Step 2: Run backend verification**

Run: `bun run typecheck` in `apps/app-backend`
Expected: TypeScript passes.

**Step 3: Run backend tests**

Run: `bun test` in `apps/app-backend`
Expected: Existing tests pass or any pre-existing unrelated failures are identified clearly.

**Step 4: Fix migration regressions if verification fails**

Address type or runtime compatibility issues introduced by the Bun-native swap, then re-run verification.
