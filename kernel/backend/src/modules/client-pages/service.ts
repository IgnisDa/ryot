import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ClientPageDocumentStale,
	ClientPagePreparationError,
	type ClientPageTarget,
	type ClientRendererDefinition,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { Context, Effect, Layer } from "effect";

import { ClientArtifactGrantService } from "#modules/client-artifacts/grant-service";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStore } from "#modules/client-artifacts/store";
import { EntitiesRepository } from "#modules/entities/repository";
import { type AvailablePlugin, PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ClientPageCompositionService } from "./composition-service";
import { generateClientDocument } from "./document";
import {
	clientPageCodeContributors,
	resolveClientPageGraph,
	type GraphPlugin,
	type ResolvedClientPageGraph,
} from "./graph";
import { getKernelClientRenderer, getKernelEntityRenderer } from "./kernel-renderers";
import { clientPageOperationTargets, resolvePluginPageTarget } from "./prepare";
import { ClientPagesRepository } from "./repository";

const canonicalOperationTargets = (targets: PreparedClientPage["identity"]["operationTargets"]) =>
	[...targets].sort((left, right) =>
		`${left.pluginSlug}/${left.pluginId}/${left.installationId}`.localeCompare(
			`${right.pluginSlug}/${right.pluginId}/${right.installationId}`,
		),
	);

const operationTargetsCurrent = (
	current: ReadonlyArray<AvailablePlugin>,
	recorded: PreparedClientPage["identity"]["operationTargets"],
) =>
	Bun.deepEquals(
		canonicalOperationTargets(clientPageOperationTargets(current)),
		canonicalOperationTargets(recorded),
	);

const savedViewUnavailable = () =>
	new ClientPagePreparationError({ reason: { code: "saved-view-unavailable" } });

