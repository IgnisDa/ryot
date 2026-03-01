# Prometheus Metrics Endpoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/metrics` endpoint that exports system, HTTP, and database metrics in Prometheus format using prom-client.

**Architecture:** Initialize prom-client with default collectors for CPU/memory/GC metrics. Create custom Prometheus metrics for HTTP requests (counter for total, histogram for latency) and database connections. Add middleware to `server.ts` to automatically track all HTTP requests. Export metrics in text format at `/metrics` endpoint.

**Tech Stack:** prom-client (Node.js Prometheus client library), Hono (web framework), TypeScript

---

## Task 1: Install prom-client dependency

**Files:**
- Modify: `apps/app-backend/package.json`

**Step 1: Install prom-client**

Run: `cd /Users/diptesh/Desktop/Code/ryot && bun add -E prom-client`

Expected: prom-client added to package.json with exact version (no ^/~)

**Step 2: Commit**

```bash
cd /Users/diptesh/Desktop/Code/ryot
git add 'apps/app-backend/package.json' 'bun.lock'
git commit -m "chore: add prom-client for prometheus metrics"
```

Expected: Commit created successfully

---

## Task 2: Create metrics service

**Files:**
- Create: `apps/app-backend/src/modules/health/service.ts`

**Step 1: Write the metrics service file**

```typescript
import promClient from "prom-client";

let metricsInitialized = false;

export const initializeMetrics = () => {
	if (metricsInitialized) return;
	metricsInitialized = true;

	// Default collectors: CPU, memory, file descriptors, GC, event loop lag
	promClient.collectDefaultMetrics({ prefix: "app_" });
};

// HTTP metrics
export const httpRequestDuration = new promClient.Histogram({
	name: "app_http_request_duration_seconds",
	help: "HTTP request latency in seconds",
	labelNames: ["method", "route", "status"],
	buckets: [0.1, 0.5, 1, 2, 5],
});

export const httpRequestTotal = new promClient.Counter({
	name: "app_http_requests_total",
	help: "Total HTTP requests",
	labelNames: ["method", "route", "status"],
});

// Database metrics
export const dbConnectionPoolSize = new promClient.Gauge({
	name: "app_db_connection_pool_size",
	help: "Database connection pool size",
});

export const dbConnectionPoolAvailable = new promClient.Gauge({
	name: "app_db_connection_pool_available",
	help: "Available database connections in pool",
});

export const getMetricsAsText = async () => {
	return promClient.register.metrics();
};
```

**Step 2: Verify file was created**

Run: `test -f /Users/diptesh/Desktop/Code/ryot/apps/app-backend/src/modules/health/service.ts && echo "File created"`

Expected: "File created"

**Step 3: Commit**

```bash
cd /Users/diptesh/Desktop/Code/ryot
git add 'apps/app-backend/src/modules/health/service.ts'
git commit -m "feat: add prometheus metrics initialization and collectors"
```

Expected: Commit created successfully

---

## Task 3: Create HTTP metrics middleware

**Files:**
- Create: `apps/app-backend/src/modules/health/middleware.ts`

**Step 1: Write the middleware file**

```typescript
import type { Context, Next } from "hono";
import { httpRequestDuration, httpRequestTotal } from "./service";

export const metricsMiddleware = async (c: Context, next: Next) => {
	const start = Date.now();
	const method = c.req.method;
	let route = c.req.path;

	// Normalize route paths to reduce cardinality
	// Convert /api/entities/123 -> /api/entities/:id
	route = route.replace(/\/api\/[^/]+\/[a-f0-9-]+/g, (match) => {
		const parts = match.split("/");
		parts[parts.length - 1] = ":id";
		return parts.join("/");
	});

	await next();

	const duration = (Date.now() - start) / 1000;
	const status = c.res.status;

	httpRequestDuration.observe(
		{ method, route, status: String(status) },
		duration,
	);
	httpRequestTotal.inc({ method, route, status: String(status) });
};
```

**Step 2: Verify file was created**

Run: `test -f /Users/diptesh/Desktop/Code/ryot/apps/app-backend/src/modules/health/middleware.ts && echo "File created"`

Expected: "File created"

**Step 3: Commit**

```bash
cd /Users/diptesh/Desktop/Code/ryot
git add 'apps/app-backend/src/modules/health/middleware.ts'
git commit -m "feat: add http metrics middleware for tracking requests"
```

Expected: Commit created successfully

---

## Task 4: Add /metrics endpoint to health routes

**Files:**
- Modify: `apps/app-backend/src/modules/health/routes.ts`

**Step 1: Update the routes.ts file to add metrics endpoint**

Replace the entire file with:

