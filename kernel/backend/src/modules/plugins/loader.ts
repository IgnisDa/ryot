import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { and, column, eq, literal, table } from "@ryot-app/ryotql";
import { Context, Effect, Layer } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaPropertiesSafe,
} from "#lib/property-schema/property-schema-runtime";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	DefinitionRegistry,
	type DefinitionSnapshot,
	type DefinitionSource,
	type SavedViewDefinition,
} from "#modules/definition-registry/service";

import { buildHttpRateLimitLookups, type HttpRateLimitLookups } from "./http-rate-limits";
import type { PluginRevision, StoredPluginIdentity } from "./types";

export type PluginRegistryEntry = PluginRevision & StoredPluginIdentity;

export type PluginRegistrySnapshot = {
	readonly definitions: DefinitionSnapshot;
	readonly httpRateLimits: HttpRateLimitLookups;
	readonly plugins: Readonly<Record<string, PluginRegistryEntry>>;
};

export const findPluginEntryById = (snapshot: PluginRegistrySnapshot, pluginId: string) =>
	Object.values(snapshot.plugins).find((plugin) => plugin.id === pluginId) ?? null;

export const deepFreeze = <Value>(value: Value): Value => {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
};

export const materializeSavedView = (
	definition: PluginManifest["savedViews"][number],
	pluginId: string,
	pluginSlug: string,
	client: PluginManifest["client"],
): SavedViewDefinition => {
	if (definition.renderer.kind === "plugin") {
		const page = client?.exports?.[definition.renderer.exportName];
		if (page?.kind !== "page") {
			throw new Error(
				`Invalid saved view ${definition.slug}: plugin renderer '${definition.renderer.exportName}' is not an advertised page export`,
			);
		}
		const parsed = parseAppSchemaPropertiesSafe({
			properties: definition.settings,
			propertiesSchema: page.settingsSchema,
		});
		if (!parsed.success) {
			throw new Error(
				`Invalid saved view ${definition.slug}: ${formatPropertyIssues(parsed.issues)}`,
			);
		}
		return {
			...definition,
			pluginId,
			pluginSlug,
			renderer: { pluginId, kind: "plugin" as const, exportName: definition.renderer.exportName },
		};
	}
	if (definition.renderer.name !== "entity-browser") {
		return { ...definition, pluginId, pluginSlug, renderer: definition.renderer };
	}
	const rawSourceName = definition.settings["sourceName"];
	const sourceName = typeof rawSourceName === "string" ? rawSourceName : undefined;
	const ownerField = definition.settings["ownerPluginIdField"];
	const source = sourceName === undefined ? undefined : definition.dataSources?.queries[sourceName];
	const ownerSelection =
		source?.output.type === "rows" && typeof ownerField === "string"
			? source.output.fields.find((selection) => "key" in selection && selection.key === ownerField)
			: undefined;
	const dataSources =
		definition.dataSources &&
		sourceName !== undefined &&
		source?.output.type === "rows" &&
		ownerSelection &&
		"expr" in ownerSelection &&
		ownerSelection.expr.type === "column"
			? {
					...definition.dataSources,
					queries: {
						...definition.dataSources.queries,
						[sourceName]: {
							...source,
							where: and(
								...(source.where ? [source.where] : []),
								eq(
									column(table("entity", ownerSelection.expr.tableAlias), "entitySchemaPluginId"),
									literal(pluginId),
								),
							),
						},
					},
				}
			: definition.dataSources;
	const addAction = definition.settings["addAction"];
	return {
		...definition,
		pluginId,
		pluginSlug,
		dataSources,
		renderer: definition.renderer,
		settings:
			typeof addAction === "object" && addAction !== null && !Array.isArray(addAction)
				? {
						...definition.settings,
						addAction: Object.assign({}, addAction, { ownerPluginId: pluginId }),
					}
				: definition.settings,
	};
};

export const mergeManifestDefinitions = (
	base: DefinitionSource,
	plugins: ReadonlyArray<Pick<PluginRegistryEntry, "id" | "manifest" | "slug">>,
): DefinitionSource => ({
	signalSchemas: [
		...base.signalSchemas,
		...plugins.flatMap(({ id, manifest }) =>
			manifest.signalSchemas.map((definition) => ({ ...definition, pluginId: id })),
		),
	],
	relationshipSchemas: [
		...plugins.flatMap(({ id, manifest }) =>
			manifest.relationshipSchemas.map((definition) => ({ ...definition, pluginId: id })),
		),
		...base.relationshipSchemas,
	],
	savedViews: [
		...base.savedViews,
		...plugins.flatMap(({ id, slug, manifest }) =>
			manifest.savedViews.map((definition) =>
				materializeSavedView(definition, id, slug, manifest.client),
			),
		),
	],
	entitySchemas: [
		...base.entitySchemas,
		...plugins.flatMap(({ id, slug, manifest }) =>
			manifest.entitySchemas.map((definition) => ({
				...definition,
				pluginId: id,
				pluginSlug: slug,
				mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
				eventSchemas: definition.eventSchemas.map((eventSchema) => ({
					...eventSchema,
					pluginId: id,
				})),
			})),
		),
	],
});

const assertUniqueScriptSlugs = (plugins: Readonly<Record<string, PluginRegistryEntry>>) => {
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

const assertUniqueProviderSlugs = (plugins: Readonly<Record<string, PluginRegistryEntry>>) => {
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
	plugins: Readonly<Record<string, PluginRegistryEntry>>,
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
	plugins: Readonly<Record<string, PluginRegistryEntry>>,
	select: (plugin: PluginRegistryEntry) => ReadonlyArray<{ readonly slug: string }>,
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
		definitions: buildDefinitionSnapshot(base),
		httpRateLimits: { byKey: {}, byOrigin: {} },
	});

	const buildSnapshot = (plugins: Readonly<Record<string, PluginRegistryEntry>>) => {
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
		const pluginEntries = Object.values(clonedPlugins);
		const manifests = pluginEntries.map(({ manifest }) => manifest);
		return deepFreeze({
			plugins: clonedPlugins,
			httpRateLimits: buildHttpRateLimitLookups(manifests),
			definitions: buildDefinitionSnapshot(mergeManifestDefinitions(base, pluginEntries)),
		} satisfies PluginRegistrySnapshot);
	};
	const preview = (plugin: PluginRegistryEntry) =>
		buildSnapshot({ ...snapshot.plugins, [plugin.slug]: plugin });
	const previewAll = (plugins: ReadonlyArray<PluginRegistryEntry>) =>
		buildSnapshot(Object.fromEntries(plugins.map((plugin) => [plugin.slug, plugin])));
	const replace = (next: PluginRegistrySnapshot) => {
		registry.replace(definitionSourceFromSnapshot(next.definitions));
		snapshot = next;
	};
	const load = (plugin: PluginRegistryEntry) => replace(preview(plugin));
	const rebuild = (plugins: ReadonlyArray<PluginRegistryEntry>) => {
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
