import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import type { ServiceResult } from "~/lib/result";
import {
	countVisibleTrackersByIdsForUser,
	createTrackerForUser,
	getOwnedTrackerById,
	getTrackerBySlugForUser,
	listUserTrackerIdsInOrder,
	persistTrackerOrderForUser,
	setTrackerEnabledForUser,
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
	setTrackerEnabledForUser: typeof setTrackerEnabledForUser;
	listUserTrackerIdsInOrder: typeof listUserTrackerIdsInOrder;
	persistTrackerOrderForUser: typeof persistTrackerOrderForUser;
	countVisibleTrackersByIdsForUser: typeof countVisibleTrackersByIdsForUser;
};

export type TrackerServiceResult<T> = ServiceResult<T, TrackerMutationError>;

type TrackerValidationResult<T> = ServiceResult<T, "validation">;

const trackerSlugExistsError = "Tracker slug already exists";
const trackerMissingFieldsError = "At least one field must be provided";
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
	setTrackerEnabledForUser,
	updateTrackerForUser,
};

const createDataResult = <T, E extends string = TrackerMutationError>(
	data: T,
): ServiceResult<T, E> => ({ data });

const createErrorResult = <T>(input: {
	error: TrackerMutationError;
	message: string;
}): TrackerServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const createValidationResult = <T>(
	message: string,
): TrackerValidationResult<T> => ({
	message,
	error: "validation",
});

export const resolveTrackerSlug = (
	input: Pick<CreateTrackerBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		label: "Tracker",
		slug: input.slug,
	});
};

export const resolveTrackerId = (trackerId: string) =>
	resolveRequiredString(trackerId, "Tracker id");

export const resolveTrackerPatch = (input: {
	current: TrackerState;
	input: UpdateTrackerBody;
}) => {
	const name = input.input.name ?? input.current.name;

	return {
		name,
		slug: input.current.slug,
		icon:
			input.input.icon === undefined ? input.current.icon : input.input.icon,
		description:
			input.input.description === undefined
				? input.current.description
				: input.input.description,
		accentColor:
			input.input.accentColor === undefined
				? input.current.accentColor
				: input.input.accentColor,
	};
};

export const buildTrackerOrder = (input: {
	currentTrackerIds: string[];
	requestedTrackerIds: string[];
}) => {
	const requestedTrackerIds = [...new Set(input.requestedTrackerIds)];
	const requestedTrackerSet = new Set(requestedTrackerIds);
	const trailingTrackerIds = input.currentTrackerIds.filter(
		(trackerId) => !requestedTrackerSet.has(trackerId),
	);

	return [...requestedTrackerIds, ...trailingTrackerIds];
};

const resolveTrackerSlugResult = (
	input: Pick<CreateTrackerBody, "name" | "slug">,
): TrackerValidationResult<string> => {
	try {
		return createDataResult(resolveTrackerSlug(input));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Tracker slug is required";
		return createValidationResult(message);
	}
};

const resolveTrackerPatchResult = (input: {
	current: TrackerState;
	input: UpdateTrackerBody;
}): TrackerServiceResult<ReturnType<typeof resolveTrackerPatch>> => {
	try {
		return createDataResult(resolveTrackerPatch(input));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Tracker payload is invalid";
		return createErrorResult({ error: "validation", message });
	}
};

const resolveTrackerIdResult = (
	trackerId: string,
): TrackerServiceResult<string> => {
	try {
		return createDataResult(resolveTrackerId(trackerId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Tracker id is required";
		return createErrorResult({ error: "validation", message });
	}
};

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
		return createValidationResult(trackerSlugExistsError);
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

		return createDataResult(createdTracker);
	} catch (error) {
		if (isUniqueConstraintError(error, trackerUniqueConstraint)) {
			return createValidationResult(trackerSlugExistsError);
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

	const enabled = input.body.enabled;
	const hasEnabledUpdate = enabled !== undefined;
	const hasTrackerConfigUpdate =
		input.body.icon !== undefined ||
		input.body.name !== undefined ||
		input.body.description !== undefined ||
		input.body.accentColor !== undefined;

	if (!hasEnabledUpdate && !hasTrackerConfigUpdate) {
		return createErrorResult({
			error: "validation",
			message: trackerMissingFieldsError,
		});
	}

	if (!hasTrackerConfigUpdate) {
		const updatedTracker = await deps.setTrackerEnabledForUser({
			userId: input.userId,
			enabled: enabled as boolean,
			trackerId: trackerIdResult.data,
		});
		if (!updatedTracker) {
			return createErrorResult({
				error: "not_found",
				message: trackerNotFoundError,
			});
		}

		return createDataResult(updatedTracker);
	}

	const ownedTracker = await deps.getOwnedTrackerById({
		userId: input.userId,
		trackerId: trackerIdResult.data,
	});
	if (!ownedTracker) {
		return createErrorResult({
			error: "not_found",
			message: trackerNotFoundError,
		});
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
		description: patchResult.data.description,
		accentColor: patchResult.data.accentColor,
	});
	if (!updatedTracker) {
		return createErrorResult({
			error: "not_found",
			message: trackerNotFoundError,
		});
	}

	if (!hasEnabledUpdate) {
		return createDataResult(updatedTracker);
	}

	const enabledTracker = await deps.setTrackerEnabledForUser({
		enabled,
		userId: input.userId,
		trackerId: trackerIdResult.data,
	});
	if (!enabledTracker) {
		return createErrorResult({
			error: "not_found",
			message: trackerNotFoundError,
		});
	}

	return createDataResult(enabledTracker);
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
		return createValidationResult(trackerIdsUnknownError);
	}

	const currentTrackerIds = await deps.listUserTrackerIdsInOrder(input.userId);
	const trackerIds = await deps.persistTrackerOrderForUser({
		userId: input.userId,
		trackerIds: buildTrackerOrder({
			currentTrackerIds,
			requestedTrackerIds: input.body.trackerIds,
		}),
	});

	return createDataResult({ trackerIds });
};
