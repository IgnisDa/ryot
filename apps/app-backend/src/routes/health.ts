import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { redis } from "../lib/redis";
import { errorResponse, successResponse } from "../lib/response";

export const healthApi = new Hono().get("/", async (c) => {
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
});
