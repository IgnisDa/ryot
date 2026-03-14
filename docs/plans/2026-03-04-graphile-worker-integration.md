# Graphile Worker Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Graphile Worker as a Postgres-based job queue alongside BullMQ with a demo job in the health endpoint.

**Architecture:** Create a new `worker/` directory mirroring the BullMQ `queue/` structure with connection management, task definitions, job processors, and initialization functions. Add demo job enqueueing to `/health` endpoint.

**Tech Stack:** Graphile Worker, PostgreSQL (existing), Zod for validation

---

## Task 1: Install Graphile Worker

**Files:**
- Modify: `apps/app-backend/package.json`

**Step 1: Install graphile-worker dependency**

Run from project root:
```bash
bun add -E graphile-worker
```

Expected: Package added to dependencies with exact version

**Step 2: Verify installation**

Run:
```bash
cd apps/app-backend && bun install
```

Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add 'apps/app-backend/package.json' 'bun.lockb'
git commit -m 'build: add graphile-worker dependency'
```

---

## Task 2: Create Worker Connection Management

**Files:**
- Create: `apps/app-backend/src/worker/connection.ts`

**Step 1: Create worker directory**

Run:
```bash
mkdir apps/app-backend/src/worker
```

**Step 2: Write connection.ts**

Create `apps/app-backend/src/worker/connection.ts`:

```typescript
import { Pool } from "pg";
import { config } from "~/lib/config";

let sharedWorkerPool: Pool | null = null;

export const getWorkerPool = () => {
	if (sharedWorkerPool) return sharedWorkerPool;

	sharedWorkerPool = new Pool({
		connectionString: config.DATABASE_URL,
	});

	return sharedWorkerPool;
};

export const shutdownWorkerPool = async () => {
	if (!sharedWorkerPool) return;

	await sharedWorkerPool.end();
	sharedWorkerPool = null;
};
```

**Step 3: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 4: Commit**

```bash
git add 'apps/app-backend/src/worker/connection.ts'
git commit -m 'feat(worker): add postgres pool connection management'
```

---

## Task 3: Create Task Definitions and Enqueueing

**Files:**
- Create: `apps/app-backend/src/worker/tasks.ts`

**Step 1: Write tasks.ts**

Create `apps/app-backend/src/worker/tasks.ts`:

```typescript
import { quickAddJob } from "graphile-worker";
import { z } from "zod";
import { getWorkerPool } from "./connection";

export const DEMO_JOB = "demoJob";

export const demoJobPayloadSchema = z.object({
	message: z.string(),
});

export type DemoJobPayload = z.infer<typeof demoJobPayloadSchema>;

export const addJob = async (taskIdentifier: string, payload: unknown) => {
	const pool = getWorkerPool();
	await quickAddJob({ pg: pool }, taskIdentifier, payload);
};
```

**Step 2: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/worker/tasks.ts'
git commit -m 'feat(worker): add job enqueueing and task definitions'
```

---

## Task 4: Create Task Runners

**Files:**
- Create: `apps/app-backend/src/worker/runners.ts`

**Step 1: Write runners.ts**

Create `apps/app-backend/src/worker/runners.ts`:

```typescript
import type { Task } from "graphile-worker";
import { DEMO_JOB, demoJobPayloadSchema } from "./tasks";

const processDemoJob: Task = async (payload, helpers) => {
	const parsed = demoJobPayloadSchema.safeParse(payload);
	if (!parsed.success) {
		helpers.logger.error("Demo job payload is invalid", {
			errors: parsed.error.errors,
		});
		throw new Error("Demo job payload is invalid");
	}

	helpers.logger.info("Demo job started", { payload: parsed.data });
	await new Promise((resolve) => setTimeout(resolve, 2000));
	helpers.logger.info("Demo job completed", { payload: parsed.data });
};

export const taskList = {
	[DEMO_JOB]: processDemoJob,
};
```

**Step 2: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/worker/runners.ts'
git commit -m 'feat(worker): add task runner implementations'
```

---

## Task 5: Create Worker Initialization

**Files:**
- Create: `apps/app-backend/src/worker/index.ts`

**Step 1: Write index.ts**

Create `apps/app-backend/src/worker/index.ts`:

```typescript
import { run, type Runner } from "graphile-worker";
import { getWorkerPool, shutdownWorkerPool } from "./connection";
import { taskList } from "./runners";

let runner: Runner | null = null;

export const initializeWorker = async () => {
	const pgPool = getWorkerPool();

	runner = await run({
		pgPool,
		taskList,
		concurrency: 5,
	});

	console.info("Graphile Worker initialized");
	return runner;
};

export const getRunner = () => {
	if (!runner) {
		throw new Error("Worker not initialized. Call initializeWorker() first.");
	}
	return runner;
};

