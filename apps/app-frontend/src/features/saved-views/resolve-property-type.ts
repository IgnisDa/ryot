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

	if (field.startsWith("@")) {
		return BUILTIN_TYPES[field] ?? null;
	}

	const dotIndex = field.indexOf(".");
	if (dotIndex === -1) {
		return null;
	}

	const slug = field.substring(0, dotIndex);
	const property = field.substring(dotIndex + 1);

	const schema = schemas.find((s) => s.slug === slug);
	if (!schema) {
		return null;
	}

	const propDef = schema.propertiesSchema[property];
	if (!propDef) {
		return null;
	}

	return propDef.type as ResolvedPropertyType;
}
