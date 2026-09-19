import type { IngestionReadinessMetadata } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import { parseAppSchemaPropertiesSafe } from "#lib/property-schema/property-schema-runtime";

export const availablePluginConfigKeys = (
	configSchema: AppSchema,
	oauthProviders: IngestionReadinessMetadata["oauthProviders"],
	properties: Readonly<Record<string, unknown>>,
) => {
	const oauthClientKeys = new Set(
		oauthProviders.flatMap(({ clientIdConfigKey, clientSecretConfigKey }) => [
			clientIdConfigKey,
			clientSecretConfigKey,
		]),
	);
	return Object.entries(configSchema.fields)
		.flatMap(([key, property]) => {
			const configuredValue = Object.hasOwn(properties, key) ? properties[key] : undefined;
			const parsed = parseAppSchemaPropertiesSafe({
				kind: "Plugin configuration",
				propertiesSchema: { fields: { [key]: property } },
				properties: configuredValue === undefined ? {} : { [key]: configuredValue },
			});
			if (!parsed.success) {
				return [];
			}
			const value = Object.hasOwn(parsed.data, key) ? parsed.data[key] : undefined;
			return value !== undefined &&
				value !== null &&
				(!oauthClientKeys.has(key) || (typeof value === "string" && value.length > 0))
				? [key]
				: [];
		})
		.sort();
};

export const ingestionReadinessMetadata = (
	manifest: PluginManifest,
	configuredKeys: ReadonlyArray<string>,
	hasConfigRevision: boolean,
): IngestionReadinessMetadata => ({
	workflows: manifest.workflows.map(({ slug, scriptSlug }) => ({ slug, scriptSlug })),
	oauthProviders: (manifest.oauthProviders ?? []).map(
		({ slug, clientIdConfigKey, clientSecretConfigKey }) => ({
			slug,
			clientIdConfigKey,
			clientSecretConfigKey,
		}),
	),
	availableConfigKeys: [
		...new Set([
			...configuredKeys,
			...(hasConfigRevision
				? []
				: availablePluginConfigKeys(manifest.configSchema, manifest.oauthProviders ?? [], {})),
		]),
	].sort(),
	scripts: manifest.scripts.map(
		({
			slug,
			oauthConnectionFields,
			executableDependencies,
			requiredPluginConfigKeys,
			optionalPluginConfigKeys,
		}) => ({
			slug,
			oauthConnectionFields,
			executableDependencies,
			requiredPluginConfigKeys,
			optionalPluginConfigKeys,
		}),
	),
});
