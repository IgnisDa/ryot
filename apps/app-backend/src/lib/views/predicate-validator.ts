import {
	type AppObjectProperty,
	type AppPropertyDefinition,
	fromAppSchema,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
import { ViewRuntimeValidationError } from "./errors";
import type { FilterExpression } from "./filtering";
import { getComparablePropertyType, supportsContainsFilter } from "./policy";
import {
	getEntityColumnPropertyDefinition,
	getEventJoinColumnPropertyDefinition,
	getEventJoinForReference,
	getEventJoinPropertyDefinition,
	getSchemaForReference,
	resolveRuntimeReference,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "./reference";

const topLevelTimestampFilterValueSchema = z.union([
	z.date(),
	z.iso.date(),
	z.iso.datetime(),
]);

const getPropertyDefinitionForFilter = <TSchema extends ViewRuntimeSchemaLike>(
	filter: FilterExpression,
	context: ViewRuntimeReferenceContext<TSchema, ViewRuntimeEventJoinLike>,
) => {
	const reference = resolveRuntimeReference(filter.field);
	if (reference.type === "entity-column") {
		getSchemaForReference(context.schemaMap, reference);
		const property = getEntityColumnPropertyDefinition(reference.column);
		if (!property) {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column 'entity.${reference.slug}.@${reference.column}'`,
			);
		}

		return property;
	}

	if (reference.type === "event-join-column") {
		getEventJoinForReference(context.eventJoinMap, reference);
		const property = getEventJoinColumnPropertyDefinition(reference.column);
		if (!property) {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column 'event.${reference.joinKey}.@${reference.column}'`,
			);
		}

		return property;
	}

	if (reference.type === "event-join-property") {
		const join = getEventJoinForReference(context.eventJoinMap, reference);
		const property = getEventJoinPropertyDefinition(join, reference.property);
		if (!property) {
			throw new ViewRuntimeValidationError(
				`Property '${reference.property}' not found for event join '${join.key}'`,
			);
		}

		return property;
	}

	const schema = getSchemaForReference(context.schemaMap, reference);
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
	return match(property)
		.with({ type: "object" }, (prop) => createObjectContainsSchema(prop))
		.otherwise((prop) => fromAppSchema(prop));
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
	const reference = resolveRuntimeReference(filter.field);
	if (
		(reference.type === "entity-column" &&
			(reference.column === "createdAt" || reference.column === "updatedAt")) ||
		(reference.type === "event-join-column" &&
			(reference.column === "createdAt" || reference.column === "updatedAt"))
	) {
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
	if (!getComparablePropertyType(property)) {
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
	if (!getComparablePropertyType(property)) {
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
	if (!supportsContainsFilter(property.type)) {
		throw new ViewRuntimeValidationError(
			`Filter operator 'contains' is not supported for property type '${property.type}'`,
		);
	}

	match(property)
		.with({ type: "string" }, () =>
			validateWithSchema(
				z.string(),
				filter.value,
				`Filter value for '${filter.field}' must be a string`,
			),
		)
		.with({ type: "array" }, (prop) =>
			validateWithSchema(
				createContainsValueSchema(prop.items),
				filter.value,
				`Filter value for '${filter.field}' must match the array item type`,
			),
		)
		.with({ type: "object" }, (prop) =>
			validateWithSchema(
				createObjectContainsSchema(prop),
				filter.value,
				`Filter value for '${filter.field}' must match the object schema`,
			),
		)
		.otherwise(() => undefined);
};

export const validateFilterExpressionAgainstSchemas = <
	TSchema extends ViewRuntimeSchemaLike,
>(
	filter: FilterExpression,
	context: ViewRuntimeReferenceContext<TSchema, ViewRuntimeEventJoinLike>,
) => {
	const property = getPropertyDefinitionForFilter(filter, context);

	match(filter)
		.with({ op: "isNull" }, () => undefined)
		.with({ op: "isNotNull" }, () => undefined)
		.with({ op: "in" }, (f) => validateInFilter(f, property))
		.with({ op: "contains" }, (f) => validateContainsFilter(f, property))
		.with(
			{ op: "eq" },
			{ op: "gt" },
			{ op: "neq" },
			{ op: "lt" },
			{ op: "gte" },
			{ op: "lte" },
			(f) => validateComparableFilter(f, property),
		)
		.exhaustive();
};
