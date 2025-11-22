import { Match } from "effect";

import type { QueryComputedField, QueryExpression } from "#lib/query-language";
import type { AppPropertyDefinition } from "#lib/schema/property-schema";

import { getComputedFieldOrThrow } from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import { supportsComparableFilter, supportsContainsFilter } from "./policy";
import {
	getEntityColumnPropertyDefinition,
	getEntitySchemaColumnPropertyDefinition,
	getEventColumnPropertyDefinition,
	getEventJoinColumnPropertyDefinition,
	getEventJoinForReference,
	getEventJoinPropertyDefinition,
	getEventSchemaColumnPropertyDefinition,
	getPropertyDefinition,
	getRelationshipJoinColumnPropertyDefinition,
	getRelationshipJoinEntitySchema,
	getRelationshipJoinForReference,
	getRelationshipJoinPropertyDefinition,
	getSchemaForReference,
	type PropertyType,
	type QueryEngineEventSchemaLike,
	type QueryEngineReferenceContext,
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
	expression: Extract<QueryExpression, { type: "literal" }>,
): ViewExpressionTypeInfo => {
	const { value } = expression;
	if (value === null) {
		return { kind: "null" };
	}

	if (typeof value === "string") {
		return createPropertyTypeInfo("string", {
			label: "Value",
			type: "string",
			description: "Literal value",
		});
	}

	if (typeof value === "boolean") {
		return createPropertyTypeInfo("boolean", {
			label: "Value",
			type: "boolean",
			description: "Literal value",
		});
	}

	if (typeof value === "number") {
		return Number.isInteger(value)
			? createPropertyTypeInfo("integer", {
					label: "Value",
					type: "integer",
					description: "Literal value",
				})
			: createPropertyTypeInfo("number", {
					label: "Value",
					type: "number",
					description: "Literal value",
				});
	}

	if (Array.isArray(value)) {
		return createPropertyTypeInfo("array");
	}

	return createPropertyTypeInfo("object");
};

export const normalizeExpressionPropertyType = (propertyType: PropertyType) => {
	return Match.value(propertyType).pipe(
		Match.when("enum", () => "string" as const),
		Match.when("datetime", () => "date" as const),
		Match.when("enum-array", () => "array" as const),
		Match.orElse((value) => value),
	);
};

const unifyPropertyDefinitions = (definitions: (AppPropertyDefinition | undefined)[]) => {
	const serialized = [...new Set(definitions.map(serializePropertyDefinition))];
	if (serialized.length !== 1) {
		return undefined;
	}

	return definitions[0];
};

const getUnifiedEventPropertyDefinition = (
	eventSchemas: QueryEngineEventSchemaLike[],
	propertyPath: string[],
) => {
	return unifyPropertyDefinitions(
		eventSchemas.map((schema) => getPropertyDefinition(schema, propertyPath) ?? undefined),
	);
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

	return !["array", "object"].includes(normalizeExpressionPropertyType(input.propertyType));
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
		...new Set(propertyInfos.map((info) => normalizeExpressionPropertyType(info.propertyType))),
	];
	if (normalizedTypes.length === 1) {
		const propertyType = normalizedTypes[0];
		if (!propertyType) {
			return { kind: "null" } satisfies ViewExpressionTypeInfo;
		}

		return createPropertyTypeInfo(
			propertyType,
			unifyPropertyDefinitions(propertyInfos.map((info) => info.propertyDefinition)),
		);
	}

	if (normalizedTypes.every((type) => ["integer", "number"].includes(type))) {
		return createPropertyTypeInfo("number");
	}

	throw new QueryEngineValidationError(
		`Expression branches have incompatible types: ${normalizedTypes.join(", ")}`,
	);
};

export const assertNumericExpression = (input: ViewExpressionTypeInfo, context: string) => {
	assertFilterCompatibleExpression(input, context);
	if (input.kind !== "property" || !isNumericPropertyType(input.propertyType)) {
		throw new QueryEngineValidationError(
			`${context} requires a numeric expression, received '${getExpressionTypeLabel(input)}'`,
		);
	}
};

export const assertConcatCompatibleExpression = (input: ViewExpressionTypeInfo) => {
	assertFilterCompatibleExpression(input, "string composition");
	if (!isConcatCompatibleType(input)) {
		throw new QueryEngineValidationError(
			`String composition requires scalar expression values, received '${getExpressionTypeLabel(input)}'`,
		);
	}
};

