import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
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
import {
	enqueueSandboxBody,
	enqueueSandboxResponseSchema,
	pollSandboxResultResponseSchema,
	sandboxJobParams,
} from "./schemas";

const sandboxJobNotFoundResult = createNotFoundErrorResult(
	"Sandbox job not found",
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
