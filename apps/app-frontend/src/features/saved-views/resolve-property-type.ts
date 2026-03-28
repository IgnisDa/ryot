import type { AppEntitySchema } from "#/features/entity-schemas/model";

export type ResolvedPropertyType =
	| "array"
	| "boolean"
	| "date"
	| "integer"
	| "number"
	| "object"
	| "string"
	| null;

const BUILTIN_TYPES: Record<string, ResolvedPropertyType> = {
	"@name": "string",
	"@createdAt": "date",
	"@updatedAt": "date",
};

export function resolvePropertyType(
	field: string,
	schemas: AppEntitySchema[],
): ResolvedPropertyType {
	if (!field) {
		return null;
	}

	if (field.startsWith("event.")) {
		return null;
	}

	const [namespace, slug, property, ...rest] = field.split(".");
	if (namespace !== "entity" || !slug || !property || rest.length > 0) {
		return null;
	}

	if (property.startsWith("@")) {
		return BUILTIN_TYPES[property] ?? null;
	}

	const schema = schemas.find((s) => s.slug === slug);
	if (!schema) {
		return null;
	}

	const propDef = schema.propertiesSchema.fields[property];
	if (!propDef) {
		return null;
	}

	return propDef.type as ResolvedPropertyType;
}
