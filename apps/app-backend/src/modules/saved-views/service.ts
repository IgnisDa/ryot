import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateSavedViewBody,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import { PluginSlug, SavedViewId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRegistry, type SavedViewDefinition } from "#modules/definition-registry/service";
import { QueryEngineService } from "#modules/query-engine/service";

import { validateDisplayConfiguration } from "./display-configuration-validation";
import { SavedViewsRepository } from "./repository";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

const toBuiltin = (
	definition: SavedViewDefinition,
	state?: { isDisabled: boolean; sortOrder: number },
) => ({
	...definition,
	isBuiltin: true,
	createdAt: "1970-01-01T00:00:00.000Z",
	updatedAt: "1970-01-01T00:00:00.000Z",
	isDisabled: state?.isDisabled ?? false,
	id: SavedViewId.make(definition.slug),
	sortOrder: state?.sortOrder ?? definition.sortOrder,
	pluginSlug: definition.pluginSlug ? PluginSlug.make(definition.pluginSlug) : null,
});

export class SavedViewsService extends Effect.Service<SavedViewsService>()("SavedViewsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const definitions = yield* DefinitionRegistry;
		const queryEngine = yield* QueryEngineService;
		const repository = yield* SavedViewsRepository;

		const list = Effect.fn(function* (
			user: CurrentUserValue,
			input: { pluginSlug?: PluginSlug | undefined; includeDisabled: boolean },
		) {
			const [custom, states] = yield* Effect.all([
				runWithDb(repository.listByUser(user.id, input)),
				runWithDb(repository.listBuiltinStates(user.id)),
			]);
			const bySlug = new Map(states.map((state) => [state.savedViewSlug, state]));
			const builtins = Object.values(definitions.getSnapshot().savedViews)
				.filter((view) => !input.pluginSlug || view.pluginSlug === input.pluginSlug)
				.map((view) => toBuiltin(view, bySlug.get(view.slug)))
				.filter((view) => input.includeDisabled || !view.isDisabled);
			return [...builtins, ...custom].sort((left, right) => left.sortOrder - right.sortOrder);
		});

		const requireSavedView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const custom = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (custom) {
				return custom;
			}
			const definition = definitions.getSavedView(viewSlug);
			if (!definition) {
				return yield* notFound(savedViewNotFound);
			}
			const state = (yield* runWithDb(repository.listBuiltinStates(user.id))).find(
				(row) => row.savedViewSlug === viewSlug,
			);
			return toBuiltin(definition, state);
		});

		const create = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			payload: CreateSavedViewBody & { slug?: string | undefined },
		) {
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* badRequest("Saved view name is required");
			}
			const slug = slugify(payload.slug ?? name);
			if (!slug) {
				return yield* badRequest("Saved view slug is required");
			}
			if (
				definitions.getSavedView(slug) ||
				(yield* runWithDb(repository.findBySlug(user.id, slug)))
			) {
				return yield* badRequest("A saved view with this name already exists");
			}
			yield* queryEngine.validate(user, payload.queryDocument);
			yield* validateDisplayConfiguration({
				doc: payload.queryDocument,
				displayConfig: payload.displayConfiguration,
				loadSchemas: (slugs) =>
					Effect.succeed(
						slugs.flatMap((schemaSlug) => {
							const schema = definitions.getEntitySchema(schemaSlug);
							return schema
								? [{ slug: schema.slug, propertiesSchema: schema.propertiesSchema }]
								: [];
						}),
					),
			});
			const created = yield* runWithDb(
				repository.create(user.id, {
					slug,
					name,
					userId: user.id,
					icon: payload.icon,
					pluginSlug: payload.pluginSlug,
					accentColor: payload.accentColor,
					queryDocument: payload.queryDocument,
					displayConfiguration: payload.displayConfiguration,
				}),
			);
			return created ?? (yield* badRequest("A saved view with this name already exists"));
		});

		const update = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const current = yield* requireSavedView(user, viewSlug);
			if (current.isBuiltin) {
				const definition = definitions.getSavedView(viewSlug);
				if (!definition) {
					return yield* notFound(savedViewNotFound);
				}
				if (
					payload.name !== definition.name ||
					payload.icon !== definition.icon ||
					payload.accentColor !== definition.accentColor ||
					(payload.pluginSlug ?? null) !== definition.pluginSlug ||
					!Bun.deepEquals(payload.queryDocument, definition.queryDocument) ||
					!Bun.deepEquals(payload.displayConfiguration, definition.displayConfiguration)
				) {
					return yield* badRequest(builtinViewMutationMessage);
				}
				const state = yield* runWithDb(
					repository.upsertBuiltinState({
						userId: user.id,
						savedViewSlug: viewSlug,
						isDisabled: payload.isDisabled,
						sortOrder: payload.sortOrder ?? current.sortOrder,
					}),
				);
				return toBuiltin(definition, state);
			}
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* badRequest("Saved view name is required");
			}
			yield* queryEngine.validate(user, payload.queryDocument);
			yield* validateDisplayConfiguration({
				doc: payload.queryDocument,
				displayConfig: payload.displayConfiguration,
				loadSchemas: (slugs) =>
					Effect.succeed(
						slugs.flatMap((schemaSlug) => {
							const schema = definitions.getEntitySchema(schemaSlug);
							return schema
								? [{ slug: schema.slug, propertiesSchema: schema.propertiesSchema }]
								: [];
						}),
					),
			});
			const updated = yield* runWithDb(
				repository.updateBySlug(
					user.id,
					viewSlug,
					{ ...payload, name, sortOrder: payload.sortOrder },
					current.pluginSlug,
				),
			);
			return updated ?? (yield* notFound(savedViewNotFound));
		});

		const deleteView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const current = yield* requireSavedView(user, viewSlug);
			if (current.isBuiltin) {
				return yield* badRequest(builtinViewMutationMessage);
			}
			return (
				(yield* runWithDb(repository.deleteBySlug(user.id, viewSlug))) ??
				(yield* notFound(savedViewNotFound))
			);
		});

		const clone = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const source = yield* requireSavedView(user, viewSlug);
			return yield* create(user, {
				icon: source.icon,
				name: `${source.name} (Copy)`,
				accentColor: source.accentColor,
				queryDocument: source.queryDocument,
				displayConfiguration: source.displayConfiguration,
				...(source.pluginSlug ? { pluginSlug: source.pluginSlug } : {}),
			});
		});

		const reorder = Effect.fn(function* (user: CurrentUserValue, payload: ReorderSavedViewsBody) {
			const views = yield* list(user, { pluginSlug: payload.pluginSlug, includeDisabled: true });
			const requested = payload.viewSlugs.map((slug) => slug.trim()).filter(Boolean);
			if (requested.length === 0 || new Set(requested).size !== requested.length) {
				return yield* badRequest("View slugs are required and must be unique");
			}
			if (requested.some((slug) => !views.some((view) => view.slug === slug))) {
				return yield* badRequest("Saved view slugs contain unknown saved views");
			}
			const reordered = [
				...requested,
				...views.map((view) => view.slug).filter((slug) => !requested.includes(slug)),
			];
			for (const [sortOrder, slug] of reordered.entries()) {
				const view = views.find((item) => item.slug === slug);
				if (!view) {
					continue;
				}
				yield* update(user, slug, {
					...view,
					sortOrder,
					pluginSlug: view.pluginSlug ?? undefined,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));
			}
			return { viewSlugs: reordered };
		});

		return { get: requireSavedView, list, clone, create, update, reorder, delete: deleteView };
	}),
}) {}
