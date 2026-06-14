import { Context, Effect, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { CurrentDb, DbService, TransactionRunner } from "../../lib/db";
import type { Conflict, DbError, NotFound } from "../../lib/errors";
import { BadRequest, badRequest, conflict, notFound } from "../../lib/errors";
import { buildReorderedIds } from "../../lib/reorder";
import { TrackersRepository } from "./repository";
import type {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	ReorderTrackersResponse,
	UpdateTrackerBody,
} from "./schemas";

const normalizeSlug = (value: string): string =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

const resolveRequiredText = (value: string) => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const resolveRequiredTrackerId = (trackerId: string) => {
	const resolvedTrackerId = trackerId.trim();
	return resolvedTrackerId.length > 0 ? resolvedTrackerId : null;
};

const resolveOptionalDescription = (description: string | undefined) => {
	if (description === undefined) {
		return undefined;
	}

	const trimmed = description.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const resolveCreatePayload = (payload: CreateTrackerBody) => {
	const name = resolveRequiredText(payload.name);
	const icon = resolveRequiredText(payload.icon);
	const accentColor = resolveRequiredText(payload.accentColor);
	const description = resolveOptionalDescription(payload.description);

	const candidate = payload.slug?.trim() ?? name;
	const slug = candidate ? normalizeSlug(candidate) : null;

	if (!name) {
		return badRequest("Tracker name is required");
	}

	if (!icon) {
		return badRequest("Icon is required");
	}

	if (!accentColor) {
		return badRequest("Accent color is required");
	}

	if (payload.description !== undefined && description === null) {
		return badRequest("Description is required");
	}

	if (!slug) {
		return badRequest("Tracker slug is required");
	}

	return { slug, name, icon, description, accentColor };
};

const resolveUpdatePayload = (input: {
	readonly current: {
		readonly slug: string;
		readonly name: string;
		readonly icon: string;
		readonly accentColor: string;
		readonly description: string | null;
	};
	readonly payload: UpdateTrackerBody;
}) => {
	const hasConfigUpdate =
		input.payload.icon !== undefined ||
		input.payload.name !== undefined ||
		input.payload.description !== undefined ||
		input.payload.accentColor !== undefined;

	if (hasConfigUpdate && input.payload.icon === undefined) {
		return badRequest("Icon is required");
	}

	if (hasConfigUpdate && input.payload.accentColor === undefined) {
		return badRequest("Accent color is required");
	}

	const name =
		input.payload.name === undefined ? input.current.name : resolveRequiredText(input.payload.name);
	const icon =
		input.payload.icon === undefined ? input.current.icon : resolveRequiredText(input.payload.icon);
	const accentColor =
		input.payload.accentColor === undefined
			? input.current.accentColor
			: resolveRequiredText(input.payload.accentColor);

	if (!name) {
		return badRequest("Tracker name is required");
	}

	if (!icon) {
		return badRequest("Icon is required");
	}

	if (!accentColor) {
		return badRequest("Accent color is required");
	}

	if (typeof input.payload.description === "string") {
		const description = resolveOptionalDescription(input.payload.description);
		if (description === null || description === undefined) {
			return badRequest("Description is required");
		}
		return { name, icon, description, accentColor, slug: input.current.slug };
	}

	return {
		name,
		icon,
		accentColor,
		slug: input.current.slug,
		description:
			input.payload.description === undefined
				? input.current.description
				: input.payload.description,
	};
};

const resolveTrackerIds = (trackerIds: ReadonlyArray<string>) => {
	if (trackerIds.length === 0) {
		return badRequest("Tracker ids are required");
	}

	const normalizedIds = trackerIds.map((trackerId) => trackerId.trim());
	if (normalizedIds.some((trackerId) => trackerId.length === 0)) {
		return badRequest("Tracker ids are required");
	}

	if (new Set(normalizedIds).size !== normalizedIds.length) {
		return badRequest("Tracker ids must be unique");
	}

	return normalizedIds;
};

export class TrackersService extends Context.Tag("TrackersService")<
	TrackersService,
	{
		readonly list: (
			user: CurrentUserValue,
			includeDisabled: boolean,
		) => Effect.Effect<ReadonlyArray<ListedTracker>, DbError>;
		readonly create: (
			user: CurrentUserValue,
			payload: CreateTrackerBody,
		) => Effect.Effect<ListedTracker, BadRequest | Conflict | DbError>;
		readonly update: (
			user: CurrentUserValue,
			trackerId: string,
			payload: UpdateTrackerBody,
		) => Effect.Effect<ListedTracker, BadRequest | DbError | NotFound>;
		readonly reorder: (
			user: CurrentUserValue,
			payload: ReorderTrackersBody,
		) => Effect.Effect<ReorderTrackersResponse, BadRequest | DbError>;
	}
>() {}

export const TrackersServiceLive = Layer.effect(
	TrackersService,
	Effect.gen(function* () {
		const db = yield* DbService;
		const repository = yield* TrackersRepository;
		const runInTransaction = yield* TransactionRunner;

		const runWithDb = <A, E>(effect: Effect.Effect<A, E, CurrentDb>) =>
			effect.pipe(Effect.provideService(CurrentDb, db.db));

		return {
			list: (user, includeDisabled) => runWithDb(repository.listByUser(user.id, includeDisabled)),
			create: (user, payload) =>
				Effect.gen(function* () {
					const resolvedPayload = resolveCreatePayload(payload);
					if (resolvedPayload instanceof BadRequest) {
						return yield* resolvedPayload;
					}

					const existing = yield* runWithDb(repository.findBySlug(user.id, resolvedPayload.slug));
					if (existing) {
						return yield* conflict("Tracker slug already exists");
					}

					return yield* runWithDb(repository.create(user.id, resolvedPayload));
				}),
			update: (user, trackerId, payload) =>
				Effect.gen(function* () {
					const resolvedTrackerId = resolveRequiredTrackerId(trackerId);
					if (!resolvedTrackerId) {
						return yield* badRequest("Tracker id is required");
					}

					const current = yield* runWithDb(repository.getOwnedById(user.id, resolvedTrackerId));
					if (!current) {
						return yield* notFound("Tracker not found");
					}

					const resolvedPayload = resolveUpdatePayload({ current, payload });
					if (resolvedPayload instanceof BadRequest) {
						return yield* resolvedPayload;
					}

					const updated = yield* runWithDb(
						repository.updateOwned({
							userId: user.id,
							trackerId: resolvedTrackerId,
							isDisabled: payload.isDisabled,
							...resolvedPayload,
						}),
					);
					if (!updated) {
						return yield* notFound("Tracker not found");
					}

					return updated;
				}),
			reorder: (user, payload) =>
				Effect.gen(function* () {
					const trackerIds = resolveTrackerIds(payload.trackerIds);
					if (trackerIds instanceof BadRequest) {
						return yield* trackerIds;
					}

					return yield* runInTransaction(
						Effect.gen(function* () {
							const visibleTrackerCount = yield* repository.countOwnedByIds(user.id, trackerIds);
							if (visibleTrackerCount !== trackerIds.length) {
								return yield* badRequest("Tracker ids contain unknown trackers");
							}

							const currentTrackerIds = yield* repository.listIdsInOrder(user.id);
							const reorderedTrackerIds = buildReorderedIds({
								requestedIds: trackerIds,
								currentIds: currentTrackerIds,
							});
							const persistedTrackerIds = yield* repository.persistOrder(
								user.id,
								reorderedTrackerIds,
							);

							return { trackerIds: [...persistedTrackerIds] };
						}),
					);
				}),
		};
	}),
);
