import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";

import { buildDefinitionSnapshot, type DefinitionSource } from "#modules/definitions/snapshot";
import { mergeManifestDefinitions } from "#modules/definitions/source";

import { buildHttpRateLimitLookups } from "../catalog/http-rate-limits";

type SystemSetPlugin = { readonly id: string; readonly manifest: PluginManifest };

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
		plugins.map(({ id, manifest }) => ({
			owner: definitionOwner(id),
			packageId: manifest.metadata.packageId,
			httpRateLimits: manifest.httpRateLimits,
		})),
	);
	return buildDefinitionSnapshot(mergeManifestDefinitions(kernel, plugins));
};
