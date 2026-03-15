import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
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
import { getMetricsAsText } from "./service";

const healthResponseSchema = dataSchema(
	z.object({
		status: z.literal("healthy"),
	}),
);

const healthRoute = createRoute({
	method: "get",
	path: "/health",
	tags: ["system"],
	summary: "Check database and Redis health",
	responses: {
		503: createErrorResponse(
			"Database or Redis checks failed",
			commonErrors.healthCheckFailed,
		),
		200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
	},
});

const metricsRoute = createRoute({
	method: "get",
	path: "/metrics",
	tags: ["system"],
	summary: "Export application metrics in Prometheus format",
	responses: {
		200: {
			description: "Prometheus metrics in text format",
			content: { "text/plain": { schema: z.string() } },
		},
	},
});

export const systemApi = new OpenAPIHono()
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
		const metricsText = await getMetricsAsText();
		return c.text(metricsText, 200, {
			"Content-Type": "text/plain; charset=utf-8",
		});
	});
