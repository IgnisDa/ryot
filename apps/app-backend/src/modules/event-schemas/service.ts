import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";
import type { CreateEventSchemaBody } from "./schemas";

export type EventSchemaPropertiesShape =
	CreateEventSchemaBody["propertiesSchema"];

export const resolveEventSchemaName = (name: string) =>
	resolveRequiredString(name, "Event schema name");

export const resolveEventSchemaEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const resolveEventSchemaSlug = (
	input: Pick<CreateEventSchemaBody, "name" | "slug">,
) => {
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

export const resolveEventSchemaCreateInput = (
	input: Pick<CreateEventSchemaBody, "name" | "propertiesSchema" | "slug">,
) => {
	const name = resolveEventSchemaName(input.name);
	const slug = resolveEventSchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEventSchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};
