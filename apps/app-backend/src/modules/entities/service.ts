import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { resolveRequiredString } from "@ryot/ts-utils/slug";

import { checkReadAccess } from "~/lib/access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import {
	formatValidationIssues,
	parseAppSchemaProperties,
	parseAppSchemaPropertiesSafe,
} from "~/lib/app/schema-validation";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { ImageSchema, type ImageSchemaType } from "~/lib/zod";
import { getRelationshipSchemaById } from "~/modules/relationship-schemas";

import {
	buildEntityRelationshipProperties,
	createEntityForUser,
	findEntityByExternalIdForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
	insertRelationship,
	upsertEntityRelationship,
} from "./repository";
import type { CreateEntityBody, ListedEntity } from "./schemas";

export type EntityPropertiesShape = Record<string, unknown>;

type EntityMutationError = "not_found" | "validation";

export type EntityServiceDeps = {
	createEntityForUser: typeof createEntityForUser;
	getEntityByIdForUser: typeof getEntityByIdForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	findEntityByExternalIdForUser: typeof findEntityByExternalIdForUser;
};

export type EntityServiceResult<T> = ServiceResult<T, EntityMutationError>;

const entityProvenanceUniqueConstraint = "entity_user_schema_script_external_id_unique";
const entityNotFoundError = "Entity not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";
const entitySchemaNotFoundError = "Entity schema not found";
const libraryEntityNotFoundError = "User library entity not found";

const entityServiceDeps: EntityServiceDeps = {
	createEntityForUser,
	getEntityByIdForUser,
	getEntityScopeForUser,
	getEntitySchemaScopeForUser,
	findEntityByExternalIdForUser,
};

const resolveEntityIdResult = (entityId: string) =>
	wrapServiceValidator(() => resolveEntityId(entityId), "Entity id is required");

const resolveEntitySchemaIdResult = (entitySchemaId: string) =>
	wrapServiceValidator(() => resolveEntitySchemaId(entitySchemaId), "Entity schema id is required");

export const resolveEntityId = (entityId: string) => resolveRequiredString(entityId, "Entity id");

export const resolveEntityName = (name: string) => resolveRequiredString(name, "Entity name");

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
	if (firstIssue.code === "invalid_union" && firstIssue.path[0] === "type") {
		throw new Error("Entity image type must be either remote or s3");
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
) => wrapServiceValidator(() => resolveEntityCreateInput(input), "Entity payload is invalid");

export const upsertInLibraryIfGlobal = async (
	input: { userId: string; entityId: string; entityUserId: string | null },
	deps: {
		getUserLibraryEntityId: (input: { userId: string }) => Promise<string | undefined>;
		upsertInLibraryRelationship: (input: {
			userId: string;
			mediaEntityId: string;
			libraryEntityId: string;
		}) => Promise<void>;
	},
) => {
	if (input.entityUserId !== null) {
		return undefined;
	}
	const libraryEntityId = await deps.getUserLibraryEntityId({
		userId: input.userId,
	});
	if (!libraryEntityId) {
		return serviceError("validation", libraryEntityNotFoundError);
	}
	await deps.upsertInLibraryRelationship({
		libraryEntityId,
		userId: input.userId,
		mediaEntityId: input.entityId,
	});

	return undefined;
};

