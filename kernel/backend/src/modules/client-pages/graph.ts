import type {
	ClientPluginAutomaticRegistryEntry,
	ClientPluginCompilerGraphInput,
} from "@ryot-app/client-plugin-compiler";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import {
	ClientRendererBadRequest,
	type ClientPageCodeContributor,
	type ClientPageArtifactIdentity,
	type ClientRendererDefinition,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug, type ClientRendererId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Result } from "effect";

import type { AvailablePlugin } from "#modules/plugins/runtime-resolver";

const PUBLIC_EXPORT =
	/^@ryot-app\/plugins\/([a-z0-9]+(?:[._-][a-z0-9]+)*)\/([a-z0-9]+(?:[._-][a-z0-9]+)*)$/;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"] as const;
const transpiler = new Bun.Transpiler({ loader: "tsx" });

const importedSpecifiers = (source: string) => {
	const scanned = Result.try(() => transpiler.scanImports(source));
	return Result.isSuccess(scanned) ? scanned.success.map(({ path }) => path) : [];
};

const dependencyUnavailable = (pluginSlug: string) =>
	new ClientRendererBadRequest({
		reason: { code: "dependency-unavailable", pluginSlug: PluginSlug.make(pluginSlug) },
	});

const exportNotFound = (exportName: string) =>
	new ClientRendererBadRequest({ reason: { exportName, code: "export-not-found" } });

const namespaceFor = (kind: "kernel" | "plugin" | "renderer", id: string) =>
	`${kind}-${sha256Hex(id)}`;

const sourceFiles = (files: Readonly<Record<string, Uint8Array>>) =>
	Object.fromEntries(
		Object.entries(files).filter(
			([path]) => path.startsWith("client/") || path.startsWith("shared/"),
		),
	);

const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/") + 1));

const normalizeRelative = (from: string, specifier: string) => {
	const segments = `${dirname(from)}${specifier}`.split("/");
	const normalized: string[] = [];
	for (const segment of segments) {
		if (segment === "." || segment === "") {
			continue;
		}
		if (segment === "..") {
			normalized.pop();
		} else {
			normalized.push(segment);
		}
	}
	return normalized.join("/");
};

export type ResolvedClientPageGraph = {
	readonly artifactKey: string;
	readonly identity: ClientPageArtifactIdentity;
	readonly compilerInput: ClientPluginCompilerGraphInput;
};
export type ResolvedClientPageArtifactGraph = Omit<ResolvedClientPageGraph, "compilerInput">;

export type GraphPlugin = Pick<
	AvailablePlugin,
	"id" | "slug" | "sourceHash" | "manifest" | "health" | "isDisabled" | "pluginRevisionId"
>;

export const clientPageCodeContributors = (
	identity: ClientPageArtifactIdentity,
	available: ReadonlyArray<AvailablePlugin>,
): readonly ClientPageCodeContributor[] => {
	const bySlug = new Map(available.map((plugin) => [plugin.slug, plugin]));
	return identity.contributors.map((contributor) => {
		if (contributor.kind === "kernel-renderer") {
			return {
				name: contributor.name,
				kind: "kernel-renderer",
				sourceHash: contributor.sourceHash,
			};
		}
		if (contributor.kind === "renderer") {
			return {
				kind: "renderer",
				rendererId: contributor.rendererId,
				sourceHash: contributor.sourceHash,
			};
		}
		const installed = bySlug.get(contributor.pluginSlug);
		if (!installed || installed.id !== contributor.pluginId) {
			throw new Error(`Missing runtime installation for ${contributor.pluginSlug}`);
		}
		return {
			kind: "plugin",
			pluginId: contributor.pluginId,
			pluginSlug: contributor.pluginSlug,
			sourceHash: contributor.sourceHash,
			installationId: installed.installationId,
		};
	});
};

