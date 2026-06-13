import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { buildDefaultQueryDocument, buildDisplayConfig } from "#lib/builtins/view-helpers";
import { DbRunner, TransactionRunner } from "#lib/db/service";
import { badRequest, conflict, notFound } from "#lib/errors";
import { buildReorderedIds } from "#lib/reorder";
import type { TrackerId, UserId } from "#lib/schema/brands";
import { slugify } from "#lib/slug";
import { trimToNull } from "#lib/validation";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { validateDisplayConfiguration } from "./display-configuration-validation";
import { SavedViewsRepository } from "./repository";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "./schemas";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

type CreateDefaultSavedViewInput = {
	readonly icon: string;
	readonly userId: UserId;
	readonly accentColor: string;
	readonly trackerId: TrackerId;
	readonly entitySchemaName: string;
	readonly entitySchemaSlug: string;
};

const resolveSavedViewName = Effect.fn(function* (name: string) {
	const trimmed = trimToNull(name);
	if (!trimmed) {
		return yield* badRequest("Saved view name is required");
	}
	return trimmed;
});

const resolveSavedViewSlug = Effect.fn(function* (name: string) {
	const slug = name ? slugify(name) : null;
	if (!slug) {
		return yield* badRequest("Saved view slug is required");
	}
	return slug;
});

const ensureBuiltinUpdateIsAllowed = (
	currentView: ListedSavedView,
	payload: UpdateSavedViewBody,
) => {
	if (!currentView.isBuiltin) {
		return Effect.void;
	}

	const attemptsMutation =
		payload.name !== currentView.name ||
		payload.icon !== currentView.icon ||
		(payload.trackerId ?? null) !== currentView.trackerId ||
		payload.accentColor !== currentView.accentColor ||
		!Bun.deepEquals(payload.queryDocument, currentView.queryDocument) ||
		!Bun.deepEquals(payload.displayConfiguration, currentView.displayConfiguration);

	if (attemptsMutation) {
		return badRequest(builtinViewMutationMessage);
	}

	return Effect.void;
};

