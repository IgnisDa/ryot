import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { ImageSchema, type ImageSchemaType } from "~/lib/db/schema/tables";
import {
	createEntityForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
} from "./repository";
import type { CreateEntityBody, ListedEntity } from "./schemas";

export type EntityPropertiesShape = Record<string, unknown>;

type EntityDetailScope = {
	entityId: string;
	isBuiltin: boolean;
	entitySchemaId: string;
};

type EntityDetailAccess =
	| { access: EntityDetailScope }
	| { error: "builtin" | "not_found" };

type EntityMutationError = "not_found" | "validation";

export type EntityServiceDeps = {
	createEntityForUser: typeof createEntityForUser;
	getEntityByIdForUser: typeof getEntityByIdForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
};

export type EntityServiceResult<T> =
	| { data: T }
	| { error: EntityMutationError; message: string };

const customEntitySchemaError =
	"Built-in entity schemas do not support manual entity creation";
const entitySchemaNotFoundError = "Entity schema not found";
const customEntityDetailError =
	"Built-in entity schemas do not support generated entity detail pages";
const entityNotFoundError = "Entity not found";

const entityServiceDeps: EntityServiceDeps = {
	createEntityForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
};

const createDataResult = <T>(data: T): EntityServiceResult<T> => ({ data });

const createErrorResult = <T>(input: {
	error: EntityMutationError;
	message: string;
}): EntityServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const resolveEntityIdResult = (
	entityId: string,
): EntityServiceResult<string> => {
	try {
		return createDataResult(resolveEntityId(entityId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Entity id is required";
		return createErrorResult({ error: "validation", message });
	}
};

const resolveEntitySchemaIdResult = (
	entitySchemaId: string,
): EntityServiceResult<string> => {
	try {
		return createDataResult(resolveEntitySchemaId(entitySchemaId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Entity schema id is required";
		return createErrorResult({ error: "validation", message });
	}
};

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

const resolveEntityCreateInputResult = (
	input: Pick<CreateEntityBody, "image" | "name" | "properties"> & {
		propertiesSchema: AppSchema;
	},
): EntityServiceResult<ReturnType<typeof resolveEntityCreateInput>> => {
	try {
		return createDataResult(resolveEntityCreateInput(input));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Entity payload is invalid";
		return createErrorResult({ error: "validation", message });
	}
};

export const getEntityDetail = async (
	input: { entityId: string; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const entityIdResult = resolveEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const foundEntity = resolveEntityDetailAccess(
		await deps.getEntityScopeForUser({
			entityId: entityIdResult.data,
			userId: input.userId,
		}),
	);
	if ("error" in foundEntity) {
		return createErrorResult({
			error: foundEntity.error === "not_found" ? "not_found" : "validation",
			message:
				foundEntity.error === "not_found"
					? entityNotFoundError
					: customEntityDetailError,
		});
	}

	const entity = await deps.getEntityByIdForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
	});
	if (!entity) {
		return createErrorResult({
			error: "not_found",
			message: entityNotFoundError,
		});
	}

	return createDataResult(entity);
};

export const createEntity = async (
	input: { body: CreateEntityBody; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const entitySchemaIdResult = resolveEntitySchemaIdResult(
		input.body.entitySchemaId,
	);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const foundEntitySchema = resolveCustomEntitySchemaAccess(
		await deps.getEntitySchemaScopeForUser({
			entitySchemaId: entitySchemaIdResult.data,
			userId: input.userId,
		}),
	);
	if (!("entitySchema" in foundEntitySchema)) {
		return createErrorResult({
			error:
				foundEntitySchema.error === "not_found" ? "not_found" : "validation",
			message:
				foundEntitySchema.error === "not_found"
					? entitySchemaNotFoundError
					: customEntitySchemaError,
		});
	}

	const entityInput = resolveEntityCreateInputResult({
		name: input.body.name,
		image: input.body.image,
		properties: input.body.properties,
		propertiesSchema: foundEntitySchema.entitySchema
			.propertiesSchema as AppSchema,
	});
	if ("error" in entityInput) {
		return entityInput;
	}

	const createdEntity = await deps.createEntityForUser({
		userId: input.userId,
		name: entityInput.data.name,
		image: entityInput.data.image,
		properties: entityInput.data.properties,
		entitySchemaId: entitySchemaIdResult.data,
	});

	return createDataResult(createdEntity);
};
