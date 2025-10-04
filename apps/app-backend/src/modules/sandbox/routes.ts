import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "~/auth";
import { successResponse } from "~/lib/response";
import { nonEmptyStringSchema } from "~/lib/zod/base";
import { getSandboxService } from "~/sandbox";
import {
	getAppConfigValue,
	getUserConfigValue,
} from "~/sandbox/host-functions";

const runSandboxSchema = z.object({
	code: nonEmptyStringSchema.max(20_000),
});

export const sandboxApi = new Hono<{ Variables: AuthType }>().post(
	"/run",
	zValidator("json", runSandboxSchema),
	async (c) => {
		const user = c.get("user");
		const parsed = c.req.valid("json");

		const startedAt = Date.now();
		const sandbox = getSandboxService();
		const result = await sandbox.run({
			userId: user.id,
			code: parsed.code,
			apiFunctions: { getAppConfigValue, getUserConfigValue },
		});

		return successResponse(c, {
			...result,
			durationMs: Date.now() - startedAt,
		});
	},
);
