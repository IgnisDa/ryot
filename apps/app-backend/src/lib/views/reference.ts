import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { ViewRuntimeValidationError } from "./errors";

export type PropertyType = AppPropertyDefinition["type"];

export type RuntimeRef =
	| { type: "top-level"; column: string }
	| { type: "schema-property"; slug: string; property: string };

export type ViewRuntimeSchemaLike = {
	slug: string;
	propertiesSchema: AppSchema;
};

export const parseFieldPath = (field: string): RuntimeRef => {
	if (field.startsWith("@")) {
		return { type: "top-level", column: field.slice(1) };
	}

	const [slug, property, ...rest] = field.split(".");
	if (!slug || !property || rest.length > 0) {
		throw new Error(`Invalid field path: ${field}`);
	}

	return { slug, property, type: "schema-property" };
};

export const getPropertyType = (
	schema: { slug: string; propertiesSchema: AppSchema },
	propertyName: string,
): PropertyType | null => {
	return schema.propertiesSchema.fields[propertyName]?.type ?? null;
};

export const buildSchemaMap = <TSchema extends { slug: string }>(
	schemas: TSchema[],
): Map<string, TSchema> => {
	return new Map(schemas.map((schema) => [schema.slug, schema]));
};

export const resolveRuntimeReference = (reference: string): RuntimeRef => {
	try {
		if (reference.startsWith("@") || reference.includes(".")) {
			return parseFieldPath(reference);
		}
	} catch (error) {
		throw new ViewRuntimeValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	throw new ViewRuntimeValidationError(
		"Schema-qualified property references are required",
	);
};

export const getSchemaForReference = <TSchema extends ViewRuntimeSchemaLike>(
	schemaMap: Map<string, TSchema>,
	reference: Extract<RuntimeRef, { type: "schema-property" }>,
): TSchema => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new ViewRuntimeValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};