type ClientPageGraphCommon<E, R> = {
	readonly plugins: ReadonlyArray<GraphPlugin>;
	readonly loadPluginFiles?: (
		plugin: GraphPlugin,
	) => Effect.Effect<Readonly<Record<string, Uint8Array>> | null, E, R>;
};

type RendererClientPageGraphInput<E, R> = ClientPageGraphCommon<E, R> & {
	readonly rendererName: string;
	readonly publishedHash: string;
	readonly rendererId: ClientRendererId;
	readonly definition: ClientRendererDefinition;
	readonly rendererFiles: Readonly<Record<string, Uint8Array>>;
};

type KernelRendererClientPageGraphInput<E, R> = ClientPageGraphCommon<E, R> & {
	readonly kernel: true;
	readonly sourceHash: string;
	readonly rendererName: string;
	readonly definition: ClientRendererDefinition;
	readonly rendererFiles: Readonly<Record<string, Uint8Array>>;
};

type PluginClientPageGraphInput<E, R> = ClientPageGraphCommon<E, R> & {
	readonly exportName: string;
	readonly plugin: GraphPlugin;
	readonly application: "page" | "plugin-route";
};

type ClientPageGraphInput<E, R> =
	| RendererClientPageGraphInput<E, R>
	| KernelRendererClientPageGraphInput<E, R>
	| PluginClientPageGraphInput<E, R>;

