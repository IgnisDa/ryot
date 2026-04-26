import type { AppPropertyDefinition } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { getComputedFieldOrThrow } from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import type { ViewComputedField, ViewExpression } from "./expression";
import { supportsComparableFilter, supportsContainsFilter } from "./policy";
import {
	getEntityColumnPropertyDefinition,
	getEntitySchemaColumnPropertyDefinition,
	getEventJoinColumnPropertyDefinition,
	getEventJoinForReference,
	getEventJoinPropertyDefinition,
	getPropertyDefinition,
	getSchemaForReference,
	type PropertyType,
	type QueryEngineEventJoinLike,
	type QueryEngineReferenceContext,
	type QueryEngineSchemaLike,
} from "./reference";

export type ViewExpressionTypeInfo =
	| { kind: "null" }
	| { kind: "image" }
	| {
			kind: "property";
			propertyType: PropertyType;
			propertyDefinition?: AppPropertyDefinition;
	  };

const serializePropertyDefinition = (value?: AppPropertyDefinition) => {
	return value ? JSON.stringify(value) : null;
};

const createPropertyTypeInfo = (
	propertyType: PropertyType,
	propertyDefinition?: AppPropertyDefinition | null,
): ViewExpressionTypeInfo => ({
	propertyType,
	kind: "property",
	propertyDefinition: propertyDefinition ?? undefined,
});

const createLiteralTypeInfo = (
	value: unknown | null,
): ViewExpressionTypeInfo => {
	if (value === null) {
		return { kind: "null" };
	}

	if (typeof value === "string") {
		return createPropertyTypeInfo("string", { label: "Value", type: "string" });
	}

	if (typeof value === "boolean") {
		return createPropertyTypeInfo("boolean", {
			label: "Value",
			type: "boolean",
		});
	}

	if (typeof value === "number") {
		return Number.isInteger(value)
			? createPropertyTypeInfo("integer", { label: "Value", type: "integer" })
			: createPropertyTypeInfo("number", { label: "Value", type: "number" });
	}

	if (Array.isArray(value)) {
		return createPropertyTypeInfo("array");
	}

	return createPropertyTypeInfo("object");
};

export const normalizeExpressionPropertyType = (propertyType: PropertyType) => {
	return match(propertyType)
		.with("datetime", () => "date" as const)
		.with("enum-array", () => "array" as const)
		.otherwise((value) => value);
};

const unifyPropertyDefinitions = (
	definitions: (AppPropertyDefinition | undefined)[],
) => {
	const serialized = [...new Set(definitions.map(serializePropertyDefinition))];
	if (serialized.length !== 1) {
		return undefined;
	}

	return definitions[0];
};

const getExpressionTypeLabel = (input: ViewExpressionTypeInfo) => {
	return input.kind === "property" ? input.propertyType : input.kind;
};

const isNumericPropertyType = (input: PropertyType) => {
	return ["integer", "number"].includes(normalizeExpressionPropertyType(input));
};

const isConcatCompatibleType = (input: ViewExpressionTypeInfo) => {
	if (input.kind === "null") {
		return true;
	}

	if (input.kind !== "property") {
		return false;
	}

	return !["array", "object"].includes(
		normalizeExpressionPropertyType(input.propertyType),
	);
};

export const unifyTypeInfos = (typeInfos: ViewExpressionTypeInfo[]) => {
	const nonNullInfos = typeInfos.filter((info) => info.kind !== "null");
	if (!nonNullInfos.length) {
		return { kind: "null" } satisfies ViewExpressionTypeInfo;
	}

	const imageInfos = nonNullInfos.filter((info) => info.kind === "image");
	const propertyInfos = nonNullInfos.filter((info) => info.kind === "property");
	if (imageInfos.length && propertyInfos.length) {
		throw new QueryEngineValidationError(
			"Expression branches cannot mix display-only image values into non-display expressions",
		);
	}

	if (imageInfos.length) {
		return { kind: "image" } satisfies ViewExpressionTypeInfo;
	}

	if (!propertyInfos.length) {
		return { kind: "null" } satisfies ViewExpressionTypeInfo;
	}

	const normalizedTypes = [
		...new Set(
			propertyInfos.map((info) =>
				normalizeExpressionPropertyType(info.propertyType),
			),
		),
	];
	if (normalizedTypes.length === 1) {
		const propertyType = normalizedTypes[0];
		if (!propertyType) {
			return { kind: "null" } satisfies ViewExpressionTypeInfo;
		}

		return createPropertyTypeInfo(
			propertyType,
			unifyPropertyDefinitions(
				propertyInfos.map((info) => info.propertyDefinition),
			),
		);
	}

	if (normalizedTypes.every((type) => ["integer", "number"].includes(type))) {
		return createPropertyTypeInfo("number");
	}

	throw new QueryEngineValidationError(
		`Expression branches have incompatible types: ${normalizedTypes.join(", ")}`,
	);
};

