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
		responses: createStandardResponses({
			successSchema: listEntitySchemasResponseSchema,
			notFoundDescription: "Tracker does not exist for this user",
			successDescription: "Entity schemas for the requested tracker",
		}),
	}),
);

const createEntitySchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entity-schemas"],
		summary: "Create an entity schema for a custom tracker",
		request: { body: jsonBody(createEntitySchemaBody) },
		responses: createStandardResponses({
			successDescription: "Entity schema was created",
			successSchema: createEntitySchemaResponseSchema,
			notFoundDescription: "Tracker does not exist for this user",
		}),
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
