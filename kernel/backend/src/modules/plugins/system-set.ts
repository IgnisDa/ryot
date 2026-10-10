import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";

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

export const validateSystemPluginSet = (
	kernel: DefinitionSource,
	plugins: ReadonlyArray<SystemSetPlugin>,
) => {
	const packageIds = new Set<PluginManifest["metadata"]["packageId"]>();
	for (const plugin of plugins) {
		const packageId = plugin.manifest.metadata.packageId;
		if (packageIds.has(packageId)) {
			throw new Error(`Duplicate package identity '${packageId}' in active system plugins`);
		}
		packageIds.add(packageId);
		const environmentKeys = new Set<string>();
		for (const key of Object.keys(plugin.manifest.configSchema.fields)) {
			const environmentKey = pluginConfigEnvironmentKey(packageId, key);
			if (environmentKeys.has(environmentKey)) {
				throw new Error(`Duplicate plugin config environment variable '${environmentKey}'`);
			}
			environmentKeys.add(environmentKey);
		}
	}
	buildHttpRateLimitLookups(
		plugins.map(({ id, slug, manifest }) => ({
			slug,
			scope: "system",
			owner: definitionOwner(id),
			httpRateLimits: manifest.httpRateLimits,
		})),
	);
	return buildDefinitionSnapshot(mergeManifestDefinitions(kernel, plugins));
};