export const inferViewExpressionType = (input: {
	expression: QueryExpression;
	context: QueryEngineReferenceContext;
	typeCache?: Map<string, ViewExpressionTypeInfo>;
	computedFieldMap?: Map<string, QueryComputedField>;
}): ViewExpressionTypeInfo => {
	const typeCache = input.typeCache ?? new Map<string, ViewExpressionTypeInfo>();
	const computedFieldMap = input.computedFieldMap ?? new Map<string, QueryComputedField>();

	return Match.value(input.expression).pipe(
		Match.when({ type: "literal" }, (expr) => createLiteralTypeInfo(expr)),
		Match.when({ type: "isNotNull" }, () =>
			createPropertyTypeInfo("boolean", {
				type: "boolean",
				label: "Is Not Null",
				description: "Whether the value is not null",
			}),
		),
		Match.when({ type: "coalesce" }, (expr) =>
			unifyTypeInfos(
				expr.values.map((expression) =>
					inferViewExpressionType({
						typeCache,
						expression,
						computedFieldMap,
						context: input.context,
					}),
				),
			),
		),
		Match.when({ type: "arithmetic" }, (expr) => {
			const leftType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.left,
			});
			const rightType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.right,
			});
			assertNumericExpression(leftType, "Arithmetic");
			assertNumericExpression(rightType, "Arithmetic");
			if (leftType.kind !== "property" || rightType.kind !== "property") {
				throw new QueryEngineValidationError("Arithmetic requires numeric property expressions");
			}

			return expr.operator === "divide" ||
				leftType.propertyType === "number" ||
				rightType.propertyType === "number"
				? createPropertyTypeInfo("number", {
						label: "Value",
						type: "number",
						description: "Computed numeric value",
					})
				: createPropertyTypeInfo("integer", {
						label: "Value",
						type: "integer",
						description: "Computed numeric value",
					});
		}),
		Match.whenOr({ type: "round" }, { type: "floor" }, { type: "integer" }, (expr) => {
			const expressionType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.expression,
			});
			assertNumericExpression(expressionType, "Numeric normalization");
			return createPropertyTypeInfo("integer", {
				label: "Value",
				type: "integer",
				description: "Normalized integer value",
			});
		}),
		Match.when({ type: "concat" }, (expr) => {
			for (const value of expr.values) {
				assertConcatCompatibleExpression(
					inferViewExpressionType({
						typeCache,
						computedFieldMap,
						expression: value,
						context: input.context,
					}),
				);
			}

			return createPropertyTypeInfo("string", {
				label: "Value",
				type: "string",
				description: "Computed text value",
			});
		}),
		Match.when({ type: "transform" }, (expr) => {
			const innerType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.expression,
			});
			assertConcatCompatibleExpression(innerType);
			return createPropertyTypeInfo("string", {
				label: "Value",
				type: "string",
				description: "Transformed text value",
			});
		}),
		Match.when({ type: "conditional" }, (expr) => {
			const thenType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.whenTrue,
			});
			const elseType = inferViewExpressionType({
				typeCache,
				computedFieldMap,
				context: input.context,
				expression: expr.whenFalse,
			});

			return unifyTypeInfos([thenType, elseType]);
		}),
		Match.when({ type: "reference" }, (expr) => {
			const { reference } = expr;

			return Match.value(reference).pipe(
				Match.when({ type: "computed-field" }, (ref) => {
					const cached = typeCache.get(ref.key);
					if (cached) {
						return cached;
					}

					const computedField = getComputedFieldOrThrow(computedFieldMap, ref.key);

					const inferred = inferViewExpressionType({
						typeCache,
						computedFieldMap,
						context: input.context,
						expression: computedField.expression,
					});
					typeCache.set(ref.key, inferred);
					return inferred;
				}),
				Match.when({ type: "entity" }, (ref) => {
					const schema = getSchemaForReference(input.context.schemaMap, ref);

					if (ref.path[0] === "properties") {
						const propertyPath = ref.path.slice(1);
						const propertyDefinition = getPropertyDefinition(schema, propertyPath);
						if (!propertyDefinition) {
							throw new QueryEngineValidationError(
								`Property '${propertyPath.join(".")}' not found in schema '${ref.slug}'`,
							);
						}

						return createPropertyTypeInfo(
							normalizeExpressionPropertyType(propertyDefinition.type),
							propertyDefinition,
						);
					}

					const [column] = ref.path;
					if (!column) {
						throw new QueryEngineValidationError("Entity reference path must not be empty");
					}
					if (ref.path.length > 1) {
						throw new QueryEngineValidationError(
							`Entity column '${ref.path.join(".")}' does not support nested paths`,
						);
					}
					if (column === "image") {
						return { kind: "image" } satisfies ViewExpressionTypeInfo;
					}

					const propertyDefinition = getEntityColumnPropertyDefinition(column);
					if (!propertyDefinition) {
						throw new QueryEngineValidationError(
							`Unsupported entity column 'entity.${ref.slug}.${column}'`,
						);
					}

					return createPropertyTypeInfo(
						normalizeExpressionPropertyType(propertyDefinition.type),
						propertyDefinition,
					);
				}),
				Match.when({ type: "event-aggregate" }, (ref) => {
					const propertyType = ref.aggregation === "count" ? "integer" : "number";
					return createPropertyTypeInfo(propertyType, {
						type: propertyType,
						label: "Event Aggregate",
						description: "Aggregated event value",
					});
				}),
				Match.when({ type: "entity-schema" }, (ref) => {
					const [column] = ref.path;
					if (!column) {
						throw new QueryEngineValidationError("Entity schema reference path must not be empty");
					}
					if (ref.path.length > 1) {
						throw new QueryEngineValidationError(
							`Entity schema column 'entity-schema.${ref.path.join(".")}' does not support nested paths`,
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
				}),
				Match.when({ type: "event" }, (ref) => {
					if (ref.path[0] !== "properties") {
						const [column] = ref.path;
						if (!column) {
							throw new QueryEngineValidationError("Event reference path must not be empty");
						}
						if (ref.path.length > 1) {
							throw new QueryEngineValidationError(
								`Event column '${ref.path.join(".")}' does not support nested paths`,
							);
						}
						const propertyDefinition = getEventColumnPropertyDefinition(column);
						if (!propertyDefinition) {
							throw new QueryEngineValidationError(`Unsupported event column 'event.${column}'`);
						}
						return createPropertyTypeInfo(
							normalizeExpressionPropertyType(propertyDefinition.type),
							propertyDefinition,
						);
					}

					const { eventSchemaSlug, path } = ref;
					const propertyPath = path.slice(1);
					if (eventSchemaSlug && input.context.eventSchemaMap) {
						const eventSchemas = input.context.eventSchemaMap.get(eventSchemaSlug);
						if (eventSchemas?.length) {
							const propertyDefinition = getUnifiedEventPropertyDefinition(
								eventSchemas,
								propertyPath,
							);
							if (propertyDefinition) {
								return createPropertyTypeInfo(
									normalizeExpressionPropertyType(propertyDefinition.type),
									propertyDefinition,
								);
							}
						}
					}

					return createPropertyTypeInfo("string", {
						type: "string",
						label: "Event Property",
						description: "Event property value",
					});
				}),
				Match.when({ type: "event-schema" }, (ref) => {
					const [column] = ref.path;
					if (!column) {
						throw new QueryEngineValidationError("Event schema reference path must not be empty");
					}
					if (ref.path.length > 1) {
						throw new QueryEngineValidationError(
							`Event schema column 'event-schema.${ref.path.join(".")}' does not support nested paths`,
						);
					}
					const propertyDefinition = getEventSchemaColumnPropertyDefinition(column);
					if (!propertyDefinition) {
						throw new QueryEngineValidationError(
							`Unsupported event schema column 'event-schema.${column}'`,
						);
					}
					return createPropertyTypeInfo(
						normalizeExpressionPropertyType(propertyDefinition.type),
						propertyDefinition,
					);
				}),
				Match.when({ type: "relationship-join" }, (ref) => {
					const join = getRelationshipJoinForReference(
						input.context.relationshipJoinMap ?? new Map(),
						ref,
					);

					const [pathRoot] = ref.path;

					if (pathRoot === "sourceEntity" || pathRoot === "targetEntity") {
						const [, column, ...rest] = ref.path;
						if (!column) {
							throw new QueryEngineValidationError(
								`Related entity reference path must not be empty after '${pathRoot}'`,
							);
						}
						if (column === "image") {
							if (ref.path.slice(1).length > 1) {
								throw new QueryEngineValidationError(
									`Related entity column '${ref.path.slice(1).join(".")}' does not support nested paths`,
								);
							}
							return { kind: "image" } satisfies ViewExpressionTypeInfo;
						}
						if (column === "properties") {
							const propertyPath = rest;
							if (!propertyPath.length) {
								throw new QueryEngineValidationError(
									`Related entity 'properties' reference requires at least one property segment`,
								);
							}
							const entitySchema = getRelationshipJoinEntitySchema(join, pathRoot);
							if (!entitySchema) {
								const sideName = pathRoot === "sourceEntity" ? "source" : "target";
								throw new QueryEngineValidationError(
									`Related entity properties under '${pathRoot}.properties' require the ${sideName} entity schema to be defined on the relationship schema '${join.relationshipSchemaSlug}'`,
								);
							}
							const propertyDefinition = getPropertyDefinition(entitySchema, propertyPath);
							if (!propertyDefinition) {
								throw new QueryEngineValidationError(
									`Property '${propertyPath.join(".")}' not found in ${pathRoot === "sourceEntity" ? "source" : "target"} entity schema '${entitySchema.slug}'`,
								);
							}
							return createPropertyTypeInfo(
								normalizeExpressionPropertyType(propertyDefinition.type),
								propertyDefinition,
							);
						}
						const propertyDefinition = getEntityColumnPropertyDefinition(column);
						if (!propertyDefinition) {
							throw new QueryEngineValidationError(
								`Unsupported related entity column '${pathRoot}.${column}'`,
							);
						}
						if (ref.path.slice(1).length > 1) {
							throw new QueryEngineValidationError(
								`Related entity column '${ref.path.slice(1).join(".")}' does not support nested paths`,
							);
						}
						return createPropertyTypeInfo(
							normalizeExpressionPropertyType(propertyDefinition.type),
							propertyDefinition,
						);
					}

					if (pathRoot === "properties") {
						const propertyPath = ref.path.slice(1);
						const propertyDefinition = getRelationshipJoinPropertyDefinition(join, propertyPath);

						return createPropertyTypeInfo(
							normalizeExpressionPropertyType(propertyDefinition.type),
							propertyDefinition,
						);
					}

					const [column] = ref.path;
					if (!column) {
						throw new QueryEngineValidationError(
							"Relationship join reference path must not be empty",
						);
					}
					if (ref.path.length > 1) {
						throw new QueryEngineValidationError(
							`Relationship join column '${ref.path.join(".")}' does not support nested paths`,
						);
					}
					const propertyDefinition = getRelationshipJoinColumnPropertyDefinition(column);
					if (!propertyDefinition) {
						throw new QueryEngineValidationError(
							`Unsupported relationship join column 'relationship.${ref.joinKey}.${column}'`,
						);
					}

					return createPropertyTypeInfo(
						normalizeExpressionPropertyType(propertyDefinition.type),
						propertyDefinition,
					);
				}),
				Match.when({ type: "event-join" }, (ref) => {
					const join = getEventJoinForReference(input.context.eventJoinMap, ref);

					if (ref.path[0] === "properties") {
						const propertyPath = ref.path.slice(1);
						const propertyDefinition = getEventJoinPropertyDefinition(join, propertyPath);

						return createPropertyTypeInfo(
							normalizeExpressionPropertyType(propertyDefinition.type),
							propertyDefinition,
						);
					}

					const [column] = ref.path;
					if (!column) {
						throw new QueryEngineValidationError("Event join reference path must not be empty");
					}
					if (ref.path.length > 1) {
						throw new QueryEngineValidationError(
							`Event join column '${ref.path.join(".")}' does not support nested paths`,
						);
					}
					const propertyDefinition = getEventJoinColumnPropertyDefinition(column);
					if (!propertyDefinition) {
						throw new QueryEngineValidationError(
							`Unsupported event join column 'event.${ref.joinKey}.${column}'`,
						);
					}

					return createPropertyTypeInfo(
						normalizeExpressionPropertyType(propertyDefinition.type),
						propertyDefinition,
					);
				}),
				Match.exhaustive,
			);
		}),
		Match.exhaustive,
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
	if (input.kind !== "property" || !supportsComparableFilter(input.propertyType)) {
		throw new QueryEngineValidationError(
			`Sort expressions must resolve to a sortable scalar value, received '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertContainsCompatibleExpression = (input: ViewExpressionTypeInfo) => {
	assertFilterCompatibleExpression(input, "filtering");
	if (input.kind !== "property" || !supportsContainsFilter(input.propertyType)) {
		throw new QueryEngineValidationError(
			`Filter operator 'contains' is not supported for expression type '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertComparableExpression = (input: ViewExpressionTypeInfo, operator: string) => {
	assertFilterCompatibleExpression(input, "filtering");
	if (input.kind !== "property" || !supportsComparableFilter(input.propertyType)) {
		throw new QueryEngineValidationError(
			`Filter operator '${operator}' is not supported for expression type '${input.kind === "property" ? input.propertyType : input.kind}'`,
		);
	}
};

export const assertCompatibleComparisonTypes = (input: {
	operator: string;
	left: ViewExpressionTypeInfo;
	right: ViewExpressionTypeInfo;
}) => {
	assertComparableExpression(input.left, input.operator);
	assertComparableExpression(input.right, input.operator);

	const leftType = input.left.kind === "property" ? input.left.propertyType : input.left.kind;
	const rightType = input.right.kind === "property" ? input.right.propertyType : input.right.kind;

	if (leftType === rightType) {
		return;
	}

	if ([leftType, rightType].every((type) => ["integer", "number"].includes(type))) {
		return;
	}

	if ([leftType, rightType].every((type) => ["date", "datetime"].includes(type))) {
		return;
	}

	throw new QueryEngineValidationError(
		`Filter operator '${input.operator}' requires compatible expression types, received '${leftType}' and '${rightType}'`,
	);
};
