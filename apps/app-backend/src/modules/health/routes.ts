import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "~/db";
import { config } from "~/lib/config";
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
import { addJob, DEMO_JOB } from "~/worker/tasks";

const healthResponseSchema = dataSchema(
	z.object({
		status: z.literal("healthy"),
	}),
);

const healthQuerySchema = z.object({
	enqueueDemoJob: z.string().optional().openapi({
		description: "Set to true to enqueue a demo job (admin only)",
		example: "true",
	}),
});

const healthRoute = createRoute({
	path: "/",
	method: "get",
	tags: ["system"],
	summary: "Check backend health",
	request: { query: healthQuerySchema },
	responses: {
		503: createErrorResponse(
			"Database or Redis checks failed",
			commonErrors.healthCheckFailed,
		),
		200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
	},
});

export const healthApi = new OpenAPIHono().openapi(healthRoute, async (c) => {
	const query = c.req.valid("query");
	const headerToken = c.req.header("x-ryot-admin-token");
	const shouldEnqueueDemoJob =
		query.enqueueDemoJob === "true" &&
		headerToken === config.SERVER_ADMIN_ACCESS_TOKEN;

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

	if (shouldEnqueueDemoJob) {
		try {
			await addJob(DEMO_JOB, { message: "Health check test" });
		} catch (error) {
			console.error("Failed to enqueue demo job:", error);
		}
	}

	return c.json(successResponse({ status: "healthy" as const }), 200);
});
