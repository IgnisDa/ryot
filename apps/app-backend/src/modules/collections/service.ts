import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { resolveRequiredString } from "@ryot/ts-utils/slug";

import { formatValidationIssues, parseAppSchemaPropertiesSafe } from "~/lib/app/schema-validation";
import type { DbClient } from "~/lib/db";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { ensureEntityInLibrary } from "~/modules/entities";
import { parseLabeledPropertySchemaInput } from "~/modules/property-schemas";

import {
	addEntityToCollection,
	createCollectionForUser,
	createLibraryEntityForUser,
	findCollectionByNameForUser,
	getBuiltinCollectionSchema,
	getCollectionById,
	getEntityById,
	removeEntityFromCollection,
} from "./repository";
import type {
	AddToCollectionBody,
	AddToCollectionData,
	CollectionResponse,
	CreateCollectionBody,
	RemoveFromCollectionBody,
	RemoveFromCollectionData,
} from "./schemas";

const entityNotFoundError = "Entity not found";
const collectionNotFoundError = "Collection not found";
const circularReferenceError = "Cannot add a collection to itself";
const collectionSchemaNotFoundError = "Collection entity schema not found";
const invalidCollectionPropertiesError = "Collection properties are invalid";
const invalidMembershipPropertiesError = "Membership properties validation failed";
const invalidMembershipSchemaError = "membershipPropertiesSchema must be a valid AppSchema";

const formatSchemaValidationError = (error: unknown) => {
	if (error instanceof Error) {
		return `${invalidMembershipSchemaError}: ${error.message}`;
	}

	return invalidMembershipSchemaError;
};

export type CollectionServiceDeps = {
	createCollectionForUser: typeof createCollectionForUser;
	getBuiltinCollectionSchema: typeof getBuiltinCollectionSchema;
};

export type EnsureLibraryEntityForUserDeps = {
	createLibraryEntityForUser: typeof createLibraryEntityForUser;
};

export type GetOrCreateCollectionServiceDeps = CollectionServiceDeps & {
	findCollectionByNameForUser: typeof findCollectionByNameForUser;
};

export type AddToCollectionServiceDeps = {
	getEntityById: typeof getEntityById;
	getCollectionById: typeof getCollectionById;
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	addEntityToCollection: typeof addEntityToCollection;
};

export type RemoveFromCollectionServiceDeps = {
	getEntityById: typeof getEntityById;
	getCollectionById: typeof getCollectionById;
	removeEntityFromCollection: typeof removeEntityFromCollection;
};

export type CollectionServiceResult<T> = ServiceResult<T, "not_found" | "validation">;

const collectionServiceDeps: CollectionServiceDeps = {
	createCollectionForUser,
	getBuiltinCollectionSchema,
};

const ensureLibraryEntityForUserDeps: EnsureLibraryEntityForUserDeps = {
	createLibraryEntityForUser,
};

const getOrCreateCollectionServiceDeps: GetOrCreateCollectionServiceDeps = {
	...collectionServiceDeps,
	findCollectionByNameForUser,
};

export const resolveCollectionName = (name: string) =>
	resolveRequiredString(name, "Collection name");

const resolveCollectionNameResult = (name: string) =>
	wrapServiceValidator(() => resolveCollectionName(name), "Collection name is invalid");

export const ensureLibraryEntityForUser = async (
	input: { userId: string; entitySchemaId: string; database?: DbClient },
	deps: EnsureLibraryEntityForUserDeps = ensureLibraryEntityForUserDeps,
) => {
	const { database, ...body } = input;
	return deps.createLibraryEntityForUser(body, database);
};

export const createCollection = async (
	input: { body: CreateCollectionBody; userId: string },
	deps: CollectionServiceDeps = collectionServiceDeps,
): Promise<CollectionServiceResult<CollectionResponse>> => {
	const nameResult = resolveCollectionNameResult(input.body.name);
	if ("error" in nameResult) {
		return nameResult;
	}

	const collectionSchema = await deps.getBuiltinCollectionSchema();
	if (!collectionSchema) {
		return serviceError("not_found", collectionSchemaNotFoundError);
	}

	if (input.body.membershipPropertiesSchema !== undefined) {
		try {
			parseLabeledPropertySchemaInput(
				input.body.membershipPropertiesSchema,
				"membershipPropertiesSchema",
			);
		} catch (error) {
			return serviceError("validation", formatSchemaValidationError(error));
		}
	}

	const properties: Record<string, unknown> = {};
	if (input.body.description !== undefined) {
		properties.description = input.body.description;
	}
	if (input.body.membershipPropertiesSchema !== undefined) {
		properties.membershipPropertiesSchema = input.body.membershipPropertiesSchema;
	}

	const entityPropertiesResult = parseAppSchemaPropertiesSafe({
		properties,
		propertiesSchema: collectionSchema.propertiesSchema,
	});
	if (!entityPropertiesResult.success) {
		return serviceError(
			"validation",
			`${invalidCollectionPropertiesError}: ${formatValidationIssues(entityPropertiesResult.issues)}`,
		);
	}

	const createdCollection = await deps.createCollectionForUser({
		userId: input.userId,
		name: nameResult.data,
		entitySchemaId: collectionSchema.id,
		properties: entityPropertiesResult.data,
	});

	return serviceData(createdCollection);
};

