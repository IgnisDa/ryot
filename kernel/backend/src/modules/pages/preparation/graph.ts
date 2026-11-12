import {
	type ClientCompositionModuleReference,
	type ClientPageCodeContributor,
	type ClientPageCompositionIdentity,
	ClientPagePreparationError,
	type ClientRendererDefinition,
	type PageDefinition,
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
	type PluginClientImport,
	pluginExportSpecifier,
} from "@ryot-app/plugin-client-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Option } from "effect";

import type { AvailablePlugin } from "#modules/plugins/catalog/runtime-resolver";

import { kernelRendererModule } from "./kernel-renderers";

export type ResolvedClientPageGraph = {
	readonly compositionKey: string;
	readonly identity: ClientPageCompositionIdentity;
};

export const clientPageGraphFromIdentity = (
	identity: ClientPageCompositionIdentity,
): ResolvedClientPageGraph => ({ identity, compositionKey: sha256Hex(stableStringify(identity)) });

export type GraphPlugin = Pick<
	AvailablePlugin,
	| "id"
	| "scope"
	| "health"
	| "manifest"
	| "isHidden"
	| "packageId"
	| "contentHash"
	| "clientImports"
	| "pluginRevisionId"
	| "clientArtifactHash"
>;

export const clientPageCodeContributors = (
	identity: ClientPageCompositionIdentity,
	available: ReadonlyArray<AvailablePlugin>,
	requireCurrentRevision = true,
): readonly ClientPageCodeContributor[] => {
	const byId = new Map(available.map((plugin) => [plugin.id, plugin]));
	return identity.contributors.map((contributor) => {
		if (contributor.kind === "page") {
			const { pluginDependencies: _dependencies, ...page } = contributor;
			return page;
		}
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
			(requireCurrentRevision && installed.pluginRevisionId !== contributor.revisionId)
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
	readonly runtimeArtifactHash: string;
	readonly plugins: ReadonlyArray<GraphPlugin>;
};
type PluginInput = Common & {
	readonly exportName: string;
	readonly plugin: GraphPlugin;
	readonly application: "page" | "plugin-route";
};
type KernelInput = Common & {
	readonly kernel: true;
	readonly sourceHash: string;
	readonly rendererName: string;
	readonly rendererArtifactHash: string;
	readonly definition: ClientRendererDefinition;
	readonly clientImports: ReadonlyArray<PluginClientImport>;
};

type PageInput = Common & {
	readonly page: true;
	readonly name: string;
	readonly pageId: string;
	readonly revision: number;
	readonly artifactHash: string;
	readonly definitionHash: string;
	readonly definition: PageDefinition;
	readonly clientImports: ReadonlyArray<PluginClientImport>;
};

export const pageModule = (pageId: string): ClientCompositionModuleReference => ({
	binding: "page",
	specifier: `@ryot/page/${encodeURIComponent(pageId)}`,
});

const ordered = <T>(values: Iterable<T>, key: (value: T) => string) => sortBy([...values], key);
const unavailable = (reference: PluginPackageReference) =>
	new ClientPagePreparationError({
		reason: {
			code: "dependency-unavailable",
			reference: { scope: reference.scope, packageId: reference.packageId },
		},
	});
const missingExport = (specifier: string) =>
	new ClientPagePreparationError({ reason: { exportName: specifier, code: "export-not-found" } });
const artifactHash = (plugin: GraphPlugin): string => {
	if (!plugin.clientArtifactHash) {
		throw new Error(`Missing client artifact hash for ${plugin.packageId}`);
	}
	return plugin.clientArtifactHash;
};
const pluginModule = (plugin: GraphPlugin, binding: string): ClientCompositionModuleReference => ({
	binding,
	specifier: pluginExportSpecifier(plugin, binding),
});

export const resolveClientPageGraph = Effect.fn("Pages.resolve-composition-graph")(function* (
	input: PageInput | KernelInput | PluginInput,
) {
	const isKernel = "kernel" in input;
	const isPage = "page" in input;
	const isPlugin = "plugin" in input;
	let rootName: string;
	let rootEntry: ClientCompositionModuleReference;
	let rootArtifacts: readonly string[];
	if (isKernel) {
		rootName = input.rendererName;
		rootEntry = kernelRendererModule(input.rendererName);
		rootArtifacts = [input.rendererArtifactHash];
	} else if (isPage) {
		rootName = input.name;
		rootEntry = pageModule(input.pageId);
		rootArtifacts = [input.artifactHash];
	} else {
		rootName = input.plugin.manifest.metadata.name;
		rootEntry = pluginModule(input.plugin, input.exportName);
		rootArtifacts = [];
	}

	const catalog = new Map(input.plugins.map((plugin) => [pluginPackageKey(plugin), plugin]));
	if (isPlugin) {
		catalog.set(pluginPackageKey(input.plugin), input.plugin);
	}
	const included = new Map<string, GraphPlugin>();
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
	const resolveClosure = Effect.fnUntraced(function* (root: PluginPackageReference) {
		const closure = new Map<string, GraphPlugin>();
		const visiting: GraphPlugin[] = [];
		const visit = (
			reference: PluginPackageReference,
		): Effect.Effect<void, ClientPagePreparationError> =>
			Effect.gen(function* () {
				const candidate = catalog.get(pluginPackageKey(reference));
				if (candidate?.health === "ready" && !candidate.manifest.client) {
					return yield* Effect.void;
				}
				const { plugin } = yield* readyPlugin(reference);
				const cycleStart = visiting.findIndex(({ id }) => id === plugin.id);
				if (cycleStart !== -1) {
					return yield* new ClientPagePreparationError({
						reason: {
							code: "dependency-cycle",
							pluginIds: [...visiting.slice(cycleStart), plugin].map(({ id }) => PluginId.make(id)),
						},
					});
				}
				if (closure.has(plugin.id)) {
					return yield* Effect.void;
				}
				visiting.push(plugin);
				yield* validateImports(plugin.id, plugin.manifest.dependencies ?? {}, plugin.clientImports);
				for (const dependency of dependencies(plugin.manifest.dependencies ?? {})) {
					yield* visit(dependency);
				}
				visiting.pop();
				closure.set(plugin.id, plugin);
				return yield* Effect.void;
			});
		yield* visit(root);
		return closure;
	});
	const include = Effect.fnUntraced(function* (reference: PluginPackageReference) {
		const closure = yield* resolveClosure(reference);
		for (const [id, plugin] of closure) {
			included.set(id, plugin);
		}
		return ordered(new Set([...closure.values()].map(artifactHash)), String);
	});
	if (isKernel || isPage) {
		yield* validateImports(
			isKernel ? input.rendererName : input.pageId,
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
	const analyticsSections: Extract<
		ClientPageCompositionIdentity,
		{ readonly application: "page" }
	>["analyticsSections"][number][] = [];
	if (isKernel && input.definition.analyticsSections) {
		for (const plugin of ordered(
			input.plugins.filter((candidate) => candidate.health === "ready" && !candidate.isHidden),
			(candidate) => candidate.id,
		)) {
			const sections = ordered(
				Object.entries(plugin.manifest.client?.analyticsSections ?? {}),
				([key]) => key,
			);
			const closure =
				sections.length === 0 ? Option.none() : yield* include(plugin).pipe(Effect.option);
			for (const [slug, registration] of sections) {
				analyticsSections.push({
					slug,
					name: registration.name,
					icon: registration.icon,
					sortOrder: registration.sortOrder,
					ownerPluginId: PluginId.make(plugin.id),
					artifactClosure: Option.getOrElse(closure, () => []),
					module: Option.isSome(closure) ? pluginModule(plugin, registration.exportName) : null,
				});
			}
		}
	}

	const routes =
		isPlugin && input.application === "plugin-route"
			? ordered(Object.entries(input.plugin.manifest.client?.routes ?? {}), ([path]) => path).sort(
					([left], [right]) => comparePluginRoutePaths(left, right),
				)
			: [];
	const homeExport = routes.find(([path]) => path === "/")?.[1];
	if (isPlugin && input.application === "plugin-route" && routes.length === 0) {
		return yield* missingExport(pluginExportSpecifier(input.plugin, input.exportName));
	}
	const selectedExportNames = new Set<string>();
	const selection =
		isPlugin && input.application === "plugin-route"
			? {
					application: "plugin-route" as const,
					routes: {
						...(homeExport === undefined ? {} : { home: pluginModule(input.plugin, homeExport) }),
						routes: routes
							.filter(([path]) => path !== "/")
							.map(([path, name]) => ({ path, module: pluginModule(input.plugin, name) })),
						...(input.plugin.manifest.client?.notFoundPage
							? { notFound: pluginModule(input.plugin, input.plugin.manifest.client.notFoundPage) }
							: {}),
					},
				}
			: {
					entry: rootEntry,
					application: "page" as const,
					analyticsSections: analyticsSections.sort(
						(left, right) =>
							left.sortOrder - right.sortOrder ||
							identityTupleKey(left.ownerPluginId, left.slug).localeCompare(
								identityTupleKey(right.ownerPluginId, right.slug),
							),
					),
				};
	if (isPlugin) {
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
			selectedExportNames.add(name);
		}
	}
	let automatic =
		isPage ||
		(isKernel
			? input.definition.automaticEntityPresentations
			: [...selectedExportNames].some(
					(name) =>
						input.plugin.manifest.client?.exports?.[name]?.automaticEntityPresentations ?? false,
				));
	if (!automatic) {
		automatic = [...included.values()].some(
			(plugin) =>
				eagerIds.has(plugin.id) &&
				plugin.id !== (isPlugin ? input.plugin.id : null) &&
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
					const artifactClosure = yield* include(plugin);
					registry.push({
						layout,
						artifactClosure,
						entitySchemaSlug,
						ownerPluginId: plugin.id,
						exportSpecifier: pluginExportSpecifier(plugin, name),
					});
				}
			}
		}
	}
	const plugins = ordered(included.values(), (plugin) => plugin.id);
	const eagerArtifactHashes = ordered(
		new Set([
			input.runtimeArtifactHash,
			...rootArtifacts,
			...plugins.filter((plugin) => eagerIds.has(plugin.id)).map(artifactHash),
		]),
		String,
	);
	const identity: ClientPageCompositionIdentity = {
		...selection,
		name: rootName,
		eagerArtifactHashes,
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		runtimeArtifactHash: input.runtimeArtifactHash,
		automaticRegistry: ordered(registry, (item) =>
			identityTupleKey(item.ownerPluginId, item.entitySchemaSlug, item.layout),
		),
		kernelAutomaticFallback: automatic
			? { provider: "kernel", layouts: ["grid", "list"], runtimeVersion: CLIENT_API_VERSION }
			: null,
		contributors: [
			...(isPage
				? [
						{
							pageId: input.pageId,
							kind: "page" as const,
							revision: input.revision,
							artifactHash: input.artifactHash,
							definitionHash: input.definitionHash,
							pluginDependencies: input.definition.pluginDependencies,
						},
					]
				: []),
			...(isKernel
				? [
						{
							name: input.rendererName,
							sourceHash: input.sourceHash,
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
				pluginDependencies: plugin.manifest.dependencies ?? {},
				exports: ordered(
					Object.entries(plugin.manifest.client?.exports ?? {}),
					([name]) => name,
				).map(([name, declaration]) => Object.assign({}, declaration, { name })),
			})),
		],
	};
	return clientPageGraphFromIdentity(identity);
});