export class ClientPagesService extends Context.Service<ClientPagesService>()(
	"ClientPagesService",
	{
		make: Effect.gen(function* () {
			const entities = yield* EntitiesRepository;
			const repository = yield* ClientPagesRepository;
			const compositions = yield* ClientPageCompositionService;
			const artifactStore = yield* ClientArtifactStore;
			const artifactGrants = yield* ClientArtifactGrantService;
			const image = yield* ImageClientArtifacts;
			const runtimeArtifactHash = image.runtime.artifact.hash;
			const rendererHash = (name: string, sourceHash: string) => {
				const renderer = image.renderers.get(name);
				if (!renderer) {
					throw new Error(`Kernel renderer artifact is missing: ${name}`);
				}
				if (renderer.sourceHash !== sourceHash) {
					throw new Error(`Kernel renderer artifact source hash mismatch: ${name}`);
				}
				return renderer.artifact.hash;
			};
			const pluginRuntime = yield* PluginRuntimeResolver;
			const listAvailable = (userId: CurrentUserValue["id"]) =>
				pluginRuntime.listPluginsAvailableToUser(userId, true);
			const resolveKernelRendererGraph = (
				available: ReadonlyArray<GraphPlugin>,
				kernel: {
					readonly name: string;
					readonly sourceHash: string;
					readonly definition: ClientRendererDefinition;
				},
			) =>
				resolveClientPageGraph({
					kernel: true,
					plugins: available,
					runtimeArtifactHash,
					rendererName: kernel.name,
					definition: kernel.definition,
					sourceHash: kernel.sourceHash,
					rendererArtifactHash: rendererHash(kernel.name, kernel.sourceHash),
				});
			const resolvePluginTarget = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				target: Exclude<ClientPageTarget, { kind: "saved-view" }>,
				available: ReadonlyArray<AvailablePlugin>,
			) {
				const resolved = yield* resolvePluginPageTarget({
					target,
					plugins: available,
					findEntity: (entityId) => entities.getClientPageEntityForUser({ userId, entityId }),
				});
				if (resolved.kind === "kernel-entity") {
					const kernel = getKernelEntityRenderer(resolved.entity.entitySchemaSlug);
					if (!kernel) {
						return yield* new ClientPagePreparationError({
							reason: {
								ownerPluginId: null,
								entityId: resolved.entity.entityId,
								code: "entity-detail-page-not-registered",
								entitySchemaSlug: resolved.entity.entitySchemaSlug,
							},
						});
					}
					const graph = yield* resolveKernelRendererGraph(available, kernel);
					return { ...resolved, graph, operationTargets: clientPageOperationTargets(available) };
				}
				const graph = yield* resolveClientPageGraph({
					plugins: available,
					runtimeArtifactHash,
					plugin: resolved.plugin,
					exportName: resolved.exportName,
					application: target.kind === "plugin-route" ? "plugin-route" : "page",
				});
				return { ...resolved, graph, operationTargets: clientPageOperationTargets(available) };
			});
			const compositionFor = (
				composition: Effect.Success<ReturnType<typeof compositions.getOrMaterialize>>,
			) => ({
				hash: composition.compositionHash,
				format: composition.identity.format,
				apiVersion: composition.identity.apiVersion,
				bridgeVersion: composition.identity.bridgeVersion,
				compilerVersion: composition.identity.compilerVersion,
			});
			const rendererGraph = Effect.fn(function* <Plugin extends GraphPlugin>(
				available: ReadonlyArray<Plugin>,
				renderer: SavedViewRenderer,
			) {
				if (renderer.kind === "kernel") {
					const kernel = getKernelClientRenderer(renderer.name);
					if (!kernel) {
						return yield* savedViewUnavailable();
					}
					const graph = yield* resolveKernelRendererGraph(available, kernel);
					return { graph, kernel, kind: "kernel" as const };
				}
				const plugin = available.find((candidate) => candidate.id === renderer.pluginId);
				if (plugin?.health !== "ready" || !plugin.manifest.client) {
					return yield* new ClientPagePreparationError({
						reason: { code: "plugin-unavailable", pluginId: renderer.pluginId },
					});
				}
				const graph = yield* resolveClientPageGraph({
					plugin,
					plugins: available,
					runtimeArtifactHash,
					application: "page",
					exportName: renderer.exportName,
				});
				return { graph, plugin, kind: "plugin" as const, exportName: renderer.exportName };
			});
			const prepare = Effect.fn("ClientPages.prepare")(function* (
				user: Pick<CurrentUserValue, "id">,
				target: ClientPageTarget,
			) {
				const available = yield* listAvailable(user.id);
				if (target.kind === "saved-view") {
					const prepared = yield* repository
						.findPreparedTarget(user.id, target.slug)
						.pipe(Effect.withSpan("ClientPages.resolve-target"));
					if (!prepared) {
						return yield* savedViewUnavailable();
					}
					const resolved = yield* rendererGraph(available, prepared.view.renderer);
					const composition = yield* compositions.getOrMaterialize(resolved.graph);
					const base = {
						target,
						savedViewId: prepared.viewId,
						viewRevision: prepared.view.revision,
						compositionHash: composition.compositionHash,
						compositionKey: resolved.graph.compositionKey,
						operationTargets: clientPageOperationTargets(available),
						contributors: clientPageCodeContributors(resolved.graph.identity, available),
					};
					let rendererContext: PreparedClientPage["context"]["renderer"];
					let identity: PreparedClientPage["identity"];
					if (resolved.kind === "kernel") {
						rendererContext = { kind: "kernel", name: resolved.kernel.name };
						identity = {
							...base,
							kind: "kernel-saved-view",
							rendererName: resolved.kernel.name,
							sourceHash: resolved.kernel.sourceHash,
						};
					} else {
						rendererContext = {
							kind: "plugin",
							pluginId: resolved.plugin.id,
							exportName: resolved.exportName,
						};
						identity = {
							...base,
							kind: "plugin-saved-view",
							pluginId: resolved.plugin.id,
							exportName: resolved.exportName,
							sourceHash: resolved.plugin.sourceHash,
							installationId: resolved.plugin.installationId,
						};
					}
					return {
						identity,
						composition: compositionFor(composition),
						context: {
							target,
							route: { params: {} },
							renderer: rendererContext,
							settings: prepared.view.settings,
							dataSources: prepared.view.dataSources,
							view: { name: prepared.view.name, icon: prepared.view.icon },
						},
					};
				}
				const resolved = yield* resolvePluginTarget(user.id, target, available).pipe(
					Effect.withSpan("ClientPages.resolve-target"),
				);
				const composition = yield* compositions.getOrMaterialize(resolved.graph);
				const contextTarget =
					target.kind === "entity" && resolved.entity
						? {
								...target,
								entitySchemaSlug: resolved.entity.entitySchemaSlug,
								entitySchemaPluginId: resolved.entity.ownerPluginId,
							}
						: target;
				const base = {
					target,
					operationTargets: resolved.operationTargets,
					compositionHash: composition.compositionHash,
					compositionKey: resolved.graph.compositionKey,
					contributors: clientPageCodeContributors(resolved.graph.identity, available),
				};
				return {
					composition: compositionFor(composition),
					context: {
						view: null,
						settings: {},
						dataSources: null,
						target: contextTarget,
						route: { params: resolved.params },
						renderer:
							resolved.kind === "kernel-entity"
								? { kind: "kernel" as const, name: resolved.rendererName }
								: {
										kind: "plugin" as const,
										pluginId: resolved.plugin.id,
										exportName: resolved.exportName,
									},
					},
					identity:
						resolved.kind === "kernel-entity"
							? {
									...base,
									sourceHash: resolved.sourceHash,
									kind: "kernel-entity-page" as const,
									rendererName: resolved.rendererName,
									entitySchemaSlug: resolved.entity.entitySchemaSlug,
								}
							: {
									...base,
									kind: "plugin-page" as const,
									pluginId: resolved.plugin.id,
									exportName: resolved.exportName,
									sourceHash: resolved.plugin.sourceHash,
									installationId: resolved.plugin.installationId,
								},
				};
			});
			const matchingComposition = Effect.fn(function* (
				available: ReadonlyArray<AvailablePlugin>,
				graph: ResolvedClientPageGraph,
				identity: PreparedClientPage["identity"],
			) {
				if (
					graph.compositionKey !== identity.compositionKey ||
					!Bun.deepEquals(
						clientPageCodeContributors(graph.identity, available),
						identity.contributors,
					)
				) {
					return null;
				}
				const composition = yield* compositions.find(graph);
				return composition?.compositionHash === identity.compositionHash ? composition : null;
			});
			const currentComposition = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				identity: PreparedClientPage["identity"],
			) {
				const available = yield* listAvailable(userId);
				if (!operationTargetsCurrent(available, identity.operationTargets)) {
					return null;
				}
				if (identity.kind === "kernel-saved-view" || identity.kind === "plugin-saved-view") {
					const prepared = yield* repository.findPreparedTarget(userId, identity.target.slug);
					if (
						!prepared ||
						prepared.viewId !== identity.savedViewId ||
						prepared.view.revision !== identity.viewRevision
					) {
						return null;
					}
					const resolved = yield* rendererGraph(available, prepared.view.renderer);
					if (
						identity.kind === "kernel-saved-view" &&
						(resolved.kind !== "kernel" ||
							resolved.kernel.name !== identity.rendererName ||
							resolved.kernel.sourceHash !== identity.sourceHash)
					) {
						return null;
					}
					if (
						identity.kind === "plugin-saved-view" &&
						(resolved.kind !== "plugin" ||
							resolved.plugin.id !== identity.pluginId ||
							resolved.plugin.sourceHash !== identity.sourceHash ||
							resolved.plugin.installationId !== identity.installationId ||
							resolved.exportName !== identity.exportName)
					) {
						return null;
					}
					return yield* matchingComposition(available, resolved.graph, identity);
				}
				const resolved = yield* resolvePluginTarget(userId, identity.target, available);
				if (
					identity.kind === "kernel-entity-page" &&
					(resolved.kind !== "kernel-entity" ||
						resolved.rendererName !== identity.rendererName ||
						resolved.sourceHash !== identity.sourceHash ||
						resolved.entity.entitySchemaSlug !== identity.entitySchemaSlug)
				) {
					return null;
				}
				if (
					identity.kind === "plugin-page" &&
					(resolved.kind !== "plugin" ||
						resolved.plugin.id !== identity.pluginId ||
						resolved.plugin.sourceHash !== identity.sourceHash ||
						resolved.plugin.installationId !== identity.installationId ||
						resolved.exportName !== identity.exportName)
				) {
					return null;
				}
				return yield* matchingComposition(available, resolved.graph, identity);
			});
			const isIdentityCurrent = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				identity: PreparedClientPage["identity"],
			) {
				return (yield* currentComposition(userId, identity)) !== null;
			});
			const document = Effect.fn("ClientPages.document")(function* (
				user: Pick<CurrentUserValue, "id">,
				identity: PreparedClientPage["identity"],
			) {
				const composition = yield* currentComposition(user.id, identity).pipe(
					Effect.catchTags({ ClientPagePreparationError: () => Effect.succeed(null) }),
				);
				if (!composition) {
					return yield* new ClientPageDocumentStale({
						reason: { code: "client-page-document-stale" },
					});
				}
				return yield* generateClientDocument(
					user.id,
					composition.compositionHash,
					composition.manifest,
				).pipe(
					Effect.provideService(ClientArtifactStore, artifactStore),
					Effect.provideService(ClientArtifactGrantService, artifactGrants),
				);
			});
			return { prepare, document, isIdentityCurrent };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
