import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";
import {
	countVisibleTrackersByIdsForUser,
	createTrackerForUser,
	getOwnedTrackerById,
	getTrackerBySlugForUser,
	getVisibleTrackerById,
	listTrackersByUser,
	listUserTrackerIdsInOrder,
	persistTrackerOrderForUser,
	setTrackerEnabledForUser,
	updateTrackerForUser,
} from "./repository";
import {
	createTrackerBody,
	createTrackerResponseSchema,
	listTrackersResponseSchema,
	reorderTrackersBody,
	reorderTrackersResponseSchema,
	trackerParams,
	updateTrackerBody,
} from "./schemas";
import {
	buildTrackerOrder,
	resolveTrackerPatch,
	resolveTrackerSlug,
} from "./service";

const ERROR_TRACKER_NOT_FOUND = "Tracker not found";
const ERROR_TRACKER_SLUG_EXISTS = "Tracker slug already exists";
const ERROR_MISSING_FIELDS = "At least one field must be provided";
const trackerNotFoundResult = createNotFoundErrorResult(
	ERROR_TRACKER_NOT_FOUND,
);
const trackerSlugExistsResult = createValidationErrorResult(
	ERROR_TRACKER_SLUG_EXISTS,
);

async function refreshUpdatedTracker(userId: string, trackerId: string) {
	const trackers = await listTrackersByUser(userId);
	const foundTracker = trackers.find((tracker) => tracker.id === trackerId);
	if (!foundTracker) return { error: ERROR_TRACKER_NOT_FOUND };
	return { data: foundTracker };
}

const listTrackersRoute = createAuthRoute(
	createRoute({
		path: "/list",
		method: "get",
		tags: ["trackers"],
		summary: "List trackers available for the user",
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
		method: "post",
		path: "/create",
		tags: ["trackers"],
		summary: "Create and enable a custom tracker",
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
		summary: "Reorder trackers for the user",
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
		return c.json(successResponse(trackers), 200);
	})
	.openapi(createTrackerRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const slugResult = resolveValidationData(
			() => resolveTrackerSlug({ name: body.name, slug: body.slug }),
			"Tracker slug is required",
		);
		if ("status" in slugResult)
			return c.json(slugResult.body, slugResult.status);

		const slug = slugResult.data;

		const existingTracker = await getTrackerBySlugForUser({
			slug,
			userId: user.id,
		});
		if (existingTracker)
			return c.json(
				trackerSlugExistsResult.body,
				trackerSlugExistsResult.status,
			);

		const createdTracker = await createTrackerForUser({
			slug,
			name: body.name,
			userId: user.id,
			icon: body.icon,
			description: body.description,
			accentColor: body.accentColor,
		});

		return c.json(successResponse(createdTracker), 200);
	})
	.openapi(updateTrackerRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");
		const enabled = body.enabled;
		const hasEnabledUpdate = enabled !== undefined;
		const hasTrackerConfigUpdate =
			body.icon !== undefined ||
			body.slug !== undefined ||
			body.name !== undefined ||
			body.description !== undefined ||
			body.accentColor !== undefined;

		if (!hasTrackerConfigUpdate) {
			if (enabled === undefined)
				return c.json(
					createValidationErrorResult(ERROR_MISSING_FIELDS).body,
					400,
				);

			const visibleTracker = await getVisibleTrackerById({
				userId: user.id,
				trackerId: params.trackerId,
			});
			if (!visibleTracker)
				return c.json(trackerNotFoundResult.body, trackerNotFoundResult.status);

			await setTrackerEnabledForUser({
				enabled,
				userId: user.id,
				trackerId: params.trackerId,
			});

			const refreshResult = await refreshUpdatedTracker(
				user.id,
				params.trackerId,
			);
			if ("error" in refreshResult)
				return c.json(trackerNotFoundResult.body, trackerNotFoundResult.status);

			return c.json(successResponse(refreshResult.data), 200);
		}

		const ownedTracker = await getOwnedTrackerById({
			userId: user.id,
			trackerId: params.trackerId,
		});
		if (!ownedTracker)
			return c.json(trackerNotFoundResult.body, trackerNotFoundResult.status);

		const patchResult = resolveValidationData(
			() => resolveTrackerPatch({ current: ownedTracker, input: body }),
			"Tracker slug is required",
		);
		if ("status" in patchResult)
			return c.json(patchResult.body, patchResult.status);

		const patch = patchResult.data;

		const conflictingTracker = await getTrackerBySlugForUser({
			slug: patch.slug,
			userId: user.id,
			excludeTrackerId: params.trackerId,
		});
		if (conflictingTracker)
			return c.json(
				trackerSlugExistsResult.body,
				trackerSlugExistsResult.status,
			);

		const updatedTracker = await updateTrackerForUser({
			name: patch.name,
			slug: patch.slug,
			icon: patch.icon,
			userId: user.id,
			trackerId: params.trackerId,
			description: patch.description,
			accentColor: patch.accentColor,
		});

		if (!hasEnabledUpdate) return c.json(successResponse(updatedTracker), 200);

		await setTrackerEnabledForUser({
			enabled,
			userId: user.id,
			trackerId: params.trackerId,
		});

		const refreshResult = await refreshUpdatedTracker(
			user.id,
			params.trackerId,
		);
		if ("error" in refreshResult)
			return c.json(trackerNotFoundResult.body, trackerNotFoundResult.status);

		return c.json(successResponse(refreshResult.data), 200);
	})
	.openapi(reorderTrackersRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const visibleTrackerCount = await countVisibleTrackersByIdsForUser({
			userId: user.id,
			trackerIds: body.trackerIds,
		});
		if (visibleTrackerCount !== body.trackerIds.length)
			return c.json(
				createValidationErrorResult("Tracker ids contain unknown trackers")
					.body,
				400,
			);

		const currentTrackerIds = await listUserTrackerIdsInOrder(user.id);
		const nextTrackerIds = buildTrackerOrder({
			currentTrackerIds,
			requestedTrackerIds: body.trackerIds,
		});
		const trackerIds = await persistTrackerOrderForUser({
			userId: user.id,
			trackerIds: nextTrackerIds,
		});

		return c.json(successResponse({ trackerIds }), 200);
	});
