import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	type DefinitionSetPlugin,
	validateDefinitionSet,
} from "@ryot-app/definitions/definition-set";
import type { DefinitionSource } from "@ryot-app/definitions/snapshot";

import { buildHttpRateLimitLookups } from "../catalog/http-rate-limits";

export const validateSystemPluginSet = (
	kernel: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
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
	return validateDefinitionSet(kernel, plugins);
};
