import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";

import {
	buildDefinitionSnapshot,
	type DefinitionSource,
} from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";

import { buildHttpRateLimitLookups } from "./http-rate-limits";

type SystemSetPlugin = {
	readonly id: string;
	readonly slug: string;
	readonly manifest: PluginManifest;
	readonly scripts: ReadonlyArray<{ readonly slug: string }>;
};

const assertUniqueScriptSlugs = (plugins: ReadonlyArray<SystemSetPlugin>) => {
	const ownerBySlug = new Map<string, string>();
	for (const plugin of plugins) {
		const pluginSlug = plugin.slug;
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

const assertUniqueProviderSlugs = (plugins: ReadonlyArray<SystemSetPlugin>) => {
	const ownerBySlug = new Map<string, string>();
	for (const plugin of plugins) {
		const pluginSlug = plugin.slug;
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

const assertUniquePluginConfigEnvironmentKeys = (plugins: ReadonlyArray<SystemSetPlugin>) => {
	const ownerByEnvironmentKey = new Map<string, string>();
	for (const plugin of plugins) {
		const pluginSlug = plugin.slug;
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
	plugins: ReadonlyArray<SystemSetPlugin>,
	select: (plugin: SystemSetPlugin) => ReadonlyArray<{ readonly slug: string }>,
) => {
	const ownerBySlug = new Map<string, string>();
	for (const plugin of plugins) {
		const pluginSlug = plugin.slug;
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

export const validateSystemPluginSet = (
	kernel: DefinitionSource,
	plugins: ReadonlyArray<SystemSetPlugin>,
) => {
	assertUniquePluginConfigEnvironmentKeys(plugins);
	buildHttpRateLimitLookups(
		plugins.map(({ slug, manifest }) => ({ slug, httpRateLimits: manifest.httpRateLimits })),
	);
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
	return buildDefinitionSnapshot(mergeManifestDefinitions(kernel, plugins));
};
