import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";
import type { CreateEntitySchemaBody } from "./schemas";

export type EntitySchemaPropertiesShape =
	CreateEntitySchemaBody["propertiesSchema"];

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaFacetId = (facetId: string) =>
	resolveRequiredString(facetId, "Facet id");

export const resolveEntitySchemaIcon = (icon: string) =>
	resolveRequiredString(icon, "Entity schema icon");

export const resolveEntitySchemaAccentColor = (accentColor: string) =>
	resolveRequiredString(accentColor, "Entity schema accent color");

export const resolveEntitySchemaSlug = (
	input: Pick<CreateEntitySchemaBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Entity schema",
	});
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	return parseLabeledPropertySchemaInput(
		input,
		"Entity schema properties",
	) as EntitySchemaPropertiesShape;
};

export const resolveEntitySchemaCreateInput = (
	input: Omit<CreateEntitySchemaBody, "facetId">,
) => {
	const icon = resolveEntitySchemaIcon(input.icon);
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const accentColor = resolveEntitySchemaAccentColor(input.accentColor);
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { icon, name, slug, accentColor, propertiesSchema };
};
