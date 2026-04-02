import { resolveRequiredString } from "@ryot/ts-utils";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import {
	createCollectionForUser,
	getBuiltinCollectionSchemaForUser,
} from "./repository";
import type { CollectionResponse, CreateCollectionBody } from "./schemas";

const collectionSchemaNotFoundError = "Collection entity schema not found";
const invalidMembershipSchemaError =
	"membershipPropertiesSchema must be a valid AppSchema";

export type CollectionServiceDeps = {
	createCollectionForUser: typeof createCollectionForUser;
	getBuiltinCollectionSchemaForUser: typeof getBuiltinCollectionSchemaForUser;
};

export type CollectionServiceResult<T> = ServiceResult<
	T,
	"not_found" | "validation"
>;

const collectionServiceDeps: CollectionServiceDeps = {
	createCollectionForUser,
	getBuiltinCollectionSchemaForUser,
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

	const collectionSchema = await deps.getBuiltinCollectionSchemaForUser({
		userId: input.userId,
	});
	if (!collectionSchema) {
		return serviceError("not_found", collectionSchemaNotFoundError);
	}

	// Validate membershipPropertiesSchema as a valid AppSchema if provided
	if (input.body.membershipPropertiesSchema !== undefined) {
		const schemaValidation = validateMembershipPropertiesSchema(
			input.body.membershipPropertiesSchema,
		);
		if (schemaValidation !== null) {
			return serviceError("validation", schemaValidation);
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

const validateMembershipPropertiesSchema = (schema: unknown): string | null => {
	if (typeof schema !== "object" || schema === null) {
		return invalidMembershipSchemaError;
	}

	const maybeSchema = schema as Record<string, unknown>;

	// Check required AppSchema structure
	if (maybeSchema.fields === undefined) {
		return invalidMembershipSchemaError;
	}

	if (typeof maybeSchema.fields !== "object" || maybeSchema.fields === null) {
		return invalidMembershipSchemaError;
	}

	// fields must be a record of property definitions
	const fields = maybeSchema.fields as Record<string, unknown>;
	for (const [key, value] of Object.entries(fields)) {
		if (!isValidPropertyDefinition(value)) {
			return `Invalid property definition for field '${key}'`;
		}
	}

	// Validate rules if present
	if (maybeSchema.rules !== undefined) {
		if (!Array.isArray(maybeSchema.rules)) {
			return "Schema rules must be an array";
		}
		for (const rule of maybeSchema.rules) {
			if (!isValidRule(rule)) {
				return "Invalid schema rule";
			}
		}
	}

	return null;
};

const isValidPropertyDefinition = (value: unknown): boolean => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const def = value as Record<string, unknown>;

	// Must have a type property
	if (typeof def.type !== "string") {
		return false;
	}

	const validTypes = [
		"string",
		"number",
		"integer",
		"boolean",
		"date",
		"datetime",
		"array",
		"object",
	];

	if (!validTypes.includes(def.type)) {
		return false;
	}

	// Validate nested items for array type
	if (def.type === "array" && def.items !== undefined) {
		if (!isValidPropertyDefinition(def.items)) {
			return false;
		}
	}

	// Validate nested properties for object type
	if (def.type === "object" && def.properties !== undefined) {
		if (typeof def.properties !== "object" || def.properties === null) {
			return false;
		}
		for (const propValue of Object.values(
			def.properties as Record<string, unknown>,
		)) {
			if (!isValidPropertyDefinition(propValue)) {
				return false;
			}
		}
	}

	return true;
};

const isValidRule = (value: unknown): boolean => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const rule = value as Record<string, unknown>;

	// Must have kind, path, and when properties
	if (rule.kind !== "validation") {
		return false;
	}

	if (!Array.isArray(rule.path)) {
		return false;
	}

	if (typeof rule.when !== "object" || rule.when === null) {
		return false;
	}

	const when = rule.when as Record<string, unknown>;
	if (typeof when.operator !== "string") {
		return false;
	}

	return true;
};
