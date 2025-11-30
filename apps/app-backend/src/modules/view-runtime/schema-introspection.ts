import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";

type ViewRuntimeSchema = {
	slug: string;
	propertiesSchema: EntitySchemaPropertiesShape;
};

export type PropertyType = EntitySchemaPropertiesShape[string]["type"];

export const getPropertyType = (
	schema: ViewRuntimeSchema,
	propertyName: string,
) => {
	return schema.propertiesSchema[propertyName]?.type ?? null;
};

export const buildSchemaMap = <TSchema extends ViewRuntimeSchema>(
	schemas: TSchema[],
) => {
	return new Map(schemas.map((schema) => [schema.slug, schema]));
};

export const parseFieldPath = (field: string) => {
	if (field.startsWith("@"))
		return {
			type: "top-level" as const,
			column: field.slice(1),
		};

	const [slug, property, ...rest] = field.split(".");
	if (!slug || !property || rest.length > 0)
		throw new Error(`Invalid field path: ${field}`);

	return { slug, property, type: "schema-property" as const };
};
