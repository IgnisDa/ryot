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
	type ClientPageGraphIdentity,
	type ClientRendererDefinition,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug, type ClientRendererId, type UserId } from "@ryot-app/contract/schema/brands";
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
	new ClientRendererBadRequest({ reason: { code: "export-not-found", exportName } });

const namespaceFor = (kind: "plugin" | "renderer", id: string) => `${kind}-${sha256Hex(id)}`;

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
	readonly graphHash: string;
	readonly identity: ClientPageGraphIdentity;
	readonly compilerInput: ClientPluginCompilerGraphInput;
	readonly contributors: readonly ClientPageCodeContributor[];
};

export const resolveClientPageGraph = <E, R>(input: {
	readonly userId: UserId;
	readonly rendererName: string;
	readonly publishedHash: string;
	readonly rendererId: ClientRendererId;
	readonly definition: ClientRendererDefinition;
	readonly plugins: ReadonlyArray<AvailablePlugin>;
	readonly rendererFiles: Readonly<Record<string, Uint8Array>>;
	readonly loadPluginFiles: (
		plugin: AvailablePlugin,
	) => Effect.Effect<Readonly<Record<string, Uint8Array>> | null, E, R>;
}): Effect.Effect<ResolvedClientPageGraph, ClientRendererBadRequest | E, R> =>
	Effect.gen(function* () {
		const rendererNamespace = namespaceFor("renderer", input.rendererId);
		const catalog = new Map(input.plugins.map((plugin) => [plugin.slug, plugin]));
		const included = new Map<string, AvailablePlugin>();
		const files = new Map<string, Readonly<Record<string, Uint8Array>>>();
		const dependencyOrder: string[] = [];

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
				const loaded = yield* input.loadPluginFiles(plugin);
				if (!loaded) {
					return yield* dependencyUnavailable(slug);
				}
				files.set(slug, sourceFiles(loaded));
				for (const dependency of sortBy(plugin.manifest.client.pluginDependencies ?? [])) {
					yield* includePlugin(dependency);
				}
				dependencyOrder.push(slug);
				return yield* Effect.void;
			});

		for (const dependency of sortBy(input.definition.pluginDependencies)) {
			yield* includePlugin(dependency);
		}

		const selectedExports = new Set<string>();
		const visited = new Set<string>();
		let automaticEntityPresentations = input.definition.automaticEntityPresentations;

		const scan = (
			owner: { readonly slug: string | null; readonly dependencies: readonly string[] },
			path: string,
			ownerFiles: Readonly<Record<string, Uint8Array>>,
		): Effect.Effect<void, ClientRendererBadRequest | E, R> =>
			Effect.gen(function* () {
				const key = `${owner.slug ?? rendererNamespace}:${path}`;
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
						selectedExports.add(specifier);
						automaticEntityPresentations ||= declaration.automaticEntityPresentations;
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

		yield* scan(
			{ slug: null, dependencies: input.definition.pluginDependencies },
			input.definition.entry,
			input.rendererFiles,
		);

		const automaticRegistry: ClientPluginAutomaticRegistryEntry[] = [];
		if (automaticEntityPresentations) {
			for (const plugin of sortBy(
				input.plugins.filter(
					(candidate) =>
						candidate.health === "ready" && !candidate.isDisabled && candidate.manifest.client,
				),
				(candidate) => candidate.slug,
			)) {
				for (const [entitySchemaSlug, registrations] of sortBy(
					Object.entries(plugin.manifest.client?.entities ?? {}),
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
						selectedExports.add(exportSpecifier);
						automaticRegistry.push({
							layout,
							exportSpecifier,
							entitySchemaSlug,
							ownerPluginId: plugin.id,
						});
						yield* scan(
							{ slug: plugin.slug, dependencies: plugin.manifest.client?.pluginDependencies ?? [] },
							plugin.manifest.client?.exports?.[exportName]?.entry ?? "",
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
		const identity: ClientPageGraphIdentity = {
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			selectedExports: sortBy([...selectedExports]),
			entry: { contributor: rendererNamespace, path: input.definition.entry },
			kernelAutomaticFallback: automaticEntityPresentations
				? { provider: "kernel", runtimeVersion: CLIENT_API_VERSION, layouts: ["grid", "list"] }
				: null,
			automaticRegistry: sortBy(
				automaticRegistry,
				(entry) => `${entry.ownerPluginId}/${entry.entitySchemaSlug}/${entry.layout}`,
			),
			contributors: [
				{
					kind: "renderer",
					name: input.rendererName,
					namespace: rendererNamespace,
					rendererId: input.rendererId,
					entry: input.definition.entry,
					sourceHash: input.publishedHash,
					pluginDependencies: sortBy(input.definition.pluginDependencies),
					automaticEntityPresentations: input.definition.automaticEntityPresentations,
				},
				...orderedPlugins.map((plugin) => ({
					pluginId: plugin.id,
					kind: "plugin" as const,
					sourceHash: plugin.sourceHash,
					installationId: plugin.installationId,
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
		const contributors: ClientPageCodeContributor[] = identity.contributors.map((contributor) =>
			contributor.kind === "renderer"
				? {
						kind: "renderer",
						rendererId: contributor.rendererId,
						sourceHash: contributor.sourceHash,
					}
				: {
						kind: "plugin",
						pluginId: contributor.pluginId,
						pluginSlug: contributor.pluginSlug,
						sourceHash: contributor.sourceHash,
						installationId: contributor.installationId,
					},
		);
		return {
			identity,
			contributors,
			graphHash: sha256Hex(stableStringify(identity)),
			compilerInput: {
				publicExports,
				application: "page",
				entry: identity.entry,
				name: input.rendererName,
				apiVersion: CLIENT_API_VERSION,
				automaticRegistry: identity.automaticRegistry,
				contributorOrder: identity.contributors.map(({ namespace }) => namespace),
				contributors: {
					[rendererNamespace]: { files: input.rendererFiles },
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
