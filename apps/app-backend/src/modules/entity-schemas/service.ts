import type { AppSchema } from "@ryot/ts-utils";
import { resolveRequiredSlug, resolveRequiredString } from "~/lib/slug";
import { parsePropertySchemaInput } from "../property-schemas/service";

export type EntitySchemaPropertiesShape = AppSchema;

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaFacetId = (facetId: string) =>
	resolveRequiredString(facetId, "Facet id");

export const resolveEntitySchemaSlug = (input: {
	name: string;
	slug?: string;
}) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Entity schema",
	});
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	return parsePropertySchemaInput(input, {
		propertiesLabel: "Entity schema properties",
		schemaLabel: "Entity schema properties schema",
	}) as EntitySchemaPropertiesShape;
};

export const resolveEntitySchemaCreateInput = (input: {
	name: string;
	slug?: string;
	propertiesSchema: unknown;
}) => {
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};