export const getEntityDetail = async (
	input: { entityId: string; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const entityIdResult = resolveEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const entityResult = checkReadAccess(
		await deps.getEntityScopeForUser({
			entityId: entityIdResult.data,
			userId: input.userId,
		}),
		{ not_found: entityNotFoundError },
	);
	if ("error" in entityResult) {
		return serviceError("not_found", entityResult.message);
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
	const hasScriptId = input.body.sandboxScriptId !== undefined;
	if (hasExternalId !== hasScriptId) {
		return serviceError("validation", partialProvenanceError);
	}

	const entitySchemaIdResult = resolveEntitySchemaIdResult(input.body.entitySchemaId);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const scope = await deps.getEntitySchemaScopeForUser({
		userId: input.userId,
		entitySchemaId: entitySchemaIdResult.data,
	});
	if (!scope) {
		return serviceError("not_found", entitySchemaNotFoundError);
	}

	const provenance =
		input.body.externalId !== undefined && input.body.sandboxScriptId !== undefined
			? {
					externalId: input.body.externalId,
					sandboxScriptId: input.body.sandboxScriptId,
				}
			: null;

	if (provenance) {
		const existingEntity = await deps.findEntityByExternalIdForUser({
			userId: input.userId,
			externalId: provenance.externalId,
			entitySchemaId: entitySchemaIdResult.data,
			sandboxScriptId: provenance.sandboxScriptId,
		});
		if (existingEntity) {
			return serviceData(existingEntity);
		}
	}

	const entityInput = resolveEntityCreateInputResult({
		name: input.body.name,
		image: input.body.image,
		properties: input.body.properties,
		propertiesSchema: scope.propertiesSchema,
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
			sandboxScriptId: provenance?.sandboxScriptId,
		});

		return serviceData(createdEntity);
	} catch (error) {
		if (isUniqueConstraintError(error, entityProvenanceUniqueConstraint) && provenance) {
			const existingEntity = await deps.findEntityByExternalIdForUser({
				userId: input.userId,
				externalId: provenance.externalId,
				entitySchemaId: entitySchemaIdResult.data,
				sandboxScriptId: provenance.sandboxScriptId,
			});
			if (existingEntity) {
				return serviceData(existingEntity);
			}
		}

		throw error;
	}
};

const relationshipSchemaNotFoundError = "Relationship schema not found";

export type WriteRelationshipDeps = {
	insertRelationship: typeof insertRelationship;
	getRelationshipSchemaById: typeof getRelationshipSchemaById;
};

const writeRelationshipDeps: WriteRelationshipDeps = {
	insertRelationship,
	getRelationshipSchemaById,
};

export const writeRelationship = async (
	input: {
		userId: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	},
	deps: WriteRelationshipDeps = writeRelationshipDeps,
): Promise<ServiceResult<void, "not_found" | "validation">> => {
	const relSchema = await deps.getRelationshipSchemaById(input.relationshipSchemaId, input.userId);
	if (!relSchema) {
		return serviceError("not_found", relationshipSchemaNotFoundError);
	}

	const result = parseAppSchemaPropertiesSafe({
		properties: input.properties,
		propertiesSchema: relSchema.propertiesSchema,
	});
	if (!result.success) {
		return serviceError(
			"validation",
			`Relationship properties validation failed: ${formatValidationIssues(result.issues)}`,
		);
	}

	await deps.insertRelationship({
		userId: input.userId,
		properties: result.data,
		sourceEntityId: input.sourceEntityId,
		targetEntityId: input.targetEntityId,
		relationshipSchemaId: input.relationshipSchemaId,
	});

	return serviceData(undefined);
};

export type WriteEntityRelationshipDeps = {
	upsertEntityRelationship: typeof upsertEntityRelationship;
	getRelationshipSchemaById: typeof getRelationshipSchemaById;
};

const writeEntityRelationshipDeps: WriteEntityRelationshipDeps = {
	getRelationshipSchemaById,
	upsertEntityRelationship,
};

export const writeEntityRelationship = async (
	input: {
		role: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		extraProperties: Record<string, unknown>;
	},
	deps: WriteEntityRelationshipDeps = writeEntityRelationshipDeps,
): Promise<ServiceResult<void, "not_found" | "validation">> => {
	const relSchema = await deps.getRelationshipSchemaById(input.relationshipSchemaId, null);
	if (!relSchema) {
		return serviceError("not_found", relationshipSchemaNotFoundError);
	}

	const propertiesToValidate = buildEntityRelationshipProperties(
		undefined,
		input.role,
		input.extraProperties,
	);
	const result = parseAppSchemaPropertiesSafe({
		properties: propertiesToValidate,
		propertiesSchema: relSchema.propertiesSchema,
	});
	if (!result.success) {
		return serviceError(
			"validation",
			`Relationship properties validation failed: ${formatValidationIssues(result.issues)}`,
		);
	}

	const { roles: _roles, ...validatedExtraProperties } = result.data;
	await deps.upsertEntityRelationship({
		role: input.role,
		sourceEntityId: input.sourceEntityId,
		targetEntityId: input.targetEntityId,
		extraProperties: validatedExtraProperties,
		relationshipSchemaId: input.relationshipSchemaId,
	});

	return serviceData(undefined);
};
