import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { resolveRequiredString } from "@ryot/ts-utils/slug";

import { formatValidationIssues, parseAppSchemaPropertiesSafe } from "~/lib/app/schema-validation";
import { db, type DbClient } from "~/lib/db";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { ensureEntityInLibrary } from "~/modules/entities";
import {
	deleteCollectionMembership,
	writeCollectionMembership,
} from "~/modules/entities/relationships";
import { createEventBySchemaSlugWithTriggers } from "~/modules/events";
import { parseLabeledPropertySchemaInput } from "~/modules/property-schemas";

import {
	createCollectionForUser,
	createLibraryEntityForUser,
	findCollectionByNameForUser,
	getBuiltinCollectionSchema,
	getCollectionById,
	getEntityById,
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

class CollectionTxAbortError extends Error {
	constructor(readonly serviceResult: { error: "not_found" | "validation"; message: string }) {
		super("transaction aborted");
	}
}

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
	writeCollectionMembership: typeof writeCollectionMembership;
	executeTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
	createEventBySchemaSlugWithTriggers: typeof createEventBySchemaSlugWithTriggers;
};

export type RemoveFromCollectionServiceDeps = {
	getEntityById: typeof getEntityById;
	getCollectionById: typeof getCollectionById;
	deleteCollectionMembership: typeof deleteCollectionMembership;
	createEventBySchemaSlugWithTriggers: typeof createEventBySchemaSlugWithTriggers;
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
	writeCollectionMembership,
	createEventBySchemaSlugWithTriggers,
	executeTransaction: (fn) => db.transaction(fn),
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

	let memberOf: AddToCollectionData["memberOf"];

	try {
		await deps.executeTransaction(async (tx) => {
			const membershipResult = await deps.writeCollectionMembership({
				database: tx,
				userId: input.userId,
				entityId: input.body.entityId,
				properties: validatedProperties,
				collectionId: input.body.collectionId,
			});
			if ("error" in membershipResult) {
				throw new CollectionTxAbortError(membershipResult);
			}

			const { wasInserted } = membershipResult.data;
			memberOf = membershipResult.data.memberOf;

			if (wasInserted) {
				const eventResult = await deps.createEventBySchemaSlugWithTriggers({
					database: tx,
					userId: input.userId,
					entityId: input.body.collectionId,
					eventSchemaSlug: "add-entity-to-collection",
					properties: {
						entityId: input.body.entityId,
						entitySchemaSlug: entity.entitySchemaSlug,
						relationshipId: membershipResult.data.memberOf.id,
						relationshipProperties: membershipResult.data.memberOf.properties,
					},
				});
				if ("error" in eventResult) {
					throw new CollectionTxAbortError(eventResult);
				}
				if ("skipped" in eventResult) {
					throw new CollectionTxAbortError({
						error: "validation",
						message: `Collection event skipped: ${eventResult.reason}`,
					});
				}
			}
		});
	} catch (error) {
		if (error instanceof CollectionTxAbortError) {
			return error.serviceResult;
		}
		throw error;
	}

	// oxlint-disable-next-line no-non-null-assertion
	return serviceData({ memberOf: memberOf! });
};

const removeFromCollectionServiceDeps: RemoveFromCollectionServiceDeps = {
	getEntityById,
	getCollectionById,
	deleteCollectionMembership,
	createEventBySchemaSlugWithTriggers,
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

	const membershipResult = await deps.deleteCollectionMembership({
		userId: input.userId,
		entityId: input.body.entityId,
		collectionId: input.body.collectionId,
	});
	if ("error" in membershipResult) {
		return membershipResult;
	}

	if (!membershipResult.data) {
		return serviceError("not_found", "Entity is not in collection");
	}

	const { memberOf } = membershipResult.data;

	const eventResult = await deps.createEventBySchemaSlugWithTriggers({
		userId: input.userId,
		entityId: input.body.collectionId,
		eventSchemaSlug: "remove-entity-from-collection",
		properties: {
			relationshipId: memberOf.id,
			entityId: input.body.entityId,
			entitySchemaSlug: entity.entitySchemaSlug,
			relationshipProperties: memberOf.properties,
		},
	});
	if ("error" in eventResult) {
		return eventResult;
	}

	return serviceData({ memberOf });
};
