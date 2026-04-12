import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	successResponse,
} from "~/lib/openapi";
import { viewDefinitionModule } from "~/lib/views/definition";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import {
	executeQueryEngineBody,
	executeQueryEngineResponseSchema,
} from "./schemas";

const executeQueryEngineRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/execute",
		tags: ["query-engine"],
		request: {
			body: {
				content: { "application/json": { schema: executeQueryEngineBody } },
			},
		},
		summary: "Execute a compiled query-engine request",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Entities for the requested query-engine request",
				executeQueryEngineResponseSchema,
			),
		},
	}),
);

export const queryEngineApi = new OpenAPIHono<{
	Variables: AuthType;
}>().openapi(executeQueryEngineRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	try {
		const result = await (
			await viewDefinitionModule.prepare({
				userId: user.id,
				source: { kind: "runtime", request: body },
			})
		).execute();
		return c.json(successResponse(result), 200);
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			const result = createNotFoundErrorResult(error.message);
			return c.json(result.body, result.status);
		}

		if (error instanceof QueryEngineValidationError) {
			const result = createValidationErrorResult(error.message);
			return c.json(result.body, result.status);
		}

		throw error;
	}
});
