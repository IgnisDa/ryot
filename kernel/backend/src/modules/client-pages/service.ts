import { ClientPluginCompilerFailure } from "@ryot-app/client-plugin-compiler";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/client-plugin-compiler/limits";
import {
	pluginClientFileExtension,
	isPluginClientTextSource,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ClientRendererBadRequest,
	ClientRendererDefinition,
	ClientRendererNotFound,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import type { ClientRendererId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Context, Effect, Encoding, Layer, Result, Schema } from "effect";

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
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { resolveClientPageGraph, type ResolvedClientPageGraph } from "./graph";
import { getKernelClientRenderer } from "./kernel-renderers";
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
		const files = [...definition.files].sort((left, right) => left.path.localeCompare(right.path));
		if (new Set(files.map(({ path }) => path)).size !== files.length) {
			return yield* invalid("Renderer file paths must be unique");
		}
		let totalBytes = 0;
		const decoded: Record<string, Uint8Array> = {};
		for (const file of files) {
			const pathIssue = canonicalRelativePosixPathIssue(file.path);
			if (pathIssue || (!file.path.startsWith("client/") && !file.path.startsWith("shared/"))) {
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
			const decodedContent = Encoding.decodeBase64(file.content);
			if (Result.isFailure(decodedContent)) {
				return yield* invalid(`Renderer file '${file.path}' has invalid base64 content`);
			}
			const bytes = decodedContent.success;
			decoded[file.path] = bytes;
			totalBytes += bytes.byteLength;
			if (
				!isPluginClientTextSource(file.path) &&
				bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes
			) {
				return yield* invalid(`Renderer asset '${file.path}' is too large`);
			}
			if (isPluginClientTextSource(file.path) || file.path.startsWith("shared/")) {
				if (
					Result.isFailure(
						Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
					)
				) {
					return yield* invalid(`Renderer text source '${file.path}' is not valid UTF-8`);
				}
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
		const schemaIssues = validateAppSchemaDefinition(definition.settingsSchema);
		if (schemaIssues.length > 0) {
			return yield* invalid(formatPropertyIssues(schemaIssues));
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

export class ClientPagesService extends Context.Service<ClientPagesService>()(
	"ClientPagesService",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const compiler = yield* ClientPluginCompiler;
			const repository = yield* ClientPagesRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const invalidator = yield* PluginCatalogInvalidator;
			const inFlightCompilations = new Map<string, Promise<PluginClientArtifact>>();
			const operationTargetsCurrent = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				recorded: PreparedClientPage["identity"]["operationTargets"],
			) {
				const current = yield* pluginRuntime.listPluginsAvailableToUser(userId, true);
				return recorded.every((target) =>
					current.some(
						(plugin) =>
							plugin.health === "ready" &&
							plugin.id === target.pluginId &&
							plugin.slug === target.pluginSlug &&
							plugin.sourceHash === target.sourceHash &&
							plugin.installationId === target.installationId,
					),
				);
			});

			const resolveGraph = Effect.fn(function* (
				input:
					| {
							readonly rendererName: string;
							readonly publishedHash: string;
							readonly rendererId: ClientRendererId;
							readonly userId: CurrentUserValue["id"];
							readonly definition: ClientRendererDefinition;
							readonly decoded: Readonly<Record<string, Uint8Array>>;
					  }
					| {
							readonly kernel: true;
							readonly sourceHash: string;
							readonly rendererName: string;
							readonly userId: CurrentUserValue["id"];
							readonly definition: ClientRendererDefinition;
							readonly decoded: Readonly<Record<string, Uint8Array>>;
					  },
			) {
				const snapshot = yield* pluginRuntime.listPluginsAvailableToUser(input.userId, true);
				return yield* resolveClientPageGraph({
					...input,
					plugins: snapshot,
					rendererFiles: input.decoded,
					loadPluginFiles: (plugin) =>
						plugins.listAuthorizedSourceFiles({
							pluginId: plugin.id,
							userId: input.userId,
							sourceHash: plugin.sourceHash,
							installationId: plugin.installationId,
						}),
				});
			});

			const resolvePluginTarget = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				target: Exclude<ClientPageTarget, { readonly kind: "saved-view" }>,
			) {
				const snapshot = yield* pluginRuntime.listPluginsAvailableToUser(userId, true);
				const resolved = yield* resolvePluginPageTarget({
					target,
					plugins: snapshot,
					findEntity: (entityId) => entities.getClientPageEntityForUser({ userId, entityId }),
				});
				const graph = yield* resolveClientPageGraph({
					userId,
					plugins: snapshot,
					plugin: resolved.plugin,
					exportName: resolved.exportName,
					application: target.kind === "plugin-route" ? "plugin-route" : "page",
					loadPluginFiles: (plugin) =>
						plugins.listAuthorizedSourceFiles({
							userId,
							pluginId: plugin.id,
							sourceHash: plugin.sourceHash,
							installationId: plugin.installationId,
						}),
				});
				return { ...resolved, graph, operationTargets: clientPageOperationTargets(snapshot) };
			});

			const compileGraph = (graph: ResolvedClientPageGraph) =>
				Effect.tryPromise({
					catch: (error) =>
						error instanceof ClientPluginCompilerFailure
							? error
							: new ClientPluginCompilerFailure({ diagnostics: [], message: String(error) }),
					try: () => {
						const existing = inFlightCompilations.get(graph.graphHash);
						if (existing) {
							return existing;
						}
						const compilation = Effect.runPromiseWith(Context.empty())(
							compiler.compile(graph.compilerInput),
						);
						inFlightCompilations.set(graph.graphHash, compilation);
						void compilation.then(
							() => inFlightCompilations.delete(graph.graphHash),
							() => inFlightCompilations.delete(graph.graphHash),
						);
						return compilation;
					},
				});

			const requireRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				rendererId: string,
			) {
				return (yield* repository.findRenderer(userId, rendererId)) ?? (yield* notFound());
			});

			const createRenderer = Effect.fn(function* (
				user: CurrentUserValue,
				input: {
					readonly slug: string;
					readonly name: string;
					readonly draftDefinition: ClientRendererDefinition;
				},
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
				input: {
					readonly expectedDraftRevision: number;
					readonly draftDefinition: ClientRendererDefinition;
				},
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
				expectedDraftRevision: number,
			) {
				const renderer = yield* requireRenderer(user.id, rendererId);
				if (renderer.draftRevision !== expectedDraftRevision) {
					return yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } });
				}
				const { decoded, definition } = yield* normalizeDefinition(renderer.draftDefinition);
				const publishedHash = sha256Hex(
					yield* Schema.encodeUnknownEffect(Schema.fromJsonString(ClientRendererDefinition))(
						definition,
					).pipe(Effect.orDie),
				);
				const graph = yield* resolveGraph({
					decoded,
					definition,
					publishedHash,
					userId: user.id,
					rendererId: renderer.id,
					rendererName: renderer.name,
				});
				const artifact = yield* compileGraph(graph).pipe(
					Effect.mapError(
						(error) =>
							new ClientRendererBadRequest({
								reason: {
									code: "build-failed",
									diagnostics: error.diagnostics.map(({ file, message }) => `${file}: ${message}`),
								},
							}),
					),
				);
				const database = yield* Database;
				const buildId = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const current = yield* repository.lockRenderer(user.id, rendererId);
							if (!current || current.draftRevision !== expectedDraftRevision) {
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
							const currentGraph = yield* resolveGraph({
								decoded,
								definition,
								publishedHash,
								userId: user.id,
								rendererId: renderer.id,
								rendererName: renderer.name,
							});
							if (currentGraph.graphHash !== graph.graphHash) {
								return yield* invalid("Renderer dependency graph changed during publication");
							}
							yield* plugins.persistClientArtifact(artifact);
							return (
								(yield* repository.publish({
									rendererId,
									definition,
									publishedHash,
									userId: user.id,
									graphHash: graph.graphHash,
									artifactHash: artifact.hash,
									graphIdentity: graph.identity,
									revision: expectedDraftRevision,
								})) ??
								(yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } }))
							);
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				yield* invalidator.user(user.id);
				return { buildId, publishedHash, publishedRevision: expectedDraftRevision };
			});

			const deleteRenderer = Effect.fn(function* (user: CurrentUserValue, rendererId: string) {
				const existing = yield* requireRenderer(user.id, rendererId);
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							yield* repository.lockRenderer(user.id, rendererId);
							if ((yield* repository.listDependentSettings(user.id, rendererId)).length > 0) {
								return yield* new ClientRendererBadRequest({ reason: { code: "renderer-in-use" } });
							}
							return (yield* repository.deleteRenderer(user.id, rendererId)) ?? existing;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const isIdentityCurrent = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				identity: PreparedClientPage["identity"],
			) {
				if (!(yield* operationTargetsCurrent(userId, identity.operationTargets))) {
					return false;
				}
				if (identity.kind === "plugin-page") {
					const resolved = yield* resolvePluginTarget(userId, identity.target);
					const build = yield* repository.findBuild({
						userId,
						graphHash: resolved.graph.graphHash,
					});
					return (
						resolved.plugin.id === identity.pluginId &&
						resolved.plugin.sourceHash === identity.sourceHash &&
						resolved.plugin.installationId === identity.installationId &&
						resolved.exportName === identity.exportName &&
						resolved.graph.graphHash === identity.graphHash &&
						Bun.deepEquals(resolved.graph.contributors, identity.contributors) &&
						build?.id === identity.buildId &&
						build.artifactHash === identity.artifactHash &&
						Bun.deepEquals(build.graphIdentity, resolved.graph.identity)
					);
				}
				const prepared = yield* repository.findPreparedTarget(userId, identity.savedViewId);
				if (identity.kind === "kernel-saved-view") {
					const kernelRenderer = getKernelClientRenderer(identity.rendererName);
					if (
						!kernelRenderer ||
						prepared?.view.renderer?.kind !== "kernel" ||
						prepared.view.renderer.name !== identity.rendererName ||
						prepared.view.revision !== identity.viewRevision ||
						identity.sourceHash !== kernelRenderer.sourceHash
					) {
						return false;
					}
					const graph = yield* resolveGraph({
						userId,
						kernel: true,
						decoded: kernelRenderer.files,
						rendererName: kernelRenderer.name,
						definition: kernelRenderer.definition,
						sourceHash: kernelRenderer.sourceHash,
					});
					const build = yield* repository.findBuild({ userId, graphHash: graph.graphHash });
					return (
						graph.graphHash === identity.graphHash &&
						Bun.deepEquals(graph.contributors, identity.contributors) &&
						build?.id === identity.buildId &&
						build.artifactHash === identity.artifactHash &&
						Bun.deepEquals(build.graphIdentity, graph.identity)
					);
				}
				const renderer = prepared?.renderer;
				const rendererId = prepared?.rendererId;
				if (
					!prepared ||
					!renderer?.publishedDefinition ||
					renderer.publishedHash === null ||
					renderer.publishedRevision === null ||
					rendererId === null ||
					renderer.publishedHash !== identity.publishedHash ||
					renderer.publishedRevision !== identity.publishedRevision ||
					rendererId !== identity.rendererId ||
					prepared.view.revision !== identity.viewRevision
				) {
					return false;
				}
				const { decoded, definition } = yield* normalizeDefinition(renderer.publishedDefinition);
				const graph = yield* resolveGraph({
					userId,
					decoded,
					definition,
					rendererId,
					rendererName: renderer.name,
					publishedHash: identity.publishedHash,
				});
				if (
					graph.graphHash !== identity.graphHash ||
					!Bun.deepEquals(graph.contributors, identity.contributors)
				) {
					return false;
				}
				const build = yield* repository.findBuild({ userId, graphHash: graph.graphHash });
				return (
					build?.id === identity.buildId &&
					build.artifactHash === identity.artifactHash &&
					Bun.deepEquals(build.graphIdentity, graph.identity)
				);
			});

			const prepareSavedView = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				savedViewId: string,
			) {
				const prepared = yield* repository.findPreparedTarget(user.id, savedViewId);
				const kernelRenderer =
					prepared?.view.renderer?.kind === "kernel"
						? getKernelClientRenderer(prepared.view.renderer.name)
						: undefined;
				if (prepared?.view.renderer?.kind === "kernel" && kernelRenderer) {
					const kernelRendererName = prepared.view.renderer.name;
					const graph = yield* resolveGraph({
						kernel: true,
						userId: user.id,
						decoded: kernelRenderer.files,
						rendererName: kernelRenderer.name,
						definition: kernelRenderer.definition,
						sourceHash: kernelRenderer.sourceHash,
					});
					let build = yield* repository.findBuild({ userId: user.id, graphHash: graph.graphHash });
					if (build && !Bun.deepEquals(build.graphIdentity, graph.identity)) {
						return yield* invalid(
							"Stored kernel client page graph identity does not match its hash",
						);
					}
					if (!build) {
						const artifact = yield* compileGraph(graph).pipe(
							Effect.mapError(
								(error) =>
									new ClientRendererBadRequest({
										reason: {
											code: "build-failed",
											diagnostics: error.diagnostics.map(
												({ file, message }) => `${file}: ${message}`,
											),
										},
									}),
							),
						);
						const database = yield* Database;
						const buildId = yield* mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									const current = yield* repository.lockSavedView(user.id, prepared.viewId);
									if (
										current?.renderer.kind !== "kernel" ||
										current.renderer.name !== kernelRendererName ||
										current.revision !== prepared.view.revision
									) {
										return yield* invalid("Saved view changed during compilation");
									}
									const currentGraph = yield* resolveGraph({
										kernel: true,
										userId: user.id,
										decoded: kernelRenderer.files,
										rendererName: kernelRenderer.name,
										definition: kernelRenderer.definition,
										sourceHash: kernelRenderer.sourceHash,
									});
									if (currentGraph.graphHash !== graph.graphHash) {
										return yield* invalid(
											"Kernel renderer dependency graph changed during compilation",
										);
									}
									yield* plugins.persistClientArtifact(artifact);
									return yield* repository.createBuild({
										userId: user.id,
										graphHash: graph.graphHash,
										artifactHash: artifact.hash,
										graphIdentity: graph.identity,
									});
								}).pipe(Effect.provideService(Database, transaction)),
							),
						);
						if (!buildId) {
							return yield* invalid("Kernel client page build could not be stored");
						}
						build = {
							id: buildId,
							format: artifact.format,
							artifactHash: artifact.hash,
							graphIdentity: graph.identity,
							apiVersion: artifact.apiVersion,
							bridgeVersion: artifact.bridgeVersion,
							compilerVersion: artifact.compilerVersion,
						};
					}
					return {
						artifact: {
							format: build.format,
							hash: build.artifactHash,
							apiVersion: build.apiVersion,
							bridgeVersion: build.bridgeVersion,
							compilerVersion: build.compilerVersion,
						},
						context: {
							route: { params: {} },
							settings: prepared.view.settings,
							dataSources: prepared.view.dataSources,
							view: { name: prepared.view.name, icon: prepared.view.icon },
							renderer: { kind: "kernel" as const, name: kernelRendererName },
							target: { kind: "saved-view" as const, savedViewId: prepared.viewId },
						},
						identity: {
							buildId: build.id,
							graphHash: graph.graphHash,
							savedViewId: prepared.viewId,
							contributors: graph.contributors,
							rendererName: kernelRendererName,
							artifactHash: build.artifactHash,
							kind: "kernel-saved-view" as const,
							viewRevision: prepared.view.revision,
							sourceHash: kernelRenderer.sourceHash,
							target: { kind: "saved-view" as const, savedViewId: prepared.viewId },
							operationTargets: clientPageOperationTargets(
								yield* pluginRuntime.listPluginsAvailableToUser(user.id, true),
							),
						},
					};
				}
				if (!prepared) {
					return yield* new ClientRendererBadRequest({ reason: { code: "renderer-unpublished" } });
				}
				const renderer = prepared.renderer;
				const rendererId = prepared.rendererId;
				if (
					!renderer?.publishedHash ||
					rendererId === null ||
					renderer.publishedRevision === null ||
					!renderer.publishedDefinition
				) {
					return yield* new ClientRendererBadRequest({ reason: { code: "renderer-unpublished" } });
				}
				const publishedHash = renderer.publishedHash;
				const publishedRevision = renderer.publishedRevision;
				const { decoded, definition } = yield* normalizeDefinition(renderer.publishedDefinition);
				const graph = yield* resolveGraph({
					decoded,
					definition,
					rendererId,
					publishedHash,
					userId: user.id,
					rendererName: renderer.name,
				});
				const preparedOperationTargets = clientPageOperationTargets(
					yield* pluginRuntime.listPluginsAvailableToUser(user.id, true),
				);
				let build = yield* repository.findBuild({ userId: user.id, graphHash: graph.graphHash });
				if (build && !Bun.deepEquals(build.graphIdentity, graph.identity)) {
					return yield* invalid("Stored client page graph identity does not match its hash");
				}
				if (!build) {
					const artifact = yield* compileGraph(graph).pipe(
						Effect.mapError(
							(error) =>
								new ClientRendererBadRequest({
									reason: {
										code: "build-failed",
										diagnostics: error.diagnostics.map(
											({ file, message }) => `${file}: ${message}`,
										),
									},
								}),
						),
					);
					const database = yield* Database;
					const buildId = yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								const current = yield* repository.lockRenderer(user.id, rendererId);
								if (current?.publishedHash !== publishedHash) {
									return yield* invalid("Renderer publication changed during compilation");
								}
								const currentGraph = yield* resolveGraph({
									decoded,
									rendererId,
									definition,
									publishedHash,
									userId: user.id,
									rendererName: renderer.name,
								});
								if (currentGraph.graphHash !== graph.graphHash) {
									return yield* invalid("Renderer dependency graph changed during compilation");
								}
								yield* plugins.persistClientArtifact(artifact);
								return yield* repository.createBuild({
									rendererId,
									userId: user.id,
									graphHash: graph.graphHash,
									artifactHash: artifact.hash,
									graphIdentity: graph.identity,
								});
							}).pipe(Effect.provideService(Database, transaction)),
						),
					);
					if (!buildId) {
						return yield* invalid("Client page build could not be stored");
					}
					build = {
						id: buildId,
						format: artifact.format,
						artifactHash: artifact.hash,
						graphIdentity: graph.identity,
						apiVersion: artifact.apiVersion,
						bridgeVersion: artifact.bridgeVersion,
						compilerVersion: artifact.compilerVersion,
					};
				}
				return {
					artifact: {
						format: build.format,
						hash: build.artifactHash,
						apiVersion: build.apiVersion,
						bridgeVersion: build.bridgeVersion,
						compilerVersion: build.compilerVersion,
					},
					context: {
						route: { params: {} },
						settings: prepared.view.settings,
						dataSources: prepared.view.dataSources,
						renderer: { id: rendererId, kind: "custom" as const },
						view: { name: prepared.view.name, icon: prepared.view.icon },
						target: { kind: "saved-view" as const, savedViewId: prepared.viewId },
					},
					identity: {
						rendererId,
						publishedHash,
						buildId: build.id,
						publishedRevision,
						graphHash: graph.graphHash,
						kind: "saved-view" as const,
						savedViewId: prepared.viewId,
						contributors: graph.contributors,
						artifactHash: build.artifactHash,
						viewRevision: prepared.view.revision,
						operationTargets: preparedOperationTargets,
						target: { kind: "saved-view" as const, savedViewId: prepared.viewId },
					},
				};
			});

			const prepare = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				target: ClientPageTarget,
			) {
				if (target.kind === "saved-view") {
					return yield* prepareSavedView(user, target.savedViewId);
				}
				const resolved = yield* resolvePluginTarget(user.id, target);
				let build = yield* repository.findBuild({
					userId: user.id,
					graphHash: resolved.graph.graphHash,
				});
				if (build && !Bun.deepEquals(build.graphIdentity, resolved.graph.identity)) {
					return yield* invalid("Stored plugin page graph identity does not match its hash");
				}
				if (!build) {
					const artifact = yield* compileGraph(resolved.graph).pipe(
						Effect.mapError(
							(error) =>
								new ClientRendererBadRequest({
									reason: {
										code: "build-failed",
										diagnostics: error.diagnostics.map(
											({ file, message }) => `${file}: ${message}`,
										),
									},
								}),
						),
					);
					yield* plugins.persistClientArtifact(artifact);
					const buildId = yield* repository.createBuild({
						userId: user.id,
						artifactHash: artifact.hash,
						graphHash: resolved.graph.graphHash,
						graphIdentity: resolved.graph.identity,
					});
					if (!buildId) {
						return yield* invalid("Plugin page build could not be stored");
					}
					build = {
						id: buildId,
						format: artifact.format,
						artifactHash: artifact.hash,
						apiVersion: artifact.apiVersion,
						bridgeVersion: artifact.bridgeVersion,
						graphIdentity: resolved.graph.identity,
						compilerVersion: artifact.compilerVersion,
					};
				}
				let contextTarget;
				if (target.kind === "entity") {
					if (!resolved.entity) {
						return yield* invalid("Resolved entity page is missing entity context");
					}
					contextTarget = {
						...target,
						entitySchemaSlug: resolved.entity.entitySchemaSlug,
						entitySchemaPluginId: resolved.entity.ownerPluginId,
					};
				} else {
					contextTarget = target;
				}
				return {
					artifact: {
						format: build.format,
						hash: build.artifactHash,
						apiVersion: build.apiVersion,
						bridgeVersion: build.bridgeVersion,
						compilerVersion: build.compilerVersion,
					},
					context: {
						view: null,
						settings: {},
						dataSources: null,
						target: contextTarget,
						route: { params: resolved.params },
						renderer: {
							kind: "plugin" as const,
							pluginId: resolved.plugin.id,
							exportName: resolved.exportName,
						},
					},
					identity: {
						target,
						buildId: build.id,
						kind: "plugin-page" as const,
						pluginId: resolved.plugin.id,
						exportName: resolved.exportName,
						artifactHash: build.artifactHash,
						graphHash: resolved.graph.graphHash,
						sourceHash: resolved.plugin.sourceHash,
						contributors: resolved.graph.contributors,
						operationTargets: resolved.operationTargets,
						installationId: resolved.plugin.installationId,
					},
				};
			});

			return {
				prepare,
				publish,
				replaceDraft,
				createRenderer,
				deleteRenderer,
				isIdentityCurrent,
				getRenderer: requireRenderer,
				listRenderers: (userId: CurrentUserValue["id"]) => repository.listRenderers(userId),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
