import { zValidator } from "@hono/zod-validator";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { getSandboxService } from "../sandbox";
import { httpCall } from "../sandbox/host-functions";

const runSandboxSchema = z.object({
	code: z.string().min(1).max(20_000),
});

type AddNumbersSuccess = { data: number; success: true };
type AddNumbersFailure = { error: string; success: false };
type AddNumbersResult = AddNumbersFailure | AddNumbersSuccess;

const addNumbers = async (
	a: unknown,
	b: unknown,
): Promise<AddNumbersResult> => {
	const first = Number(a);
	const second = Number(b);

	if (!Number.isFinite(first) || !Number.isFinite(second))
		return {
			success: false,
			error: "addNumbers expects two finite numbers",
		};

	try {
		const result = await db.execute(
			sql`SELECT (${first}::double precision + ${second}::double precision) AS data`,
		);

		if (Math.random() < 0.3)
			return {
				error: "Random demo error from addNumbers",
				success: false,
			};

		const row = result.rows[0] as { data?: number | string } | undefined;
		const data = Number(row?.data);
		if (!Number.isFinite(data))
			return {
				success: false,
				error: "Could not read addNumbers result from database",
			};

		return { data, success: true };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to run addNumbers",
		};
	}
};

export const sandboxApi = new Hono().post(
	"/run",
	zValidator("json", runSandboxSchema),
	async (c) => {
		const parsed = c.req.valid("json");

		const startedAt = Date.now();
		const sandbox = getSandboxService();
		const result = await sandbox.run({
			context: {},
			maxHeapMB: 64,
			timeoutMs: 10_000,
			code: parsed.code,
			apiFunctions: { addNumbers, httpCall },
		});

		return c.json({ ...result, durationMs: Date.now() - startedAt });
	},
);
