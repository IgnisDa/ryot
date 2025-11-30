import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { ImageSchema, type ImageSchemaType } from "~/lib/db/schema/tables";
import type { CreateEntityBody } from "./schemas";

export type EntityPropertiesShape = Record<string, unknown>;

type EntityDetailScope = {
	entityId: string;
	isBuiltin: boolean;
	entitySchemaId: string;
};

type EntityDetailAccess =
	| { access: EntityDetailScope }
	| { error: "builtin" | "not_found" };

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
	if (!("entitySchema" in entityAccess)) {
		return { error: entityAccess.error };
	}

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

export const parseEntityImage = (image: unknown): ImageSchemaType | null => {
	if (image == null) {
		return null;
	}

	const parsedImage = ImageSchema.safeParse(image);
	if (parsedImage.success) {
		return parsedImage.data;
	}

	const firstIssue = parsedImage.error.issues[0];
	if (!firstIssue) {
		throw new Error("Entity image is invalid");
	}
	if (firstIssue.code === "invalid_type" && firstIssue.path.length === 0) {
		throw new Error("Entity image must be an object");
	}
	if (firstIssue.code === "invalid_union" && firstIssue.path[0] === "kind") {
		throw new Error("Entity image kind must be either remote or s3");
	}

	throw new Error(firstIssue.message);
};

export const resolveEntityCreateInput = (
	input: Pick<CreateEntityBody, "image" | "name" | "properties"> & {
		propertiesSchema: AppSchema;
	},
) => {
	const name = resolveEntityName(input.name);
	const image = parseEntityImage(input.image);
	const properties = parseEntityProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { name, image, properties };
};
