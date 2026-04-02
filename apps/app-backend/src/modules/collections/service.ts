import type { AppSchema } from "@ryot/ts-utils";
import { resolveRequiredString } from "@ryot/ts-utils";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { propertySchemaInputSchema } from "~/modules/property-schemas/schemas";
import {
	addEntityToCollection,
	createCollectionForUser,
	getBuiltinCollectionSchema,
	getCollectionById,
	getEntityById,
} from "./repository";
import type {
	AddToCollectionBody,
	AddToCollectionData,
	CollectionResponse,
	CreateCollectionBody,
} from "./schemas";

const collectionSchemaNotFoundError = "Collection entity schema not found";
const invalidMembershipSchemaError =
	"membershipPropertiesSchema must be a valid AppSchema";
const collectionNotFoundError = "Collection not found";
const entityNotFoundError = "Entity not found";
const invalidMembershipPropertiesError =
	"Membership properties validation failed";

export type CollectionServiceDeps = {
	createCollectionForUser: typeof createCollectionForUser;
	getBuiltinCollectionSchema: typeof getBuiltinCollectionSchema;
};

export type AddToCollectionServiceDeps = {
	addEntityToCollection: typeof addEntityToCollection;
	getCollectionById: typeof getCollectionById;
	getEntityById: typeof getEntityById;
};

export type CollectionServiceResult<T> = ServiceResult<
	T,
	"not_found" | "validation"
>;

const collectionServiceDeps: CollectionServiceDeps = {
	createCollectionForUser,
	getBuiltinCollectionSchema,
};

export const resolveCollectionName = (name: string) =>
	resolveRequiredString(name, "Collection name");

const resolveCollectionNameResult = (name: string) =>
	wrapServiceValidator(
		() => resolveCollectionName(name),
		"Collection name is invalid",
	);

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
		const parseResult = propertySchemaInputSchema.safeParse(
			input.body.membershipPropertiesSchema,
		);
		if (!parseResult.success) {
			return serviceError(
				"validation",
				`${invalidMembershipSchemaError}: ${parseResult.error.message}`,
			);
		}
	}

	// Build properties with membershipPropertiesSchema if provided
	const properties: Record<string, unknown> = {};
	if (input.body.description !== undefined) {
		properties.description = input.body.description;
	}
	if (input.body.membershipPropertiesSchema !== undefined) {
		properties.membershipPropertiesSchema =
			input.body.membershipPropertiesSchema;
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
	addEntityToCollection,
	getCollectionById,
	getEntityById,
};

export const addToCollection = async (
	input: { body: AddToCollectionBody; userId: string },
	deps: AddToCollectionServiceDeps = addToCollectionServiceDeps,
): Promise<CollectionServiceResult<AddToCollectionData>> => {
	// Verify the collection exists and belongs to the user
	const collection = await deps.getCollectionById(
		input.body.collectionId,
		input.userId,
	);
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
		try {
			validatedProperties = parseAppSchemaProperties({
				kind: "Membership",
				properties: input.body.properties,
				propertiesSchema: membershipSchema,
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: invalidMembershipPropertiesError;
			return serviceError("validation", message);
		}
	} else {
		validatedProperties = input.body.properties ?? {};
	}

	// Create the relationships (collection and member_of)
	const relationships = await deps.addEntityToCollection({
		collectionId: input.body.collectionId,
		entityId: input.body.entityId,
		userId: input.userId,
		properties: validatedProperties,
	});

	return serviceData(relationships);
};
