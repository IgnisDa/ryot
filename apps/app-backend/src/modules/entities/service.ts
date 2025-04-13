import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { ImageSchema, type ImageSchemaType } from "~/lib/db/schema/tables";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import {
	createEntityForUser,
	findEntityByExternalIdForUser,
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
	findEntityByExternalIdForUser: typeof findEntityByExternalIdForUser;
};

export type EntityServiceResult<T> = ServiceResult<T, EntityMutationError>;

const entityProvenanceUniqueConstraint =
	"entity_user_schema_script_external_id_unique";
const partialProvenanceError =
	"externalId and detailsSandboxScriptId must both be provided or both be omitted";
const customEntitySchemaError =
	"Built-in entity schemas do not support manual entity creation";
const entitySchemaNotFoundError = "Entity schema not found";
const customEntityDetailError =
	"Built-in entity schemas do not support generated entity detail pages";
const entityNotFoundError = "Entity not found";

const entityServiceDeps: EntityServiceDeps = {
	createEntityForUser,
	getEntityByIdForUser,
	getEntityScopeForUser,
	getEntitySchemaScopeForUser,
	findEntityByExternalIdForUser,
};

const resolveEntityIdResult = (entityId: string) =>
	wrapServiceValidator(
		() => resolveEntityId(entityId),
		"Entity id is required",
	);

const resolveEntitySchemaIdResult = (entitySchemaId: string) =>
	wrapServiceValidator(
		() => resolveEntitySchemaId(entitySchemaId),
		"Entity schema id is required",
	);

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
) =>
	wrapServiceValidator(
		() => resolveEntityCreateInput(input),
		"Entity payload is invalid",
	);

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
		return serviceError(
			foundEntity.error === "not_found" ? "not_found" : "validation",
			foundEntity.error === "not_found"
				? entityNotFoundError
				: customEntityDetailError,
		);
	}

	const entity = await deps.getEntityByIdForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
	});
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}

	return serviceData(entity);
};

export const createEntity = async (
	input: { body: CreateEntityBody; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const hasExternalId = input.body.externalId !== undefined;
	const hasScriptId = input.body.detailsSandboxScriptId !== undefined;
	if (hasExternalId !== hasScriptId) {
		return serviceError("validation", partialProvenanceError);
	}

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
		return serviceError(
			foundEntitySchema.error === "not_found" ? "not_found" : "validation",
			foundEntitySchema.error === "not_found"
				? entitySchemaNotFoundError
				: customEntitySchemaError,
		);
	}

	const provenance =
		input.body.externalId !== undefined &&
		input.body.detailsSandboxScriptId !== undefined
			? {
					externalId: input.body.externalId,
					detailsSandboxScriptId: input.body.detailsSandboxScriptId,
				}
			: null;

	if (provenance) {
		const existingEntity = await deps.findEntityByExternalIdForUser({
			userId: input.userId,
			externalId: provenance.externalId,
			entitySchemaId: entitySchemaIdResult.data,
			detailsSandboxScriptId: provenance.detailsSandboxScriptId,
		});
		if (existingEntity) {
			return serviceData(existingEntity);
		}
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

	try {
		const createdEntity = await deps.createEntityForUser({
			userId: input.userId,
			name: entityInput.data.name,
			image: entityInput.data.image,
			externalId: provenance?.externalId,
			properties: entityInput.data.properties,
			entitySchemaId: entitySchemaIdResult.data,
			detailsSandboxScriptId: provenance?.detailsSandboxScriptId,
		});

		return serviceData(createdEntity);
	} catch (error) {
		if (
			isUniqueConstraintError(error, entityProvenanceUniqueConstraint) &&
			provenance
		) {
			const existingEntity = await deps.findEntityByExternalIdForUser({
				userId: input.userId,
				externalId: provenance.externalId,
				entitySchemaId: entitySchemaIdResult.data,
				detailsSandboxScriptId: provenance.detailsSandboxScriptId,
			});
			if (existingEntity) {
				return serviceData(existingEntity);
			}
		}

		throw error;
	}
};
