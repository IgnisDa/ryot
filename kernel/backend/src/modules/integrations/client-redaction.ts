import type { IntegrationProviderSettings } from "@ryot-app/contract/modules/integrations/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

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

export const redactIntegrationForClient = (
	settingsSchema: AppSchema | null,
	providerSpecifics: IntegrationProviderSettings,
): IntegrationProviderSettings => {
	if (!settingsSchema) {
		const kind = providerSpecifics["kind"];
		return typeof kind === "string" ? { kind } : {};
	}
	return redactSecretValues(settingsSchema.fields, providerSpecifics);
};
