import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { checkReadAccess } from "~/lib/access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { ImageSchema, type ImageSchemaType } from "~/lib/zod";
import {
	createEntityForUser,
	findEntityByExternalIdForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
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

const entityProvenanceUniqueConstraint =
	"entity_user_schema_script_external_id_unique";
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

export const upsertInLibraryIfGlobal = async (
	input: { userId: string; entityId: string; entityUserId: string | null },
	deps: {
		getUserLibraryEntityId: (input: {
			userId: string;
		}) => Promise<string | undefined>;
		upsertInLibraryRelationship: (input: {
			userId: string;
			mediaEntityId: string;
			libraryEntityId: string;
		}) => Promise<void>;
	},
) => {
	if (input.entityUserId !== null) {
		return;
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

	const entitySchemaIdResult = resolveEntitySchemaIdResult(
		input.body.entitySchemaId,
	);
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
		input.body.externalId !== undefined &&
		input.body.sandboxScriptId !== undefined
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
		propertiesSchema: scope.propertiesSchema as AppSchema,
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
		if (
			isUniqueConstraintError(error, entityProvenanceUniqueConstraint) &&
			provenance
		) {
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
