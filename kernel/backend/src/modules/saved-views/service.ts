import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import {
	type CreateSavedViewBody,
	type ReorderSavedViewsBody,
	SavedViewBadRequest,
	SavedViewCommandResponse,
	SavedViewNotFound,
	type SavedViewRenderer,
	SavedViewRendererConfig,
	type UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { deriveSavedViewQueries } from "@ryot-app/definitions/saved-view-queries";
import { validateSavedViewDefinition } from "@ryot-app/definitions/saved-views";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginSavedViewReferences } from "#modules/plugins/catalog/saved-view-references";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { bindRyotQLDocument } from "#modules/ryotql/binding";
import { RyotQLService } from "#modules/ryotql/service";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { slugify } from "#platform/slug";
import { trimToNull } from "#platform/validation";

import { buildSavedViewReorderPlan } from "./reorder";
import { SavedViewsRepository } from "./repository";

const missing = (reference: SavedViewReference) =>
	new SavedViewNotFound({ reason: { reference, code: "saved-view-not-found" } });

const immutable = (reference: SavedViewReference) =>
	new SavedViewBadRequest({ reason: { reference, code: "builtin-view-immutable" } });

const definitionIncompatible = (error: Error) =>
	new SavedViewBadRequest({ reason: { message: error.message, code: "settings-incompatible" } });

