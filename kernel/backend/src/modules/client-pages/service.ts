import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/client-plugin-compiler/limits";
import {
	isPluginClientTextSource,
	pluginClientFileExtension,
} from "@ryot-app/client-plugin-contract";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ClientPagePreparationError,
	ClientRendererBadRequest,
	ClientRendererDefinition,
	ClientRendererNotFound,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import type { ClientRendererId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Encoding, Layer, Result, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { decodeStoredManifest, PluginRepository } from "#modules/plugins/repository";
import { type AvailablePlugin, PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ClientPageBuildService } from "./build-service";
import { ClientPageArtifactGrantService } from "./grant-service";
import {
	clientPageCodeContributors,
	resolveClientPageArtifactGraph,
	resolveClientPageGraph,
	type GraphPlugin,
	type ResolvedClientPageArtifactGraph,
	type ResolvedClientPageGraph,
} from "./graph";
import {
	getKernelClientRenderer,
	getKernelEntityRenderer,
	listKernelEntityRenderers,
} from "./kernel-renderers";
import { clientPageOperationTargets, resolvePluginPageTarget } from "./prepare";
import { ClientPagesRepository } from "./repository";

const notFound = () => new ClientRendererNotFound({ reason: { code: "renderer-not-found" } });
const invalid = (message: string) =>
	new ClientRendererBadRequest({ reason: { message, code: "definition-invalid" } });

const normalizeDefinition = (definition: ClientRendererDefinition) =>
	Effect.gen(function* () {
		if (new Set(definition.pluginDependencies).size !== definition.pluginDependencies.length) {
			return yield* invalid("Renderer plugin dependencies must be unique");
		}
		const files = [...definition.files].sort((a, b) => a.path.localeCompare(b.path));
		if (new Set(files.map(({ path }) => path)).size !== files.length) {
			return yield* invalid("Renderer file paths must be unique");
		}
		let totalBytes = 0;
		const decoded: Record<string, Uint8Array> = {};
		for (const file of files) {
			if (
				canonicalRelativePosixPathIssue(file.path) ||
				(!file.path.startsWith("client/") && !file.path.startsWith("shared/"))
			) {
				return yield* invalid(
					`Renderer file path '${file.path}' must be canonical under client/ or shared/`,
				);
			}
			if (
				(file.path.startsWith("client/") && pluginClientFileExtension(file.path) === undefined) ||
				(file.path.startsWith("shared/") && !isPluginSharedSource(file.path))
			) {
				return yield* invalid(`Renderer file '${file.path}' has an unsupported extension`);
			}
			const content = Encoding.decodeBase64(file.content);
			if (Result.isFailure(content)) {
				return yield* invalid(`Renderer file '${file.path}' has invalid base64 content`);
			}
			const bytes = content.success;
			decoded[file.path] = bytes;
			totalBytes += bytes.byteLength;
			if (
				!isPluginClientTextSource(file.path) &&
				bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes
			) {
				return yield* invalid(`Renderer asset '${file.path}' is too large`);
			}
			if (
				(isPluginClientTextSource(file.path) || file.path.startsWith("shared/")) &&
				Result.isFailure(Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
			) {
				return yield* invalid(`Renderer text source '${file.path}' is not valid UTF-8`);
			}
		}
		if (totalBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* invalid("Renderer source exceeds the client source limit");
		}
		if (!Object.hasOwn(decoded, definition.entry)) {
			return yield* invalid(`Renderer entry '${definition.entry}' is missing`);
		}
		if (
			!definition.entry.startsWith("client/") ||
			(!definition.entry.endsWith(".ts") && !definition.entry.endsWith(".tsx"))
		) {
			return yield* invalid("Renderer entry must be a TypeScript module under client/");
		}
		const issues = validateAppSchemaDefinition(definition.settingsSchema);
		if (issues.length) {
			return yield* invalid(formatPropertyIssues(issues));
		}
		yield* parseAppSchemaProperties({
			properties: {},
			kind: "Renderer settings",
			propertiesSchema: definition.settingsSchema,
		}).pipe(
			Effect.catchTag("PropertyValidationError", (error) =>
				error.issues.some(({ message }) => message.includes("Dynamic choices"))
					? Effect.fail(invalid(formatPropertyIssues(error.issues)))
					: Effect.void,
			),
		);
		return {
			decoded,
			definition: {
				...definition,
				files,
				pluginDependencies: [...definition.pluginDependencies].sort(),
			},
		};
	});

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
	} & (
		| { kernel: true; sourceHash: string }
		| { rendererId: ClientRendererId; publishedHash: string }
	),
) => ({ ...renderer, plugins: available, rendererFiles: renderer.decoded });