```typescript
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "~/db";
import {
	commonErrors,
	createErrorResponse,
	dataSchema,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	successResponse,
} from "~/lib/openapi";
import { redis } from "~/lib/redis";
import { getMetricsAsText, initializeMetrics } from "./service";

const healthResponseSchema = dataSchema(
	z.object({
		status: z.literal("healthy"),
	}),
);

const healthRoute = createRoute({
	path: "/",
	method: "get",
	tags: ["health"],
	summary: "Check backend health",
	responses: {
		503: createErrorResponse(
			"Database or Redis checks failed",
			commonErrors.healthCheckFailed,
		),
		200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
	},
});

const metricsRoute = createRoute({
	path: "/metrics",
	method: "get",
	tags: ["health"],
	summary: "Export metrics in Prometheus format",
	responses: {
		200: {
			description: "Prometheus metrics in text format",
			content: {
				"text/plain": {
					schema: z.string(),
				},
			},
		},
	},
});

export const healthApi = new OpenAPIHono()
	.openapi(healthRoute, async (c) => {
		try {
			await db.execute(sql`SELECT 1`);
		} catch (error) {
			return c.json(
				errorResponse(
					ERROR_CODES.HEALTH_CHECK_FAILED,
					`Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				),
				503,
			);
		}

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

		return c.json(successResponse({ status: "healthy" as const }), 200);
	})
	.openapi(metricsRoute, async (c) => {
		initializeMetrics();
		const metricsText = await getMetricsAsText();
		return c.text(metricsText, 200, {
			"Content-Type": "text/plain; charset=utf-8",
		});
	});
```

**Step 2: Verify syntax is correct**

Run: `cd /Users/diptesh/Desktop/Code/ryot && bun run turbo typecheck --filter=@ryot/app-backend`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
cd /Users/diptesh/Desktop/Code/ryot
git add 'apps/app-backend/src/modules/health/routes.ts'
git commit -m "feat: add /metrics endpoint for prometheus scraping"
```

Expected: Commit created successfully

---

## Task 5: Add metrics middleware to server

**Files:**
- Modify: `apps/app-backend/src/app/server.ts`

**Step 1: Update server.ts to include metrics middleware**

Replace file with:

```typescript
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { metricsMiddleware } from "~/modules/health/middleware";
import { apiApp } from "./api";

export const app = new Hono()
	.use("*", metricsMiddleware)
	.route("/api", apiApp)
	.use("*", serveStatic({ root: "./client" }))
	.use("*", serveStatic({ path: "./client/_shell.html" }));
```

**Step 2: Verify syntax is correct**

Run: `cd /Users/diptesh/Desktop/Code/ryot && bun run turbo typecheck --filter=@ryot/app-backend`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
cd /Users/diptesh/Desktop/Code/ryot
git add 'apps/app-backend/src/app/server.ts'
git commit -m "feat: add metrics middleware to track all http requests"
```

Expected: Commit created successfully

---

## Task 6: Test the metrics endpoint

**Files:**
- Test: manual verification via curl/HTTP request

**Step 1: Start the backend server in dev mode**

Run: `cd /Users/diptesh/Desktop/Code/ryot && bun run turbo dev --filter=@ryot/app-backend`

Expected: Server starts and listens on configured PORT (typically 3000 or shown in console)

**Step 2: In another terminal, make a test request to health endpoint**

Run: `curl http://localhost:3000/api/health`

Expected: Response like:
```json
{"data":{"status":"healthy"}}
```

**Step 3: In same terminal, request metrics**

Run: `curl http://localhost:3000/api/health/metrics`

Expected: Prometheus text format metrics output containing:
- `app_http_requests_total{method="GET",route="/api/health",status="200"} 2`
- `app_http_request_duration_seconds_bucket` entries
- `app_process_cpu_user_seconds_total`
- `app_process_resident_memory_bytes`
- `app_nodejs_eventloop_lag_seconds` or similar

**Step 4: Stop the server**

Run: Press Ctrl+C in the terminal running `bun run turbo dev`

Expected: Server gracefully shuts down

---

## Verification Checklist

- [ ] `bun run turbo typecheck --filter=@ryot/app-backend` passes
- [ ] `bun run turbo build --filter=@ryot/app-backend` succeeds
- [ ] `/api/health` endpoint still works and returns 200
- [ ] `/api/health/metrics` returns Prometheus-formatted text
- [ ] Metrics contain HTTP request counts and durations
- [ ] Metrics contain system metrics (CPU, memory, GC)
- [ ] Git log shows all 6 commits with proper messages

---

## Notes for Future Enhancement

The infrastructure is now in place to add custom business metrics:

```typescript
// In any module, import and use:
import { httpRequestTotal, dbConnectionPoolSize } from "~/modules/health/service";

// Track custom events:
httpRequestTotal.inc({ custom_label: "value" });
dbConnectionPoolSize.set(50);
```

Database connection pool metrics can be updated in the database initialization code by calling the gauge setters.
