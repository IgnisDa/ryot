import { z } from "zod";

export interface EntitySchemaFormValues {
	name: string;
	slug: string;
	propertiesSchema: string;
}

export const defaultEntitySchemaPropertiesSchema =
	'{"type":"object","properties":{}}';

function isPlainObject(value: unknown) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidPropertiesSchemaShape(value: string) {
	let parsed: unknown;

	try {
		parsed = JSON.parse(value);
	} catch {
		return false;
	}

	if (!isPlainObject(parsed)) return false;

	const parsedObject = parsed as { properties?: unknown; type?: unknown };
	const keys = Object.keys(parsedObject);

	if (keys.length !== 2) return false;
	if (!keys.includes("type") || !keys.includes("properties")) return false;
	if (parsedObject.type !== "object") return false;
	if (!isPlainObject(parsedObject.properties)) return false;

	return true;
}

export const createEntitySchemaFormSchema = z.object({
	name: z
		.string()
		.refine((value) => value.trim().length > 0, "Name is required"),
	slug: z
		.string()
		.refine((value) => value.trim().length > 0, "Slug is required"),
	propertiesSchema: z
		.string()
		.refine((value) => value.trim().length > 0, "Properties schema is required")
		.refine(
			hasValidPropertiesSchemaShape,
			"Properties schema must be valid JSON Schema object text",
		),
});

export type CreateEntitySchemaFormValues = z.infer<
	typeof createEntitySchemaFormSchema
>;

export function buildEntitySchemaFormValues(
	values?: Partial<EntitySchemaFormValues>,
): CreateEntitySchemaFormValues {
	return {
		name: values?.name ?? "",
		slug: values?.slug ?? "",
		propertiesSchema:
			values?.propertiesSchema ?? defaultEntitySchemaPropertiesSchema,
	};
}

export const defaultCreateEntitySchemaFormValues: CreateEntitySchemaFormValues =
	buildEntitySchemaFormValues();

export interface CreateEntitySchemaPayload {
	name: string;
	slug: string;
	facetId: string;
	propertiesSchema: string;
}

export function toCreateEntitySchemaPayload(
	input: CreateEntitySchemaFormValues,
	facetId: string,
) {
	return {
		facetId,
		name: input.name.trim(),
		slug: input.slug.trim(),
		propertiesSchema: input.propertiesSchema,
	};
}
