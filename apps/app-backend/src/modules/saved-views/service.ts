import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner, TransactionRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import { buildReorderedIds } from "#lib/reorder";
import { slugify } from "#lib/slug";
import { trimToNull } from "#lib/validation";

import { SavedViewsRepository } from "./repository";
import type { CreateSavedViewBody, ReorderSavedViewsBody, UpdateSavedViewBody } from "./schemas";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

const resolveSavedViewName = (name: string) => {
	const trimmed = trimToNull(name);
	if (!trimmed) {
		return badRequest("Saved view name is required");
	}
	return Effect.succeed(trimmed);
};

const resolveSavedViewSlug = (name: string) => {
	const slug = name ? slugify(name) : null;
	if (!slug) {
		return badRequest("Saved view slug is required");
	}
	return Effect.succeed(slug);
};

const ensureBuiltinUpdateIsAllowed = (
	currentView: {
		name: string;
		icon: string;
		isBuiltin: boolean;
		accentColor: string;
		trackerId: string | null;
		queryDefinition: unknown;
		displayConfiguration: unknown;
	},
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
		JSON.stringify(payload.queryDefinition) !== JSON.stringify(currentView.queryDefinition) ||
		JSON.stringify(payload.displayConfiguration) !==
			JSON.stringify(currentView.displayConfiguration);

	if (attemptsMutation) {
		return badRequest(builtinViewMutationMessage);
	}

	return Effect.void;
};

export class SavedViewsService extends Effect.Service<SavedViewsService>()("SavedViewsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const runInTransaction = yield* TransactionRunner;
		const repository = yield* SavedViewsRepository;

		return {
			list: (user: CurrentUserValue, input: { trackerId?: string; includeDisabled: boolean }) =>
				runWithDb(repository.listByUser(user.id, input)),
			get: (user: CurrentUserValue, viewSlug: string) =>
				Effect.gen(function* () {
					const view = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
					if (!view) {
						return yield* notFound(savedViewNotFound);
					}

					return view;
				}),
			create: (user: CurrentUserValue, payload: CreateSavedViewBody) =>
				Effect.gen(function* () {
					const name = yield* resolveSavedViewName(payload.name);
					const slug = yield* resolveSavedViewSlug(name);

					const existing = yield* runWithDb(repository.findBySlug(user.id, slug));
					if (existing) {
						return yield* badRequest("A saved view with this name already exists");
					}

					const created = yield* runWithDb(
						repository.create(user.id, {
							slug,
							name,
							userId: user.id,
							isBuiltin: false,
							icon: payload.icon,
							trackerId: payload.trackerId,
							accentColor: payload.accentColor,
							queryDefinition: payload.queryDefinition,
							displayConfiguration: payload.displayConfiguration,
						}),
					);

					return created;
				}),
			update: (user: CurrentUserValue, viewSlug: string, payload: UpdateSavedViewBody) =>
				Effect.gen(function* () {
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
								queryDefinition: payload.queryDefinition,
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
			delete: (user: CurrentUserValue, viewSlug: string) =>
				Effect.gen(function* () {
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
			clone: (user: CurrentUserValue, viewSlug: string) =>
				Effect.gen(function* () {
					const source = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
					if (!source) {
						return yield* notFound(savedViewNotFound);
					}

					const clonedName = `${source.name} (Copy)`;
					const name = yield* resolveSavedViewName(clonedName);
					const slug = yield* resolveSavedViewSlug(name);

					const created = yield* runWithDb(
						repository.create(user.id, {
							slug,
							name,
							userId: user.id,
							isBuiltin: false,
							icon: source.icon,
							trackerId: source.trackerId,
							accentColor: source.accentColor,
							queryDefinition: source.queryDefinition,
							displayConfiguration: source.displayConfiguration,
						}),
					);

					return created;
				}),
			reorder: (user: CurrentUserValue, payload: ReorderSavedViewsBody) =>
				Effect.gen(function* () {
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
