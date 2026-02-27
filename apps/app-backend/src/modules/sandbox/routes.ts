import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import {
	errorJsonResponse,
	jsonResponse,
	payloadValidationErrorResponse,
} from "~/lib/openapi";
import { nonEmptyStringSchema } from "~/lib/zod/base";
import { getSandboxService } from "~/sandbox";
import {
	getAppConfigValue,
	getUserConfigValue,
} from "~/sandbox/host-functions";

const runSandboxSchema = z.object({
	code: nonEmptyStringSchema.max(20_000),
});

const runSandboxResponseSchema = z.object({
	success: z.boolean(),
	logs: z.string().optional(),
	error: z.string().optional(),
	value: z.unknown().optional(),
	durationMs: z.number().int().nonnegative(),
});

const runSandboxRoute = createRoute({
	path: "/run",
	method: "post",
	tags: ["sandbox"],
	summary: "Run a sandbox script",
	request: {
		body: {
			content: {
				"application/json": {
					schema: runSandboxSchema,
				},
			},
		},
	},
	responses: {
		400: payloadValidationErrorResponse,
		401: errorJsonResponse("Request is unauthenticated"),
		200: jsonResponse("Sandbox run completed", runSandboxResponseSchema),
	},
});

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

		return c.json(
			{
				...result,
				durationMs: Date.now() - startedAt,
			},
			200,
		);
	},
);
