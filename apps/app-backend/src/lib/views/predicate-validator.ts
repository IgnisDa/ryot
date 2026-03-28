import {
	type AppObjectProperty,
	type AppPropertyDefinition,
	fromAppSchema,
} from "@ryot/ts-utils";
import { z } from "zod";
import { ViewRuntimeValidationError } from "./errors";
import type { FilterExpression } from "./filtering";
import {
	getSchemaForReference,
	getTopLevelPropertyDefinition,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "./reference";

const topLevelTimestampFilterValueSchema = z.union([
	z.date(),
	z.iso.date(),
	z.iso.datetime(),
]);

const comparablePropertyTypes = new Set([
	"date",
	"number",
	"string",
	"boolean",
	"integer",
	"datetime",
]);

const getPropertyDefinitionForFilter = <TSchema extends ViewRuntimeSchemaLike>(
	filter: FilterExpression,
	schemaMap: Map<string, TSchema>,
) => {
	const reference = resolveRuntimeReference(filter.field);
	if (reference.type === "top-level") {
		const property = getTopLevelPropertyDefinition(reference.column);
		if (!property) {
			throw new ViewRuntimeValidationError(
				`Unsupported column '@${reference.column}'`,
			);
		}

		return property;
	}

	const schema = getSchemaForReference(schemaMap, reference);
	const property = schema.propertiesSchema.fields[reference.property];
	if (!property) {
		throw new ViewRuntimeValidationError(
			`Property '${reference.property}' not found in schema '${reference.slug}'`,
		);
	}

	return property;
};

const createObjectContainsSchema = (property: AppObjectProperty): z.ZodType => {
	const shape: Record<string, z.ZodType> = {};

	for (const [key, value] of Object.entries(property.properties)) {
		shape[key] = createContainsValueSchema(value).optional();
	}

	return z.object(shape).strict();
};

const createContainsValueSchema = (
	property: AppPropertyDefinition,
): z.ZodType => {
	switch (property.type) {
		case "object":
			return createObjectContainsSchema(property);
		default:
			return fromAppSchema(property);
	}
};

const validateWithSchema = (
	schema: z.ZodType,
	value: unknown,
	message: string,
) => {
	const result = schema.safeParse(value);
	if (result.success) {
		return;
	}

	throw new ViewRuntimeValidationError(message);
};

const getValueSchema = (
	filter: FilterExpression,
	property: AppPropertyDefinition,
) => {
	if (filter.field === "@createdAt" || filter.field === "@updatedAt") {
		return topLevelTimestampFilterValueSchema;
	}

	return fromAppSchema(property);
};

const validateComparableFilter = (
	filter: Extract<
		FilterExpression,
		{ op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" }
	>,
	property: AppPropertyDefinition,
) => {
	if (!comparablePropertyTypes.has(property.type)) {
		throw new ViewRuntimeValidationError(
			`Filter operator '${filter.op}' is not supported for property type '${property.type}'`,
		);
	}

	const schema = getValueSchema(filter, property);
	validateWithSchema(
		schema,
		filter.value,
		`Filter value for '${filter.field}' must match the '${property.type}' property type`,
	);
};

const validateInFilter = (
	filter: Extract<FilterExpression, { op: "in" }>,
	property: AppPropertyDefinition,
) => {
	if (!comparablePropertyTypes.has(property.type)) {
		throw new ViewRuntimeValidationError(
			`Filter operator 'in' is not supported for property type '${property.type}'`,
		);
	}

	const schema = getValueSchema(filter, property);
	for (const value of filter.value) {
		validateWithSchema(
			schema,
			value,
			`Filter value for '${filter.field}' must match the '${property.type}' property type`,
		);
	}
};

const validateContainsFilter = (
	filter: Extract<FilterExpression, { op: "contains" }>,
	property: AppPropertyDefinition,
) => {
	switch (property.type) {
		case "string":
			validateWithSchema(
				z.string(),
				filter.value,
				`Filter value for '${filter.field}' must be a string`,
			);
			return;
		case "array":
			validateWithSchema(
				createContainsValueSchema(property.items),
				filter.value,
				`Filter value for '${filter.field}' must match the array item type`,
			);
			return;
		case "object":
			validateWithSchema(
				createObjectContainsSchema(property),
				filter.value,
				`Filter value for '${filter.field}' must match the object schema`,
			);
			return;
		default:
			throw new ViewRuntimeValidationError(
				`Filter operator 'contains' is not supported for property type '${property.type}'`,
			);
	}
};

export const validateFilterExpressionAgainstSchemas = <
	TSchema extends ViewRuntimeSchemaLike,
>(
	filter: FilterExpression,
	schemaMap: Map<string, TSchema>,
) => {
	const property = getPropertyDefinitionForFilter(filter, schemaMap);

	switch (filter.op) {
		case "isNull":
			return;
		case "in":
			validateInFilter(filter, property);
			return;
		case "contains":
			validateContainsFilter(filter, property);
			return;
		case "eq":
		case "neq":
		case "gt":
		case "gte":
		case "lt":
		case "lte":
			validateComparableFilter(filter, property);
			return;
	}
	throw new ViewRuntimeValidationError(
		`Unsupported filter operator '${(filter as { op: string }).op}'`,
	);
};
