import type { PluginBindings, PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	DefinitionRegistry,
	type DefinitionSnapshot,
	type DefinitionSource,
} from "#modules/definition-registry/service";

import type { NormalizedPlugin } from "./types";

export type PluginRegistrySnapshot = {
	readonly bindings: PluginBindings;
	readonly definitions: DefinitionSnapshot;
	readonly plugins: Readonly<Record<string, NormalizedPlugin>>;
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
	schemaScriptLinks: [],
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
			entitySchemas.map((definition) => ({ ...definition, pluginSlug: metadata.slug })),
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
			schemaScriptLinks: [...bindings.schemaScriptLinks, ...manifest.bindings.schemaScriptLinks],
			relationshipAutomations: [
				...bindings.relationshipAutomations,
				...manifest.bindings.relationshipAutomations,
			],
		}),
		emptyBindings(),
	);

export const makePluginLoader = (registry: Pick<DefinitionRegistry, "getSnapshot" | "replace">) => {
	const base = definitionSourceFromSnapshot(registry.getSnapshot());
	let snapshot: PluginRegistrySnapshot = {
		plugins: {},
		bindings: emptyBindings(),
		definitions: buildDefinitionSnapshot(base),
	};

	const buildSnapshot = (plugins: Readonly<Record<string, NormalizedPlugin>>) => {
		const clonedPlugins = structuredClone(plugins);
		const manifests = Object.values(clonedPlugins).map(({ manifest }) => manifest);
		return deepFreeze({
			plugins: clonedPlugins,
			bindings: mergeBindings(manifests),
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

	return { load, preview, rebuild, previewAll, getSnapshot: () => snapshot };
};

export class PluginLoader extends Effect.Service<PluginLoader>()("PluginLoader", {
	effect: Effect.gen(function* () {
		return makePluginLoader(yield* DefinitionRegistry);
	}),
}) {}

export const PluginLoaderLive = PluginLoader.Default.pipe(
	Layer.provideMerge(DefinitionRegistry.Default),
);