export class SavedViewsService extends Effect.Service<SavedViewsService>()("SavedViewsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const queryEngine = yield* QueryEngineService;
		const repository = yield* SavedViewsRepository;
		const runInTransaction = yield* TransactionRunner;
		const entitySchemasRepository = yield* EntitySchemasRepository;

		const list = Effect.fn("SavedViewsService.list")(function* (
			user: CurrentUserValue,
			input: { trackerId?: TrackerId; includeDisabled: boolean },
		) {
			return yield* runWithDb(repository.listByUser(user.id, input));
		});

		const get = Effect.fn("SavedViewsService.get")(function* (
			user: CurrentUserValue,
			viewSlug: string,
		) {
			const view = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (!view) {
				return yield* notFound(savedViewNotFound);
			}

			return view;
		});

		const create = Effect.fn("SavedViewsService.create")(function* (
			user: CurrentUserValue,
			payload: CreateSavedViewBody,
		) {
			const name = yield* resolveSavedViewName(payload.name);
			const slug = yield* resolveSavedViewSlug(name);
			yield* queryEngine.validate(user, payload.queryDocument);
			yield* validateDisplayConfiguration({
				doc: payload.queryDocument,
				displayConfig: payload.displayConfiguration,
				loadSchemas: (slugs) =>
					runWithDb(entitySchemasRepository.listVisibleBySlugs(user.id, slugs)),
			});

			const existing = yield* runWithDb(repository.findBySlug(user.id, slug));
			if (existing) {
				return yield* badRequest("A saved view with this name already exists");
			}

			return yield* runWithDb(
				repository.create(user.id, {
					slug,
					name,
					userId: user.id,
					isBuiltin: false,
					icon: payload.icon,
					trackerId: payload.trackerId,
					accentColor: payload.accentColor,
					queryDocument: payload.queryDocument,
					displayConfiguration: payload.displayConfiguration,
				}),
			).pipe(Effect.catchTag("Conflict", (error) => Effect.fail(badRequest(error.message))));
		});

		const createDefaultForSchema = Effect.fn("SavedViewsService.createDefaultForSchema")(function* (
			input: CreateDefaultSavedViewInput,
		) {
			const name = `All ${input.entitySchemaName}s`;
			const slug = slugify(`all ${input.entitySchemaSlug}`);
			const existing = yield* runWithDb(repository.findBySlug(input.userId, slug));
			if (existing) {
				return yield* conflict("Entity schema default saved view already exists");
			}

			return yield* runWithDb(
				repository.create(input.userId, {
					slug,
					name,
					isBuiltin: true,
					icon: input.icon,
					userId: input.userId,
					trackerId: input.trackerId,
					accentColor: input.accentColor,
					displayConfiguration: buildDisplayConfig(input.entitySchemaSlug),
					queryDocument: buildDefaultQueryDocument([input.entitySchemaSlug]),
				}),
			);
		});

		const update = Effect.fn("SavedViewsService.update")(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody,
		) {
			const current = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (!current) {
				return yield* notFound(savedViewNotFound);
			}

			yield* ensureBuiltinUpdateIsAllowed(current, payload);

			if (current.isBuiltin) {
				const updated = yield* runWithDb(
					repository.updateDisabledBySlug(user.id, viewSlug, payload.isDisabled),
				);
				if (!updated) {
					return yield* notFound(savedViewNotFound);
				}
				return updated;
			}

			const name = yield* resolveSavedViewName(payload.name);
			yield* queryEngine.validate(user, payload.queryDocument);
			yield* validateDisplayConfiguration({
				doc: payload.queryDocument,
				displayConfig: payload.displayConfiguration,
				loadSchemas: (slugs) =>
					runWithDb(entitySchemasRepository.listVisibleBySlugs(user.id, slugs)),
			});

			const updated = yield* runWithDb(
				repository.updateBySlug(
					user.id,
					viewSlug,
					{
						name,
						icon: payload.icon,
						trackerId: payload.trackerId,
						isDisabled: payload.isDisabled,
						accentColor: payload.accentColor,
						queryDocument: payload.queryDocument,
						displayConfiguration: payload.displayConfiguration,
					},
					current.trackerId,
				),
			);
			if (!updated) {
				return yield* notFound(savedViewNotFound);
			}

			return updated;
		});

		const deleteView = Effect.fn("SavedViewsService.delete")(function* (
			user: CurrentUserValue,
			viewSlug: string,
		) {
			const current = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (!current) {
				return yield* notFound(savedViewNotFound);
			}
			if (current.isBuiltin) {
				return yield* badRequest(builtinViewMutationMessage);
			}

			const deleted = yield* runWithDb(repository.deleteBySlug(user.id, viewSlug));
			if (!deleted) {
				return yield* notFound(savedViewNotFound);
			}

			return deleted;
		});

		const clone = Effect.fn("SavedViewsService.clone")(function* (
			user: CurrentUserValue,
			viewSlug: string,
		) {
			const source = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (!source) {
				return yield* notFound(savedViewNotFound);
			}
			const clonedName = `${source.name} (Copy)`;
			const name = yield* resolveSavedViewName(clonedName);
			const slug = yield* resolveSavedViewSlug(name);

			return yield* runWithDb(
				repository.create(user.id, {
					slug,
					name,
					userId: user.id,
					isBuiltin: false,
					icon: source.icon,
					trackerId: source.trackerId,
					accentColor: source.accentColor,
					queryDocument: source.queryDocument,
					displayConfiguration: source.displayConfiguration,
				}),
			).pipe(Effect.catchTag("Conflict", (error) => Effect.fail(badRequest(error.message))));
		});

		const reorder = Effect.fn("SavedViewsService.reorder")(function* (
			user: CurrentUserValue,
			payload: ReorderSavedViewsBody,
		) {
			const viewSlugs = payload.viewSlugs.map((s) => s.trim()).filter(Boolean);
			if (viewSlugs.length === 0) {
				return yield* badRequest("View slugs are required");
			}
			if (new Set(viewSlugs).size !== viewSlugs.length) {
				return yield* badRequest("View slugs must be unique");
			}

			return yield* runInTransaction(
				Effect.gen(function* () {
					const count = yield* repository.countBySlugs(user.id, viewSlugs, payload.trackerId);
					if (count !== viewSlugs.length) {
						return yield* badRequest("Saved view slugs contain unknown saved views");
					}

					const currentSlugs = yield* repository.listSlugsInOrder(user.id, payload.trackerId);
					const reorderedSlugs = buildReorderedIds({
						requestedIds: viewSlugs,
						currentIds: currentSlugs,
					});
					const persistedSlugs = yield* repository.persistOrder(
						user.id,
						payload.trackerId,
						reorderedSlugs,
					);

					return { viewSlugs: [...persistedSlugs] };
				}),
			);
		});

		return {
			get,
			list,
			clone,
			create,
			update,
			reorder,
			delete: deleteView,
			createDefaultForSchema,
		};
	}),
}) {}
