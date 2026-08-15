import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type {
	CreateSavedViewBody,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewBadRequest, SavedViewNotFound } from "@ryot/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Option } from "effect";

import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginDefinitionMaterializer } from "#modules/plugins/definition-materializer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { validateSavedViewDefinition } from "./definition-validation";
import { SavedViewsRepository } from "./repository";

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const definitions = yield* DefinitionRegistry;
		const repository = yield* SavedViewsRepository;
		const pluginRuntime = Option.getOrUndefined(yield* Effect.serviceOption(PluginRuntimeResolver));
		const installations = Option.getOrUndefined(
			yield* Effect.serviceOption(PluginInstallationRepository),
		);
		const effectiveForUser = (userId: CurrentUserValue["id"], includeUnavailable = false) =>
			pluginRuntime
				? pluginRuntime.getEffectiveDefinitions(userId, includeUnavailable)
				: Effect.succeed(definitions.getSnapshot());

		const list = Effect.fn(function* (
			user: CurrentUserValue,
			input: { pluginSlug?: PluginSlug | undefined; includeDisabled: boolean },
		) {
			return yield* repository.listByUser(user.id, input);
		});

		const ensureBuiltinViews = Effect.fn(function* (userId: CurrentUserValue["id"]) {
			const effective = yield* effectiveForUser(userId, true);
			const views = Object.values(effective.savedViews);
			const installationByPluginId = new Map(
				(installations ? yield* installations.listForUser(userId) : []).map((state) => [
					state.pluginId,
					state.id,
				]),
			);
			yield* repository.ensureBuiltinViews(
				userId,
				views.map(
					({ slug, name, icon, layouts, sortOrder, pluginId, pluginSlug, entitySchemaSlug }) => ({
						slug,
						name,
						icon,
						layouts,
						sortOrder,
						pluginSlug: pluginSlug ? PluginSlug.make(pluginSlug) : null,
						pluginInstallationId: pluginId ? (installationByPluginId.get(pluginId) ?? null) : null,
						entitySchemaSlug:
							entitySchemaSlug === null ? null : EntitySchemaSlug.make(entitySchemaSlug),
						entitySchemaPluginId:
							entitySchemaSlug === null
								? null
								: (effective.entitySchemas[entitySchemaSlug]?.pluginId ?? null),
					}),
				),
			);
		});
		const removeGenerated = (pluginInstallationId: string) =>
			repository.deleteGeneratedByInstallation(pluginInstallationId);

		const requireSavedView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const savedView = yield* repository.findBySlug(user.id, viewSlug);
			if (savedView) {
				return savedView;
			}
			return yield* new SavedViewNotFound({ reason: { code: "saved-view-not-found", viewSlug } });
		});

		const create = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			payload: CreateSavedViewBody & { slug?: string | undefined },
		) {
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* new SavedViewBadRequest({
					reason: { code: "required-field", field: "name" },
				});
			}
			const slug = slugify(payload.slug ?? name);
			if (!slug) {
				return yield* new SavedViewBadRequest({
					reason: { code: "required-field", field: "slug" },
				});
			}
			const effective = yield* effectiveForUser(user.id);
			if (effective.savedViews[slug] || (yield* repository.findBySlug(user.id, slug))) {
				return yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } });
			}
			yield* validateSavedViewDefinition(payload);
			if (payload.entitySchemaSlug !== null && !effective.entitySchemas[payload.entitySchemaSlug]) {
				return yield* new SavedViewBadRequest({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: payload.entitySchemaSlug },
				});
			}
			const created = yield* repository.create(user.id, {
				slug,
				name,
				userId: user.id,
				icon: payload.icon,
				layouts: payload.layouts,
				pluginInstallationId: null,
				pluginSlug: payload.pluginSlug,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaPluginId:
					payload.entitySchemaSlug === null
						? null
						: (effective.entitySchemas[payload.entitySchemaSlug]?.pluginId ?? null),
			});
			return created ?? (yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } }));
		});

		const update = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const current = yield* requireSavedView(user, viewSlug);
			const layouts = payload.layouts ?? current.layouts;
			const entitySchemaSlug = payload.entitySchemaSlug ?? current.entitySchemaSlug;
			const effective = yield* effectiveForUser(user.id);
			if (current.isBuiltin) {
				if (
					payload.name !== current.name ||
					payload.icon !== current.icon ||
					(payload.pluginSlug ?? null) !== current.pluginSlug ||
					(payload.entitySchemaSlug !== undefined &&
						payload.entitySchemaSlug !== current.entitySchemaSlug) ||
					(payload.layouts !== undefined && !Bun.deepEquals(payload.layouts, current.layouts))
				) {
					return yield* new SavedViewBadRequest({
						reason: { code: "builtin-view-immutable", viewSlug },
					});
				}
				return (
					(yield* repository.updateBuiltinStateBySlug(
						user.id,
						viewSlug,
						payload.isDisabled,
						payload.sortOrder ?? current.sortOrder,
					)) ??
					(yield* new SavedViewNotFound({ reason: { code: "saved-view-not-found", viewSlug } }))
				);
			}
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* new SavedViewBadRequest({
					reason: { code: "required-field", field: "name" },
				});
			}
			yield* validateSavedViewDefinition({ layouts });
			if (entitySchemaSlug !== null && !effective.entitySchemas[entitySchemaSlug]) {
				return yield* new SavedViewBadRequest({
					reason: { code: "entity-schema-not-found", entitySchemaSlug },
				});
			}
			const updated = yield* repository.updateBySlug(
				user.id,
				viewSlug,
				{
					...payload,
					name,
					layouts,
					entitySchemaSlug,
					sortOrder: payload.sortOrder,
					entitySchemaPluginId:
						entitySchemaSlug === null
							? null
							: (effective.entitySchemas[entitySchemaSlug]?.pluginId ?? null),
				},
				current.pluginSlug,
			);
			return (
				updated ??
				(yield* new SavedViewNotFound({ reason: { code: "saved-view-not-found", viewSlug } }))
			);
		});

		const deleteView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const current = yield* requireSavedView(user, viewSlug);
			if (current.isBuiltin) {
				return yield* new SavedViewBadRequest({
					reason: { code: "builtin-view-immutable", viewSlug },
				});
			}
			return (
				(yield* repository.deleteBySlug(user.id, viewSlug)) ??
				(yield* new SavedViewNotFound({ reason: { code: "saved-view-not-found", viewSlug } }))
			);
		});

		const clone = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const source = yield* requireSavedView(user, viewSlug);
			return yield* create(user, {
				icon: source.icon,
				layouts: source.layouts,
				name: `${source.name} (Copy)`,
				entitySchemaSlug: source.entitySchemaSlug,
				...(source.pluginSlug ? { pluginSlug: source.pluginSlug } : {}),
			});
		});

		const reorder = Effect.fn(function* (user: CurrentUserValue, payload: ReorderSavedViewsBody) {
			const views = yield* list(user, { pluginSlug: payload.pluginSlug, includeDisabled: true });
			const scoped = views.filter(
				(view) => (view.pluginSlug ?? null) === (payload.pluginSlug ?? null),
			);
			const requested = payload.viewSlugs.map((slug) => slug.trim()).filter(Boolean);
			if (requested.length === 0) {
				return yield* new SavedViewBadRequest({
					reason: { code: "invalid-reorder", issue: "empty", viewSlugs: requested },
				});
			}
			if (new Set(requested).size !== requested.length) {
				return yield* new SavedViewBadRequest({
					reason: { code: "invalid-reorder", issue: "duplicate", viewSlugs: requested },
				});
			}
			if (requested.some((slug) => !scoped.some((view) => view.slug === slug))) {
				return yield* new SavedViewBadRequest({
					reason: { code: "invalid-reorder", issue: "unknown-view", viewSlugs: requested },
				});
			}
			const reordered = [
				...requested,
				...scoped.map((view) => view.slug).filter((slug) => !requested.includes(slug)),
			];
			for (const [sortOrder, slug] of reordered.entries()) {
				const view = scoped.find((item) => item.slug === slug);
				if (!view) {
					continue;
				}
				yield* update(user, slug, {
					...view,
					sortOrder,
					pluginSlug: view.pluginSlug ?? undefined,
				}).pipe(
					Effect.catch((error) =>
						Effect.logWarning("saved view reorder update failed", error).pipe(
							Effect.andThen(
								new SavedViewBadRequest({
									reason: { viewSlugs: requested, issue: "update-failed", code: "invalid-reorder" },
								}),
							),
						),
					),
				);
			}
			return { viewSlugs: reordered };
		});

		return {
			clone,
			create,
			update,
			reorder,
			removeGenerated,
			delete: deleteView,
			ensureBuiltinViews,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const SavedViewPluginDefinitionMaterializerLive = Layer.effect(
	PluginDefinitionMaterializer,
	Effect.gen(function* () {
		const savedViews = yield* SavedViewsService;
		return {
			materialize: (userId: CurrentUserValue["id"]) => savedViews.ensureBuiltinViews(userId),
			removeGenerated: (pluginInstallationId: string) =>
				savedViews.removeGenerated(pluginInstallationId),
		};
	}),
);