export const getOrCreateCollection = async (
	input: { body: CreateCollectionBody; userId: string },
	deps: GetOrCreateCollectionServiceDeps = getOrCreateCollectionServiceDeps,
): Promise<CollectionServiceResult<CollectionResponse>> => {
	const nameResult = resolveCollectionNameResult(input.body.name);
	if ("error" in nameResult) {
		return nameResult;
	}

	const collectionSchema = await deps.getBuiltinCollectionSchema();
	if (!collectionSchema) {
		return serviceError("not_found", collectionSchemaNotFoundError);
	}

	const existing = await deps.findCollectionByNameForUser({
		userId: input.userId,
		name: nameResult.data,
		entitySchemaId: collectionSchema.id,
	});
	if (existing) {
		return serviceData(existing);
	}

	return createCollection(input, deps);
};

const addToCollectionServiceDeps: AddToCollectionServiceDeps = {
	getEntityById,
	getCollectionById,
	ensureEntityInLibrary,
	addEntityToCollection,
};

export const addToCollection = async (
	input: { body: AddToCollectionBody; userId: string },
	deps: AddToCollectionServiceDeps = addToCollectionServiceDeps,
): Promise<CollectionServiceResult<AddToCollectionData>> => {
	if (input.body.collectionId === input.body.entityId) {
		return serviceError("validation", circularReferenceError);
	}

	const collection = await deps.getCollectionById(input.body.collectionId, input.userId);
	if (!collection) {
		return serviceError("not_found", collectionNotFoundError);
	}

	const entity = await deps.getEntityById(input.body.entityId, input.userId);
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}

	// oxlint-disable-next-line no-unsafe-type-assertion
	const membershipSchema = collection.properties.membershipPropertiesSchema as
		| AppSchema
		| undefined;
	let validatedProperties: Record<string, unknown>;
	if (membershipSchema) {
		const parseResult = parseAppSchemaPropertiesSafe({
			properties: input.body.properties,
			propertiesSchema: membershipSchema,
		});
		if (!parseResult.success) {
			return serviceError(
				"validation",
				`${invalidMembershipPropertiesError}: ${formatValidationIssues(parseResult.issues)}`,
			);
		}
		validatedProperties = parseResult.data;
	} else {
		validatedProperties = input.body.properties ?? {};
	}

	if (entity.userId === null) {
		const libraryResult = await deps.ensureEntityInLibrary({
			entityId: entity.id,
			userId: input.userId,
		});
		if ("error" in libraryResult) {
			return libraryResult;
		}
	}

	const relationships = await deps.addEntityToCollection({
		userId: input.userId,
		entityId: input.body.entityId,
		properties: validatedProperties,
		collectionId: input.body.collectionId,
	});

	return serviceData(relationships);
};

const removeFromCollectionServiceDeps: RemoveFromCollectionServiceDeps = {
	getEntityById,
	getCollectionById,
	removeEntityFromCollection,
};

export const removeFromCollection = async (
	input: { body: RemoveFromCollectionBody; userId: string },
	deps: RemoveFromCollectionServiceDeps = removeFromCollectionServiceDeps,
): Promise<CollectionServiceResult<RemoveFromCollectionData>> => {
	const collection = await deps.getCollectionById(input.body.collectionId, input.userId);
	if (!collection) {
		return serviceError("not_found", collectionNotFoundError);
	}

	const entity = await deps.getEntityById(input.body.entityId, input.userId);
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}
	const relationships = await deps.removeEntityFromCollection({
		userId: input.userId,
		entityId: input.body.entityId,
		collectionId: input.body.collectionId,
	});

	if (!relationships) {
		return serviceError("not_found", "Entity is not in collection");
	}

	return serviceData(relationships);
};
