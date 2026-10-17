import {
	ClientPagePreparationError,
	type ClientPageCodeContributor,
	type ClientPageCompositionIdentity,
	type ClientRendererDefinition,
} from "@ryot-app/contract/modules/pages/schemas";
import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import {
	identityTupleKey,
	pluginPackageKey,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	pluginExportSpecifier,
	type PluginClientImport,
} from "@ryot-app/plugin-client-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import type { AvailablePlugin } from "#modules/plugins/catalog/runtime-resolver";

export type ResolvedClientPageGraph = {
	readonly compositionKey: string;
	readonly identity: ClientPageCompositionIdentity;
};

export type GraphPlugin = Pick<
	AvailablePlugin,
	| "id"
	| "packageId"
	| "scope"
	| "pluginRevisionId"
	| "clientImports"
	| "contentHash"
	| "clientArtifactHash"
	| "manifest"
	| "health"
	| "isHidden"
>;

export const clientPageCodeContributors = (
	identity: ClientPageCompositionIdentity,
	available: ReadonlyArray<AvailablePlugin>,
): readonly ClientPageCodeContributor[] => {
	const byId = new Map(available.map((plugin) => [plugin.id, plugin]));
	return identity.contributors.map((contributor) => {
		if (contributor.kind === "kernel-renderer") {
			return {
				name: contributor.name,
				kind: "kernel-renderer",
				sourceHash: contributor.sourceHash,
			};
		}
		const installed = byId.get(contributor.pluginId);
		if (
			!installed ||
			installed.packageId !== contributor.packageId ||
			installed.pluginRevisionId !== contributor.revisionId
		) {
			throw new Error(`Missing runtime installation for ${contributor.pluginId}`);
		}
		return {
			kind: "plugin",
			pluginId: contributor.pluginId,
			packageId: contributor.packageId,
			revisionId: contributor.revisionId,
			contentHash: contributor.contentHash,
			installationId: installed.installationId,
		};
	});
};

