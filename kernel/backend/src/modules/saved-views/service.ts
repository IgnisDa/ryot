import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	savedViewReferenceKey,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	SavedViewBadRequest,
	SavedViewNotFound,
	type CreateSavedViewBody,
	type ReorderSavedViewsBody,
	type UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginSavedViewReferences } from "#modules/plugins/catalog/saved-view-references";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { bindRyotQLDocument } from "#modules/ryotql/binding";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { slugify } from "#platform/slug";
import { trimToNull } from "#platform/validation";

import { validateSavedViewDefinition } from "./definition-validation";
import { SavedViewsRepository } from "./repository";

const missing = (reference: SavedViewReference) =>
	new SavedViewNotFound({ reason: { reference, code: "saved-view-not-found" } });

const immutable = (reference: SavedViewReference) =>
	new SavedViewBadRequest({ reason: { reference, code: "builtin-view-immutable" } });

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const invalidator = yield* PluginCatalogInvalidator;
		const installations = yield* PluginInstallationRepository;
		const pluginRepository = yield* PluginRepository;
		const session = yield* DatabaseSession;
		const assetReferences = yield* ManagedAssetReferenceLocker.make;
		const transact = <A, E, R>(userId: UserId, work: Effect.Effect<A, E, R>) =>
			session
				.transaction(
					Effect.gen(function* () {
						yield* pluginRepository.lockIngestionShared();
						yield* session.acquireUserWriteLock(userId);
						const result = yield* work;
						yield* invalidator.recordUser(userId);
						return result;
					}),
				)
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		const requireInstallation = Effect.fn(function* (userId: UserId, installationId: string) {
			const available = yield* pluginRuntime.listPluginsAvailableToUser(userId, true);
			if (!available.some((plugin) => plugin.installationId === installationId)) {
				return yield* new SavedViewBadRequest({
					reason: { installationId, code: "plugin-not-found" },
				});
			}
			return installationId;
		});
		const requireSavedView = Effect.fn(function* (userId: UserId, reference: SavedViewReference) {
			return (yield* repository.findByReference(userId, reference)) ?? (yield* missing(reference));
		});
		const prepareDefinition = Effect.fn(function* (
			userId: UserId,
			renderer: CreateSavedViewBody["renderer"],
			settings: CreateSavedViewBody["settings"],
			document: CreateSavedViewBody["dataSources"],
		) {
			const available = yield* pluginRuntime.listPluginsAvailableToUser(userId, true);
			const catalog = available.filter(({ health }) => health === "ready");
			const page =
				renderer.kind === "plugin"
					? catalog.find(({ id }) => id === renderer.pluginId)?.manifest.client?.exports?.[
							renderer.exportName
						]
					: undefined;
			const dataSources =
				document === null
					? null
					: yield* bindRyotQLDocument(
							document,
							{ userId, type: "user", language: null, audience: "kernel", accessClass: "standard" },
							catalog.map((plugin) => ({
								pluginId: plugin.id,
								scope: plugin.scope,
								packageId: plugin.packageId,
							})),
						);
			yield* validateSavedViewDefinition(
				renderer,
				settings,
				dataSources,
				null,
				page?.kind === "page" ? page : null,
			);
			if (page?.kind === "page") {
				yield* assetReferences
					.lock([
						{ ownerUserId: userId, properties: settings, propertiesSchema: page.settingsSchema },
					])
					.pipe(
						Effect.catchTag(
							"ManagedAssetReferenceRejected",
							() => new SavedViewBadRequest({ reason: { code: "asset-forbidden" } }),
						),
					);
			}
			return dataSources;
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
			const created = yield* mapDatabaseErrors(
				transact(
					user.id,
					Effect.gen(function* () {
						if (yield* repository.customSlugExists(user.id, slug)) {
							return yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } });
						}
						const dataSources = yield* prepareDefinition(
							user.id,
							payload.renderer,
							payload.settings,
							payload.dataSources,
						);
						const pluginInstallationId = payload.workspaceInstallationId
							? yield* requireInstallation(user.id, payload.workspaceInstallationId)
							: null;
						return (
							(yield* repository.create(user.id, {
								slug,
								name,
								dataSources,
								userId: user.id,
								icon: payload.icon,
								pluginInstallationId,
								renderer: payload.renderer,
								settings: payload.settings,
							})) ?? (yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } }))
						);
					}),
				),
			);
			yield* invalidator.user(user.id);
			return created;
		});
		const update = Effect.fn(function* (
			user: CurrentUserValue,
			reference: SavedViewReference,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const result = yield* mapDatabaseErrors(
				transact(
					user.id,
					Effect.gen(function* () {
						const current =
							reference.kind === "custom"
								? ((yield* repository.lockCustom(user.id, reference.savedViewId)) ??
									(yield* missing(reference)))
								: yield* requireSavedView(user.id, reference);
						if (reference.kind !== "custom") {
							if (
								payload.name !== undefined ||
								payload.icon !== undefined ||
								payload.renderer !== undefined ||
								payload.settings !== undefined ||
								payload.dataSources !== undefined ||
								payload.workspaceInstallationId !== undefined
							) {
								return yield* immutable(reference);
							}
							const updated =
								(yield* repository.setBuiltinState(
									user.id,
									reference,
									payload.isHidden,
									payload.sortOrder ?? current.sortOrder,
								)) ?? (yield* missing(reference));
							if (payload.isHidden) {
								yield* installations.clearHomeSavedViewReferences(user.id, reference);
							}
							return { id: updated.id };
						}
						const name = trimToNull(payload.name ?? current.name);
						if (!name) {
							return yield* new SavedViewBadRequest({
								reason: { field: "name", code: "required-field" },
							});
						}
						const renderer = payload.renderer ?? current.renderer;
						const settings = payload.settings ?? current.settings;
						const definitionChanged =
							payload.renderer !== undefined ||
							payload.settings !== undefined ||
							payload.dataSources !== undefined;
						const dataSources =
							definitionChanged || (!payload.isHidden && current.isHidden)
								? yield* prepareDefinition(
										user.id,
										renderer,
										settings,
										payload.dataSources === undefined ? current.dataSources : payload.dataSources,
									)
								: current.dataSources;
						let pluginInstallationId: string | null;
						if (payload.workspaceInstallationId === undefined) {
							pluginInstallationId = current.pluginInstallationId;
						} else if (payload.workspaceInstallationId === null) {
							pluginInstallationId = null;
						} else {
							pluginInstallationId = yield* requireInstallation(
								user.id,
								payload.workspaceInstallationId,
							);
						}
						const updated =
							(yield* repository.updateCustom(
								user.id,
								reference.savedViewId,
								{
									name,
									renderer,
									settings,
									dataSources,
									pluginInstallationId,
									isHidden: payload.isHidden,
									sortOrder: payload.sortOrder,
									icon: payload.icon ?? current.icon,
								},
								current.pluginInstallationId,
							)) ?? (yield* missing(reference));
						if (payload.isHidden) {
							yield* installations.clearHomeSavedViewReferences(user.id, reference);
						}
						return updated;
					}),
				),
			);
			yield* invalidator.user(user.id);
			return result;
		});
		const deleteView = Effect.fn(function* (user: CurrentUserValue, reference: SavedViewReference) {
			if (reference.kind !== "custom") {
				return yield* immutable(reference);
			}
			const result = yield* mapDatabaseErrors(
				transact(
					user.id,
					Effect.gen(function* () {
						if (!(yield* repository.lockCustom(user.id, reference.savedViewId))) {
							return yield* missing(reference);
						}
						yield* installations.clearHomeSavedViewReferences(user.id, reference);
						return (
							(yield* repository.deleteCustom(user.id, reference.savedViewId)) ??
							(yield* missing(reference))
						);
					}),
				),
			);
			yield* invalidator.user(user.id);
			return result;
		});
		const clone = Effect.fn(function* (user: CurrentUserValue, reference: SavedViewReference) {
			const source = yield* requireSavedView(user.id, reference);
			return yield* create(user, {
				icon: source.icon,
				renderer: source.renderer,
				settings: source.settings,
				name: `${source.name} (Copy)`,
				dataSources: source.dataSources,
				...(source.pluginInstallationId
					? { workspaceInstallationId: source.pluginInstallationId }
					: {}),
			});
		});
		const reorder = Effect.fn(function* (user: CurrentUserValue, payload: ReorderSavedViewsBody) {
			const result = yield* mapDatabaseErrors(
				transact(
					user.id,
					Effect.gen(function* () {
						const pluginInstallationId = payload.installationId
							? yield* requireInstallation(user.id, payload.installationId)
							: null;
						const views = (yield* repository.listByUser(user.id, {
							includeHidden: true,
							pluginInstallationId: pluginInstallationId ?? undefined,
						})).filter((view) => view.pluginInstallationId === pluginInstallationId);
						const requested = payload.references;
						const keys = new Set(requested.map(savedViewReferenceKey));
						const viewKeys = new Set(views.map((view) => savedViewReferenceKey(view.reference)));
						const invalid = (issue: "empty" | "duplicate" | "unknown-view" | "update-failed") =>
							new SavedViewBadRequest({
								reason: { issue, references: requested, code: "invalid-reorder" },
							});
						if (requested.length === 0) {
							return yield* invalid("empty");
						}
						if (keys.size !== requested.length) {
							return yield* invalid("duplicate");
						}
						if (!requested.every((reference) => viewKeys.has(savedViewReferenceKey(reference)))) {
							return yield* invalid("unknown-view");
						}
						const references = [
							...requested,
							...views
								.map((view) => view.reference)
								.filter((reference) => !keys.has(savedViewReferenceKey(reference))),
						];
						if (
							(yield* repository.reorderByReferences(user.id, pluginInstallationId, references)) !==
							references.length
						) {
							return yield* invalid("update-failed");
						}
						return { references };
					}),
				),
			);
			yield* invalidator.user(user.id);
			return result;
		});
		const hasCustomInstallationReferences = (userId: UserId, pluginInstallationId: string) =>
			repository.hasCustomInstallationReferences(userId, pluginInstallationId);
		return { clone, create, update, reorder, delete: deleteView, hasCustomInstallationReferences };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const SavedViewPluginReferencesLive = Layer.effect(
	PluginSavedViewReferences,
	Effect.gen(function* () {
		const savedViews = yield* SavedViewsService;
		return {
			hasCustomSavedViewReferences: (
				userId: CurrentUserValue["id"],
				pluginInstallationId: string,
			) => savedViews.hasCustomInstallationReferences(userId, pluginInstallationId),
		};
	}),
);
