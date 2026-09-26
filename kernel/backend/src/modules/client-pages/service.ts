import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ClientPagePreparationError,
	type ClientPageTarget,
	type ClientRendererDefinition,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { EntitiesRepository } from "#modules/entities/repository";
import { decodeStoredManifest } from "#modules/plugins/repository";
import { type AvailablePlugin, PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ClientPageCompositionService } from "./composition-service";
import { ClientDocumentGrantService } from "./grant-service";
import {
	clientPageCodeContributors,
	resolveClientPageGraph,
	type GraphPlugin,
	type ResolvedClientPageGraph,
} from "./graph";
import {
	getKernelClientRenderer,
	getKernelEntityRenderer,
	listKernelEntityRenderers,
} from "./kernel-renderers";
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
			const grants = yield* ClientDocumentGrantService;
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
			const requireComposition = Effect.fn("ClientPages.findComposition")(function* (
				graph: ResolvedClientPageGraph,
			) {
				const composition = yield* compositions.find(graph);
				if (!composition) {
					return yield* Effect.die(
						new Error(`Client page composition ${graph.compositionKey} was not materialized`),
					);
				}
				return composition;
			});
			const compositionFor = Effect.fn("ClientPages.issueDocumentGrant")(function* (
				userId: CurrentUserValue["id"],
				composition: Effect.Success<ReturnType<typeof requireComposition>>,
			) {
				const documentGrant = yield* grants.issue(userId, composition.compositionHash);
				return {
					documentGrant,
					hash: composition.compositionHash,
					format: composition.identity.format,
					apiVersion: composition.identity.apiVersion,
					bridgeVersion: composition.identity.bridgeVersion,
					compilerVersion: composition.identity.compilerVersion,
				};
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
			/** Every composition a user can reach: saved views, plugin homes, detail pages, and kernel entity renderers. */
			const collectReachableGraphs = Effect.fn(function* (
				available: ReadonlyArray<GraphPlugin>,
				savedViewRenderers: Iterable<SavedViewRenderer>,
			) {
				const graphs = new Map<string, ResolvedClientPageGraph>();
				const add = (graph: ResolvedClientPageGraph) =>
					void graphs.set(graph.compositionKey, graph);
				for (const renderer of savedViewRenderers) {
					if (
						renderer.kind === "plugin" &&
						!available.some(
							(plugin) =>
								plugin.id === renderer.pluginId &&
								plugin.health === "ready" &&
								plugin.manifest.client,
						)
					) {
						continue;
					}
					add((yield* rendererGraph(available, renderer)).graph);
				}
				for (const plugin of available) {
					if (plugin.health !== "ready" || !plugin.manifest.client) {
						continue;
					}
					const home = plugin.manifest.client.routes?.["/"];
					if (home) {
						add(
							yield* resolveClientPageGraph({
								plugin,
								exportName: home,
								plugins: available,
								runtimeArtifactHash,
								application: "plugin-route",
							}),
						);
					}
					for (const exportName of new Set(
						Object.values(plugin.manifest.client.entities ?? {})
							.map(({ detailPage }) => detailPage)
							.filter((name): name is string => name !== undefined),
					)) {
						add(
							yield* resolveClientPageGraph({
								plugin,
								exportName,
								plugins: available,
								runtimeArtifactHash,
								application: "page",
							}),
						);
					}
				}
				for (const kernel of listKernelEntityRenderers()) {
					add(yield* resolveKernelRendererGraph(available, kernel));
				}
				return graphs;
			});
			const materializeGraphs = (graphs: ReadonlyMap<string, ResolvedClientPageGraph>) =>
				Effect.forEach(graphs.values(), (graph) => compositions.materialize(graph), {
					discard: true,
					concurrency: 8,
				});
			const materializeRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				renderer: SavedViewRenderer,
			) {
				const { graph } = yield* rendererGraph(yield* listAvailable(userId), renderer);
				yield* compositions.materialize(graph);
				return yield* Effect.void;
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
					const composition = yield* requireComposition(resolved.graph);
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
						composition: yield* compositionFor(user.id, composition),
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
				const composition = yield* requireComposition(resolved.graph);
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
					composition: yield* compositionFor(user.id, composition),
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
			const isIdentityCurrent = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				identity: PreparedClientPage["identity"],
			) {
				const available = yield* listAvailable(userId);
				if (!operationTargetsCurrent(available, identity.operationTargets)) {
					return false;
				}
				if (identity.kind === "kernel-saved-view" || identity.kind === "plugin-saved-view") {
					const prepared = yield* repository.findPreparedTarget(userId, identity.target.slug);
					if (
						!prepared ||
						prepared.viewId !== identity.savedViewId ||
						prepared.view.revision !== identity.viewRevision
					) {
						return false;
					}
					const resolved = yield* rendererGraph(available, prepared.view.renderer);
					if (
						identity.kind === "kernel-saved-view" &&
						(resolved.kind !== "kernel" ||
							resolved.kernel.name !== identity.rendererName ||
							resolved.kernel.sourceHash !== identity.sourceHash)
					) {
						return false;
					}
					if (
						identity.kind === "plugin-saved-view" &&
						(resolved.kind !== "plugin" ||
							resolved.plugin.id !== identity.pluginId ||
							resolved.plugin.sourceHash !== identity.sourceHash ||
							resolved.plugin.installationId !== identity.installationId ||
							resolved.exportName !== identity.exportName)
					) {
						return false;
					}
					return (
						resolved.graph.compositionKey === identity.compositionKey &&
						Bun.deepEquals(
							clientPageCodeContributors(resolved.graph.identity, available),
							identity.contributors,
						) &&
						(yield* compositions.find(resolved.graph))?.compositionHash === identity.compositionHash
					);
				}
				const resolved = yield* resolvePluginTarget(userId, identity.target, available);
				if (
					identity.kind === "kernel-entity-page" &&
					(resolved.kind !== "kernel-entity" ||
						resolved.rendererName !== identity.rendererName ||
						resolved.sourceHash !== identity.sourceHash ||
						resolved.entity.entitySchemaSlug !== identity.entitySchemaSlug)
				) {
					return false;
				}
				if (
					identity.kind === "plugin-page" &&
					(resolved.kind !== "plugin" ||
						resolved.plugin.id !== identity.pluginId ||
						resolved.plugin.sourceHash !== identity.sourceHash ||
						resolved.plugin.installationId !== identity.installationId ||
						resolved.exportName !== identity.exportName)
				) {
					return false;
				}
				return (
					resolved.graph.compositionKey === identity.compositionKey &&
					Bun.deepEquals(
						clientPageCodeContributors(resolved.graph.identity, available),
						identity.contributors,
					) &&
					(yield* compositions.find(resolved.graph))?.compositionHash === identity.compositionHash
				);
			});
			const listSavedViewRenderers = (userId: CurrentUserValue["id"]) =>
				repository
					.listPreparedTargets(userId)
					.pipe(Effect.map((views) => views.map(({ view }) => view.renderer)));
			const materializeUserCompositions = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				availableInput?: ReadonlyArray<AvailablePlugin>,
			) {
				const available = availableInput ?? (yield* listAvailable(userId));
				yield* materializeGraphs(
					yield* collectReachableGraphs(available, yield* listSavedViewRenderers(userId)),
				);
				return yield* Effect.void;
			});
			const materializeSystemCompositions = Effect.fn("ClientPages.materializeSystemCompositions")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select({
								id: schema.plugin.id,
								slug: schema.plugin.slug,
								manifest: schema.pluginRevision.manifest,
								pluginRevisionId: schema.pluginRevision.id,
								sourceHash: schema.pluginRevision.sourceHash,
								clientArtifactHash: schema.pluginRevision.clientArtifactHash,
							})
							.from(schema.plugin)
							.innerJoin(
								schema.pluginRevision,
								eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
							)
							.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system"))),
					);
					const available: GraphPlugin[] = yield* Effect.forEach(rows, (row) =>
						decodeStoredManifest(row.manifest, row.slug).pipe(
							Effect.map((manifest) => ({
								manifest,
								id: row.id,
								slug: row.slug,
								isDisabled: false,
								health: "ready" as const,
								sourceHash: row.sourceHash,
								pluginRevisionId: row.pluginRevisionId,
								clientArtifactHash: row.clientArtifactHash,
							})),
						),
					);
					const views = yield* mapDatabaseErrors(
						db.select({ renderer: schema.globalSavedView.renderer }).from(schema.globalSavedView),
					);
					yield* materializeGraphs(
						yield* collectReachableGraphs(
							available,
							views.map(({ renderer }) => renderer),
						),
					);
					return yield* Effect.void;
				},
			);
			const assertUserCompositions = Effect.fn("ClientPages.assertUserCompositions")(function* (
				userId: CurrentUserValue["id"],
			) {
				const graphs = yield* collectReachableGraphs(
					yield* listAvailable(userId),
					yield* listSavedViewRenderers(userId),
				);
				for (const graph of graphs.values()) {
					yield* requireComposition(graph);
				}
			});
			const materializePendingInstallation = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				installationId: string,
			) {
				const available = yield* listAvailable(userId);
				if (!available.some((plugin) => plugin.installationId === installationId)) {
					return yield* Effect.die(new Error("Installing client plugin is unavailable"));
				}
				yield* materializeUserCompositions(
					userId,
					available.map((plugin) =>
						plugin.installationId === installationId
							? Object.assign({}, plugin, { health: "ready" as const })
							: plugin,
					),
				);
				return yield* Effect.void;
			});
			return {
				prepare,
				isIdentityCurrent,
				materializeRenderer,
				assertUserCompositions,
				materializeUserCompositions,
				materializeSystemCompositions,
				materializePendingInstallation,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
