import type { IntegrationProviderSettings } from "@ryot-app/contract/modules/integrations/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

const redactPropertyValue = (definition: AppPropertyDefinition, value: unknown): unknown => {
	if (definition.type === "object" && isObjectRecord(value)) {
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
	settingsSchema: null | AppSchema,
	providerSpecifics: IntegrationProviderSettings,
): IntegrationProviderSettings => {
	if (!settingsSchema) {
		const kind = providerSpecifics["kind"];
		return typeof kind === "string" ? { kind } : {};
	}
	return redactSecretValues(settingsSchema.fields, providerSpecifics);
};
