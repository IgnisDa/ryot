import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import type { ImageSchemaType } from "~/lib/db/schema/tables";

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

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const resolveRemoteImageUrl = (url: string) => {
	const resolvedUrl = resolveRequiredString(url, "Entity image remote url");

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(resolvedUrl);
	} catch {
		throw new Error("Entity image remote url must be a valid URL");
	}

	if (!["http:", "https:"].includes(parsedUrl.protocol))
		throw new Error("Entity image remote url must be a valid URL");

	return resolvedUrl;
};

export const parseEntityImage = (image: unknown): ImageSchemaType | null => {
	if (image == null) return null;
	if (!isJsonObject(image)) throw new Error("Entity image must be an object");

	const kind = image.kind;
	if (kind !== "remote" && kind !== "s3")
		throw new Error("Entity image kind must be either remote or s3");

	if (kind === "remote")
		return { kind, url: resolveRemoteImageUrl(String(image.url ?? "")) };

	return {
		kind,
		key: resolveRequiredString(String(image.key ?? ""), "Entity image s3 key"),
	};
};

export const resolveEntityCreateInput = (input: {
	name: string;
	properties: unknown;
	image: ImageSchemaType | null;
	propertiesSchema: AppSchema;
}) => {
	const name = resolveEntityName(input.name);
	const image = parseEntityImage(input.image);
	const properties = parseEntityProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { name, image, properties };
};
