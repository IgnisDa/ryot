import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateSavedViewBody,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { QueryEngineService } from "#modules/query-engine/service";

import { validateDisplayConfiguration } from "./display-configuration-validation";
import { SavedViewsRepository } from "./repository";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const definitions = yield* DefinitionRegistry;
		const queryEngine = yield* QueryEngineService;
		const repository = yield* SavedViewsRepository;

		const list = Effect.fn(function* (
			user: CurrentUserValue,
			input: { pluginSlug?: PluginSlug | undefined; includeDisabled: boolean },
		) {
			return yield* runWithDb(repository.listByUser(user.id, input));
		});

		const ensureBuiltinViews = Effect.fn(function* (userId: CurrentUserValue["id"]) {
			const views = Object.values(definitions.getSnapshot().savedViews);
			yield* runWithDb(
				repository.ensureBuiltinViews(
					userId,
					views.map(
						({
							slug,
							name,
							icon,
							sortOrder,
							pluginSlug,
							accentColor,
							queryDocument,
							displayConfiguration,
						}) => ({
							slug,
							name,
							icon,
							sortOrder,
							accentColor,
							queryDocument,
							displayConfiguration,
							pluginSlug: pluginSlug ? PluginSlug.make(pluginSlug) : null,
						}),
					),
				),
			);
		});

		const requireSavedView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const savedView = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
			if (savedView) {
				return savedView;
			}
			return yield* notFound(savedViewNotFound);
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
				if (
					payload.name !== current.name ||
					payload.icon !== current.icon ||
					payload.accentColor !== current.accentColor ||
					(payload.pluginSlug ?? null) !== current.pluginSlug ||
					!Bun.deepEquals(payload.queryDocument, current.queryDocument) ||
					!Bun.deepEquals(payload.displayConfiguration, current.displayConfiguration)
				) {
					return yield* badRequest(builtinViewMutationMessage);
				}
				return (
					(yield* runWithDb(
						repository.updateBuiltinStateBySlug(
							user.id,
							viewSlug,
							payload.isDisabled,
							payload.sortOrder ?? current.sortOrder,
						),
					)) ?? (yield* notFound(savedViewNotFound))
				);
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

		return {
			list,
			clone,
			create,
			update,
			reorder,
			delete: deleteView,
			ensureBuiltinViews,
			get: requireSavedView,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