export const assertNumericExpression = (
	input: ViewExpressionTypeInfo,
	context: string,
) => {
	assertFilterCompatibleExpression(input, context);
	if (input.kind !== "property" || !isNumericPropertyType(input.propertyType)) {
		throw new QueryEngineValidationError(
			`${context} requires a numeric expression, received '${getExpressionTypeLabel(input)}'`,
		);
	}
};

export const assertConcatCompatibleExpression = (
	input: ViewExpressionTypeInfo,
) => {
	assertFilterCompatibleExpression(input, "string composition");
	if (!isConcatCompatibleType(input)) {
		throw new QueryEngineValidationError(
			`String composition requires scalar expression values, received '${getExpressionTypeLabel(input)}'`,
		);
	}
};

export const inferViewExpressionType = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	expression: ViewExpression;
	typeCache?: Map<string, ViewExpressionTypeInfo>;
	computedFieldMap?: Map<string, ViewComputedField>;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}): ViewExpressionTypeInfo => {
	const typeCache =
		input.typeCache ?? new Map<string, ViewExpressionTypeInfo>();
	const computedFieldMap =
		input.computedFieldMap ?? new Map<string, ViewComputedField>();

	if (input.expression.type === "literal") {
		return createLiteralTypeInfo(input.expression.value);
	}

	if (input.expression.type === "coalesce") {
		return unifyTypeInfos(
			input.expression.values.map((expression) =>
				inferViewExpressionType({
					typeCache,
					expression,
					computedFieldMap,
					context: input.context,
				}),
			),
		);
	}

	if (input.expression.type === "arithmetic") {
		const leftType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.left,
		});
		const rightType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.right,
		});
		assertNumericExpression(leftType, "Arithmetic");
		assertNumericExpression(rightType, "Arithmetic");
		if (leftType.kind !== "property" || rightType.kind !== "property") {
			throw new QueryEngineValidationError(
				"Arithmetic requires numeric property expressions",
			);
		}

		return input.expression.operator === "divide" ||
			leftType.propertyType === "number" ||
			rightType.propertyType === "number"
			? createPropertyTypeInfo("number", { label: "Value", type: "number" })
			: createPropertyTypeInfo("integer", { label: "Value", type: "integer" });
	}

	if (
		input.expression.type === "round" ||
		input.expression.type === "floor" ||
		input.expression.type === "integer"
	) {
		const expressionType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.expression,
		});
		assertNumericExpression(expressionType, "Numeric normalization");
		return createPropertyTypeInfo("integer", {
			label: "Value",
			type: "integer",
		});
	}

	if (input.expression.type === "concat") {
		for (const value of input.expression.values) {
			assertConcatCompatibleExpression(
				inferViewExpressionType({
					typeCache,
					computedFieldMap,
					expression: value,
					context: input.context,
				}),
			);
		}

		return createPropertyTypeInfo("string", { label: "Value", type: "string" });
	}

	if (input.expression.type === "transform") {
		const innerType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.expression,
		});
		assertConcatCompatibleExpression(innerType);
		return createPropertyTypeInfo("string", { label: "Value", type: "string" });
	}

	if (input.expression.type === "conditional") {
		const thenType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.whenTrue,
		});
		const elseType = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: input.expression.whenFalse,
		});

		return unifyTypeInfos([thenType, elseType]);
	}

	const reference = input.expression.reference;
	if (reference.type === "computed-field") {
		const cached = typeCache.get(reference.key);
		if (cached) {
			return cached;
		}

		const computedField = getComputedFieldOrThrow(
			computedFieldMap,
			reference.key,
		);

		const inferred = inferViewExpressionType({
			typeCache,
			computedFieldMap,
			context: input.context,
			expression: computedField.expression,
		});
		typeCache.set(reference.key, inferred);
		return inferred;
	}

	if (reference.type === "entity") {
		const schema = getSchemaForReference(input.context.schemaMap, reference);

		if (reference.path[0] === "properties") {
			const propertyPath = reference.path.slice(1);
			const propertyDefinition = getPropertyDefinition(schema, propertyPath);
			if (!propertyDefinition) {
				throw new QueryEngineValidationError(
					`Property '${propertyPath.join(".")}' not found in schema '${reference.slug}'`,
				);
			}

			return createPropertyTypeInfo(
				normalizeExpressionPropertyType(propertyDefinition.type),
				propertyDefinition,
			);
		}

		const [column] = reference.path;
		if (!column) {
			throw new QueryEngineValidationError(
				"Entity reference path must not be empty",
			);
		}
		if (column === "image") {
			return { kind: "image" };
		}

		const propertyDefinition = getEntityColumnPropertyDefinition(column);
		if (!propertyDefinition) {
			throw new QueryEngineValidationError(
				`Unsupported entity column 'entity.${reference.slug}.${column}'`,
			);
		}

		return createPropertyTypeInfo(
			normalizeExpressionPropertyType(propertyDefinition.type),
			propertyDefinition,
		);
	}

	if (reference.type === "event-aggregate") {
		const propertyType =
			reference.aggregation === "count" ? "integer" : "number";
		return createPropertyTypeInfo(propertyType, {
			type: propertyType,
			label: "Event Aggregate",
		});
	}

	if (reference.type === "entity-schema") {
		const [column] = reference.path;
		if (!column) {
			throw new QueryEngineValidationError(
				"Entity schema reference path must not be empty",
			);
		}
		if (reference.path.length > 1) {
			throw new QueryEngineValidationError(
				`Entity schema column 'entity-schema.${reference.path.join(".")}' does not support nested paths`,
			);
		}
		const propertyDefinition = getEntitySchemaColumnPropertyDefinition(column);
		if (!propertyDefinition) {
			throw new QueryEngineValidationError(
				`Unsupported entity schema column 'entity-schema.${column}'`,
			);
		}
		return createPropertyTypeInfo(
			normalizeExpressionPropertyType(propertyDefinition.type),
			propertyDefinition,
		);
	}

	const join = getEventJoinForReference(input.context.eventJoinMap, reference);

	if (reference.path[0] === "properties") {
		const propertyPath = reference.path.slice(1);
		const propertyDefinition = getEventJoinPropertyDefinition(
			join,
			propertyPath,
		);

		return createPropertyTypeInfo(
			normalizeExpressionPropertyType(propertyDefinition.type),
			propertyDefinition,
		);
	}

	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event reference path must not be empty",
		);
	}
	const propertyDefinition = getEventJoinColumnPropertyDefinition(column);
	if (!propertyDefinition) {
		throw new QueryEngineValidationError(
			`Unsupported event join column 'event.${reference.joinKey}.${column}'`,
		);
	}

	return createPropertyTypeInfo(
		normalizeExpressionPropertyType(propertyDefinition.type),
		propertyDefinition,
	);
};

