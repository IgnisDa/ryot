import type { AppSchema } from "@ryot/ts-utils";
import { resolveRequiredSlug, resolveRequiredString } from "~/lib/slug";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";

export type EventSchemaPropertiesShape = AppSchema;

export const resolveEventSchemaName = (name: string) =>
	resolveRequiredString(name, "Event schema name");

export const resolveEventSchemaEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const resolveEventSchemaSlug = (input: {
	name: string;
	slug?: string;
}) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Event schema",
	});
};

export const parseEventSchemaPropertiesSchema = (input: unknown) =>
	parseLabeledPropertySchemaInput(
		input,
		"Event schema properties",
	) as EventSchemaPropertiesShape;

export const resolveEventSchemaCreateInput = (input: {
	name: string;
	slug?: string;
	propertiesSchema: unknown;
}) => {
	const name = resolveEventSchemaName(input.name);
	const slug = resolveEventSchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEventSchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};
