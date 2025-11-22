import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner, TransactionRunner } from "#lib/db";
import { badRequest, conflict, notFound } from "#lib/errors";
import { buildReorderedIds } from "#lib/reorder";
import { slugify } from "#lib/slug";
import { trimToNull } from "#lib/validation";

import { TrackersRepository } from "./repository";
import type { CreateTrackerBody, ReorderTrackersBody, UpdateTrackerBody } from "./schemas";

const resolveOptionalDescription = (description: string | undefined) => {
	if (description === undefined) {
		return undefined;
	}

	const trimmed = description.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const resolveCreatePayload = (payload: CreateTrackerBody) => {
	const name = trimToNull(payload.name);
	const icon = trimToNull(payload.icon);
	const accentColor = trimToNull(payload.accentColor);
	const description = resolveOptionalDescription(payload.description);

	const candidate = payload.slug?.trim() ?? name;
	const slug = candidate ? slugify(candidate) : null;

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

	return Effect.succeed({ slug, name, icon, description, accentColor });
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
		input.payload.name === undefined ? input.current.name : trimToNull(input.payload.name);
	const icon =
		input.payload.icon === undefined ? input.current.icon : trimToNull(input.payload.icon);
	const accentColor =
		input.payload.accentColor === undefined
			? input.current.accentColor
			: trimToNull(input.payload.accentColor);

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
		return Effect.succeed({ name, icon, description, accentColor, slug: input.current.slug });
	}

	return Effect.succeed({
		name,
		icon,
		accentColor,
		slug: input.current.slug,
		description:
			input.payload.description === undefined
				? input.current.description
				: input.payload.description,
	});
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

	return Effect.succeed(normalizedIds);
};

export class TrackersService extends Effect.Service<TrackersService>()("TrackersService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* TrackersRepository;
		const runInTransaction = yield* TransactionRunner;

		return {
			list: Effect.fn("TrackersService.list")(function* (
				user: CurrentUserValue,
				includeDisabled: boolean,
			) {
				return yield* runWithDb(repository.listByUser(user.id, includeDisabled));
			}),
			create: Effect.fn("TrackersService.create")(function* (
				user: CurrentUserValue,
				payload: CreateTrackerBody,
			) {
				const resolvedPayload = yield* resolveCreatePayload(payload);

				const existing = yield* runWithDb(repository.findBySlug(user.id, resolvedPayload.slug));
				if (existing) {
					return yield* conflict("Tracker slug already exists");
				}

				return yield* runWithDb(repository.create(user.id, resolvedPayload));
			}),
			update: Effect.fn("TrackersService.update")(function* (
				user: CurrentUserValue,
				trackerId: string,
				payload: UpdateTrackerBody,
			) {
				const resolvedTrackerId = trimToNull(trackerId);
				if (!resolvedTrackerId) {
					return yield* badRequest("Tracker id is required");
				}

				const current = yield* runWithDb(repository.getOwnedById(user.id, resolvedTrackerId));
				if (!current) {
					return yield* notFound("Tracker not found");
				}

				const resolvedPayload = yield* resolveUpdatePayload({ current, payload });

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
			reorder: Effect.fn("TrackersService.reorder")(function* (
				user: CurrentUserValue,
				payload: ReorderTrackersBody,
			) {
				const trackerIds = yield* resolveTrackerIds(payload.trackerIds);

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
}) {}
