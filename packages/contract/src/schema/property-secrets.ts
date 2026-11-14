import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

import type { AppPropertyDefinition, AppSchema } from "./property-schema";

export const hasPropertySecrets = (property: AppPropertyDefinition): boolean =>
	property.secret === true ||
	(property.type === "array" && hasPropertySecrets(property.items)) ||
	(property.type === "object" && Object.values(property.properties).some(hasPropertySecrets));

const retainValue = (
	property: AppPropertyDefinition,
	stored: unknown,
	submitted: unknown,
): unknown => {
	if (
		submitted === undefined &&
		(property.secret || (property.type === "array" && hasPropertySecrets(property)))
	) {
		return stored;
	}
	if (property.type === "object" && isObjectRecord(submitted) && isObjectRecord(stored)) {
		return retainPropertySecrets({ fields: property.properties }, stored, submitted);
	}
	return submitted;
};

export const retainPropertySecrets = (
	schema: AppSchema,
	stored: Readonly<Record<string, unknown>>,
	submitted: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
	const result = new Map(Object.entries(submitted));
	for (const [key, property] of Object.entries(schema.fields)) {
		const value = retainValue(property, stored[key], submitted[key]);
		if (value !== undefined) {
			result.set(key, value);
		}
	}
	return Object.fromEntries(result);
};
