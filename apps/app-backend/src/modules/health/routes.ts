import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "~/db";
import { errorJsonResponse, jsonResponse } from "~/lib/openapi";
import { redis } from "~/lib/redis";

const healthResponseSchema = z.object({
	status: z.literal("healthy"),
});

const healthRoute = createRoute({
	tags: ["health"],
	path: "/",
	method: "get",
	summary: "Check backend health",
	responses: {
		503: errorJsonResponse("Database or Redis checks failed"),
		200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
	},
});

export const healthApi = new OpenAPIHono().openapi(healthRoute, async (c) => {
	try {
		await db.execute(sql`SELECT 1`);
	} catch (error) {
		return c.json(
			{
				error: `Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			},
			503,
		);
	}

	try {
		await redis.ping();
	} catch (error) {
		return c.json(
			{
				error: `Redis check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			},
			503,
		);
	}

	return c.json({ status: "healthy" } as const, 200);
});