export const assertFilterCompatibleExpression = (
	input: ViewExpressionTypeInfo,
	context: string,
) => {
	if (input.kind === "image") {
		throw new QueryEngineValidationError(
			`Image expressions are display-only and cannot be used in ${context}`,
		);
	}
};

export const assertSortableExpression = (input: ViewExpressionTypeInfo) => {
	assertFilterCompatibleExpression(input, "sorting");
	if (
		input.kind !== "property" ||
		!supportsComparableFilter(input.propertyType)
	) {
		throw new QueryEngineValidationError(
			`Sort expressions must resolve to a sortable scalar value, received '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertContainsCompatibleExpression = (
	input: ViewExpressionTypeInfo,
) => {
	assertFilterCompatibleExpression(input, "filtering");
	if (
		input.kind !== "property" ||
		!supportsContainsFilter(input.propertyType)
	) {
		throw new QueryEngineValidationError(
			`Filter operator 'contains' is not supported for expression type '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertComparableExpression = (
	input: ViewExpressionTypeInfo,
	operator: string,
) => {
	assertFilterCompatibleExpression(input, "filtering");
	if (
		input.kind !== "property" ||
		!supportsComparableFilter(input.propertyType)
	) {
		throw new QueryEngineValidationError(
			`Filter operator '${operator}' is not supported for expression type '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertCompatibleComparisonTypes = (input: {
	left: ViewExpressionTypeInfo;
	right: ViewExpressionTypeInfo;
	operator: string;
}) => {
	assertComparableExpression(input.left, input.operator);
	assertComparableExpression(input.right, input.operator);

	const leftType =
		input.left.kind === "property" ? input.left.propertyType : input.left.kind;
	const rightType =
		input.right.kind === "property"
			? input.right.propertyType
			: input.right.kind;

	if (leftType === rightType) {
		return;
	}

	if (
		[leftType, rightType].every((type) => ["integer", "number"].includes(type))
	) {
		return;
	}

	if ([leftType, rightType].every((type) => type === "date")) {
		return;
	}

	throw new QueryEngineValidationError(
		`Filter operator '${input.operator}' requires compatible expression types, received '${leftType}' and '${rightType}'`,
	);
};
