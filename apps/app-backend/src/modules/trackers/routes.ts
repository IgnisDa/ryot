import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createSuccessResult,
	createValidationServiceErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
} from "~/lib/openapi";
import { listTrackersByUser } from "./repository";
import {
	createTrackerBody,
	createTrackerResponseSchema,
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
		summary: "List trackers for the authenticated user",
		responses: {
			200: jsonResponse(
				"Trackers available for the user",
				listTrackersResponseSchema,
			),
		},
	}),
);

const createTrackerRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["trackers"],
		summary: "Create a custom tracker",
		request: {
			body: { content: { "application/json": { schema: createTrackerBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse("Tracker was created", createTrackerResponseSchema),
		},
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
			body: { content: { "application/json": { schema: updateTrackerBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Tracker does not exist for this user"),
			200: jsonResponse("Tracker was updated", createTrackerResponseSchema),
		},
	}),
);

const reorderTrackersRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["trackers"],
		path: "/reorder",
		summary: "Reorder visible trackers for the authenticated user",
		request: {
			body: {
				content: { "application/json": { schema: reorderTrackersBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse(
				"Tracker order was updated",
				reorderTrackersResponseSchema,
			),
		},
	}),
);

export const trackersApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listTrackersRoute, async (c) => {
		const user = c.get("user");
		const trackers = await listTrackersByUser(user.id);
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
