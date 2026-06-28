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
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { PluginDefinitionMaterializer } from "#modules/plugins/definition-materializer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { validateSavedViewDefinition } from "./definition-validation";
import { SavedViewsRepository } from "./repository";

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		const clientPages = yield* ClientPagesRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const invalidator = yield* PluginCatalogInvalidator;
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
				views.map(({ slug, name, icon, renderer, settings, dataSources, sortOrder, pluginId }) => ({
					slug,
					name,
					icon,
					renderer,
					settings,
					dataSources,
					sortOrder,
					pluginInstallationId: pluginId ? (installationByPluginId.get(pluginId) ?? null) : null,
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
		const validateRendererSettings = Effect.fn(function* (
			userId: CurrentUserValue["id"],
			renderer: Extract<CreateSavedViewBody, { renderer: unknown }>["renderer"],
			settings: Readonly<Record<string, unknown>>,
			dataSources: Extract<CreateSavedViewBody, { renderer: unknown }>["dataSources"],
		) {
			const record =
				renderer.kind === "custom"
					? yield* clientPages.lockRenderer(userId, renderer.rendererId)
					: null;
			const pluginPage =
				renderer.kind === "plugin"
					? (yield* pluginRuntime.listPluginsAvailableToUser(userId)).find(
							({ id }) => id === renderer.pluginId,
						)?.manifest.client?.exports?.[renderer.exportName]
					: undefined;
			return yield* validateSavedViewDefinition(
				renderer,
				settings,
				dataSources,
				record,
				pluginPage?.kind === "page" ? pluginPage : null,
			);
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
			const database = yield* Database;
			return yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const rendererId = yield* validateRendererSettings(
							user.id,
							payload.renderer,
							payload.settings,
							payload.dataSources,
						);
						const created = yield* repository.create(user.id, {
							slug,
							name,
							userId: user.id,
							icon: payload.icon,
							renderer: payload.renderer,
							settings: payload.settings,
							clientRendererId: rendererId,
							dataSources: payload.dataSources,
							pluginInstallationId: payload.workspacePluginSlug
								? yield* resolvePluginInstallation(user.id, payload.workspacePluginSlug)
								: null,
						});
						return (
							created ?? (yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } }))
						);
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
		});

		const updateUnlocked = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
			current: Effect.Success<ReturnType<typeof requireSavedView>>,
		) {
			const renderer = payload.renderer ?? current.renderer;
			const settings = payload.settings ?? current.settings;
			const dataSources =
				payload.dataSources === undefined ? current.dataSources : payload.dataSources;
			if (current.isBuiltin) {
				if (
					payload.name !== current.name ||
					payload.icon !== current.icon ||
					!Bun.deepEquals(renderer, current.renderer) ||
					!Bun.deepEquals(settings, current.settings) ||
					!Bun.deepEquals(dataSources, current.dataSources)
				) {
					return yield* new SavedViewBadRequest({
						reason: { code: "builtin-view-immutable", viewSlug },
					});
				}
			}
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* new SavedViewBadRequest({
					reason: { code: "required-field", field: "name" },
				});
			}
			let rendererId = null;
			if (current.isBuiltin) {
				if (current.renderer.kind === "custom") {
					rendererId = current.renderer.rendererId;
				}
			} else {
				rendererId = yield* validateRendererSettings(user.id, renderer, settings, dataSources);
			}
			let pluginInstallationId = current.pluginInstallationId;
			if (payload.workspacePluginSlug === null) {
				pluginInstallationId = null;
			} else if (payload.workspacePluginSlug !== undefined) {
				pluginInstallationId = yield* resolvePluginInstallation(
					user.id,
					payload.workspacePluginSlug,
				);
			}
			const updated = yield* repository.updateBySlug(
				user.id,
				viewSlug,
				{
					name,
					icon: payload.icon,
					renderer,
					settings,
					dataSources,
					clientRendererId: rendererId,
					isDisabled: payload.isDisabled,
					sortOrder: payload.sortOrder,
					pluginInstallationId,
				},
				current.pluginInstallationId,
			);
			return (
				updated ??
				(yield* new SavedViewNotFound({ reason: { code: "saved-view-not-found", viewSlug } }))
			);
		});

		const update = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const database = yield* Database;
			const updated = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const current = yield* repository.lockBySlug(user.id, viewSlug);
						if (!current) {
							return yield* new SavedViewNotFound({
								reason: { code: "saved-view-not-found", viewSlug },
							});
						}
						const result = yield* updateUnlocked(user, viewSlug, payload, current);
						if (payload.isDisabled) {
							yield* installations.clearHomeSavedViewReferences(user.id, current.id);
						}
						return result;
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			if (payload.isDisabled) {
				yield* invalidator.user(user.id);
			}
			return updated;
		});

		const deleteView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const database = yield* Database;
			const deleted = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const current = yield* repository.lockBySlug(user.id, viewSlug);
						if (!current) {
							return yield* new SavedViewNotFound({
								reason: { code: "saved-view-not-found", viewSlug },
							});
						}
						if (current.isBuiltin) {
							return yield* new SavedViewBadRequest({
								reason: { code: "builtin-view-immutable", viewSlug },
							});
						}
						yield* installations.clearHomeSavedViewReferences(user.id, current.id);
						return (
							(yield* repository.deleteBySlug(user.id, viewSlug)) ??
							(yield* new SavedViewNotFound({
								reason: { code: "saved-view-not-found", viewSlug },
							}))
						);
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			yield* invalidator.user(user.id);
			return deleted;
		});

		const clone = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const source = yield* requireSavedView(user, viewSlug);
			return yield* create(user, {
				icon: source.icon,
				renderer: source.renderer,
				name: `${source.name} (Copy)`,
				settings: source.settings,
				dataSources: source.dataSources,
				...(source.pluginSlug ? { workspacePluginSlug: source.pluginSlug } : {}),
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