const resolveGraph = <E, R>(
	input: ClientPageGraphInput<E, R>,
): Effect.Effect<ResolvedClientPageGraph, ClientRendererBadRequest | E, R> =>
	Effect.gen(function* () {
		const isRenderer = "definition" in input;
		const isKernel = isRenderer && "kernel" in input;
		const rendererNamespace = isRenderer
			? namespaceFor(
					isKernel ? "kernel" : "renderer",
					isKernel ? input.rendererName : input.rendererId,
				)
			: null;
		const catalog = new Map(input.plugins.map((plugin) => [plugin.slug, plugin]));
		const included = new Map<string, GraphPlugin>();
		const files = new Map<string, Readonly<Record<string, Uint8Array>>>();
		const dependencyOrder: string[] = [];
		const selectedExports = new Set<string>();
		const primarySlug = isRenderer ? null : input.plugin.slug;

		const includePlugin = (slug: string): Effect.Effect<void, ClientRendererBadRequest | E, R> =>
			Effect.gen(function* () {
				if (included.has(slug)) {
					return yield* Effect.void;
				}
				const plugin = catalog.get(slug);
				if (plugin?.health !== "ready" || !plugin.manifest.client) {
					return yield* dependencyUnavailable(slug);
				}
				included.set(slug, plugin);
				if (input.loadPluginFiles) {
					const loaded = yield* input.loadPluginFiles(plugin);
					if (!loaded) {
						return yield* dependencyUnavailable(slug);
					}
					files.set(slug, sourceFiles(loaded));
				}
				for (const dependency of sortBy(plugin.manifest.client.pluginDependencies ?? [])) {
					yield* includePlugin(dependency);
				}
				if (slug !== primarySlug) {
					for (const exportName of Object.keys(plugin.manifest.client.exports ?? {})) {
						selectedExports.add(`@ryot-app/plugins/${slug}/${exportName}`);
					}
				}
				dependencyOrder.push(slug);
				return yield* Effect.void;
			});

		if (isRenderer) {
			for (const dependency of sortBy(input.definition.pluginDependencies)) {
				yield* includePlugin(dependency);
			}
		} else {
			if (input.plugin.health !== "ready" || !input.plugin.manifest.client) {
				return yield* dependencyUnavailable(input.plugin.slug);
			}
			catalog.set(input.plugin.slug, input.plugin);
			yield* includePlugin(input.plugin.slug);
		}

		const visited = new Set<string>();
		const routeRegistry =
			!isRenderer && input.application === "plugin-route"
				? (() => {
						const routes = Object.entries(input.plugin.manifest.client?.routes ?? {}).sort(
							([left], [right]) => comparePluginRoutePaths(left, right),
						);
						const home = routes.find(([path]) => path === "/")?.[1];
						return home
							? {
									home: `@ryot-app/plugins/${input.plugin.slug}/${home}`,
									routes: routes.flatMap(([path, exportName]) =>
										path === "/"
											? []
											: [
													{
														path,
														exportSpecifier: `@ryot-app/plugins/${input.plugin.slug}/${exportName}`,
													},
												],
									),
									...(input.plugin.manifest.client?.notFoundPage
										? {
												notFound: `@ryot-app/plugins/${input.plugin.slug}/${input.plugin.manifest.client.notFoundPage}`,
											}
										: {}),
								}
							: null;
					})()
				: null;
		if (!isRenderer && input.application === "plugin-route" && !routeRegistry) {
			return yield* exportNotFound(`@ryot-app/plugins/${input.plugin.slug}/route:/`);
		}
		const selectedPluginExport = isRenderer
			? null
			: input.plugin.manifest.client?.exports?.[
					input.application === "plugin-route"
						? (input.plugin.manifest.client.routes?.["/"] ?? "")
						: input.exportName
				];
		if (!isRenderer && selectedPluginExport?.kind !== "page") {
			return yield* exportNotFound(`@ryot-app/plugins/${input.plugin.slug}/${input.exportName}`);
		}
		let automaticEntityPresentations = isRenderer
			? input.definition.automaticEntityPresentations
			: (selectedPluginExport?.automaticEntityPresentations ?? false);
		if (!isRenderer && input.application === "plugin-route") {
			automaticEntityPresentations = [
				...Object.values(input.plugin.manifest.client?.routes ?? {}),
				input.plugin.manifest.client?.notFoundPage,
			]
				.filter((name): name is string => name !== undefined)
				.some(
					(name) =>
						input.plugin.manifest.client?.exports?.[name]?.automaticEntityPresentations ?? false,
				);
		}
		if (!automaticEntityPresentations) {
			automaticEntityPresentations = [...included.values()].some(
				(plugin) =>
					plugin.slug !== primarySlug &&
					Object.values(plugin.manifest.client?.exports ?? {}).some(
						(declaration) => declaration.automaticEntityPresentations,
					),
			);
		}

		const scan = (
			owner: { readonly slug: string | null; readonly dependencies: readonly string[] },
			path: string,
			ownerFiles: Readonly<Record<string, Uint8Array>>,
		): Effect.Effect<void, ClientRendererBadRequest | E, R> =>
			Effect.gen(function* () {
				const key = `${owner.slug ?? rendererNamespace ?? "renderer"}:${path}`;
				if (visited.has(key)) {
					return yield* Effect.void;
				}
				visited.add(key);
				const contents = ownerFiles[path];
				if (!contents || (!path.endsWith(".ts") && !path.endsWith(".tsx"))) {
					return yield* Effect.void;
				}
				const text = new TextDecoder().decode(contents);
				for (const imported of importedSpecifiers(text)) {
					const specifier = imported;
					const match = PUBLIC_EXPORT.exec(specifier);
					if (match) {
						const [, pluginSlug, exportName] = match;
						if (!pluginSlug || !exportName || !owner.dependencies.includes(pluginSlug)) {
							return yield* exportNotFound(specifier);
						}
						yield* includePlugin(pluginSlug);
						const plugin = included.get(pluginSlug);
						const declaration = plugin?.manifest.client?.exports?.[exportName];
						if (!plugin || !declaration) {
							return yield* exportNotFound(specifier);
						}
						yield* scan(
							{ slug: pluginSlug, dependencies: plugin.manifest.client.pluginDependencies ?? [] },
							declaration.entry,
							files.get(pluginSlug) ?? {},
						);
						continue;
					}
					if (!specifier.startsWith(".")) {
						continue;
					}
					const relative = normalizeRelative(path, specifier);
					const resolved = SOURCE_EXTENSIONS.map((extension) => `${relative}${extension}`).find(
						(candidate) => ownerFiles[candidate] !== undefined,
					);
					if (resolved) {
						yield* scan(owner, resolved, ownerFiles);
					}
				}
				return yield* Effect.void;
			});

		if (isRenderer) {
			if (input.loadPluginFiles) {
				yield* scan(
					{ slug: null, dependencies: input.definition.pluginDependencies },
					input.definition.entry,
					input.rendererFiles,
				);
			}
		} else {
			const exportNames =
				input.application === "plugin-route"
					? [
							...Object.values(input.plugin.manifest.client?.routes ?? {}),
							...(input.plugin.manifest.client?.notFoundPage
								? [input.plugin.manifest.client.notFoundPage]
								: []),
						]
					: [input.exportName];
			for (const exportName of sortBy([...new Set(exportNames)])) {
				const specifier = `@ryot-app/plugins/${input.plugin.slug}/${exportName}`;
				const declaration = input.plugin.manifest.client?.exports?.[exportName];
				if (declaration?.kind !== "page") {
					return yield* exportNotFound(specifier);
				}
				selectedExports.add(specifier);
				if (input.loadPluginFiles) {
					yield* scan(
						{
							slug: input.plugin.slug,
							dependencies: input.plugin.manifest.client?.pluginDependencies ?? [],
						},
						declaration.entry,
						files.get(input.plugin.slug) ?? {},
					);
				}
			}
		}

		const automaticRegistry: ClientPluginAutomaticRegistryEntry[] = [];
		if (automaticEntityPresentations) {
			for (const plugin of sortBy(
				input.plugins.filter(
					(candidate) =>
						candidate.health === "ready" && !candidate.isDisabled && candidate.manifest.client,
				),
				(candidate) => candidate.slug,
			)) {
				const client = plugin.manifest.client;
				if (!client) {
					continue;
				}
				for (const [entitySchemaSlug, registrations] of sortBy(
					Object.entries(client.entities ?? {}),
					([slug]) => slug,
				)) {
					for (const [layout, exportName] of [
						["grid", registrations.gridPresentation],
						["list", registrations.listPresentation],
					] as const) {
						if (!exportName) {
							continue;
						}
						yield* includePlugin(plugin.slug);
						const exportSpecifier = `@ryot-app/plugins/${plugin.slug}/${exportName}`;
						const declaration = client.exports?.[exportName];
						if (declaration?.kind !== "presentation") {
							return yield* exportNotFound(exportSpecifier);
						}
						selectedExports.add(exportSpecifier);
						automaticRegistry.push({
							layout,
							exportSpecifier,
							entitySchemaSlug,
							ownerPluginId: plugin.id,
						});
						yield* scan(
							{ slug: plugin.slug, dependencies: client.pluginDependencies ?? [] },
							declaration.entry,
							files.get(plugin.slug) ?? {},
						);
					}
				}
			}
		}

		const orderedPlugins = dependencyOrder.flatMap((slug) => {
			const plugin = included.get(slug);
			return plugin ? [plugin] : [];
		});
		const publicExports = Object.fromEntries(
			orderedPlugins.flatMap((plugin) =>
				sortBy(Object.entries(plugin.manifest.client?.exports ?? {}), ([name]) => name).map(
					([name, declaration]) =>
						[
							`@ryot-app/plugins/${plugin.slug}/${name}`,
							{
								kind: declaration.kind,
								entry: declaration.entry,
								contributor: namespaceFor("plugin", plugin.id),
							},
						] as const,
				),
			),
		);
		const entry = isRenderer
			? { path: input.definition.entry, contributor: rendererNamespace ?? "" }
			: {
					path: selectedPluginExport?.entry ?? "",
					contributor: namespaceFor("plugin", input.plugin.id),
				};
		const rendererContributors: Array<ClientPageArtifactIdentity["contributors"][number]> = [];
		if (isKernel) {
			rendererContributors.push({
				kind: "kernel-renderer",
				name: input.rendererName,
				sourceHash: input.sourceHash,
				entry: input.definition.entry,
				namespace: rendererNamespace ?? "",
				pluginDependencies: sortBy(input.definition.pluginDependencies),
				automaticEntityPresentations: input.definition.automaticEntityPresentations,
			});
		} else if (isRenderer) {
			rendererContributors.push({
				kind: "renderer",
				name: input.rendererName,
				rendererId: input.rendererId,
				entry: input.definition.entry,
				sourceHash: input.publishedHash,
				namespace: namespaceFor("renderer", input.rendererId),
				pluginDependencies: sortBy(input.definition.pluginDependencies),
				automaticEntityPresentations: input.definition.automaticEntityPresentations,
			});
		}
		const identity: ClientPageArtifactIdentity = {
			entry,
			routeRegistry,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			selectedExports: sortBy([...selectedExports]),
			application: isRenderer ? "page" : input.application,
			name: isRenderer ? input.rendererName : input.plugin.manifest.metadata.name,
			kernelAutomaticFallback: automaticEntityPresentations
				? { provider: "kernel", layouts: ["grid", "list"], runtimeVersion: CLIENT_API_VERSION }
				: null,
			automaticRegistry: sortBy(
				automaticRegistry,
				(registration) =>
					`${registration.ownerPluginId}/${registration.entitySchemaSlug}/${registration.layout}`,
			),
			contributors: [
				...rendererContributors,
				...orderedPlugins.map((plugin) => ({
					pluginId: plugin.id,
					kind: "plugin" as const,
					sourceHash: plugin.sourceHash,
					pluginSlug: PluginSlug.make(plugin.slug),
					namespace: namespaceFor("plugin", plugin.id),
					pluginDependencies: sortBy(plugin.manifest.client?.pluginDependencies ?? []).map((slug) =>
						PluginSlug.make(slug),
					),
					exports: sortBy(
						Object.entries(plugin.manifest.client?.exports ?? {}),
						([name]) => name,
					).map(([name, declaration]) => Object.assign({ name }, declaration)),
				})),
			],
		};
		return {
			identity,
			artifactKey: sha256Hex(stableStringify(identity)),
			compilerInput: {
				publicExports,
				entry: identity.entry,
				apiVersion: CLIENT_API_VERSION,
				...(routeRegistry ? { routeRegistry } : {}),
				automaticRegistry: identity.automaticRegistry,
				application: isRenderer ? "page" : input.application,
				contributorOrder: identity.contributors.map(({ namespace }) => namespace),
				name: isRenderer ? input.rendererName : input.plugin.manifest.metadata.name,
				contributors: {
					...(isRenderer && rendererNamespace
						? { [rendererNamespace]: { files: input.rendererFiles } }
						: {}),
					...Object.fromEntries(
						orderedPlugins.map((plugin) => [
							namespaceFor("plugin", plugin.id),
							{ files: files.get(plugin.slug) ?? {} },
						]),
					),
				},
			},
		} satisfies ResolvedClientPageGraph;
	});

export const resolveClientPageGraph = <E, R>(
	input: ClientPageGraphInput<E, R> & {
		readonly loadPluginFiles: NonNullable<ClientPageGraphCommon<E, R>["loadPluginFiles"]>;
	},
) => resolveGraph(input).pipe(Effect.withSpan("ClientPageBuild.resolve-graph"));

export const resolveClientPageArtifactGraph = (
	input: ClientPageGraphInput<never, never>,
): Effect.Effect<ResolvedClientPageArtifactGraph, ClientRendererBadRequest> =>
	resolveGraph(input).pipe(
		Effect.map(({ compilerInput: _compilerInput, ...graph }) => graph),
		Effect.withSpan("ClientPages.resolve-artifact-graph"),
	);
