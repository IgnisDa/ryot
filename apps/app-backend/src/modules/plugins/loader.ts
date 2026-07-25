import type { PluginBindings, PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot/contract/modules/plugins/plugin-config";
import { Context, Effect, Layer } from "effect";

import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	DefinitionRegistry,
	type DefinitionSnapshot,
	type DefinitionSource,
} from "#modules/definition-registry/service";

import { buildHttpRateLimitLookups, type HttpRateLimitLookups } from "./http-rate-limits";
import type { NormalizedPlugin } from "./types";

export type PluginRegistrySnapshot = {
	readonly bindings: PluginBindings;
	readonly definitions: DefinitionSnapshot;
	readonly plugins: Readonly<Record<string, NormalizedPlugin>>;
	readonly httpRateLimits: HttpRateLimitLookups;
};

const deepFreeze = <Value>(value: Value): Value => {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
};

const emptyBindings = (): PluginBindings => ({
	eventAutomations: [],
	entityAutomations: [],
	signalAutomations: [],
	schemaProviderLinks: [],
	relationshipAutomations: [],
});

const mergeManifestDefinitions = (
	base: DefinitionSource,
	manifests: ReadonlyArray<PluginManifest>,
): DefinitionSource => ({
	savedViews: [...base.savedViews, ...manifests.flatMap(({ savedViews }) => savedViews)],
	entitySchemas: [
		...base.entitySchemas,
		...manifests.flatMap(({ entitySchemas, metadata }) =>
			entitySchemas.map((definition) => ({
				...definition,
				pluginSlug: metadata.slug,
				mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
			})),
		),
	],
	signalSchemas: [
		...base.signalSchemas,
		...manifests.flatMap(({ signalSchemas }) => signalSchemas),
	],
	relationshipSchemas: [
		...manifests.flatMap(({ relationshipSchemas }) => relationshipSchemas),
		...base.relationshipSchemas,
	],
});

const mergeBindings = (manifests: ReadonlyArray<PluginManifest>): PluginBindings =>
	manifests.reduce<PluginBindings>(
		(bindings, manifest) => ({
			eventAutomations: [...bindings.eventAutomations, ...manifest.bindings.eventAutomations],
			entityAutomations: [...bindings.entityAutomations, ...manifest.bindings.entityAutomations],
			signalAutomations: [...bindings.signalAutomations, ...manifest.bindings.signalAutomations],
			schemaProviderLinks: [
				...bindings.schemaProviderLinks,
				...manifest.bindings.schemaProviderLinks,
			],
			relationshipAutomations: [
				...bindings.relationshipAutomations,
				...manifest.bindings.relationshipAutomations,
			],
		}),
		emptyBindings(),
	);

const assertUniqueScriptSlugs = (plugins: Readonly<Record<string, NormalizedPlugin>>) => {
	const ownerBySlug = new Map<string, string>();
	for (const [pluginSlug, plugin] of Object.entries(plugins)) {
		for (const script of plugin.scripts) {
			const owner = ownerBySlug.get(script.slug);
			if (owner) {
				throw new Error(
					`Duplicate script slug '${script.slug}' in active plugins '${owner}' and '${pluginSlug}'`,
				);
			}
			ownerBySlug.set(script.slug, pluginSlug);
		}
	}
};

const assertUniqueProviderSlugs = (plugins: Readonly<Record<string, NormalizedPlugin>>) => {
	const ownerBySlug = new Map<string, string>();
	for (const [pluginSlug, plugin] of Object.entries(plugins)) {
		for (const provider of plugin.manifest.providers) {
			const owner = ownerBySlug.get(provider.slug);
			if (owner) {
				throw new Error(
					`Duplicate provider slug '${provider.slug}' in active plugins '${owner}' and '${pluginSlug}'`,
				);
			}
			ownerBySlug.set(provider.slug, pluginSlug);
		}
	}
};

