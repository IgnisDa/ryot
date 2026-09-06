import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import {
	ClientPagePreparationError,
	type ClientPageCodeContributor,
	type ClientPageCompositionIdentity,
	type ClientRendererDefinition,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import type { AvailablePlugin } from "#modules/plugins/runtime-resolver";

export type ResolvedClientPageGraph = {
	readonly compositionKey: string;
	readonly identity: ClientPageCompositionIdentity;
};

export type GraphPlugin = Pick<
	AvailablePlugin,
	"id" | "slug" | "sourceHash" | "clientArtifactHash" | "manifest" | "health" | "isDisabled"
>;

export const clientPageCodeContributors = (
	identity: ClientPageCompositionIdentity,
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

type Common = {
	readonly plugins: ReadonlyArray<GraphPlugin>;
	readonly runtimeArtifactHash: string;
};
type KernelInput = Common & {
	readonly kernel: true;
	readonly sourceHash: string;
	readonly rendererArtifactHash: string;
	readonly rendererName: string;
	readonly definition: ClientRendererDefinition;
};
type PluginInput = Common & {
	readonly exportName: string;
	readonly plugin: GraphPlugin;
	readonly application: "page" | "plugin-route";
};

const namespaceFor = (kind: "kernel" | "plugin", id: string) => `${kind}-${sha256Hex(id)}`;
const qualify = (slug: string, name: string) => `@ryot-app/plugins/${slug}/${name}`;
const ordered = <T>(values: Iterable<T>, key: (value: T) => string) => sortBy([...values], key);
const unavailable = (slug: string) =>
	new ClientPagePreparationError({
		reason: { code: "dependency-unavailable", pluginSlug: PluginSlug.make(slug) },
	});
const missingExport = (specifier: string) =>
	new ClientPagePreparationError({ reason: { exportName: specifier, code: "export-not-found" } });
const artifactHash = (plugin: GraphPlugin): string => {
	if (!plugin.clientArtifactHash) {
		throw new Error(`Missing client artifact hash for ${plugin.slug}`);
	}
	return plugin.clientArtifactHash;
};

export const resolveClientPageGraph = (input: KernelInput | PluginInput) =>
	Effect.gen(function* () {
		const isKernel = "kernel" in input;
		const catalog = new Map(input.plugins.map((plugin) => [plugin.slug, plugin]));
		if (!isKernel) {
			catalog.set(input.plugin.slug, input.plugin);
		}
		const included = new Map<string, GraphPlugin>();
		const include = (slug: string): Effect.Effect<void, ClientPagePreparationError> =>
			Effect.gen(function* () {
				if (included.has(slug)) {
					return yield* Effect.void;
				}
				const plugin = catalog.get(slug);
				if (plugin?.health !== "ready" || !plugin.manifest.client || !plugin.clientArtifactHash) {
					return yield* unavailable(slug);
				}
				included.set(slug, plugin);
				for (const dependency of ordered(plugin.manifest.client.pluginDependencies ?? [], String)) {
					yield* include(dependency);
				}
				return yield* Effect.void;
			});
		const eagerSlugs = new Set<string>();
		if (isKernel) {
			for (const dependency of ordered(input.definition.pluginDependencies, String)) {
				yield* include(dependency);
			}
		} else {
			yield* include(input.plugin.slug);
		}
		for (const slug of included.keys()) {
			eagerSlugs.add(slug);
		}

		const routes =
			!isKernel && input.application === "plugin-route"
				? ordered(
						Object.entries(input.plugin.manifest.client?.routes ?? {}),
						([path]) => path,
					).sort(([left], [right]) => comparePluginRoutePaths(left, right))
				: [];
		let primaryExport: string | null | undefined = null;
		if (!isKernel) {
			primaryExport =
				input.application === "plugin-route"
					? routes.find(([path]) => path === "/")?.[1]
					: input.exportName;
		}
		if (
			!isKernel &&
			input.plugin.manifest.client?.exports?.[primaryExport ?? ""]?.kind !== "page"
		) {
			return yield* missingExport(
				`@ryot-app/plugins/${input.plugin.slug}/${primaryExport ?? input.exportName}`,
			);
		}
		const selectedExports = new Set<string>();
		const routeRegistry =
			!isKernel && input.application === "plugin-route"
				? {
						home: qualify(input.plugin.slug, primaryExport ?? ""),
						routes: routes
							.filter(([path]) => path !== "/")
							.map(([path, name]) => ({ path, exportSpecifier: qualify(input.plugin.slug, name) })),
						...(input.plugin.manifest.client?.notFoundPage
							? { notFound: qualify(input.plugin.slug, input.plugin.manifest.client.notFoundPage) }
							: {}),
					}
				: null;
		if (!isKernel) {
			for (const name of input.application === "plugin-route"
				? [
						...routes.map(([, exportName]) => exportName),
						...(input.plugin.manifest.client?.notFoundPage
							? [input.plugin.manifest.client.notFoundPage]
							: []),
					]
				: [input.exportName]) {
				if (input.plugin.manifest.client?.exports?.[name]?.kind !== "page") {
					return yield* missingExport(qualify(input.plugin.slug, name));
				}
				selectedExports.add(qualify(input.plugin.slug, name));
			}
		}
		let automatic = isKernel
			? input.definition.automaticEntityPresentations
			: [...selectedExports].some((specifier) => {
					const name = specifier.slice(specifier.lastIndexOf("/") + 1);
					return (
						input.plugin.manifest.client?.exports?.[name]?.automaticEntityPresentations ?? false
					);
				});
		if (!automatic) {
			automatic = [...included.values()].some(
				(plugin) =>
					plugin.slug !== (isKernel ? null : input.plugin.slug) &&
					Object.values(plugin.manifest.client?.exports ?? {}).some(
						(declaration) => declaration.automaticEntityPresentations,
					),
			);
		}
		const registry: ClientPageCompositionIdentity["automaticRegistry"][number][] = [];
		if (automatic) {
			for (const plugin of ordered(
				input.plugins.filter((p) => p.health === "ready" && !p.isDisabled && p.manifest.client),
				(p) => p.slug,
			)) {
				for (const [entitySchemaSlug, registration] of ordered(
					Object.entries(plugin.manifest.client?.entities ?? {}),
					([slug]) => slug,
				)) {
					for (const [layout, name] of [
						["grid", registration.gridPresentation],
						["list", registration.listPresentation],
					] as const) {
						if (!name) {
							continue;
						}
						const specifier = qualify(plugin.slug, name);
						if (plugin.manifest.client?.exports?.[name]?.kind !== "presentation") {
							return yield* missingExport(specifier);
						}
						const closure = new Map<string, string>();
						const visit = (slug: string): Effect.Effect<void, ClientPagePreparationError> =>
							Effect.gen(function* () {
								yield* include(slug);
								const entry = included.get(slug);
								if (!entry || closure.has(slug)) {
									return;
								}
								closure.set(slug, artifactHash(entry));
								for (const dep of ordered(
									entry.manifest.client?.pluginDependencies ?? [],
									String,
								)) {
									yield* visit(dep);
								}
							});
						yield* visit(plugin.slug);
						registry.push({
							layout,
							entitySchemaSlug,
							ownerPluginId: plugin.id,
							exportSpecifier: specifier,
							artifactClosure: ordered(new Set(closure.values()), String),
						});
					}
				}
			}
		}
		const plugins = ordered(included.values(), (plugin) => plugin.slug);
		for (const plugin of plugins) {
			if (plugin.slug !== (isKernel ? null : input.plugin.slug)) {
				for (const name of Object.keys(plugin.manifest.client?.exports ?? {})) {
					selectedExports.add(qualify(plugin.slug, name));
				}
			}
		}
		const entry = isKernel
			? { path: input.definition.entry, contributor: namespaceFor("kernel", input.rendererName) }
			: {
					contributor: namespaceFor("plugin", input.plugin.id),
					path: input.plugin.manifest.client?.exports?.[primaryExport ?? ""]?.entry ?? "",
				};
		const eagerArtifactHashes = ordered(
			new Set([
				input.runtimeArtifactHash,
				...(isKernel ? [input.rendererArtifactHash] : []),
				...plugins.filter((plugin) => eagerSlugs.has(plugin.slug)).map(artifactHash),
			]),
			String,
		);
		const identity: ClientPageCompositionIdentity = {
			entry,
			routeRegistry,
			eagerArtifactHashes,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			runtimeArtifactHash: input.runtimeArtifactHash,
			selectedExports: ordered(selectedExports, String),
			application: isKernel ? "page" : input.application,
			name: isKernel ? input.rendererName : input.plugin.manifest.metadata.name,
			automaticRegistry: ordered(
				registry,
				(item) => `${item.ownerPluginId}/${item.entitySchemaSlug}/${item.layout}`,
			),
			kernelAutomaticFallback: automatic
				? { provider: "kernel", layouts: ["grid", "list"], runtimeVersion: CLIENT_API_VERSION }
				: null,
			contributors: [
				...(isKernel
					? [
							{
								name: input.rendererName,
								namespace: entry.contributor,
								sourceHash: input.sourceHash,
								entry: input.definition.entry,
								kind: "kernel-renderer" as const,
								artifactHash: input.rendererArtifactHash,
								pluginDependencies: ordered(input.definition.pluginDependencies, String),
								automaticEntityPresentations: input.definition.automaticEntityPresentations,
							},
						]
					: []),
				...plugins.map((plugin) => ({
					pluginId: plugin.id,
					kind: "plugin" as const,
					sourceHash: plugin.sourceHash,
					pluginSlug: PluginSlug.make(plugin.slug),
					clientArtifactHash: artifactHash(plugin),
					namespace: namespaceFor("plugin", plugin.id),
					pluginDependencies: ordered(plugin.manifest.client?.pluginDependencies ?? [], String).map(
						(slug) => PluginSlug.make(slug),
					),
					exports: ordered(
						Object.entries(plugin.manifest.client?.exports ?? {}),
						([name]) => name,
					).map(([name, declaration]) => Object.assign({}, declaration, { name })),
				})),
			],
		};
		return { identity, compositionKey: sha256Hex(stableStringify(identity)) };
	}).pipe(Effect.withSpan("ClientPages.resolve-composition-graph"));
