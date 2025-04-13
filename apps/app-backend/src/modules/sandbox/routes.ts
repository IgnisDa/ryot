import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";
import {
	enqueueSandboxBody,
	enqueueSandboxResponseSchema,
	pollSandboxResultResponseSchema,
	sandboxJobParams,
} from "./schemas";
import { enqueueSandbox, getSandboxResult } from "./service";

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

		const result = await enqueueSandbox({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getSandboxResultRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getSandboxResult({
			jobId: params.jobId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
