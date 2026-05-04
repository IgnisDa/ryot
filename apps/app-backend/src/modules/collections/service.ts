import type { AppSchema } from "@ryot/ts-utils";
import { resolveRequiredString } from "@ryot/ts-utils";

import { parseAppSchemaPropertiesSafe, type ValidationIssue } from "~/lib/app/schema-validation";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import {
	getUserLibraryEntityId,
	upsertInLibraryIfGlobal,
	upsertInLibraryRelationship,
} from "~/modules/entities";
import { parseLabeledPropertySchemaInput } from "~/modules/property-schemas/service";

import {
	addEntityToCollection,
	createCollectionForUser,
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

const collectionSchemaNotFoundError = "Collection entity schema not found";
const invalidMembershipSchemaError = "membershipPropertiesSchema must be a valid AppSchema";
const collectionNotFoundError = "Collection not found";
const entityNotFoundError = "Entity not found";
const invalidMembershipPropertiesError = "Membership properties validation failed";
const circularReferenceError = "Cannot add a collection to itself";

const formatValidationIssues = (issues: ValidationIssue[]) =>
	issues.map((i) => `${i.path}: ${i.message}`).join("; ");

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

export type AddToCollectionServiceDeps = {
	getEntityById: typeof getEntityById;
	getCollectionById: typeof getCollectionById;
	addEntityToCollection: typeof addEntityToCollection;
	getUserLibraryEntityId: typeof getUserLibraryEntityId;
	upsertInLibraryRelationship: typeof upsertInLibraryRelationship;
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

export const resolveCollectionName = (name: string) =>
	resolveRequiredString(name, "Collection name");

const resolveCollectionNameResult = (name: string) =>
	wrapServiceValidator(() => resolveCollectionName(name), "Collection name is invalid");

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

	// Validate membershipPropertiesSchema as a valid AppSchema if provided
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

	// Build properties with membershipPropertiesSchema if provided
	const properties: Record<string, unknown> = {};
	if (input.body.description !== undefined) {
		properties.description = input.body.description;
	}
	if (input.body.membershipPropertiesSchema !== undefined) {
		properties.membershipPropertiesSchema = input.body.membershipPropertiesSchema;
	}

	const createdCollection = await deps.createCollectionForUser({
		name: nameResult.data,
		userId: input.userId,
		entitySchemaId: collectionSchema.id,
		properties,
	});

	return serviceData(createdCollection);
};

const addToCollectionServiceDeps: AddToCollectionServiceDeps = {
	getEntityById,
	getCollectionById,
	addEntityToCollection,
	getUserLibraryEntityId,
	upsertInLibraryRelationship,
};

export const addToCollection = async (
	input: { body: AddToCollectionBody; userId: string },
	deps: AddToCollectionServiceDeps = addToCollectionServiceDeps,
): Promise<CollectionServiceResult<AddToCollectionData>> => {
	// Prevent circular reference: cannot add a collection to itself
	if (input.body.collectionId === input.body.entityId) {
		return serviceError("validation", circularReferenceError);
	}

	// Verify the collection exists and belongs to the user
	const collection = await deps.getCollectionById(input.body.collectionId, input.userId);
	if (!collection) {
		return serviceError("not_found", collectionNotFoundError);
	}

	// Verify the entity exists and belongs to the user
	const entity = await deps.getEntityById(input.body.entityId, input.userId);
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}

	// Validate properties against collection's membershipPropertiesSchema if defined
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

	const libraryError = await upsertInLibraryIfGlobal(
		{ userId: input.userId, entityId: entity.id, entityUserId: entity.userId },
		deps,
	);
	if (libraryError) {
		return libraryError;
	}

	// Create the canonical member-of relationship
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
	// Verify the collection exists and belongs to the user
	const collection = await deps.getCollectionById(input.body.collectionId, input.userId);
	if (!collection) {
		return serviceError("not_found", collectionNotFoundError);
	}

	// Verify the entity exists and belongs to the user
	const entity = await deps.getEntityById(input.body.entityId, input.userId);
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}

	// Remove the canonical member-of relationship
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
