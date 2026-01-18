import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";
import { getQueues } from "~/lib/queue";
import { createEventsJobName } from "./jobs";
import {
	createEventBulkBody,
	createEventBulkResponseSchema,
	listEventsQuery,
	listEventsResponseSchema,
} from "./schemas";
import { listEntityEvents } from "./service";

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
			successDescription:
				"Number of events submitted to the processing queue (not yet created)",
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

		await getQueues().eventsQueue.add(createEventsJobName, {
			body,
			userId: user.id,
		});

		const response = createSuccessResult({ count: body.length });
		return c.json(response.body, response.status);
	});
