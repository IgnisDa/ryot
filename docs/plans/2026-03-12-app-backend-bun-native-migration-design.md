# App Backend Bun Native Migration Design

**Date:** 2026-03-12  
**Status:** Approved

## Overview

Replace every `node:` import in `apps/app-backend/src` with Bun-native or web-standard equivalents so the backend runs on Bun without depending on Node builtins for its sandbox infrastructure.

## Scope

**In Scope:**
- `apps/app-backend/src/lib/db/index.ts`
- `apps/app-backend/src/lib/sandbox/utils.ts`
- `apps/app-backend/src/lib/sandbox/service.ts`
- `apps/app-backend/src/lib/sandbox/runner.ts`
- `apps/app-backend/src/lib/sandbox/bridge.ts`
- Removal of all `node:` imports under `apps/app-backend/src`

**Out of Scope:**
- Rewriting unrelated backend modules
- Adding new feature behavior to the sandbox
- Adding new test coverage beyond existing verification commands
- Git commits or worktree setup

## Architecture

### Direct Bun Runtime Migration

Use Bun and web platform APIs directly instead of wrapping Node-compatible interfaces.

- `node:child_process` becomes `Bun.spawn`
- `node:http` server code becomes `Bun.serve`
- `node:crypto` becomes global `crypto`
- `node:fs/promises` becomes `Bun.write` and `Bun.file(...).delete()`
- `node:path` and `node:os` usages are reduced to string-based path construction where practical

### File-by-File Plan

**`db/index.ts`**
- Remove `node:path`
- Build the migrations folder path from `process.cwd()` directly

**`runner.ts`**
- Replace tmpdir/path joins with a Bun temp file path rooted under `/tmp`
- Replace `writeFile` with `Bun.write`
- Replace `rm` with `Bun.file(path).delete()`

**`utils.ts`**
- Replace Node-only process and response types with Bun subprocess and web response helpers
- Keep stream reading and exit formatting behavior unchanged from the caller perspective

**`service.ts`**
- Replace `spawn` with `Bun.spawn`
- Replace `randomBytes(32).toString("hex")` with a Bun-compatible `crypto.getRandomValues` based helper
- Preserve timeout behavior, stdin payload delivery, stdout/stderr capture, and timeout error messages

**`bridge.ts`**
- Replace the Node HTTP server with `Bun.serve`
- Move request handling to `Request` and `Response`
- Preserve the same routing (`/rpc/:executionId/:fnName`), Redis-backed session validation, authorization, request body limits, and JSON response shapes

## Error Handling

- Preserve existing sandbox timeout messages and signal formatting
- Keep body size enforcement for bridge requests
- Return the same HTTP status codes and JSON payload shapes from the bridge
- Fail fast if the Bun server does not allocate a port or if the sandbox process cannot start

## Verification

- Run backend type checking
- Run targeted backend tests that exercise affected sandbox code if any exist
- Run the backend Bun test suite or a focused subset that is available without DB setup
- Confirm no `node:` imports remain in `apps/app-backend/src`

## Selected Approach

This migration uses direct Bun APIs instead of compatibility wrappers because the affected surface area is small, isolated, and already concentrated in the sandbox layer. That keeps the code actually Bun-native and avoids preserving Node-shaped abstractions that would only add indirection.
