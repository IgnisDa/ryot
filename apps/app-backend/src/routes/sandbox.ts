import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getSandboxService } from "../sandbox";

const runSandboxSchema = z.object({
	code: z.string().min(1).max(20_000),
});

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
			apiFunctions: {},
			timeoutMs: 10_000,
			code: parsed.code,
		});

		return c.json({ ...result, durationMs: Date.now() - startedAt });
	},
);
