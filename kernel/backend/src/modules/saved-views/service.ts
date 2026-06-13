import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type {
	CreateSavedViewBody,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	SavedViewBadRequest,
	SavedViewNotFound,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { PluginDefinitionMaterializer } from "#modules/plugins/definition-materializer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { validateSavedViewDefinition } from "./definition-validation";
import { SavedViewsRepository } from "./repository";

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const installations = yield* PluginInstallationRepository;
		const effectiveForUser = (userId: CurrentUserValue["id"], includeUnavailable = false) =>
			pluginRuntime.getEffectiveDefinitions(userId, includeUnavailable);
		const resolvePluginInstallation = Effect.fn(function* (
			userId: CurrentUserValue["id"],
			pluginSlug: PluginSlug,
		) {
			const available = yield* pluginRuntime.listPluginsAvailableToUser(userId);
			const plugin =
				available.find(
					(candidate) => candidate.scope === "system" && candidate.slug === pluginSlug,
				) ?? available.find((candidate) => candidate.slug === pluginSlug);
			return plugin
				? plugin.installationId
				: yield* new SavedViewBadRequest({ reason: { code: "plugin-not-found", pluginSlug } });
		});

		const ensureBuiltinViews = Effect.fn(function* (userId: CurrentUserValue["id"]) {
			const effective = yield* effectiveForUser(userId, true);
			const views = Object.values(effective.savedViews);
			const installationByPluginId = new Map(
				(yield* installations.listForUser(userId)).map((state) => [state.pluginId, state.id]),
			);
			yield* repository.ensureBuiltinViews(
				userId,
				views.map(({ slug, name, icon, layouts, sortOrder, pluginId, entitySchemaSlug }) => ({
					slug,
					name,
					icon,
					layouts,
					sortOrder,
					pluginInstallationId: pluginId ? (installationByPluginId.get(pluginId) ?? null) : null,
					entitySchemaSlug:
						entitySchemaSlug === null ? null : EntitySchemaSlug.make(entitySchemaSlug),
					entitySchemaPluginId:
						entitySchemaSlug === null
							? null
							: (effective.entitySchemas[entitySchemaSlug]?.pluginId ?? null),
				})),
			);
		});
		const removeGenerated = (pluginInstallationId: string) =>
			repository.deleteGeneratedByInstallation(pluginInstallationId);
		const hasCustomInstallationReferences = (userId: UserId, pluginInstallationId: string) =>
			repository.hasCustomInstallationReferences(userId, pluginInstallationId);

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
				entitySchemaSlug: payload.entitySchemaSlug,
				pluginInstallationId: payload.pluginSlug
					? yield* resolvePluginInstallation(user.id, payload.pluginSlug)
					: null,
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
					pluginInstallationId: payload.pluginSlug
						? yield* resolvePluginInstallation(user.id, payload.pluginSlug)
						: null,
					entitySchemaPluginId:
						entitySchemaSlug === null
							? null
							: (effective.entitySchemas[entitySchemaSlug]?.pluginId ?? null),
				},
				current.pluginInstallationId,
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
			const pluginInstallationId = payload.pluginSlug
				? yield* resolvePluginInstallation(user.id, payload.pluginSlug)
				: null;
			const views = yield* repository.listByUser(user.id, {
				includeDisabled: true,
				pluginInstallationId: pluginInstallationId ?? undefined,
			});
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
			const reorderedCount = yield* repository.reorderBySlugs(
				user.id,
				pluginInstallationId,
				reordered,
			);
			if (reorderedCount !== reordered.length) {
				return yield* new SavedViewBadRequest({
					reason: { viewSlugs: requested, issue: "update-failed", code: "invalid-reorder" },
				});
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
			hasCustomInstallationReferences,
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
			hasCustomSavedViewReferences: (
				userId: CurrentUserValue["id"],
				pluginInstallationId: string,
			) => savedViews.hasCustomInstallationReferences(userId, pluginInstallationId),
			removeGenerated: (pluginInstallationId: string) =>
				savedViews.removeGenerated(pluginInstallationId),
		};
	}),
);
