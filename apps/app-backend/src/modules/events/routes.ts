import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";

import {
	createEventBulkBody,
	createEventBulkResponseSchema,
	listEventsQuery,
	listEventsResponseSchema,
} from "./schemas";
import { enqueueEventsForUser, listEntityEvents } from "./service";

const listEventsRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["events"],
		request: { query: listEventsQuery },
		summary: "List events for an entity",
		responses: createStandardResponses({
			successDescription:
				"Events for the requested entity, including built-in media lifecycle actions",
			successSchema: listEventsResponseSchema,
			notFoundDescription: "Entity does not exist for this user",
		}),
	}),
);

const createEventRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["events"],
		request: { body: jsonBody(createEventBulkBody) },
		summary:
			"Enqueue events for an entity for async processing, including built-in media lifecycle actions",
		responses: createStandardResponses({
			successSchema: createEventBulkResponseSchema,
			successDescription: "Number of events submitted to the processing queue (not yet created)",
		}),
	}),
);

export const eventsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventsRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const result = await listEntityEvents({
			userId: user.id,
			entityId: query.entityId,
			sessionEntityId: query.sessionEntityId,
			eventSchemaSlug: query.eventSchemaSlug,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createEventRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await enqueueEventsForUser({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
