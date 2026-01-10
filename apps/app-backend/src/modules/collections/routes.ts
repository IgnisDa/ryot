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
	createCollectionBody,
	createCollectionResponseSchema,
} from "./schemas";
import { createCollection } from "./service";

const createCollectionRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["collections"],
		summary: "Create a new collection",
		request: { body: jsonBody(createCollectionBody) },
		description:
			"Create a user-owned collection entity under the built-in collection schema. The membershipPropertiesSchema is validated as a real AppSchema before persistence.",
		responses: createStandardResponses({
			successDescription: "Collection was created",
			successSchema: createCollectionResponseSchema,
		}),
	}),
);

export const collectionsApi = new OpenAPIHono<{
	Variables: AuthType;
}>().openapi(createCollectionRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	const result = await createCollection({ body, userId: user.id });
	if ("error" in result) {
		const response = createServiceErrorResult(result);
		return c.json(response.body, response.status);
	}

	const response = createSuccessResult(result.data);
	return c.json(response.body, response.status);
});
