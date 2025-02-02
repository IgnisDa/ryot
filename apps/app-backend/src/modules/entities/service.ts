import type { AppSchema } from "@ryot/ts-utils";
import { parseAppSchemaProperties } from "~/lib/app-schema-validation";
import { resolveRequiredString } from "~/lib/slug";

export type EntityPropertiesShape = Record<string, unknown>;

export const resolveEntityName = (name: string) =>
	resolveRequiredString(name, "Entity name");

export const resolveEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const parseEntityProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) =>
	parseAppSchemaProperties({
		kind: "Entity",
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	}) as EntityPropertiesShape;

export const resolveEntityCreateInput = (input: {
	name: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}) => {
	const name = resolveEntityName(input.name);
	const properties = parseEntityProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { name, properties };
};
