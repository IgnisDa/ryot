import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AuthType } from "~/lib/auth";
import { db } from "~/lib/db";
import { sandboxScript } from "~/lib/db/schema/tables";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createStandardResponses,
	jsonBody,
	successResponse,
} from "~/lib/openapi";
import { getSandboxService } from "~/lib/sandbox";
import { sandboxRunJobResult } from "~/lib/sandbox/jobs";
import type { ApiFunctionDescriptor } from "~/lib/sandbox/types";
import { canUserRunScript } from "./access-control";
import {
	enqueueSandboxBody,
	enqueueSandboxResponseSchema,
	pollSandboxResultResponseSchema,
	sandboxJobParams,
} from "./schemas";

const sandboxJobNotFoundResult = createNotFoundErrorResult(
	"Sandbox job not found",
);

const sandboxScriptNotFoundResult = createNotFoundErrorResult(
	"Sandbox script not found",
);

const sandboxJobResultUnavailableMessage = "Sandbox job result unavailable";

const createApiFunctionDescriptors = (
	userId: string,
): Array<ApiFunctionDescriptor> => [
	{ context: {}, functionKey: "httpCall" },
	{ context: {}, functionKey: "getAppConfigValue" },
	{ context: {}, functionKey: "getUserConfigValue" },
	{ context: { userId }, functionKey: "getEntitySchemas" },
];

const enqueueSandboxRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/enqueue",
		tags: ["sandbox"],
		summary: "Enqueue a sandbox script",
		request: { body: jsonBody(enqueueSandboxBody) },
		responses: createStandardResponses({
			successSchema: enqueueSandboxResponseSchema,
			successDescription: "Sandbox script enqueued",
			notFoundDescription: "Sandbox script not found",
		}),
	}),
);

const getSandboxResultRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["sandbox"],
		path: "/result/{jobId}",
		request: { params: sandboxJobParams },
		summary: "Get a sandbox script result",
		responses: createStandardResponses({
			successDescription: "Sandbox script result",
			notFoundDescription: "Sandbox job not found",
			successSchema: pollSandboxResultResponseSchema,
		}),
	}),
);

export const sandboxApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(enqueueSandboxRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		if (body.kind === "script") {
			const [found] = await db
				.select({
					code: sandboxScript.code,
					userId: sandboxScript.userId,
					isBuiltin: sandboxScript.isBuiltin,
				})
				.from(sandboxScript)
				.where(eq(sandboxScript.id, body.scriptId))
				.limit(1);

			if (!found || !canUserRunScript({ userId: user.id, script: found })) {
				return c.json(
					sandboxScriptNotFoundResult.body,
					sandboxScriptNotFoundResult.status,
				);
			}

			const result = await getSandboxService().enqueue({
				userId: user.id,
				code: found.code,
				context: body.context,
				scriptId: body.scriptId,
				apiFunctionDescriptors: createApiFunctionDescriptors(user.id),
			});

			return c.json(successResponse(result), 200);
		}

		const result = await getSandboxService().enqueue({
			code: body.code,
			userId: user.id,
			context: body.context,
			apiFunctionDescriptors: createApiFunctionDescriptors(user.id),
		});

		return c.json(successResponse(result), 200);
	})
	.openapi(getSandboxResultRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const foundJob = await getSandboxService().getJobByIdForUser({
			userId: user.id,
			jobId: params.jobId,
		});
		if (!foundJob) {
			return c.json(
				sandboxJobNotFoundResult.body,
				sandboxJobNotFoundResult.status,
			);
		}

		const state = await foundJob.job.getState();
		if (state === "completed") {
			const result = sandboxRunJobResult.safeParse(foundJob.job.returnvalue);
			if (!result.success) {
				return c.json(
					successResponse({
						status: "failed",
						error: sandboxJobResultUnavailableMessage,
					}),
					200,
				);
			}

			return c.json(
				successResponse({
					status: "completed",
					logs: result.data.logs ?? null,
					error: result.data.error ?? null,
					value: result.data.value === undefined ? null : result.data.value,
				}),
				200,
			);
		}

		if (state === "failed") {
			return c.json(
				successResponse({
					status: "failed",
					error: foundJob.job.failedReason || "Sandbox job failed",
				}),
				200,
			);
		}

		return c.json(successResponse({ status: "pending" }), 200);
	});
