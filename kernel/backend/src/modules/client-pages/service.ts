import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/client-plugin-compiler/limits";
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
import { EntitiesRepository } from "#modules/entities/repository";
import { decodeStoredManifest } from "#modules/plugins/repository";
import { type AvailablePlugin, PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ClientPageBuildService } from "./build-service";
import { ClientPageArtifactGrantService } from "./grant-service";
import {
	clientPageCodeContributors,
	resolveClientPageArtifactGraph,
	type GraphPlugin,
	type ResolvedClientPageArtifactGraph,
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

const rendererGraphInput = (
	available: ReadonlyArray<GraphPlugin>,
	renderer: {
		rendererName: string;
		definition: ClientRendererDefinition;
		decoded: Readonly<Record<string, Uint8Array>>;
		kernel: true;
		sourceHash: string;
	},
) => ({ ...renderer, plugins: available, rendererFiles: renderer.decoded });

const savedViewUnavailable = () =>
	new ClientPagePreparationError({ reason: { code: "saved-view-unavailable" } });

export class ClientPagesService extends Context.Service<ClientPagesService>()(
	"ClientPagesService",
	{
		make: Effect.gen(function* () {
			const entities = yield* EntitiesRepository;
			const repository = yield* ClientPagesRepository;
			const builds = yield* ClientPageBuildService;
			const grants = yield* ClientPageArtifactGrantService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const listAvailable = (userId: CurrentUserValue["id"]) =>
				pluginRuntime.listPluginsAvailableToUser(userId, true);
			const resolveRendererIdentity = (
				available: ReadonlyArray<GraphPlugin>,
				renderer: Parameters<typeof rendererGraphInput>[1],
			) => resolveClientPageArtifactGraph(rendererGraphInput(available, renderer));
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
					const graph = yield* resolveRendererIdentity(available, {
						decoded: {},
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
					return { ...resolved, graph, operationTargets: clientPageOperationTargets(available) };
				}
				const graph = yield* resolveClientPageArtifactGraph({
					plugins: available,
					plugin: resolved.plugin,
					exportName: resolved.exportName,
					application: target.kind === "plugin-route" ? "plugin-route" : "page",
				});
				return { ...resolved, graph, operationTargets: clientPageOperationTargets(available) };
			});
			const requireBuild = Effect.fn("ClientPages.findBuild")(function* (
				graph: ResolvedClientPageArtifactGraph,
			) {
				const build = yield* builds.find(graph);
				if (!build) {
					return yield* Effect.die(
						new Error(`Client page artifact ${graph.artifactKey} was not materialized`),
					);
				}
				return build;
			});
			const artifactFor = Effect.fn("ClientPages.issueArtifactGrant")(function* (
				userId: CurrentUserValue["id"],
				build: Effect.Success<ReturnType<typeof requireBuild>>,
			) {
				const grant = yield* grants.issue(userId, build.artifactHash);
				return {
					grant,
					format: build.format,
					hash: build.artifactHash,
					apiVersion: build.apiVersion,
					bridgeVersion: build.bridgeVersion,
					compilerVersion: build.compilerVersion,
				};
			});
			const savedViewGraph = Effect.fn(function* (
				prepared: NonNullable<Effect.Success<ReturnType<typeof repository.findPreparedTarget>>>,
				available: ReadonlyArray<AvailablePlugin>,
			) {
				if (prepared.view.renderer.kind === "kernel") {
					const kernel = getKernelClientRenderer(prepared.view.renderer.name);
					if (!kernel) {
						return yield* savedViewUnavailable();
					}
					const graph = yield* resolveRendererIdentity(available, {
						decoded: {},
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
					return { graph, kernel, kind: "kernel" as const };
				}
				const selected = prepared.view.renderer;
				const plugin = available.find((candidate) => candidate.id === selected.pluginId);
				if (plugin?.health !== "ready" || !plugin.manifest.client) {
					return yield* new ClientPagePreparationError({
						reason: { code: "plugin-unavailable", pluginId: selected.pluginId },
					});
				}
				const graph = yield* resolveClientPageArtifactGraph({
					plugin,
					plugins: available,
					application: "page",
					exportName: selected.exportName,
				});
				return { graph, plugin, kind: "plugin" as const, exportName: selected.exportName };
			});
			const materializeRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				renderer: SavedViewRenderer,
			) {
				const available = yield* listAvailable(userId);
				let graph: ResolvedClientPageArtifactGraph;
				if (renderer.kind === "kernel") {
					const kernel = getKernelClientRenderer(renderer.name);
					if (!kernel) {
						return yield* savedViewUnavailable();
					}
					graph = yield* resolveRendererIdentity(available, {
						decoded: {},
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
				} else {
					const plugin = available.find((candidate) => candidate.id === renderer.pluginId);
					if (plugin?.health !== "ready" || !plugin.manifest.client) {
						return yield* new ClientPagePreparationError({
							reason: { code: "plugin-unavailable", pluginId: renderer.pluginId },
						});
					}
					graph = yield* resolveClientPageArtifactGraph({
						plugin,
						plugins: available,
						application: "page",
						exportName: renderer.exportName,
					});
				}
				yield* builds.materialize(graph);
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
					const resolved = yield* savedViewGraph(prepared, available);
					const build = yield* requireBuild(resolved.graph);
					const base = {
						target,
						savedViewId: prepared.viewId,
						artifactHash: build.artifactHash,
						viewRevision: prepared.view.revision,
						artifactKey: resolved.graph.artifactKey,
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
						artifact: yield* artifactFor(user.id, build),
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
				const build = yield* requireBuild(resolved.graph);
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
					artifactHash: build.artifactHash,
					artifactKey: resolved.graph.artifactKey,
					operationTargets: resolved.operationTargets,
					contributors: clientPageCodeContributors(resolved.graph.identity, available),
				};
				return {
					artifact: yield* artifactFor(user.id, build),
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
					const resolved = yield* savedViewGraph(prepared, available);
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
						resolved.graph.artifactKey === identity.artifactKey &&
						Bun.deepEquals(
							clientPageCodeContributors(resolved.graph.identity, available),
							identity.contributors,
						) &&
						(yield* builds.find(resolved.graph))?.artifactHash === identity.artifactHash
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
					resolved.graph.artifactKey === identity.artifactKey &&
					Bun.deepEquals(
						clientPageCodeContributors(resolved.graph.identity, available),
						identity.contributors,
					) &&
					(yield* builds.find(resolved.graph))?.artifactHash === identity.artifactHash
				);
			});
			const materializeUser = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				availableInput?: ReadonlyArray<AvailablePlugin>,
			) {
				const available = availableInput ?? (yield* listAvailable(userId));
				const graphs = new Map<string, ResolvedClientPageArtifactGraph>();
				for (const view of yield* repository.listPreparedTargets(userId)) {
					const resolved = yield* savedViewGraph(view, available);
					graphs.set(resolved.graph.artifactKey, resolved.graph);
				}
				for (const plugin of available) {
					if (plugin.health !== "ready" || !plugin.manifest.client) {
						continue;
					}
					if (plugin.manifest.client.routes?.["/"]) {
						const graph = yield* resolveClientPageArtifactGraph({
							plugin,
							plugins: available,
							application: "plugin-route",
							exportName: plugin.manifest.client.routes["/"],
						});
						graphs.set(graph.artifactKey, graph);
					}
					const detailPages = new Set(
						Object.values(plugin.manifest.client.entities ?? {})
							.map((entity) => entity.detailPage)
							.filter((name): name is string => name !== undefined),
					);
					for (const exportName of detailPages) {
						const graph = yield* resolveClientPageArtifactGraph({
							plugin,
							exportName,
							plugins: available,
							application: "page",
						});
						graphs.set(graph.artifactKey, graph);
					}
				}
				for (const kernel of listKernelEntityRenderers()) {
					const graph = yield* resolveRendererIdentity(available, {
						decoded: {},
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
					graphs.set(graph.artifactKey, graph);
				}
				yield* Effect.forEach(graphs.values(), (graph) => builds.materialize(graph), {
					discard: true,
					concurrency: CLIENT_PLUGIN_COMPILER_LIMITS.concurrency,
				});
				return yield* Effect.void;
			});
			const materializeSystemBaseline = Effect.fn("ClientPages.materializeSystemBaseline")(
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
							})),
						),
					);
					const graphs = new Map<string, ResolvedClientPageArtifactGraph>();
					const add = (graph: ResolvedClientPageArtifactGraph) =>
						void graphs.set(graph.artifactKey, graph);
					const views = yield* mapDatabaseErrors(
						db.select({ renderer: schema.globalSavedView.renderer }).from(schema.globalSavedView),
					);
					for (const { renderer } of views) {
						if (renderer.kind === "kernel") {
							const kernel = getKernelClientRenderer(renderer.name);
							if (!kernel) {
								return yield* savedViewUnavailable();
							}
							add(
								yield* resolveRendererIdentity(available, {
									decoded: {},
									kernel: true,
									rendererName: kernel.name,
									definition: kernel.definition,
									sourceHash: kernel.sourceHash,
								}),
							);
						} else {
							const plugin = available.find(({ id }) => id === renderer.pluginId);
							if (!plugin) {
								return yield* savedViewUnavailable();
							}
							add(
								yield* resolveClientPageArtifactGraph({
									plugin,
									plugins: available,
									application: "page",
									exportName: renderer.exportName,
								}),
							);
						}
					}
					for (const plugin of available) {
						if (!plugin.manifest.client) {
							continue;
						}
						const home = plugin.manifest.client.routes?.["/"];
						if (home) {
							add(
								yield* resolveClientPageArtifactGraph({
									plugin,
									exportName: home,
									plugins: available,
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
								yield* resolveClientPageArtifactGraph({
									plugin,
									exportName,
									plugins: available,
									application: "page",
								}),
							);
						}
					}
					for (const kernel of listKernelEntityRenderers()) {
						add(
							yield* resolveRendererIdentity(available, {
								decoded: {},
								kernel: true,
								rendererName: kernel.name,
								definition: kernel.definition,
								sourceHash: kernel.sourceHash,
							}),
						);
					}
					yield* Effect.forEach(graphs.values(), (graph) => builds.materialize(graph), {
						discard: true,
						concurrency: CLIENT_PLUGIN_COMPILER_LIMITS.concurrency,
					});
					return yield* Effect.void;
				},
			);
			const assertUserBuilds = Effect.fn("ClientPages.assertUserBuilds")(function* (
				userId: CurrentUserValue["id"],
			) {
				const available = yield* listAvailable(userId);
				const graphs = new Map<string, ResolvedClientPageArtifactGraph>();
				for (const view of yield* repository.listPreparedTargets(userId)) {
					const { graph } = yield* savedViewGraph(view, available);
					graphs.set(graph.artifactKey, graph);
				}
				for (const plugin of available) {
					if (plugin.health !== "ready" || !plugin.manifest.client) {
						continue;
					}
					const home = plugin.manifest.client.routes?.["/"];
					if (home) {
						const graph = yield* resolveClientPageArtifactGraph({
							plugin,
							exportName: home,
							plugins: available,
							application: "plugin-route",
						});
						graphs.set(graph.artifactKey, graph);
					}
					for (const exportName of new Set(
						Object.values(plugin.manifest.client.entities ?? {})
							.map(({ detailPage }) => detailPage)
							.filter((name): name is string => name !== undefined),
					)) {
						const graph = yield* resolveClientPageArtifactGraph({
							plugin,
							exportName,
							plugins: available,
							application: "page",
						});
						graphs.set(graph.artifactKey, graph);
					}
				}
				for (const kernel of listKernelEntityRenderers()) {
					const graph = yield* resolveRendererIdentity(available, {
						decoded: {},
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
					graphs.set(graph.artifactKey, graph);
				}
				for (const graph of graphs.values()) {
					yield* requireBuild(graph);
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
				yield* materializeUser(
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
				materializeUser,
				assertUserBuilds,
				isIdentityCurrent,
				materializeRenderer,
				materializeSystemBaseline,
				materializePendingInstallation,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
