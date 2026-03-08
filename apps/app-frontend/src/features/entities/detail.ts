import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";

export interface EntityDetailProperty {
	key: string;
	label: string;
	value: string;
}

export function getEntityDetailPath(facetSlug: string, entityId: string) {
	return `/tracking/${facetSlug}/entities/${entityId}`;
}

export function formatEntityDetailPropertyValue(
	propertyDef: AppPropertyDefinition,
	value: unknown,
): string | null {
	if (value === null || value === undefined) return null;

	switch (propertyDef.type) {
		case "boolean":
			return typeof value === "boolean" ? (value ? "Yes" : "No") : null;
		case "integer":
		case "number":
			return typeof value === "number" ? value.toString() : null;
		case "string":
			return typeof value === "string" ? value : null;
		case "date":
			return typeof value === "string" ? value : null;
		case "array":
		case "object":
			return null;
	}
}

export function getEntityDetailProperties(
	propertiesSchema: AppSchema,
	properties: Record<string, unknown>,
): EntityDetailProperty[] {
	return Object.entries(propertiesSchema)
		.map(([key, propertyDef]) => {
			const value = formatEntityDetailPropertyValue(
				propertyDef,
				properties[key],
			);
			if (value === null) return null;

			return { key, value, label: key };
		})
		.filter((property): property is EntityDetailProperty => !!property);
}

export function hasDeferredEntityDetailProperties(propertiesSchema: AppSchema) {
	return Object.values(propertiesSchema).some(
		(propertyDef) =>
			propertyDef.type === "array" || propertyDef.type === "object",
	);
}
