# Graphile Worker Integration Design

**Date:** 2026-03-04  
**Status:** Approved

## Overview

Integrate Graphile Worker as an alternative job queue system alongside the existing BullMQ implementation. This allows us to evaluate Graphile Worker as a potential replacement for BullMQ while maintaining the current system.

## Goals

- Set up Graphile Worker with a structure that mirrors the existing BullMQ implementation
- Add a sample demo job to the `/health` endpoint to demonstrate enqueueing and processing
- Keep both systems running in parallel without interference
- Provide a clear migration path for the future

## Architecture

### Directory Structure

Create a new `worker/` directory that mirrors the BullMQ `queue/` structure:

```
src/
├── queue/          (existing BullMQ)
│   ├── connection.ts
│   ├── queues.ts
│   ├── workers.ts
│   └── index.ts
└── worker/         (new Graphile Worker)
    ├── connection.ts   - Postgres pool configuration
    ├── tasks.ts        - Job enqueueing and task definitions
    ├── runners.ts      - Task processor implementations
    └── index.ts        - Initialization and accessor functions
```

**Naming rationale:** Using "worker" (singular) vs "queue" helps distinguish the two systems while maintaining similar structure.

## Components

### worker/connection.ts

Manages the Postgres connection pool for Graphile Worker:
- Export `getWorkerPool()` - Returns a shared pg Pool instance
- Reuse existing database configuration from `~/lib/config` or `~/db`
- Export `shutdownWorkerPool()` - Cleanup function for graceful shutdown

### worker/tasks.ts

Handles job enqueueing and task definitions:
- Export `addJob()` helper function to enqueue jobs using Graphile's `quickAddJob()`
- Define task identifiers as constants (e.g., `export const DEMO_JOB = "demoJob"`)
- Use Zod schemas for type-safe job data (matching BullMQ pattern)

### worker/runners.ts

Implements task processors:
- Export a `TaskList` object mapping task names to handler functions
- Implement `processDemoJob()` that sleeps for 2 seconds and logs
- Each handler receives `(payload, helpers)` from Graphile Worker
- Follow Graphile Worker's task handler signature

### worker/index.ts

Initialization and lifecycle management:
- `initializeWorker()` - Creates and starts the Graphile Worker runner
- `getWorker()` - Returns the runner instance
- `shutdownWorker()` - Stops the runner and closes pool
- Store runner in module-level variable (same pattern as queue/index.ts)

## Data Flow

1. **Job Enqueueing:** `/health` endpoint calls `addJob(DEMO_JOB, { message: "Health check test" })`
2. **Job Storage:** Graphile Worker stores job in `graphile_worker.jobs` table in Postgres
3. **Job Processing:** Worker runner picks up job and executes `processDemoJob()` handler
4. **Execution:** Handler logs message, sleeps 2 seconds, logs completion
5. **Cleanup:** Graphile Worker updates job status in database

## Implementation Details

### Database Schema

- Graphile Worker automatically creates its own `graphile_worker` schema
- Schema creation happens on first worker start
- No manual migrations needed

### Demo Job Implementation

```typescript
const processDemoJob = async (payload: unknown) => {
  console.log("Demo job started with payload:", payload);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second sleep
  console.log("Demo job completed");
};
```

### Initialization

- Call `initializeWorker()` in main app startup (src/index.ts)
- Initialize after database is ready
- Can run in parallel with BullMQ initialization

### Error Handling

- Worker initialization failures are logged but don't crash the app (graceful degradation)
- Job failures are logged by Graphile Worker and stored in database
- Failed jobs can be retried via Graphile's built-in retry mechanism
- Unhandled task names throw errors (similar to BullMQ pattern)

### Dependencies

- Add `graphile-worker` package (exact version)
- Reuse existing `pg` package (already in dependencies)

## Health Endpoint Modification

Add job enqueueing to the health endpoint:

```typescript
import { DEMO_JOB, addJob } from "~/worker/tasks";

// After existing health checks
await addJob(DEMO_JOB, { message: "Health check test" });
```

This demonstrates that:
- Jobs can be enqueued successfully
- Worker is running and processing jobs (visible in logs)
- The integration is working end-to-end

## Migration Strategy

This design supports a gradual migration from BullMQ to Graphile Worker:

1. **Phase 1 (Current):** Both systems run in parallel
2. **Phase 2:** New jobs use Graphile Worker, existing jobs stay on BullMQ
3. **Phase 3:** Migrate existing BullMQ jobs to Graphile Worker
4. **Phase 4:** Remove BullMQ dependencies and `queue/` directory

The mirrored structure makes this migration straightforward - each BullMQ component has a clear Graphile Worker equivalent.

## Non-Goals

- Replacing BullMQ in this implementation (comes later)
- Adding production-ready job monitoring/dashboards
- Implementing complex job scheduling or cron patterns
- Migrating existing sandbox jobs to Graphile Worker

## Success Criteria

- Graphile Worker successfully initializes on app startup
- Health endpoint enqueues demo job without errors
- Demo job processes in background and logs expected output
- No interference with existing BullMQ functionality
- Code structure matches BullMQ patterns for familiarity
