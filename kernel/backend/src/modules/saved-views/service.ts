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
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
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
		const definitions = yield* DefinitionRepository;
		const invalidator = yield* PluginCatalogInvalidator;
		const surfaces = yield* ClientSurfaceMaterializer;
		const installations = yield* PluginInstallationRepository;
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
				: yield* new SavedViewBadRequest({ reason: { pluginSlug, code: "plugin-not-found" } });
		});

		const ensureBuiltinViews = Effect.fn(function* (userId: CurrentUserValue["id"]) {
			const views = yield* definitions.listUserSavedViews(userId, { listed: true });
			const installationByPluginId = new Map(
				(yield* installations.listForUser(userId)).map((state) => [state.pluginId, state.id]),
			);
			yield* repository.ensureBuiltinViews(
				userId,
				views.map(({ slug, name, icon, renderer, settings, pluginId, sortOrder, dataSources }) => ({
					slug,
					name,
					icon,
					renderer,
					settings,
					sortOrder,
					dataSources,
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
			return yield* new SavedViewNotFound({ reason: { viewSlug, code: "saved-view-not-found" } });
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
					reason: { field: "name", code: "required-field" },
				});
			}
			const slug = slugify(payload.slug ?? name);
			if (!slug) {
				return yield* new SavedViewBadRequest({
					reason: { field: "slug", code: "required-field" },
				});
			}
			const effective = yield* definitions.listUserSavedViews(user.id, { listed: false });
			if (
				effective.some((view) => view.slug === slug) ||
				(yield* repository.findBySlug(user.id, slug))
			) {
				return yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } });
			}
			yield* validateRendererSettings(
				user.id,
				payload.renderer,
				payload.settings,
				payload.dataSources,
			);
			yield* surfaces.materializeRenderer(user.id, payload.renderer);
			const database = yield* Database;
			const created = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const rendererId = yield* validateRendererSettings(
							user.id,
							payload.renderer,
							payload.settings,
							payload.dataSources,
						);
						const row = yield* repository.create(user.id, {
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
						return row ?? (yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } }));
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			yield* invalidator.user(user.id);
			return created;
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
						reason: { viewSlug, code: "builtin-view-immutable" },
					});
				}
			}
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* new SavedViewBadRequest({
					reason: { field: "name", code: "required-field" },
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
					renderer,
					settings,
					dataSources,
					icon: payload.icon,
					pluginInstallationId,
					clientRendererId: rendererId,
					sortOrder: payload.sortOrder,
					isDisabled: payload.isDisabled,
				},
				current.pluginInstallationId,
			);
			return (
				updated ??
				(yield* new SavedViewNotFound({ reason: { viewSlug, code: "saved-view-not-found" } }))
			);
		});

		const update = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const previous = yield* requireSavedView(user, viewSlug);
			const nextRenderer = payload.renderer ?? previous.renderer;
			if (
				!payload.isDisabled &&
				(previous.isDisabled || !Bun.deepEquals(nextRenderer, previous.renderer))
			) {
				yield* validateRendererSettings(
					user.id,
					nextRenderer,
					payload.settings ?? previous.settings,
					payload.dataSources === undefined ? previous.dataSources : payload.dataSources,
				);
				yield* surfaces.materializeRenderer(user.id, nextRenderer);
			}
			const database = yield* Database;
			const { updated, reenabled, rendererChanged } = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const current = yield* repository.lockBySlug(user.id, viewSlug);
						if (!current) {
							return yield* new SavedViewNotFound({
								reason: { viewSlug, code: "saved-view-not-found" },
							});
						}
						if (
							current.isDisabled !== previous.isDisabled ||
							!Bun.deepEquals(current.renderer, previous.renderer)
						) {
							return yield* new SavedViewBadRequest({
								reason: { code: "renderer-kind-unavailable" },
							});
						}
						const result = yield* updateUnlocked(user, viewSlug, payload, current);
						const changedRenderer =
							payload.renderer !== undefined && !Bun.deepEquals(payload.renderer, current.renderer);
						const becameEnabled = current.isDisabled && !payload.isDisabled;
						if (payload.isDisabled) {
							yield* installations.clearHomeSavedViewReferences(user.id, current.id);
						}
						return { updated: result, reenabled: becameEnabled, rendererChanged: changedRenderer };
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			if (rendererChanged || reenabled || (payload.isDisabled && !previous.isDisabled)) {
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
								reason: { viewSlug, code: "saved-view-not-found" },
							});
						}
						if (current.isBuiltin) {
							return yield* new SavedViewBadRequest({
								reason: { viewSlug, code: "builtin-view-immutable" },
							});
						}
						yield* installations.clearHomeSavedViewReferences(user.id, current.id);
						return (
							(yield* repository.deleteBySlug(user.id, viewSlug)) ??
							(yield* new SavedViewNotFound({ reason: { viewSlug, code: "saved-view-not-found" } }))
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
				settings: source.settings,
				name: `${source.name} (Copy)`,
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
					reason: { issue: "empty", viewSlugs: requested, code: "invalid-reorder" },
				});
			}
			if (new Set(requested).size !== requested.length) {
				return yield* new SavedViewBadRequest({
					reason: { issue: "duplicate", viewSlugs: requested, code: "invalid-reorder" },
				});
			}
			if (requested.some((slug) => !scoped.some((view) => view.slug === slug))) {
				return yield* new SavedViewBadRequest({
					reason: { viewSlugs: requested, issue: "unknown-view", code: "invalid-reorder" },
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
			removeGenerated: (pluginInstallationId: string) =>
				savedViews.removeGenerated(pluginInstallationId),
			hasCustomSavedViewReferences: (
				userId: CurrentUserValue["id"],
				pluginInstallationId: string,
			) => savedViews.hasCustomInstallationReferences(userId, pluginInstallationId),
		};
	}),
);
