import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
} from "~/lib/openapi";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";

import { prepareAndExecute } from "./preparer";
import { queryEngineRequestSchema, queryEngineResponseDataSchema } from "./schemas";

const executeQueryEngineRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/execute",
		tags: ["query-engine"],
		request: {
			body: {
				content: { "application/json": { schema: queryEngineRequestSchema } },
			},
		},
		summary: "Execute a declarative query-engine request",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Result for the requested query-engine request",
				queryEngineResponseDataSchema,
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
		const result = await prepareAndExecute({ userId: user.id, request: body });
		return c.json(result, 200);
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