const assertUniquePluginConfigEnvironmentKeys = (
	plugins: Readonly<Record<string, NormalizedPlugin>>,
) => {
	const ownerByEnvironmentKey = new Map<string, string>();
	for (const [pluginSlug, plugin] of Object.entries(plugins)) {
		for (const key of Object.keys(plugin.manifest.configSchema.fields)) {
			const environmentKey = pluginConfigEnvironmentKey(pluginSlug, key);
			const owner = ownerByEnvironmentKey.get(environmentKey);
			if (owner) {
				throw new Error(
					`Duplicate plugin config environment variable '${environmentKey}' in active plugins '${owner}' and '${pluginSlug}'`,
				);
			}
			ownerByEnvironmentKey.set(environmentKey, pluginSlug);
		}
	}
};

const assertUniqueManifestEntrySlugs = (
	kind: string,
	plugins: Readonly<Record<string, NormalizedPlugin>>,
	select: (plugin: NormalizedPlugin) => ReadonlyArray<{ readonly slug: string }>,
) => {
	const ownerBySlug = new Map<string, string>();
	for (const [pluginSlug, plugin] of Object.entries(plugins)) {
		for (const entry of select(plugin)) {
			const owner = ownerBySlug.get(entry.slug);
			if (owner) {
				throw new Error(
					`Duplicate ${kind} slug '${entry.slug}' in active plugins '${owner}' and '${pluginSlug}'`,
				);
			}
			ownerBySlug.set(entry.slug, pluginSlug);
		}
	}
};

export const makePluginLoader = (
	registry: Pick<DefinitionRegistry["Service"], "getSnapshot" | "replace">,
) => {
	const base = definitionSourceFromSnapshot(registry.getSnapshot());
	let snapshot: PluginRegistrySnapshot = deepFreeze({
		plugins: {},
		bindings: emptyBindings(),
		httpRateLimits: { byKey: {}, byOrigin: {} },
		definitions: buildDefinitionSnapshot(base),
	});

	const buildSnapshot = (plugins: Readonly<Record<string, NormalizedPlugin>>) => {
		assertUniquePluginConfigEnvironmentKeys(plugins);
		assertUniqueScriptSlugs(plugins);
		assertUniqueProviderSlugs(plugins);
		assertUniqueManifestEntrySlugs(
			"import source",
			plugins,
			({ manifest }) => manifest.importSources,
		);
		assertUniqueManifestEntrySlugs(
			"integration provider",
			plugins,
			({ manifest }) => manifest.integrationProviders,
		);
		const clonedPlugins = structuredClone(plugins);
		const manifests = Object.values(clonedPlugins).map(({ manifest }) => manifest);
		return deepFreeze({
			plugins: clonedPlugins,
			bindings: mergeBindings(manifests),
			httpRateLimits: buildHttpRateLimitLookups(manifests),
			definitions: buildDefinitionSnapshot(mergeManifestDefinitions(base, manifests)),
		} satisfies PluginRegistrySnapshot);
	};
	const preview = (plugin: NormalizedPlugin) =>
		buildSnapshot({ ...snapshot.plugins, [plugin.manifest.metadata.slug]: plugin });
	const previewAll = (plugins: ReadonlyArray<NormalizedPlugin>) =>
		buildSnapshot(
			Object.fromEntries(plugins.map((plugin) => [plugin.manifest.metadata.slug, plugin])),
		);
	const replace = (next: PluginRegistrySnapshot) => {
		registry.replace(definitionSourceFromSnapshot(next.definitions));
		snapshot = next;
	};
	const load = (plugin: NormalizedPlugin) => replace(preview(plugin));
	const rebuild = (plugins: ReadonlyArray<NormalizedPlugin>) => {
		replace(previewAll(plugins));
	};

	return { load, replace, preview, rebuild, previewAll, getSnapshot: () => snapshot };
};

export class PluginLoader extends Context.Service<PluginLoader>()("PluginLoader", {
	make: Effect.gen(function* () {
		return makePluginLoader(yield* DefinitionRegistry);
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginLoaderLive = PluginLoader.layer.pipe(
	Layer.provideMerge(DefinitionRegistry.layer),
);
