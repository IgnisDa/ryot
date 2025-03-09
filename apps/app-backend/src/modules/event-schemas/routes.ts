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
		summary: "List event schemas for a custom entity schema",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Event schemas for the requested entity schema",
				listEventSchemasResponseSchema,
			),
		},
	}),
);

const createEventSchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["event-schemas"],
		summary: "Create an event schema for a custom entity schema",
		request: {
			body: {
				content: { "application/json": { schema: createEventSchemaBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Event schema was created",
				createEventSchemaResponseSchema,
			),
		},
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
