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
import {
	executeViewRuntimeQuery,
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "./query-builder";
import {
	executeViewRuntimeBody,
	executeViewRuntimeResponseSchema,
} from "./schemas";

const sortFieldRequiredError = "Sort field is required";

const executeViewRuntimeRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/execute",
		tags: ["view-runtime"],
		request: {
			body: {
				content: { "application/json": { schema: executeViewRuntimeBody } },
			},
		},
		summary: "Execute a compiled view-runtime query",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Entities for the requested runtime query",
				executeViewRuntimeResponseSchema,
			),
		},
	}),
);

export const viewRuntimeApi = new OpenAPIHono<{
	Variables: AuthType;
}>().openapi(executeViewRuntimeRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	if (!body.sort.field.length) {
		const error = createValidationErrorResult(sortFieldRequiredError);
		return c.json(error.body, error.status);
	}

	try {
		const result = await executeViewRuntimeQuery(body, user.id);
		return c.json(successResponse(result), 200);
	} catch (error) {
		if (error instanceof ViewRuntimeNotFoundError) {
			const result = createNotFoundErrorResult(error.message);
			return c.json(result.body, result.status);
		}

		if (error instanceof ViewRuntimeValidationError) {
			const result = createValidationErrorResult(error.message);
			return c.json(result.body, result.status);
		}

		throw error;
	}
});
