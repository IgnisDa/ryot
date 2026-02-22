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
	createEventSchemaBody,
	createEventSchemaResponseSchema,
	listEventSchemasQuery,
	listEventSchemasResponseSchema,
} from "./schemas";
import { createEventSchema, listEventSchemas } from "./service";

const listEventSchemasRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["event-schemas"],
		request: { query: listEventSchemasQuery },
		summary: "List visible event schemas for an entity schema",
		responses: createStandardResponses({
			successSchema: listEventSchemasResponseSchema,
			notFoundDescription: "Entity schema does not exist for this user",
			successDescription:
				"Event schemas visible for the requested entity schema, including seeded built-in media lifecycle schemas",
		}),
	}),
);

const createEventSchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["event-schemas"],
		request: { body: jsonBody(createEventSchemaBody) },
		summary: "Create an event schema for a custom entity schema",
		responses: createStandardResponses({
			successDescription: "Event schema was created",
			successSchema: createEventSchemaResponseSchema,
			notFoundDescription: "Entity schema does not exist for this user",
		}),
	}),
);

export const eventSchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventSchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const result = await listEventSchemas({
			entitySchemaId: query.entitySchemaId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createEventSchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createEventSchema({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