export const shutdownWorker = async () => {
	if (runner) {
		await runner.stop();
		runner = null;
		await shutdownWorkerPool();
		console.info("Graphile Worker shut down");
	}
};
```

**Step 2: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/worker/index.ts'
git commit -m 'feat(worker): add worker initialization and lifecycle management'
```

---

## Task 6: Integrate Worker into App Runtime

**Files:**
- Modify: `apps/app-backend/src/app/runtime.ts`

**Step 1: Add worker imports**

In `apps/app-backend/src/app/runtime.ts`, add import after line 10:

```typescript
import {
	initializeWorker,
	shutdownWorker,
} from "~/worker";
```

**Step 2: Initialize worker on startup**

In `startServer()` function, add after line 19:

```typescript
await initializeWorker();
```

**Step 3: Shutdown worker on graceful shutdown**

In `shutdown()` function, add after line 42:

```typescript
await shutdownWorker();
```

The shutdown section should now look like:

```typescript
try {
	await shutdownWorkers();
	await shutdownQueues();
	await shutdownSandboxService();
	await shutdownWorker();
	await shutdownRedis();
	server.close(() => {
		console.info("Server closed");
		clearTimeout(forceExitTimeout);
		process.exit(0);
	});
} catch (error) {
	console.error("Error during shutdown:", error);
	clearTimeout(forceExitTimeout);
	process.exit(1);
}
```

**Step 4: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 5: Commit**

```bash
git add 'apps/app-backend/src/app/runtime.ts'
git commit -m 'feat(worker): integrate worker lifecycle into app runtime'
```

---

## Task 7: Add Demo Job to Health Endpoint

**Files:**
- Modify: `apps/app-backend/src/modules/health/routes.ts`

**Step 1: Add worker imports**

In `apps/app-backend/src/modules/health/routes.ts`, add import after line 13:

```typescript
import { DEMO_JOB, addJob } from "~/worker/tasks";
```

**Step 2: Enqueue demo job in health handler**

In the health route handler, add before the final return statement (after line 58, before line 60):

```typescript
try {
	await addJob(DEMO_JOB, { message: "Health check test" });
} catch (error) {
	console.error("Failed to enqueue demo job:", error);
}
```

The final section should look like:

```typescript
try {
	await redis.ping();
} catch (error) {
	return c.json(
		errorResponse(
			ERROR_CODES.HEALTH_CHECK_FAILED,
			`Redis check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		),
		503,
	);
}

try {
	await addJob(DEMO_JOB, { message: "Health check test" });
} catch (error) {
	console.error("Failed to enqueue demo job:", error);
}

return c.json(successResponse({ status: "healthy" as const }), 200);
```

**Step 3: Verify no TypeScript errors**

Run:
```bash
cd apps/app-backend && bun run typecheck
```

Expected: No type errors

**Step 4: Commit**

```bash
git add 'apps/app-backend/src/modules/health/routes.ts'
git commit -m 'feat(worker): add demo job enqueueing to health endpoint'
```

---

## Task 8: Test Integration End-to-End

**Files:**
- Test: Backend server startup and health endpoint

**Step 1: Start the backend server**

Run:
```bash
cd apps/app-backend && bun run dev
```

Expected output should include:
- "Graphile Worker initialized"
- "Server listening on port 8000..." (or configured port)

**Step 2: Call the health endpoint**

In a new terminal, run:
```bash
curl http://localhost:8000/health
```

Expected:
- HTTP 200 response
- JSON: `{"success": true, "data": {"status": "healthy"}}`

**Step 3: Verify demo job processing**

Check the server logs for:
```
Demo job started
```

Wait 2 seconds, then check for:
```
Demo job completed
```

**Step 4: Call health endpoint again**

Run:
```bash
curl http://localhost:8000/health
```

Expected: Another demo job is enqueued and processed (visible in logs)

**Step 5: Verify database tables**

Connect to Postgres and check:
```bash
psql $DATABASE_URL -c "SELECT * FROM graphile_worker.jobs ORDER BY created_at DESC LIMIT 5;"
```

Expected: Recent demo jobs visible with status 'completed'

**Step 6: Test graceful shutdown**

Stop the dev server (Ctrl+C)

Expected output:
- "Shutting down server..."
- "Workers shut down"
- "Queues shut down"
- "Graphile Worker shut down"
- "Server closed"

**Step 7: Document testing**

All tests pass. Integration is working end-to-end.

---

## Success Criteria

✅ Graphile Worker initializes on server startup  
✅ Worker creates `graphile_worker` schema in Postgres  
✅ Health endpoint successfully enqueues demo job  
✅ Demo job processes in background with 2-second sleep  
✅ Job processing logs appear in console  
✅ Worker shuts down gracefully with server  
✅ No TypeScript errors  
✅ BullMQ continues working alongside Graphile Worker  

## Next Steps

After implementation:
- Monitor demo job execution in production
- Consider migrating existing BullMQ jobs to Graphile Worker
- Add job monitoring/dashboard if needed
- Evaluate performance vs BullMQ for future decision
