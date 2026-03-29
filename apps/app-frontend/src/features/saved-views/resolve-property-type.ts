import type { AppPropertyDefinition } from "@ryot/ts-utils";
import type { AppEntitySchema } from "#/features/entity-schemas/model";

export type ResolvedPropertyType = Exclude<
	AppPropertyDefinition["type"],
	"datetime"
> | null;

const BUILTIN_TYPES: Record<string, ResolvedPropertyType> = {
	"@name": "string",
	"@createdAt": "date",
	"@updatedAt": "date",
};

const normalizePropertyType = (
	propertyType: AppPropertyDefinition["type"],
): ResolvedPropertyType => {
	return propertyType === "datetime" ? "date" : propertyType;
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

	return normalizePropertyType(propDef.type);
}
