import { resolveRequiredString } from "@ryot/ts-utils";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { propertySchemaInputSchema } from "~/modules/property-schemas/schemas";
import {
	createCollectionForUser,
	getBuiltinCollectionSchema,
} from "./repository";
import type { CollectionResponse, CreateCollectionBody } from "./schemas";

const collectionSchemaNotFoundError = "Collection entity schema not found";
const invalidMembershipSchemaError =
	"membershipPropertiesSchema must be a valid AppSchema";

export type CollectionServiceDeps = {
	createCollectionForUser: typeof createCollectionForUser;
	getBuiltinCollectionSchema: typeof getBuiltinCollectionSchema;
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
