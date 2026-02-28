import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import {
	createAuthRoute,
	dataSchema,
	jsonResponse,
	payloadErrorResponse,
	successResponse,
} from "~/lib/openapi";
import { nonEmptyStringSchema, nullableStringSchema } from "~/lib/zod/base";
import { getSandboxService } from "~/sandbox";
import {
	getAppConfigValue,
	getUserConfigValue,
} from "~/sandbox/host-functions";

const runSandboxSchema = z.object({
	code: nonEmptyStringSchema.max(20_000),
});

const runSandboxResponseSchema = dataSchema(
	z.object({
		logs: nullableStringSchema,
		error: nullableStringSchema,
		value: z.unknown().optional(),
		durationMs: z.number().int().nonnegative(),
	}),
);

const runSandboxRoute = createAuthRoute(
	createRoute({
		path: "/run",
		method: "post",
		tags: ["sandbox"],
		summary: "Run a sandbox script",
		request: {
			body: { content: { "application/json": { schema: runSandboxSchema } } },
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse("Sandbox run completed", runSandboxResponseSchema),
		},
	}),
);

export const sandboxApi = new OpenAPIHono<{ Variables: AuthType }>().openapi(
	runSandboxRoute,
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

		const { success, ...resultData } = result;
		return c.json(
			successResponse({ ...resultData, durationMs: Date.now() - startedAt }),
			200,
		);
	},
);
