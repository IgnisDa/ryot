import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner, TransactionRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import { buildReorderedIds } from "#lib/reorder";
import type { TrackerId } from "#lib/schema/brands";
import { slugify } from "#lib/slug";
import { trimToNull } from "#lib/validation";
import { QueryEngineService } from "#modules/query-engine/service";

import { SavedViewsRepository } from "./repository";
import type { CreateSavedViewBody, ReorderSavedViewsBody, UpdateSavedViewBody } from "./schemas";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

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

const normalizeSavedViewQueryDefinition = (
	queryDefinition: CreateSavedViewBody["queryDefinition"],
) => ({
	mode: "entities" as const,
	sort: queryDefinition.sort,
	scope: [...queryDefinition.scope],
	filter: queryDefinition.filter ?? null,
	eventJoins: [...(queryDefinition.eventJoins ?? [])],
	computedFields: [...(queryDefinition.computedFields ?? [])],
	relationshipJoins: [...(queryDefinition.relationshipJoins ?? [])],
});

const ensureBuiltinUpdateIsAllowed = (
	currentView: {
		name: string;
		icon: string;
		isBuiltin: boolean;
		accentColor: string;
		trackerId: TrackerId | null;
		queryDefinition: unknown;
		displayConfiguration: unknown;
	},
	payload: UpdateSavedViewBody,
) => {
	if (!currentView.isBuiltin) {
		return Effect.void;
	}

	const nextQueryDefinition = normalizeSavedViewQueryDefinition(payload.queryDefinition);

	const attemptsMutation =
		payload.name !== currentView.name ||
		payload.icon !== currentView.icon ||
		(payload.trackerId ?? null) !== currentView.trackerId ||
		payload.accentColor !== currentView.accentColor ||
		!Bun.deepEquals(nextQueryDefinition, currentView.queryDefinition) ||
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

		return {
			list: Effect.fn("SavedViewsService.list")(function* (
				user: CurrentUserValue,
				input: { trackerId?: TrackerId; includeDisabled: boolean },
			) {
				return yield* runWithDb(repository.listByUser(user.id, input));
			}),
			get: Effect.fn("SavedViewsService.get")(function* (user: CurrentUserValue, viewSlug: string) {
				const view = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
				if (!view) {
					return yield* notFound(savedViewNotFound);
				}

				return view;
			}),
			create: Effect.fn("SavedViewsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateSavedViewBody,
			) {
				const name = yield* resolveSavedViewName(payload.name);
				const slug = yield* resolveSavedViewSlug(name);
				const queryDefinition = normalizeSavedViewQueryDefinition(payload.queryDefinition);

				const existing = yield* runWithDb(repository.findBySlug(user.id, slug));
				if (existing) {
					return yield* badRequest("A saved view with this name already exists");
				}

				yield* queryEngine.validateSavedView(user, {
					queryDefinition,
					displayConfiguration: payload.displayConfiguration,
				});

				const created = yield* runWithDb(
					repository.create(user.id, {
						slug,
						name,
						userId: user.id,
						queryDefinition,
						isBuiltin: false,
						icon: payload.icon,
						trackerId: payload.trackerId,
						accentColor: payload.accentColor,
						displayConfiguration: payload.displayConfiguration,
					}),
				);

				return created;
			}),
			update: Effect.fn("SavedViewsService.update")(function* (
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
				const queryDefinition = normalizeSavedViewQueryDefinition(payload.queryDefinition);

				yield* queryEngine.validateSavedView(user, {
					queryDefinition,
					displayConfiguration: payload.displayConfiguration,
				});

				const updated = yield* runWithDb(
					repository.updateBySlug(
						user.id,
						viewSlug,
						{
							name,
							queryDefinition,
							icon: payload.icon,
							trackerId: payload.trackerId,
							isDisabled: payload.isDisabled,
							accentColor: payload.accentColor,
							displayConfiguration: payload.displayConfiguration,
						},
						current.trackerId,
					),
				);
				if (!updated) {
					return yield* notFound(savedViewNotFound);
				}

				return updated;
			}),
			delete: Effect.fn("SavedViewsService.delete")(function* (
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
			}),
			clone: Effect.fn("SavedViewsService.clone")(function* (
				user: CurrentUserValue,
				viewSlug: string,
			) {
				const source = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
				if (!source) {
					return yield* notFound(savedViewNotFound);
				}
				const queryDefinition = normalizeSavedViewQueryDefinition(source.queryDefinition);

				const clonedName = `${source.name} (Copy)`;
				const name = yield* resolveSavedViewName(clonedName);
				const slug = yield* resolveSavedViewSlug(name);

				yield* queryEngine.validateSavedView(user, {
					queryDefinition,
					displayConfiguration: source.displayConfiguration,
				});

				const created = yield* runWithDb(
					repository.create(user.id, {
						slug,
						name,
						userId: user.id,
						queryDefinition,
						isBuiltin: false,
						icon: source.icon,
						trackerId: source.trackerId,
						accentColor: source.accentColor,
						displayConfiguration: source.displayConfiguration,
					}),
				);

				return created;
			}),
			reorder: Effect.fn("SavedViewsService.reorder")(function* (
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
			}),
		};
	}),
}) {}
