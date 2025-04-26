import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	createValidationServiceErrorResult,
	jsonBody,
} from "~/lib/openapi";
import { listTrackersByUser } from "./repository";
import {
	createTrackerBody,
	createTrackerResponseSchema,
	listTrackersQuery,
	listTrackersResponseSchema,
	reorderTrackersBody,
	reorderTrackersResponseSchema,
	trackerParams,
	updateTrackerBody,
} from "./schemas";
import { createTracker, reorderTrackers, updateTracker } from "./service";

const listTrackersRoute = createAuthRoute(
	createRoute({
		path: "",
		method: "get",
		tags: ["trackers"],
		request: { query: listTrackersQuery },
		summary: "List trackers for the authenticated user",
		responses: createStandardResponses({
			successSchema: listTrackersResponseSchema,
			successDescription: "Trackers available for the user",
		}),
	}),
);

const createTrackerRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["trackers"],
		summary: "Create a custom tracker",
		request: { body: jsonBody(createTrackerBody) },
		responses: createStandardResponses({
			successDescription: "Tracker was created",
			successSchema: createTrackerResponseSchema,
		}),
	}),
);

const updateTrackerRoute = createAuthRoute(
	createRoute({
		method: "patch",
		tags: ["trackers"],
		path: "/{trackerId}",
		summary: "Update a tracker",
		request: {
			params: trackerParams,
			body: jsonBody(updateTrackerBody),
		},
		responses: createStandardResponses({
			successDescription: "Tracker was updated",
			successSchema: createTrackerResponseSchema,
			notFoundDescription: "Tracker does not exist for this user",
		}),
	}),
);

const reorderTrackersRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["trackers"],
		path: "/reorder",
		summary: "Reorder visible trackers for the authenticated user",
		request: { body: jsonBody(reorderTrackersBody) },
		responses: createStandardResponses({
			successSchema: reorderTrackersResponseSchema,
			successDescription: "Tracker order was updated",
		}),
	}),
);

export const trackersApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listTrackersRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const trackers = await listTrackersByUser(user.id, query.includeDisabled);
		const response = createSuccessResult(trackers);
		return c.json(response.body, response.status);
	})
	.openapi(createTrackerRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createTracker({ body, userId: user.id });
		if ("error" in result) {
			const response = createValidationServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(updateTrackerRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const result = await updateTracker({
			body,
			userId: user.id,
			trackerId: params.trackerId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(reorderTrackersRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await reorderTrackers({ body, userId: user.id });
		if ("error" in result) {
			const response = createValidationServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