type Common = {
	readonly plugins: ReadonlyArray<GraphPlugin>;
	readonly runtimeArtifactHash: string;
};
type KernelInput = Common & {
	readonly clientImports: ReadonlyArray<PluginClientImport>;
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
const ordered = <T>(values: Iterable<T>, key: (value: T) => string) => sortBy([...values], key);
const unavailable = (reference: PluginPackageReference) =>
	new ClientPagePreparationError({ reason: { reference, code: "dependency-unavailable" } });
const missingExport = (specifier: string) =>
	new ClientPagePreparationError({ reason: { exportName: specifier, code: "export-not-found" } });
const artifactHash = (plugin: GraphPlugin): string => {
	if (!plugin.clientArtifactHash) {
		throw new Error(`Missing client artifact hash for ${plugin.packageId}`);
	}
	return plugin.clientArtifactHash;
};

export const resolveClientPageGraph = Effect.fn("Pages.resolve-composition-graph")(function* (
	input: KernelInput | PluginInput,
) {
	const isKernel = "kernel" in input;
	const catalog = new Map(input.plugins.map((plugin) => [pluginPackageKey(plugin), plugin]));
	if (!isKernel) {
		catalog.set(pluginPackageKey(input.plugin), input.plugin);
	}
	const included = new Map<string, GraphPlugin>();
	const visiting: GraphPlugin[] = [];
	const dependencies = (aliases: Readonly<Record<string, PluginPackageReference>>) =>
		ordered(Object.values(aliases), pluginPackageKey);
	const readyPlugin = Effect.fnUntraced(function* (reference: PluginPackageReference) {
		const plugin = catalog.get(pluginPackageKey(reference));
		if (plugin?.health !== "ready" || !plugin.manifest.client || !plugin.clientArtifactHash) {
			return yield* unavailable(reference);
		}
		return { plugin, client: plugin.manifest.client };
	});
	const validateImports = (
		importer: string,
		aliases: Readonly<Record<string, PluginPackageReference>>,
		imports: ReadonlyArray<PluginClientImport>,
	): Effect.Effect<void, ClientPagePreparationError> =>
		Effect.gen(function* () {
			const declared = new Set(Object.values(aliases).map(pluginPackageKey));
			for (const imported of imports) {
				if (!declared.has(pluginPackageKey(imported.reference))) {
					return yield* new ClientPagePreparationError({
						reason: { importer, code: "dependency-undeclared", reference: imported.reference },
					});
				}
				const target = yield* readyPlugin(imported.reference);
				if (!Object.hasOwn(target.client.exports ?? {}, imported.exportName)) {
					return yield* missingExport(
						pluginExportSpecifier(imported.reference, imported.exportName),
					);
				}
			}
			return yield* Effect.void;
		});
	const include = (
		reference: PluginPackageReference,
	): Effect.Effect<void, ClientPagePreparationError> =>
		Effect.gen(function* () {
			const { plugin, client } = yield* readyPlugin(reference);
			const cycleStart = visiting.findIndex(({ id }) => id === plugin.id);
			if (cycleStart !== -1) {
				return yield* new ClientPagePreparationError({
					reason: {
						code: "dependency-cycle",
						pluginIds: [...visiting.slice(cycleStart), plugin].map(({ id }) => PluginId.make(id)),
					},
				});
			}
			if (included.has(plugin.id)) {
				return yield* Effect.void;
			}
			visiting.push(plugin);
			yield* validateImports(plugin.id, client.pluginDependencies ?? {}, plugin.clientImports);
			for (const dependency of dependencies(client.pluginDependencies ?? {})) {
				yield* include(dependency);
			}
			visiting.pop();
			included.set(plugin.id, plugin);
			return yield* Effect.void;
		});
	if (isKernel) {
		yield* validateImports(
			input.rendererName,
			input.definition.pluginDependencies,
			input.clientImports,
		);
		for (const dependency of dependencies(input.definition.pluginDependencies)) {
			yield* include(dependency);
		}
	} else {
		yield* include(input.plugin);
	}
	const eagerIds = new Set(included.keys());

	const routes =
		!isKernel && input.application === "plugin-route"
			? ordered(Object.entries(input.plugin.manifest.client?.routes ?? {}), ([path]) => path).sort(
					([left], [right]) => comparePluginRoutePaths(left, right),
				)
			: [];
	const homeExport = routes.find(([path]) => path === "/")?.[1];
	let primaryExport: string | null | undefined = null;
	if (!isKernel) {
		primaryExport =
			input.application === "plugin-route"
				? (homeExport ?? routes[0]?.[1] ?? input.exportName)
				: input.exportName;
	}
	if (!isKernel && input.plugin.manifest.client?.exports?.[primaryExport ?? ""]?.kind !== "page") {
		return yield* missingExport(
			pluginExportSpecifier(input.plugin, primaryExport ?? input.exportName),
		);
	}
	const selectedExports = new Set<string>();
	const routeRegistry =
		!isKernel && input.application === "plugin-route"
			? {
					...(homeExport === undefined
						? {}
						: { home: pluginExportSpecifier(input.plugin, homeExport) }),
					routes: routes
						.filter(([path]) => path !== "/")
						.map(([path, name]) => ({
							path,
							exportSpecifier: pluginExportSpecifier(input.plugin, name),
						})),
					...(input.plugin.manifest.client?.notFoundPage
						? {
								notFound: pluginExportSpecifier(
									input.plugin,
									input.plugin.manifest.client.notFoundPage,
								),
							}
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
				return yield* missingExport(pluginExportSpecifier(input.plugin, name));
			}
			selectedExports.add(pluginExportSpecifier(input.plugin, name));
		}
	}
	let automatic = isKernel
		? input.definition.automaticEntityPresentations
		: [...selectedExports].some((specifier) => {
				const name = specifier.slice(specifier.lastIndexOf("/") + 1);
				return input.plugin.manifest.client?.exports?.[name]?.automaticEntityPresentations ?? false;
			});
	if (!automatic) {
		automatic = [...included.values()].some(
			(plugin) =>
				plugin.id !== (isKernel ? null : input.plugin.id) &&
				Object.values(plugin.manifest.client?.exports ?? {}).some(
					(declaration) => declaration.automaticEntityPresentations,
				),
		);
	}
	const registry: ClientPageCompositionIdentity["automaticRegistry"][number][] = [];
	if (automatic) {
		for (const plugin of ordered(
			input.plugins.filter((p) => p.health === "ready" && !p.isHidden && p.manifest.client),
			(p) => p.id,
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
					const specifier = pluginExportSpecifier(plugin, name);
					if (plugin.manifest.client?.exports?.[name]?.kind !== "presentation") {
						return yield* missingExport(specifier);
					}
					const closure = new Map<string, string>();
					const visit = (
						reference: PluginPackageReference,
					): Effect.Effect<void, ClientPagePreparationError> =>
						Effect.gen(function* () {
							yield* include(reference);
							const entry = catalog.get(pluginPackageKey(reference));
							if (!entry || closure.has(entry.id)) {
								return;
							}
							closure.set(entry.id, artifactHash(entry));
							for (const dep of dependencies(entry.manifest.client?.pluginDependencies ?? {})) {
								yield* visit(dep);
							}
						});
					yield* visit(plugin);
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
	const plugins = ordered(included.values(), (plugin) => plugin.id);
	for (const plugin of plugins) {
		if (plugin.id !== (isKernel ? null : input.plugin.id)) {
			for (const name of Object.keys(plugin.manifest.client?.exports ?? {})) {
				selectedExports.add(pluginExportSpecifier(plugin, name));
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
			...plugins.filter((plugin) => eagerIds.has(plugin.id)).map(artifactHash),
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
		automaticRegistry: ordered(registry, (item) =>
			identityTupleKey(item.ownerPluginId, item.entitySchemaSlug, item.layout),
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
							pluginDependencies: input.definition.pluginDependencies,
							automaticEntityPresentations: input.definition.automaticEntityPresentations,
						},
					]
				: []),
			...plugins.map((plugin) => ({
				scope: plugin.scope,
				kind: "plugin" as const,
				packageId: plugin.packageId,
				contentHash: plugin.contentHash,
				pluginId: PluginId.make(plugin.id),
				revisionId: plugin.pluginRevisionId,
				clientArtifactHash: artifactHash(plugin),
				namespace: namespaceFor("plugin", plugin.id),
				pluginDependencies: plugin.manifest.client?.pluginDependencies ?? {},
				exports: ordered(
					Object.entries(plugin.manifest.client?.exports ?? {}),
					([name]) => name,
				).map(([name, declaration]) => Object.assign({}, declaration, { name })),
			})),
		],
	};
	return { identity, compositionKey: sha256Hex(stableStringify(identity)) };
});