export class SavedViewsService extends Context.Service<SavedViewsService>()(
	"@ryot-app/kernel-backend/modules/saved-views/service/SavedViewsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* SavedViewsRepository;
			const catalogs = yield* DefinitionCatalog;
			const ryotql = yield* RyotQLService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const invalidator = yield* PluginCatalogInvalidator;
			const installations = yield* PluginInstallationRepository;
			const pluginRepository = yield* PluginRepository;
			const session = yield* DatabaseSession;
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const transact = <A, E, R>(userId: UserId, work: Effect.Effect<A, E, R>) =>
				session
					.transaction(
						Effect.gen(function* () {
							yield* pluginRepository.lockIngestionShared([userId]);
							yield* session.acquireUserWriteLock(userId);
							yield* admission.admitAccount(userId);
							const result = yield* work;
							yield* invalidator.user(userId);
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
				return (
					(yield* repository.findByReference(userId, reference)) ?? (yield* missing(reference))
				);
			});
			const prepareDefinition = Effect.fn(function* (
				userId: UserId,
				renderer: SavedViewRenderer,
				settings: CreateSavedViewBody["settings"],
				document: CreateSavedViewBody["dataSources"],
				trusted?: boolean,
			) {
				if (renderer.kind === "page") {
					const published = yield* repository.findPublishedPage(userId, renderer.pageId);
					if (!published) {
						return yield* new SavedViewBadRequest({ reason: { code: "renderer-not-found" } });
					}
				}
				const available = yield* pluginRuntime.listPluginsAvailableToUser(userId, true);
				const catalog = available.filter(({ health }) => health === "ready");
				const page =
					renderer.kind === "plugin"
						? catalog.find(({ id }) => id === renderer.pluginId)?.manifest.client?.exports?.[
								renderer.exportName
							]
						: undefined;
				const schemas = (yield* catalogs.forUser(userId)).entitySchemas;

				const dataSources =
					document === null
						? null
						: yield* Effect.fromResult(
								deriveSavedViewQueries(renderer, settings, document, trusted ?? false),
							).pipe(Effect.mapError(definitionIncompatible));
				const branches = yield* Effect.fromResult(
					validateSavedViewDefinition({
						schemas,
						renderer,
						settings,
						dataSources,
						options: { kernelBuiltin: false },
						pluginPage: page?.kind === "page" ? page : null,
					}),
				).pipe(Effect.mapError((reason) => new SavedViewBadRequest({ reason })));
				for (const branch of branches) {
					yield* bindRyotQLDocument(
						branch,
						{ userId, type: "user", language: null, audience: "plugin", accessClass: "standard" },
						catalog.map((plugin) => ({
							pluginId: plugin.id,
							scope: plugin.scope,
							packageId: plugin.packageId,
						})),
					);
				}

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
			const prepareSelection = Effect.fn(function* (
				document: CreateSavedViewBody["dataSources"],
				selection: Pick<CreateSavedViewBody, "sort" | "filter" | "arguments">,
				userId: UserId,
				forbiddenSource?: SavedViewReference,
			) {
				const parsed = yield* Effect.fromResult(
					bindArguments(document?.parameters, selection.arguments),
				).pipe(
					Effect.mapError(
						(issues) =>
							new SavedViewBadRequest({
								reason: {
									code: "settings-incompatible",
									message: issues.map(({ message }) => message).join("; "),
								},
							}),
					),
				);
				const argumentsValue = yield* Schema.decodeUnknownEffect(
					Schema.Record(Schema.String, JsonValue),
				)(parsed).pipe(Effect.orDie);
				if (
					(selection.filter !== undefined && !document?.controls?.filter) ||
					(selection.sort !== undefined && !document?.controls?.sort)
				) {
					return yield* new SavedViewBadRequest({
						reason: {
							code: "settings-incompatible",
							message: "Selection requires declared controls",
						},
					});
				}
				if (document !== null) {
					yield* ryotql
						.validateSelectionForUser(
							userId,
							{ source: { document, kind: "inline" }, ...selection },
							forbiddenSource,
						)
						.pipe(
							Effect.catchTags({
								RyotQLInternalError: Effect.die,
								DemoOperationProtected: Effect.die,
							}),
						);
				}
				return {
					arguments: argumentsValue,
					sort: selection.sort ?? null,
					filter: selection.filter ?? null,
				};
			});
			const create = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				payload: CreateSavedViewBody & { slug?: string | undefined },
				trusted?: boolean,
				idempotencyKey?: string,
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
				const write = Effect.gen(function* () {
					if (yield* repository.customSlugExists(user.id, slug)) {
						return yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } });
					}
					const dataSources = yield* prepareDefinition(
						user.id,
						payload.renderer,
						payload.settings,
						payload.dataSources,
						trusted,
					);
					const pluginInstallationId = payload.workspaceInstallationId
						? yield* requireInstallation(user.id, payload.workspaceInstallationId)
						: null;
					return (
						(yield* repository.create(user.id, {
							slug,
							name,
							dataSources,
							...(yield* prepareSelection(dataSources, payload, user.id)),
							userId: user.id,
							icon: payload.icon,
							pluginInstallationId,
							renderer: payload.renderer,
							settings: payload.settings,
						})) ?? (yield* new SavedViewBadRequest({ reason: { code: "duplicate-name" } }))
					);
				});
				return yield* mapDatabaseErrors(
					transact(
						user.id,
						idempotencyKey === undefined
							? write
							: keys
									.once(
										idempotencyIdentity({
											userId: user.id,
											request: payload,
											key: idempotencyKey,
											kind: "saved-view:create",
										}),
										SavedViewCommandResponse,
										write,
									)
									.pipe(
										Effect.catchTag("IdempotencyConflict", () =>
											definitionIncompatible(
												new Error("Saved view idempotency key was reused with different input"),
											),
										),
									),
					),
				);
			});
			const update = Effect.fn(function* (
				user: CurrentUserValue,
				reference: SavedViewReference,
				payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
				idempotencyKey?: string,
			) {
				const write = Effect.gen(function* () {
					const current =
						reference.kind === "custom"
							? ((yield* repository.lockCustom(user.id, reference.savedViewId)) ??
								(yield* missing(reference)))
							: yield* requireSavedView(user.id, reference);
					if (reference.kind !== "custom") {
						if (
							payload.name !== undefined ||
							payload.icon !== undefined ||
							"renderer" in payload ||
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
					const config = "renderer" in payload ? payload : current;
					const { renderer, settings } = config;
					const dataSources =
						"renderer" in payload || (!payload.isHidden && current.isHidden)
							? yield* prepareDefinition(
									user.id,
									renderer,
									settings,
									config.dataSources,
									!("renderer" in payload),
								)
							: current.dataSources;
					let pluginInstallationId: null | string;
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
								...(yield* prepareSelection(
									dataSources,
									{
										arguments: payload.arguments ?? current.arguments,
										sort: payload.sort === undefined ? current.sort : (payload.sort ?? undefined),
										filter:
											payload.filter === undefined ? current.filter : (payload.filter ?? undefined),
									},
									user.id,
									reference,
								)),
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
				});
				return yield* mapDatabaseErrors(
					transact(
						user.id,
						idempotencyKey === undefined
							? write
							: keys
									.once(
										idempotencyIdentity({
											userId: user.id,
											key: idempotencyKey,
											kind: "saved-view:update",
											request: { payload, reference },
										}),
										SavedViewCommandResponse,
										write,
									)
									.pipe(
										Effect.catchTag("IdempotencyConflict", () =>
											definitionIncompatible(
												new Error("Saved view idempotency key was reused with different input"),
											),
										),
									),
					),
				);
			});
			const deleteView = Effect.fn(function* (
				user: CurrentUserValue,
				reference: SavedViewReference,
				idempotencyKey?: string,
			) {
				if (reference.kind !== "custom") {
					return yield* immutable(reference);
				}
				const write = Effect.gen(function* () {
					if (!(yield* repository.lockCustom(user.id, reference.savedViewId))) {
						return yield* missing(reference);
					}
					yield* installations.clearHomeSavedViewReferences(user.id, reference);
					return (
						(yield* repository.deleteCustom(user.id, reference.savedViewId)) ??
						(yield* missing(reference))
					);
				});
				return yield* mapDatabaseErrors(
					transact(
						user.id,
						idempotencyKey === undefined
							? write
							: keys
									.once(
										idempotencyIdentity({
											userId: user.id,
											request: reference,
											key: idempotencyKey,
											kind: "saved-view:delete",
										}),
										SavedViewCommandResponse,
										write,
									)
									.pipe(
										Effect.catchTag("IdempotencyConflict", () =>
											definitionIncompatible(
												new Error("Saved view idempotency key was reused with different input"),
											),
										),
									),
					),
				);
			});
			const clone = Effect.fn(function* (user: CurrentUserValue, reference: SavedViewReference) {
				const source = yield* requireSavedView(user.id, reference);
				const config = yield* Schema.decodeUnknownEffect(SavedViewRendererConfig)({
					sort: source.sort,
					filter: source.filter,
					renderer: source.renderer,
					settings: source.settings,
					arguments: source.arguments,
					dataSources: source.dataSources,
				}).pipe(
					Effect.mapError(
						() =>
							new SavedViewBadRequest({
								reason: {
									code: "settings-incompatible",
									message: "Saved view definition is invalid",
								},
							}),
					),
				);
				return yield* create(
					user,
					{
						...config,
						icon: source.icon,
						name: `${source.name} (Copy)`,
						...(source.pluginInstallationId
							? { workspaceInstallationId: source.pluginInstallationId }
							: {}),
					},
					true,
				);
			});
			const reorder = Effect.fn(function* (user: CurrentUserValue, payload: ReorderSavedViewsBody) {
				const result = yield* mapDatabaseErrors(
					transact(
						user.id,
						Effect.gen(function* () {
							const pluginInstallationId = payload.installationId
								? yield* requireInstallation(user.id, payload.installationId)
								: null;
							const views = yield* repository.listReorderScope(user.id, pluginInstallationId);
							const plan = yield* buildSavedViewReorderPlan(views, payload.references);
							yield* repository.persistReorder(user.id, pluginInstallationId, plan);
							return { references: plan.map((entry) => entry.reference) };
						}),
					),
				);
				return result;
			});
			const hasCustomInstallationReferences = (userId: UserId, pluginInstallationId: string) =>
				repository.hasCustomInstallationReferences(userId, pluginInstallationId);
			return {
				clone,
				create,
				update,
				reorder,
				delete: deleteView,
				hasCustomInstallationReferences,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(RyotQLService.layer),
		Layer.provide(DefinitionCatalog.layer),
	);
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