export class ClientPagesService extends Context.Service<ClientPagesService>()(
	"ClientPagesService",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const repository = yield* ClientPagesRepository;
			const builds = yield* ClientPageBuildService;
			const grants = yield* ClientPageArtifactGrantService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const invalidator = yield* PluginCatalogInvalidator;
			const listAvailable = (userId: CurrentUserValue["id"]) =>
				pluginRuntime.listPluginsAvailableToUser(userId, true);
			const loadFiles = (plugin: GraphPlugin) =>
				plugins
					.listRevisionSourceFiles(plugin.pluginRevisionId)
					.pipe(Effect.withSpan("ClientPageBuild.load-source-files"));
			const resolveRendererGraph = (
				available: ReadonlyArray<GraphPlugin>,
				renderer: Parameters<typeof rendererGraphInput>[1],
			) =>
				resolveClientPageGraph({
					...rendererGraphInput(available, renderer),
					loadPluginFiles: loadFiles,
				});
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
			const requireRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				rendererId: string,
			) {
				return (yield* repository.findRenderer(userId, rendererId)) ?? (yield* notFound());
			});
			const createRenderer = Effect.fn(function* (
				user: CurrentUserValue,
				input: { slug: string; name: string; draftDefinition: ClientRendererDefinition },
			) {
				const name = trimToNull(input.name);
				const slug = slugify(input.slug);
				if (!name || !slug) {
					return yield* invalid("Renderer name and slug are required");
				}
				const { definition } = yield* normalizeDefinition(input.draftDefinition);
				return (
					(yield* repository.createRenderer({
						name,
						slug,
						userId: user.id,
						draftDefinition: definition,
					})) ?? (yield* invalid("Renderer slug is already in use"))
				);
			});
			const replaceDraft = Effect.fn(function* (
				user: CurrentUserValue,
				rendererId: string,
				input: { expectedDraftRevision: number; draftDefinition: ClientRendererDefinition },
			) {
				yield* requireRenderer(user.id, rendererId);
				const { definition } = yield* normalizeDefinition(input.draftDefinition);
				return (
					(yield* repository.replaceDraft({
						rendererId,
						definition,
						userId: user.id,
						expectedRevision: input.expectedDraftRevision,
					})) ?? (yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } }))
				);
			});
			const publish = Effect.fn(function* (
				user: CurrentUserValue,
				rendererId: string,
				revision: number,
			) {
				const renderer = yield* requireRenderer(user.id, rendererId);
				if (renderer.draftRevision !== revision) {
					return yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } });
				}
				const { decoded, definition } = yield* normalizeDefinition(renderer.draftDefinition);
				const publishedHash = sha256Hex(
					yield* Schema.encodeUnknownEffect(Schema.fromJsonString(ClientRendererDefinition))(
						definition,
					).pipe(Effect.orDie),
				);
				const graph = yield* resolveRendererGraph(yield* listAvailable(user.id), {
					decoded,
					definition,
					publishedHash,
					rendererId: renderer.id,
					rendererName: renderer.name,
				});
				yield* builds
					.materialize(graph)
					.pipe(
						Effect.catchTag("ClientPluginCompilerFailure", (error) =>
							Effect.fail(
								new ClientRendererBadRequest({
									reason: {
										code: "build-failed",
										diagnostics: error.diagnostics.map(
											({ file, message }) => `${file}: ${message}`,
										),
									},
								}),
							),
						),
					);
				const database = yield* Database;
				yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const current = yield* repository.lockRenderer(user.id, rendererId);
							if (!current || current.draftRevision !== revision) {
								return yield* new ClientRendererBadRequest({
									reason: { code: "draft-revision-stale" },
								});
							}
							for (const dependent of yield* repository.listDependentSettings(
								user.id,
								rendererId,
							)) {
								yield* parseAppSchemaProperties({
									kind: "Saved view settings",
									properties: dependent.settings,
									propertiesSchema: definition.settingsSchema,
								}).pipe(
									Effect.mapError(
										(error) =>
											new ClientRendererBadRequest({
												reason: {
													code: "settings-incompatible",
													message: formatPropertyIssues(error.issues),
												},
											}),
									),
								);
							}
							const currentGraph = yield* resolveRendererGraph(yield* listAvailable(user.id), {
								decoded,
								definition,
								publishedHash,
								rendererId: renderer.id,
								rendererName: renderer.name,
							});
							if (currentGraph.artifactKey !== graph.artifactKey) {
								return yield* invalid("Renderer dependency graph changed during publication");
							}
							return (
								(yield* repository.publish({
									revision,
									rendererId,
									definition,
									publishedHash,
									userId: user.id,
								})) ??
								(yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } }))
							);
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				yield* invalidator.user(user.id);
				return { publishedHash, publishedRevision: revision };
			});
			const deleteRenderer = Effect.fn(function* (user: CurrentUserValue, rendererId: string) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const existing = yield* repository.lockRenderer(user.id, rendererId);
							if (!existing) {
								return yield* notFound();
							}
							if ((yield* repository.listDependentSettings(user.id, rendererId)).length) {
								return yield* new ClientRendererBadRequest({ reason: { code: "renderer-in-use" } });
							}
							return (yield* repository.deleteRenderer(user.id, rendererId)) ?? (yield* notFound());
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});
			const savedViewGraph = Effect.fn(function* (
				_userId: CurrentUserValue["id"],
				prepared: NonNullable<Effect.Success<ReturnType<typeof repository.findPreparedTarget>>>,
				available: ReadonlyArray<AvailablePlugin>,
				withSourceFiles = false,
			) {
				const resolveRenderer = withSourceFiles ? resolveRendererGraph : resolveRendererIdentity;
				if (prepared.view.renderer.kind === "kernel") {
					const kernel = getKernelClientRenderer(prepared.view.renderer.name);
					if (!kernel) {
						return yield* invalid("Kernel client renderer is missing");
					}
					const graph = yield* resolveRenderer(available, {
						kernel: true,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
						decoded: withSourceFiles ? kernel.files : {},
					});
					return { graph, kernel, kind: "kernel" as const };
				}
				if (prepared.view.renderer.kind === "plugin") {
					const selected = prepared.view.renderer;
					const plugin = available.find((candidate) => candidate.id === selected.pluginId);
					if (plugin?.health !== "ready" || !plugin.manifest.client) {
						return yield* new ClientPagePreparationError({
							reason: { code: "plugin-unavailable", pluginId: selected.pluginId },
						});
					}
					const input = {
						plugin,
						plugins: available,
						application: "page" as const,
						exportName: selected.exportName,
					};
					const graph = withSourceFiles
						? yield* resolveClientPageGraph({ ...input, loadPluginFiles: loadFiles })
						: yield* resolveClientPageArtifactGraph(input);
					return { graph, plugin, kind: "plugin" as const, exportName: selected.exportName };
				}
				const renderer = prepared.renderer;
				if (
					!renderer?.publishedHash ||
					prepared.rendererId === null ||
					renderer.publishedRevision === null ||
					!renderer.publishedDefinition
				) {
					return yield* new ClientRendererBadRequest({ reason: { code: "renderer-unpublished" } });
				}
				const { decoded, definition } = withSourceFiles
					? yield* normalizeDefinition(renderer.publishedDefinition)
					: { decoded: {}, definition: renderer.publishedDefinition };
				const graph = yield* resolveRenderer(available, {
					decoded,
					definition,
					rendererName: renderer.name,
					rendererId: prepared.rendererId,
					publishedHash: renderer.publishedHash,
				});
				return {
					graph,
					renderer,
					kind: "custom" as const,
					rendererId: prepared.rendererId,
					publishedHash: renderer.publishedHash,
					publishedRevision: renderer.publishedRevision,
				};
			});
			const materializeRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				renderer: SavedViewRenderer,
			) {
				const available = yield* listAvailable(userId);
				let graph: ResolvedClientPageGraph;
				if (renderer.kind === "kernel") {
					const kernel = getKernelClientRenderer(renderer.name);
					if (!kernel) {
						return yield* invalid("Kernel client renderer is missing");
					}
					graph = yield* resolveRendererGraph(available, {
						kernel: true,
						decoded: kernel.files,
						rendererName: kernel.name,
						definition: kernel.definition,
						sourceHash: kernel.sourceHash,
					});
				} else if (renderer.kind === "plugin") {
					const plugin = available.find((candidate) => candidate.id === renderer.pluginId);
					if (plugin?.health !== "ready" || !plugin.manifest.client) {
						return yield* new ClientPagePreparationError({
							reason: { code: "plugin-unavailable", pluginId: renderer.pluginId },
						});
					}
					graph = yield* resolveClientPageGraph({
						plugin,
						plugins: available,
						application: "page",
						loadPluginFiles: loadFiles,
						exportName: renderer.exportName,
					});
				} else {
					const published = yield* requireRenderer(userId, renderer.rendererId);
					if (!published.publishedHash || !published.publishedDefinition) {
						return yield* new ClientRendererBadRequest({
							reason: { code: "renderer-unpublished" },
						});
					}
					const { decoded, definition } = yield* normalizeDefinition(published.publishedDefinition);
					graph = yield* resolveRendererGraph(available, {
						decoded,
						definition,
						rendererId: published.id,
						rendererName: published.name,
						publishedHash: published.publishedHash,
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
						return yield* new ClientRendererBadRequest({
							reason: { code: "renderer-unpublished" },
						});
					}
					const resolved = yield* savedViewGraph(user.id, prepared, available);
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
					} else if (resolved.kind === "plugin") {
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
					} else {
						rendererContext = { kind: "custom", id: resolved.rendererId };
						identity = {
							...base,
							kind: "saved-view",
							rendererId: resolved.rendererId,
							publishedHash: resolved.publishedHash,
							publishedRevision: resolved.publishedRevision,
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
				if (
					identity.kind === "saved-view" ||
					identity.kind === "kernel-saved-view" ||
					identity.kind === "plugin-saved-view"
				) {
					const prepared = yield* repository.findPreparedTarget(userId, identity.target.slug);
					if (
						!prepared ||
						prepared.viewId !== identity.savedViewId ||
						prepared.view.revision !== identity.viewRevision
					) {
						return false;
					}
					const resolved = yield* savedViewGraph(userId, prepared, available);
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
					if (
						identity.kind === "saved-view" &&
						(resolved.kind !== "custom" ||
							resolved.rendererId !== identity.rendererId ||
							resolved.renderer.publishedHash !== identity.publishedHash ||
							resolved.renderer.publishedRevision !== identity.publishedRevision)
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
				const graphs = new Map<string, ResolvedClientPageGraph>();
				for (const view of yield* repository.listPreparedTargets(userId)) {
					const resolved = yield* savedViewGraph(userId, view, available, true);
					if (!("compilerInput" in resolved.graph)) {
						return yield* Effect.die(
							new Error("Client page materialization requires source files"),
						);
					}
					graphs.set(resolved.graph.artifactKey, resolved.graph);
				}
				for (const plugin of available) {
					if (plugin.health !== "ready" || !plugin.manifest.client) {
						continue;
					}
					if (plugin.manifest.client.routes?.["/"]) {
						const graph = yield* resolveClientPageGraph({
							plugin,
							plugins: available,
							loadPluginFiles: loadFiles,
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
						const graph = yield* resolveClientPageGraph({
							plugin,
							exportName,
							plugins: available,
							application: "page",
							loadPluginFiles: loadFiles,
						});
						graphs.set(graph.artifactKey, graph);
					}
				}
				for (const kernel of listKernelEntityRenderers()) {
					const graph = yield* resolveRendererGraph(available, {
						kernel: true,
						decoded: kernel.files,
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
					const graphs = new Map<string, ResolvedClientPageGraph>();
					const add = (graph: ResolvedClientPageGraph) => void graphs.set(graph.artifactKey, graph);
					const views = yield* mapDatabaseErrors(
						db.select({ renderer: schema.globalSavedView.renderer }).from(schema.globalSavedView),
					);
					for (const { renderer } of views) {
						if (renderer.kind === "kernel") {
							const kernel = getKernelClientRenderer(renderer.name);
							if (!kernel) {
								return yield* invalid("Kernel client renderer is missing");
							}
							add(
								yield* resolveRendererGraph(available, {
									kernel: true,
									decoded: kernel.files,
									rendererName: kernel.name,
									definition: kernel.definition,
									sourceHash: kernel.sourceHash,
								}),
							);
						} else if (renderer.kind === "plugin") {
							const plugin = available.find(({ id }) => id === renderer.pluginId);
							if (!plugin) {
								return yield* invalid("Built-in view plugin is missing");
							}
							add(
								yield* resolveClientPageGraph({
									plugin,
									plugins: available,
									application: "page",
									loadPluginFiles: loadFiles,
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
								yield* resolveClientPageGraph({
									plugin,
									exportName: home,
									plugins: available,
									loadPluginFiles: loadFiles,
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
									application: "page",
									loadPluginFiles: loadFiles,
								}),
							);
						}
					}
					for (const kernel of listKernelEntityRenderers()) {
						add(
							yield* resolveRendererGraph(available, {
								kernel: true,
								decoded: kernel.files,
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
					const { graph } = yield* savedViewGraph(userId, view, available);
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
				publish,
				replaceDraft,
				createRenderer,
				deleteRenderer,
				materializeUser,
				assertUserBuilds,
				isIdentityCurrent,
				materializeRenderer,
				materializeSystemBaseline,
				materializePendingInstallation,
				listRenderers: (userId: CurrentUserValue["id"]) => repository.listRenderers(userId),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
