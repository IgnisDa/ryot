import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import type { IntegrationRecord } from "./repository";

export type RegisteredProviderLookup = (
	providerSlug: string,
	pluginSlug: string,
) => RegisteredIntegrationProvider | null;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const redactPropertyValue = (definition: AppPropertyDefinition, value: unknown): unknown => {
	if (definition.type === "object" && isRecord(value)) {
		return redactSecretValues(definition.properties, value);
	}
	if (definition.type === "array" && Array.isArray(value)) {
		if (definition.items.secret === true) {
			return [];
		}
		return value.map((item) => redactPropertyValue(definition.items, item));
	}
	return value;
};

const redactSecretValues = (
	fields: AppSchema["fields"],
	value: Readonly<Record<string, unknown>>,
) => {
	const redacted = { ...value };
	for (const [key, definition] of Object.entries(fields)) {
		if (definition.secret === true) {
			Reflect.deleteProperty(redacted, key);
		} else if (Object.hasOwn(value, key)) {
			redacted[key] = redactPropertyValue(definition, value[key]);
		}
	}
	return redacted;
};

/**
 * Client-facing boundary. `repository.normalizeIntegration` deliberately returns credentials
 * verbatim because integration scripts read them through the `getIntegration` host function.
 * Only the service methods
 * backing the `list` / `get` / `update` contract endpoints route through here.
 */
export const redactIntegrationForClient = (
	findProvider: RegisteredProviderLookup,
	integration: IntegrationRecord,
): IntegrationRecord => {
	const registered = findProvider(integration.provider, integration.pluginSlug);
	if (!registered) {
		const kind = integration.providerSpecifics["kind"];
		const providerSpecifics = typeof kind === "string" ? { kind } : {};
		return { ...integration, providerSpecifics };
	}
	const providerSpecifics = redactSecretValues(
		registered.settingsSchema.fields,
		integration.providerSpecifics,
	);
	return { ...integration, providerSpecifics };
};
