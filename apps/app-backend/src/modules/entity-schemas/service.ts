import {
	type AppSchema,
	resolveRequiredSlug,
	resolveRequiredString,
} from "@ryot/ts-utils";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";

export type EntitySchemaPropertiesShape = AppSchema;

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaFacetId = (facetId: string) =>
	resolveRequiredString(facetId, "Facet id");

export const resolveEntitySchemaIcon = (icon: string) =>
	resolveRequiredString(icon, "Entity schema icon");

export const resolveEntitySchemaAccentColor = (accentColor: string) =>
	resolveRequiredString(accentColor, "Entity schema accent color");

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
	return parseLabeledPropertySchemaInput(
		input,
		"Entity schema properties",
	) as EntitySchemaPropertiesShape;
};

export const resolveEntitySchemaCreateInput = (input: {
	icon: string;
	name: string;
	slug?: string;
	accentColor: string;
	propertiesSchema: unknown;
}) => {
	const icon = resolveEntitySchemaIcon(input.icon);
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const accentColor = resolveEntitySchemaAccentColor(input.accentColor);
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { icon, name, slug, accentColor, propertiesSchema };
};
