import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { DisplayConfiguration } from "@ryot/contract/display-configuration";
import { DbError, badRequest, conflict, notFound } from "@ryot/contract/errors";
import type { BadRequest, Conflict } from "@ryot/contract/errors";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import type { TrackerId, UserId } from "@ryot/contract/schema/brands";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine";
import { Effect, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { buildReorderedIds } from "#lib/shared/reorder";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { buildDefaultDisplayConfig } from "#modules/builtins/view-helpers";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { validateDisplayConfiguration } from "./display-configuration-validation";
import { SavedViewsRepository } from "./repository";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";
const savedViewDuplicateMessage = "A saved view with this name already exists";
const queryDocumentEquals = Schema.equivalence(QueryDocument);
const displayConfigurationEquals = Schema.equivalence(DisplayConfiguration);

const mapDefaultSavedViewCreateError = (
	error: BadRequest | Conflict | DbError,
): Conflict | DbError => {
	if (error._tag !== "BadRequest") {
		return error;
	}
	if (error.message === savedViewDuplicateMessage) {
		return conflict("Entity schema default saved view already exists");
	}
	return new DbError({ message: error.message });
};

type SavedViewUser = Pick<CurrentUserValue, "id">;

type CreateSavedViewInput = CreateSavedViewBody & {
	readonly isBuiltin?: boolean | undefined;
	readonly slug?: string | undefined;
};

type UpdateSavedViewInput = UpdateSavedViewBody & {
	readonly sortOrder?: number | undefined;
};

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
	payload: UpdateSavedViewInput,
) => {
	if (!currentView.isBuiltin) {
		return Effect.void;
	}

	const attemptsMutation =
		payload.name !== currentView.name ||
		payload.icon !== currentView.icon ||
		(payload.trackerId ?? null) !== currentView.trackerId ||
		payload.accentColor !== currentView.accentColor ||
		!queryDocumentEquals(payload.queryDocument, currentView.queryDocument) ||
		!displayConfigurationEquals(payload.displayConfiguration, currentView.displayConfiguration);

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

		const requireSavedView = Effect.fn("SavedViewsService.requireSavedView")(function* (
			user: CurrentUserValue,
			viewSlug: string,
		) {
			const view = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (!view) {
				return yield* notFound(savedViewNotFound);
			}

			return view;
		});

		const list = Effect.fn("SavedViewsService.list")(function* (
			user: CurrentUserValue,
			input: { trackerId?: TrackerId | undefined; includeDisabled: boolean },
		) {
			return yield* runWithDb(repository.listByUser(user.id, input));
		});

		const get = Effect.fn("SavedViewsService.get")(function* (
			user: CurrentUserValue,
			viewSlug: string,
		) {
			return yield* requireSavedView(user, viewSlug);
		});

		const create = Effect.fn("SavedViewsService.create")(function* (
			user: SavedViewUser,
			payload: CreateSavedViewInput,
		) {
			const name = yield* resolveSavedViewName(payload.name);
			const slug = yield* resolveSavedViewSlug(payload.slug ?? name);
			const isBuiltin = payload.isBuiltin ?? false;
			yield* queryEngine.validate(user, payload.queryDocument);
			yield* validateDisplayConfiguration({
				doc: payload.queryDocument,
				displayConfig: payload.displayConfiguration,
				loadSchemas: (slugs) =>
					runWithDb(entitySchemasRepository.listVisibleBySlugs(user.id, slugs)),
			});

			const existing = yield* runWithDb(repository.findBySlug(user.id, slug));
			if (existing) {
				return yield* badRequest(savedViewDuplicateMessage);
			}

			return yield* runWithDb(
				repository.create(user.id, {
					slug,
					name,
					userId: user.id,
					isBuiltin,
					icon: payload.icon,
					trackerId: payload.trackerId,
					accentColor: payload.accentColor,
					queryDocument: payload.queryDocument,
					displayConfiguration: payload.displayConfiguration,
				}),
			).pipe(
				Effect.flatMap((created) =>
					created ? Effect.succeed(created) : badRequest(savedViewDuplicateMessage),
				),
			);
		});

		const createDefaultForSchema = Effect.fn("SavedViewsService.createDefaultForSchema")(function* (
			input: CreateDefaultSavedViewInput,
		) {
			const name = `All ${input.entitySchemaName}s`;
			const slug = yield* resolveSavedViewSlug(slugify(`all ${input.entitySchemaSlug}`)).pipe(
				Effect.mapError((error) => new DbError({ message: error.message })),
			);
			const existing = yield* runWithDb(repository.findBySlug(input.userId, slug));
			if (existing) {
				return yield* conflict("Entity schema default saved view already exists");
			}

			return yield* create(
				{ id: input.userId },
				{
					accentColor: input.accentColor,
					displayConfiguration: buildDefaultDisplayConfig(input.entitySchemaSlug),
					icon: input.icon,
					isBuiltin: true,
					name,
					queryDocument: buildDefaultSavedViewQueryDocument({
						schemas: [input.entitySchemaSlug],
					}),
					slug,
					trackerId: input.trackerId,
				},
			).pipe(Effect.mapError(mapDefaultSavedViewCreateError));
		});

		const update = Effect.fn("SavedViewsService.update")(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewInput,
		) {
			const current = yield* requireSavedView(user, viewSlug);

			yield* ensureBuiltinUpdateIsAllowed(current, payload);

			if (current.isBuiltin) {
				const updated = yield* runWithDb(
					repository.updateDisabledBySlug(user.id, viewSlug, payload.isDisabled, payload.sortOrder),
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
						sortOrder: payload.sortOrder,
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
			const current = yield* requireSavedView(user, viewSlug);
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
			const source = yield* requireSavedView(user, viewSlug);
			const clonedName = `${source.name} (Copy)`;

			return yield* create(user, {
				accentColor: source.accentColor,
				displayConfiguration: source.displayConfiguration,
				icon: source.icon,
				name: clonedName,
				queryDocument: source.queryDocument,
				...(source.trackerId ? { trackerId: source.trackerId } : {}),
			});
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

					const currentViews = yield* repository.listInOrder(user.id, payload.trackerId);
					const currentSlugs = currentViews.map((view) => view.slug);
					const reorderedSlugs = buildReorderedIds({
						requestedIds: viewSlugs,
						currentIds: currentSlugs,
					});
					const viewsBySlug = new Map(currentViews.map((view) => [view.slug, view]));

					for (const [sortOrder, viewSlug] of reorderedSlugs.entries()) {
						const currentView = viewsBySlug.get(viewSlug);
						if (!currentView) {
							return yield* badRequest("Saved view slugs contain unknown saved views");
						}
						if (currentView.sortOrder === sortOrder) {
							continue;
						}

						yield* update(user, viewSlug, {
							accentColor: currentView.accentColor,
							displayConfiguration: currentView.displayConfiguration,
							icon: currentView.icon,
							isDisabled: currentView.isDisabled,
							name: currentView.name,
							queryDocument: currentView.queryDocument,
							sortOrder,
							...(currentView.trackerId ? { trackerId: currentView.trackerId } : {}),
						}).pipe(
							Effect.catchTag("NotFound", () =>
								Effect.fail(badRequest("Saved view slugs contain unknown saved views")),
							),
						);
					}

					return { viewSlugs: [...reorderedSlugs] };
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
