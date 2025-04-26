import type { AppSchema } from "@ryot/ts-utils";
import { parseAppSchemaProperties } from "~/lib/app-schema-validation";
import { resolveCustomEntitySchemaAccess } from "~/lib/entity-schema-access";
import { resolveRequiredString } from "~/lib/slug";

export type EntityPropertiesShape = Record<string, unknown>;

type EntityDetailScope = {
	entityId: string;
	isBuiltin: boolean;
	entitySchemaId: string;
};

type EntityDetailAccess =
	| { error: "builtin" | "not_found" }
	| { access: EntityDetailScope };

export const resolveEntityId = (entityId: string) =>
	resolveRequiredString(entityId, "Entity id");

export const resolveEntityName = (name: string) =>
	resolveRequiredString(name, "Entity name");

export const resolveEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const resolveEntityDetailAccess = (
	scope: EntityDetailScope | undefined,
): EntityDetailAccess => {
	const entityAccess = resolveCustomEntitySchemaAccess(scope);
	if (!("entitySchema" in entityAccess)) return { error: entityAccess.error };

	return { access: entityAccess.entitySchema };
};

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
