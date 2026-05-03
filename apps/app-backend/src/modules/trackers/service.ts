import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";

import { isUniqueConstraintError } from "~/lib/app/postgres";
import { buildReorderedIds } from "~/lib/reorder";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";

import {
	countVisibleTrackersByIdsForUser,
	createTrackerForUser,
	getOwnedTrackerById,
	getTrackerBySlugForUser,
	listUserTrackerIdsInOrder,
	persistTrackerOrderForUser,
	updateTrackerForUser,
} from "./repository";
import type {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	UpdateTrackerBody,
} from "./schemas";

type TrackerState = {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	description: string | null;
};

type TrackerMutationError = "not_found" | "validation";

export type TrackerServiceDeps = {
	getOwnedTrackerById: typeof getOwnedTrackerById;
	createTrackerForUser: typeof createTrackerForUser;
	updateTrackerForUser: typeof updateTrackerForUser;
	getTrackerBySlugForUser: typeof getTrackerBySlugForUser;
	listUserTrackerIdsInOrder: typeof listUserTrackerIdsInOrder;
	persistTrackerOrderForUser: typeof persistTrackerOrderForUser;
	countVisibleTrackersByIdsForUser: typeof countVisibleTrackersByIdsForUser;
};

export type TrackerServiceResult<T> = ServiceResult<T, TrackerMutationError>;

type TrackerValidationResult<T> = ServiceResult<T, "validation">;

const trackerSlugExistsError = "Tracker slug already exists";
const trackerNotFoundError = "Tracker not found";
const trackerIdsUnknownError = "Tracker ids contain unknown trackers";
const trackerUniqueConstraint = "tracker_user_slug_unique";

const trackerServiceDeps: TrackerServiceDeps = {
	createTrackerForUser,
	countVisibleTrackersByIdsForUser,
	getOwnedTrackerById,
	getTrackerBySlugForUser,
	listUserTrackerIdsInOrder,
	persistTrackerOrderForUser,
	updateTrackerForUser,
};

export const resolveTrackerSlug = (input: Pick<CreateTrackerBody, "name" | "slug">) => {
	return resolveRequiredSlug({
		name: input.name,
		label: "Tracker",
		slug: input.slug,
	});
};

export const resolveTrackerId = (trackerId: string) =>
	resolveRequiredString(trackerId, "Tracker id");

export const resolveTrackerPatch = (input: { current: TrackerState; input: UpdateTrackerBody }) => {
	const name = input.input.name ?? input.current.name;

	return {
		name,
		slug: input.current.slug,
		icon: input.input.icon === undefined ? input.current.icon : input.input.icon,
		description:
			input.input.description === undefined ? input.current.description : input.input.description,
		accentColor:
			input.input.accentColor === undefined ? input.current.accentColor : input.input.accentColor,
	};
};

export const buildTrackerOrder = (input: {
	currentTrackerIds: string[];
	requestedTrackerIds: string[];
}) =>
	buildReorderedIds({
		currentIds: input.currentTrackerIds,
		requestedIds: input.requestedTrackerIds,
	});

const resolveTrackerSlugResult = (input: Pick<CreateTrackerBody, "name" | "slug">) =>
	wrapServiceValidator(() => resolveTrackerSlug(input), "Tracker slug is required");

const resolveTrackerPatchResult = (input: { current: TrackerState; input: UpdateTrackerBody }) =>
	wrapServiceValidator(() => resolveTrackerPatch(input), "Tracker payload is invalid");

const resolveTrackerIdResult = (trackerId: string) =>
	wrapServiceValidator(() => resolveTrackerId(trackerId), "Tracker id is required");

export const createTracker = async (
	input: { body: CreateTrackerBody; userId: string },
	deps: TrackerServiceDeps = trackerServiceDeps,
): Promise<TrackerValidationResult<ListedTracker>> => {
	const slugResult = resolveTrackerSlugResult({
		name: input.body.name,
		slug: input.body.slug,
	});
	if ("error" in slugResult) {
		return slugResult;
	}

	const existingTracker = await deps.getTrackerBySlugForUser({
		slug: slugResult.data,
		userId: input.userId,
	});
	if (existingTracker) {
		return serviceError("validation", trackerSlugExistsError);
	}

	try {
		const createdTracker = await deps.createTrackerForUser({
			slug: slugResult.data,
			name: input.body.name,
			userId: input.userId,
			icon: input.body.icon,
			description: input.body.description,
			accentColor: input.body.accentColor,
		});

		return serviceData(createdTracker);
	} catch (error) {
		if (isUniqueConstraintError(error, trackerUniqueConstraint)) {
			return serviceError("validation", trackerSlugExistsError);
		}

		throw error;
	}
};

export const updateTracker = async (
	input: { body: UpdateTrackerBody; userId: string; trackerId: string },
	deps: TrackerServiceDeps = trackerServiceDeps,
): Promise<TrackerServiceResult<ListedTracker>> => {
	const trackerIdResult = resolveTrackerIdResult(input.trackerId);
	if ("error" in trackerIdResult) {
		return trackerIdResult;
	}

	const ownedTracker = await deps.getOwnedTrackerById({
		userId: input.userId,
		trackerId: trackerIdResult.data,
	});
	if (!ownedTracker) {
		return serviceError("not_found", trackerNotFoundError);
	}

	const patchResult = resolveTrackerPatchResult({
		input: input.body,
		current: ownedTracker,
	});
	if ("error" in patchResult) {
		return patchResult;
	}

	const updatedTracker = await deps.updateTrackerForUser({
		userId: input.userId,
		name: patchResult.data.name,
		slug: patchResult.data.slug,
		icon: patchResult.data.icon,
		trackerId: trackerIdResult.data,
		isDisabled: input.body.isDisabled,
		description: patchResult.data.description,
		accentColor: patchResult.data.accentColor,
	});
	if (!updatedTracker) {
		return serviceError("not_found", trackerNotFoundError);
	}

	return serviceData(updatedTracker);
};

export const reorderTrackers = async (
	input: { body: ReorderTrackersBody; userId: string },
	deps: TrackerServiceDeps = trackerServiceDeps,
): Promise<TrackerValidationResult<{ trackerIds: string[] }>> => {
	const visibleTrackerCount = await deps.countVisibleTrackersByIdsForUser({
		userId: input.userId,
		trackerIds: input.body.trackerIds,
	});
	if (visibleTrackerCount !== input.body.trackerIds.length) {
		return serviceError("validation", trackerIdsUnknownError);
	}

	const currentTrackerIds = await deps.listUserTrackerIdsInOrder(input.userId);
	const trackerIds = await deps.persistTrackerOrderForUser({
		userId: input.userId,
		trackerIds: buildTrackerOrder({
			currentTrackerIds,
			requestedTrackerIds: input.body.trackerIds,
		}),
	});

	return serviceData({ trackerIds });
};
