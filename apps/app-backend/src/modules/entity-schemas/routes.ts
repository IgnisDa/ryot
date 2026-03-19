import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createSuccessResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
} from "~/lib/openapi";
import {
	createEntitySchemaBody,
	createEntitySchemaResponseSchema,
	listEntitySchemasQuery,
	listEntitySchemasResponseSchema,
} from "./schemas";
import { createEntitySchema, listEntitySchemas } from "./service";

const listEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["entity-schemas"],
		request: { query: listEntitySchemasQuery },
		summary: "List entity schemas for a tracker",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Tracker does not exist for this user"),
			200: jsonResponse(
				"Entity schemas for the requested tracker",
				listEntitySchemasResponseSchema,
			),
		},
	}),
);

const createEntitySchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entity-schemas"],
		summary: "Create an entity schema for a custom tracker",
		request: {
			body: {
				content: { "application/json": { schema: createEntitySchemaBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Tracker does not exist for this user"),
			200: jsonResponse(
				"Entity schema was created",
				createEntitySchemaResponseSchema,
			),
		},
	}),
);

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const result = await listEntitySchemas({
			userId: user.id,
			trackerId: query.trackerId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createEntitySchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createEntitySchema({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
