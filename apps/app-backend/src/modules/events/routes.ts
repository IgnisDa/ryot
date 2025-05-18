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
	createEventBulkBody,
	createEventBulkResponseSchema,
	listEventsQuery,
	listEventsResponseSchema,
} from "./schemas";
import { createEvents, listEntityEvents } from "./service";

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
		summary:
			"Create events for an entity, including built-in media lifecycle actions",
		request: { body: jsonBody(createEventBulkBody) },
		responses: createStandardResponses({
			successSchema: createEventBulkResponseSchema,
			successDescription:
				"Number of events created for the requested entity, including built-in media lifecycle actions",
			notFoundDescription:
				"Entity or event schema does not exist for this user",
		}),
	}),
);

export const eventsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventsRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const result = await listEntityEvents({
			entityId: query.entityId,
			userId: user.id,
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

		const result = await createEvents({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
