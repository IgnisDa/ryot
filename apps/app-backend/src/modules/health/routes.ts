import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "~/db";
import { errorJsonResponse, jsonResponse } from "~/lib/openapi";
import { redis } from "~/lib/redis";
import { errorResponse, successResponse } from "~/lib/response";

const healthResponseSchema = z.object({
	status: z.literal("healthy"),
});

export const healthApi = new Hono().get(
	"/",
	describeRoute({
		tags: ["health"],
		summary: "Check backend health",
		responses: {
			503: errorJsonResponse("Database or Redis checks failed"),
			200: jsonResponse(
				"Database and Redis checks passed",
				healthResponseSchema,
			),
		},
	}),
	async (c) => {
		try {
			await db.execute(sql`SELECT 1`);
		} catch (error) {
			return errorResponse(
				c,
				`Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				503,
			);
		}

		try {
			await redis.ping();
		} catch (error) {
			return errorResponse(
				c,
				`Redis check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				503,
			);
		}

		return successResponse(c, { status: "healthy" });
	},
);
