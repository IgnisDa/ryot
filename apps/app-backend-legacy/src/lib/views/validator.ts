import type { RuntimeRef } from "@ryot/ts-utils/view-language";
import { match } from "ts-pattern";

import type { QueryEngineRequest } from "~/modules/query-engine";
import type { DisplayConfiguration, LatestRelationshipJoinDefinition } from "~/modules/saved-views";

import {
	buildComputedFieldMap,
	getComputedFieldDependencies,
	getComputedFieldOrThrow,
	prepareComputedFields,
} from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import type { ViewComputedField, ViewExpression, ViewPredicate } from "./expression";
import {
	assertComparableExpression,
	assertNumericExpression,
	assertSortableExpression,
	inferViewExpressionType,
	type ViewExpressionTypeInfo,
} from "./expression-analysis";
import { validateViewPredicateAgainstSchemas } from "./predicate-validator";
import {
	displayBuiltins,
	eventDisplayBuiltins,
	eventSchemaDisplayBuiltins,
	eventSchemaSortFilterBuiltins,
	eventSortFilterBuiltins,
	getEntityColumnPropertyDefinition,
	getEntitySchemaColumnPropertyDefinition,
	getEventColumnPropertyDefinition,
	getEventJoinColumnPropertyDefinition,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getEventSchemaColumnPropertyDefinition,
	getPropertyDefinition,
	getPropertyType,
	getRelationshipJoinColumnPropertyDefinition,
	getRelationshipJoinEntitySchema,
	getRelationshipJoinForReference,
	getRelationshipJoinPropertyType,
	getSchemaForReference,
	type QueryEngineEventJoinLike,
	type QueryEngineEventSchemaLike,
	type QueryEngineRelationshipJoinLike,
	type QueryEngineReferenceContext,
	type QueryEngineSchemaLike,
	serializeComparablePropertyDefinition,
	sortFilterBuiltins,
} from "./reference";

type ValidationSchemaRow = QueryEngineSchemaLike;
type ValidationEventJoinRow = QueryEngineEventJoinLike;

const validateBuiltinPathHasSingleSegment = (input: { path: string[]; label: string }): void => {
	if (input.path.length <= 1) {
		return;
	}

	throw new QueryEngineValidationError(
		`${input.label} '${input.path.join(".")}' does not support nested paths`,
	);
};

const getEventPropertyDefinition = (
	eventSchemas: QueryEngineEventSchemaLike[],
	eventSchemaSlug: string,
	propertyPath: string[],
) => {
	const [firstDefinition, ...restDefinitions] = eventSchemas.map((schema) => {
		const propertyDefinition = getPropertyDefinition(schema, propertyPath);
		if (!propertyDefinition) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' not found in event schema '${eventSchemaSlug}'`,
			);
		}

		return propertyDefinition;
	});

	if (!firstDefinition) {
		throw new QueryEngineValidationError(
			`Event schema '${eventSchemaSlug}' is not available for the requested event schemas`,
		);
	}

	const serializedDefinition = serializeComparablePropertyDefinition(firstDefinition);
	for (const definition of restDefinitions) {
		if (serializeComparablePropertyDefinition(definition) !== serializedDefinition) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' has incompatible definitions across event schemas for slug '${eventSchemaSlug}'`,
			);
		}
	}

	return firstDefinition;
};

const validateEventReference = (
	reference: Extract<RuntimeRef, { type: "event" }>,
	eventSchemaMap: Map<string, QueryEngineEventSchemaLike[]>,
	requireSchemaSlug: boolean,
	validBuiltins: ReadonlySet<string>,
): void => {
	if (reference.path[0] === "properties") {
		const propertyPath = reference.path.slice(1);
		if (!reference.eventSchemaSlug) {
			if (requireSchemaSlug) {
				throw new QueryEngineValidationError(
					"Primary event property references in this context must specify eventSchemaSlug",
				);
			}

			return;
		}

		const eventSchemas = eventSchemaMap.get(reference.eventSchemaSlug);
		if (!eventSchemas?.length) {
			throw new QueryEngineValidationError(
				`Event schema '${reference.eventSchemaSlug}' is not available for the requested event schemas`,
			);
		}

		getEventPropertyDefinition(eventSchemas, reference.eventSchemaSlug, propertyPath);

		return;
	}

	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError("Event reference path must not be empty");
	}
	validateBuiltinPathHasSingleSegment({ path: reference.path, label: "Event column" });

	if (!validBuiltins.has(column)) {
		throw new QueryEngineValidationError(`Unsupported event column 'event.${column}'`);
	}

	if (!getEventColumnPropertyDefinition(column)) {
		throw new QueryEngineValidationError(`Unsupported event column 'event.${column}'`);
	}
};
const validateEventSchemaReference = (
	reference: Extract<RuntimeRef, { type: "event-schema" }>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError("Event schema reference path must not be empty");
	}
	if (reference.path.length > 1) {
		throw new QueryEngineValidationError(
			`Event schema column 'event-schema.${reference.path.join(".")}' does not support nested paths`,
		);
	}
	if (!validBuiltins.has(column)) {
		throw new QueryEngineValidationError(
			`Event schema column 'event-schema.${column}' is not valid in this context`,
		);
	}
	if (!getEventSchemaColumnPropertyDefinition(column)) {
		throw new QueryEngineValidationError(
			`Event schema column 'event-schema.${column}' is not valid in this context`,
		);
	}
};

const isPrimaryEventMode = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(
	context: QueryEngineReferenceContext<TSchema, TJoin>,
) => context.supportsPrimaryEventRefs === true;

const assertStringExpression = (input: ViewExpressionTypeInfo, context: string) => {
	if (input.kind === "property" && input.propertyType === "string") {
		return;
	}

	throw new QueryEngineValidationError(
		`${context} requires a string expression, received '${input.kind === "property" ? input.propertyType : input.kind}'`,
	);
};

export const validateRuntimeReferenceAgainstSchemas = (
	reference: RuntimeRef,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const primaryEventMode = isPrimaryEventMode(context);

	match(reference)
		.with({ type: "computed-field" }, () => {
			throw new QueryEngineValidationError(
				"Computed field references are not allowed in this context",
			);
		})
		.with({ type: "entity" }, (ref) => {
			const schema = getSchemaForReference(context.schemaMap, ref);

			if (ref.path[0] === "properties") {
				const propertyPath = ref.path.slice(1);
				const propertyType = getPropertyType(schema, propertyPath);
				if (!propertyType) {
					throw new QueryEngineValidationError(
						`Property '${propertyPath.join(".")}' not found in schema '${ref.slug}'`,
					);
				}
				return;
			}

			const [column] = ref.path;
			if (!column) {
				throw new QueryEngineValidationError("Entity reference path must not be empty");
			}
			validateBuiltinPathHasSingleSegment({ path: ref.path, label: "Entity column" });
			if (column === "image") {
				return;
			}
			if (!validBuiltins.has(column)) {
				throw new QueryEngineValidationError(
					`Unsupported entity column 'entity.${ref.slug}.${column}'`,
				);
			}
			if (!getEntityColumnPropertyDefinition(column)) {
				throw new QueryEngineValidationError(
					`Unsupported entity column 'entity.${ref.slug}.${column}'`,
				);
			}
		})
		.with({ type: "event-aggregate" }, (ref) => {
			if (primaryEventMode) {
				throw new QueryEngineValidationError(
					"event-aggregate references are not supported in this query mode",
				);
			}

			if (context.eventSchemaSlugs && !context.eventSchemaSlugs.has(ref.eventSchemaSlug)) {
				throw new QueryEngineValidationError(
					`Event schema '${ref.eventSchemaSlug}' is not available for the requested entity schemas`,
				);
			}
			if (ref.aggregation === "count") {
				return;
			}

			if (ref.path?.[0] !== "properties") {
				throw new QueryEngineValidationError(
					`Event aggregate path must start with 'properties' (received '${ref.path?.[0]}')`,
				);
			}

			const propertyPath = ref.path.slice(1);
			const eventSchemas = context.eventSchemaMap?.get(ref.eventSchemaSlug);
			if (!eventSchemas?.length) {
				throw new QueryEngineValidationError(
					`Event schema '${ref.eventSchemaSlug}' is not available for the requested entity schemas`,
				);
			}

			const propertyDefinition = getEventPropertyDefinition(
				eventSchemas,
				ref.eventSchemaSlug,
				propertyPath,
			);
			if (!["integer", "number"].includes(propertyDefinition.type)) {
				throw new QueryEngineValidationError(
					`${ref.aggregation} event aggregate requires a numeric property, received '${propertyDefinition.type}'`,
				);
			}
		})
		.with({ type: "entity-schema" }, (ref) => {
			const [column] = ref.path;
			if (!column) {
				throw new QueryEngineValidationError("Entity schema reference path must not be empty");
			}
			if (ref.path.length > 1) {
				throw new QueryEngineValidationError(
					`Entity schema column 'entity-schema.${ref.path.join(".")}' does not support nested paths`,
				);
			}
			if (!getEntitySchemaColumnPropertyDefinition(column)) {
				throw new QueryEngineValidationError(
					`Unsupported entity schema column 'entity-schema.${column}'`,
				);
			}
			if (!validBuiltins.has(column)) {
				throw new QueryEngineValidationError(
					`Entity schema column 'entity-schema.${column}' is not valid in this context`,
				);
			}
		})
		.with({ type: "event" }, (ref) => {
			if (!primaryEventMode || !context.eventSchemaMap) {
				throw new QueryEngineValidationError(
					"Primary event references are not supported in this query mode",
				);
			}

			validateEventReference(
				ref,
				context.eventSchemaMap,
				context.requirePrimaryEventSchemaSlug ?? false,
				validBuiltins,
			);
		})
		.with({ type: "event-schema" }, (ref) => {
			if (!primaryEventMode || !context.eventSchemaMap) {
				throw new QueryEngineValidationError(
					"Primary event schema references are not supported in this query mode",
				);
			}

			validateEventSchemaReference(ref, validBuiltins);
		})
		.with({ type: "relationship-join" }, (ref) => {
			if (primaryEventMode) {
				throw new QueryEngineValidationError(
					"Relationship join references are not supported in this query mode",
				);
			}

			const join = getRelationshipJoinForReference(context.relationshipJoinMap ?? new Map(), ref);

			const [pathRoot] = ref.path;

			if (pathRoot === "sourceEntity" || pathRoot === "targetEntity") {
				const [, column, ...rest] = ref.path;
				const sideName = pathRoot === "sourceEntity" ? "source" : "target";
				if (!column) {
					throw new QueryEngineValidationError(
						`Related entity reference path must not be empty after '${pathRoot}'`,
					);
				}
				if (column === "image") {
					validateBuiltinPathHasSingleSegment({
						label: "Related entity column",
						path: ref.path.slice(1),
					});
					return;
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
						throw new QueryEngineValidationError(
							`Related entity properties under '${pathRoot}.properties' require the ${sideName} entity schema to be defined on the relationship schema '${join.relationshipSchemaSlug}'`,
						);
					}
					const propertyType = getPropertyType(entitySchema, propertyPath);
					if (!propertyType) {
						throw new QueryEngineValidationError(
							`Property '${propertyPath.join(".")}' not found in ${sideName} entity schema '${entitySchema.slug}'`,
						);
					}
					return;
				}
				if (!getEntityColumnPropertyDefinition(column)) {
					throw new QueryEngineValidationError(
						`Unsupported related entity column '${pathRoot}.${column}'`,
					);
				}
				validateBuiltinPathHasSingleSegment({
					label: "Related entity column",
					path: ref.path.slice(1),
				});
				return;
			}

			if (pathRoot === "properties") {
				const propertyPath = ref.path.slice(1);
				getRelationshipJoinPropertyType(join, propertyPath);
				return;
			}

			const [column] = ref.path;
			if (!column) {
				throw new QueryEngineValidationError("Relationship join reference path must not be empty");
			}
			if (!getRelationshipJoinColumnPropertyDefinition(column)) {
				throw new QueryEngineValidationError(
					`Unsupported relationship join column 'relationship.${ref.joinKey}.${column}'`,
				);
			}
			validateBuiltinPathHasSingleSegment({
				path: ref.path,
				label: "Relationship join column",
			});
		})
		.with({ type: "event-join" }, (ref) => {
			const join = getEventJoinForReference(context.eventJoinMap, ref);

			if (ref.path[0] === "properties") {
				const propertyPath = ref.path.slice(1);
				getEventJoinPropertyType(join, propertyPath);
				return;
			}

			const [column] = ref.path;
			if (!column) {
				throw new QueryEngineValidationError("Event join reference path must not be empty");
			}
			if (!getEventJoinColumnPropertyDefinition(column)) {
				throw new QueryEngineValidationError(
					`Unsupported event join column 'event.${ref.joinKey}.${column}'`,
				);
			}
			validateBuiltinPathHasSingleSegment({ path: ref.path, label: "Event join column" });
		})
		.exhaustive();
};

const collectComputedFieldChain = (
	expression: ViewExpression,
	computedFieldMap: Map<string, ViewComputedField>,
	seen = new Set<string>(),
): ViewComputedField[] => {
	if (expression.type === "literal") {
		return [];
	}

	if (expression.type === "reference") {
		if (expression.reference.type !== "computed-field") {
			return [];
		}

		const field = getComputedFieldOrThrow(computedFieldMap, expression.reference.key);
		if (seen.has(field.key)) {
			return [];
		}

		seen.add(field.key);
		return [field, ...collectComputedFieldsInExpression(field.expression, computedFieldMap, seen)];
	}

	return collectComputedFieldsInExpression(expression, computedFieldMap, seen);
};

const collectComputedFieldsInExpression = (
	expression: ViewExpression,
	computedFieldMap: Map<string, ViewComputedField>,
	seen = new Set<string>(),
): ViewComputedField[] => {
	const dependencies = getComputedFieldDependencies(expression);
	return dependencies.flatMap((key) => {
		if (seen.has(key)) {
			return [];
		}

		const field = getComputedFieldOrThrow(computedFieldMap, key);
		seen.add(key);
		return [field].concat(
			collectComputedFieldsInExpression(field.expression, computedFieldMap, seen),
		);
	});
};

const withPrimaryEventSchemaSlugRequirement = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(
	context: QueryEngineReferenceContext<TSchema, TJoin>,
) => ({
	...context,
	requirePrimaryEventSchemaSlug: true,
});

const validateStrictPrimaryEventRefsInExpression = (
	expression: ViewExpression,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	validBuiltins: ReadonlySet<string>,
	computedFieldMap: Map<string, ViewComputedField>,
) => {
	const strictContext = context.requirePrimaryEventSchemaSlug
		? context
		: withPrimaryEventSchemaSlugRequirement(context);
	validateExpressionAgainstSchemas(expression, strictContext, validBuiltins, computedFieldMap);

	for (const computedField of collectComputedFieldChain(expression, computedFieldMap)) {
		validateExpressionAgainstSchemas(
			computedField.expression,
			strictContext,
			validBuiltins,
			computedFieldMap,
		);
	}
};

const validateStrictPrimaryEventRefsInPredicate = (
	predicate: ViewPredicate,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	validBuiltins: ReadonlySet<string>,
	computedFields: ViewComputedField[] | undefined,
) => {
	const strictContext = withPrimaryEventSchemaSlugRequirement(context);
	const computedFieldMap = buildComputedFieldMap(computedFields);
	validateViewPredicateAgainstSchemas({
		context: strictContext,
		predicate,
		computedFields,
		validBuiltins,
		validateExpression: (expression) =>
			validateStrictPrimaryEventRefsInExpression(
				expression,
				strictContext,
				validBuiltins,
				computedFieldMap,
			),
	});
};

export const validateExpressionAgainstSchemas = (
	expression: ViewExpression,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	validBuiltins: ReadonlySet<string>,
	computedFieldMap: Map<string, ViewComputedField> = new Map(),
): void => {
	match(expression)
		.with({ type: "literal" }, () => undefined)
		.with({ type: "reference" }, (expr) => {
			if (expr.reference.type === "computed-field") {
				getComputedFieldOrThrow(computedFieldMap, expr.reference.key);
				return;
			}

			validateRuntimeReferenceAgainstSchemas(expr.reference, context, validBuiltins);
		})
		.with({ type: "arithmetic" }, (expr) => {
			validateExpressionAgainstSchemas(expr.left, context, validBuiltins, computedFieldMap);
			validateExpressionAgainstSchemas(expr.right, context, validBuiltins, computedFieldMap);
			inferViewExpressionType({ context, expression: expr, computedFieldMap });
		})
		.with(
			{ type: "round" },
			{ type: "floor" },
			{ type: "integer" },
			{ type: "transform" },
			(expr) => {
				validateExpressionAgainstSchemas(expr.expression, context, validBuiltins, computedFieldMap);
				inferViewExpressionType({ context, expression: expr, computedFieldMap });
			},
		)
		.with({ type: "conditional" }, (expr) => {
			validateViewPredicateAgainstSchemas({
				context,
				predicate: expr.condition,
				computedFields: [...computedFieldMap.values()],
				validBuiltins,
				validateExpression: (predicateExpression) =>
					context.requirePrimaryEventSchemaSlug
						? validateStrictPrimaryEventRefsInExpression(
								predicateExpression,
								context,
								validBuiltins,
								computedFieldMap,
							)
						: validateExpressionAgainstSchemas(
								predicateExpression,
								context,
								validBuiltins,
								computedFieldMap,
							),
			});
			validateExpressionAgainstSchemas(expr.whenTrue, context, validBuiltins, computedFieldMap);
			validateExpressionAgainstSchemas(expr.whenFalse, context, validBuiltins, computedFieldMap);
			inferViewExpressionType({ context, expression: expr, computedFieldMap });
		})
		.with({ type: "coalesce" }, { type: "concat" }, (expr) => {
			for (const value of expr.values) {
				validateExpressionAgainstSchemas(value, context, validBuiltins, computedFieldMap);
			}

			inferViewExpressionType({ context, expression: expr, computedFieldMap });
		})
		.exhaustive();
};

const validateComputedFields = (input: {
	validBuiltins: ReadonlySet<string>;
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>;
}) => {
	const { computedFieldMap, orderedComputedFields } = prepareComputedFields(input.computedFields);

	for (const computedField of orderedComputedFields) {
		validateExpressionAgainstSchemas(
			computedField.expression,
			input.context,
			input.validBuiltins,
			computedFieldMap,
		);
	}

	return computedFieldMap;
};

const validateJoinLocalFilterExpression = (
	expression: ViewExpression,
	joinKey: string,
	join: QueryEngineRelationshipJoinLike,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	match(expression)
		.with({ type: "literal" }, () => undefined)
		.with({ type: "reference" }, (referenceExpression) => {
			if (referenceExpression.reference.type !== "relationship-join") {
				throw new QueryEngineValidationError(
					`Join-local filter may only reference the current relationship join, received '${referenceExpression.reference.type}'`,
				);
			}
			if (referenceExpression.reference.joinKey !== joinKey) {
				throw new QueryEngineValidationError(
					`Join-local filter cannot reference relationship join '${referenceExpression.reference.joinKey}'`,
				);
			}
			const [pathRoot] = referenceExpression.reference.path;
			if (pathRoot === "sourceEntity" || pathRoot === "targetEntity") {
				throw new QueryEngineValidationError(
					`Join-local filter cannot reference related entity data '${pathRoot}' on join '${referenceExpression.reference.joinKey}'`,
				);
			}
			if (pathRoot === "properties") {
				const propertyPath = referenceExpression.reference.path.slice(1);
				getRelationshipJoinPropertyType(join, propertyPath);
				return;
			}
			validateBuiltinPathHasSingleSegment({
				path: referenceExpression.reference.path,
				label: "Relationship join column",
			});
		})
		.with({ type: "coalesce" }, (coalesceExpression) => {
			for (const value of coalesceExpression.values) {
				validateJoinLocalFilterExpression(value, joinKey, join, context);
			}
		})
		.with({ type: "arithmetic" }, (arithmeticExpression) => {
			validateJoinLocalFilterExpression(arithmeticExpression.left, joinKey, join, context);
			validateJoinLocalFilterExpression(arithmeticExpression.right, joinKey, join, context);
		})
		.with(
			{ type: "round" },
			{ type: "floor" },
			{ type: "integer" },
			{ type: "transform" },
			(nestedExpression) => {
				validateJoinLocalFilterExpression(nestedExpression.expression, joinKey, join, context);
			},
		)
		.with({ type: "concat" }, (concatExpression) => {
			for (const value of concatExpression.values) {
				validateJoinLocalFilterExpression(value, joinKey, join, context);
			}
		})
		.with({ type: "conditional" }, (conditionalExpression) => {
			validateJoinLocalFilterExpression(conditionalExpression.whenTrue, joinKey, join, context);
			validateJoinLocalFilterExpression(conditionalExpression.whenFalse, joinKey, join, context);
			validateJoinLocalFilterPredicate(conditionalExpression.condition, joinKey, join, context);
		})
		.exhaustive();
};

const validateJoinLocalFilterPredicate = (
	predicate: ViewPredicate,
	joinKey: string,
	join: QueryEngineRelationshipJoinLike,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	validateViewPredicateAgainstSchemas({
		context,
		predicate,
		validBuiltins: sortFilterBuiltins,
		validateExpression: (expression) =>
			validateJoinLocalFilterExpression(expression, joinKey, join, context),
	});
};

const validateRelationshipJoinLocalFilters = (
	relationshipJoins: LatestRelationshipJoinDefinition[],
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
) => {
	for (const join of relationshipJoins) {
		if (join.filter) {
			const loadedJoin = context.relationshipJoinMap?.get(join.key);
			if (!loadedJoin) {
				throw new QueryEngineValidationError(`Relationship join '${join.key}' not found`);
			}
			validateJoinLocalFilterPredicate(join.filter, join.key, loadedJoin, context);
		}
	}
};

const validateEntityQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "entities" }>,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	validateRelationshipJoinLocalFilters(request.relationshipJoins, context);

	const computedFieldMap = validateComputedFields({
		context,
		validBuiltins: displayBuiltins,
		computedFields: request.computedFields,
	});

	validateExpressionAgainstSchemas(
		request.sort.expression,
		context,
		sortFilterBuiltins,
		computedFieldMap,
	);
	validateStrictPrimaryEventRefsInExpression(
		request.sort.expression,
		context,
		sortFilterBuiltins,
		computedFieldMap,
	);
	assertSortableExpression(
		inferViewExpressionType({
			context,
			computedFieldMap,
			expression: request.sort.expression,
		}),
	);

	if (request.filter) {
		validateStrictPrimaryEventRefsInPredicate(
			request.filter,
			context,
			sortFilterBuiltins,
			request.computedFields,
		);
	}

	for (const field of request.fields) {
		validateExpressionAgainstSchemas(field.expression, context, displayBuiltins, computedFieldMap);
	}
};

const validateAggregateQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "aggregate" }>,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	validateRelationshipJoinLocalFilters(request.relationshipJoins, context);

	const computedFieldMap = validateComputedFields({
		context,
		validBuiltins: displayBuiltins,
		computedFields: request.computedFields,
	});

	if (request.filter) {
		validateStrictPrimaryEventRefsInPredicate(
			request.filter,
			context,
			sortFilterBuiltins,
			request.computedFields,
		);
	}

	for (const field of request.aggregations) {
		const aggregation = field.aggregation;

		if (aggregation.type === "count") {
			continue;
		}

		if (aggregation.type === "countWhere") {
			validateViewPredicateAgainstSchemas({
				context,
				predicate: aggregation.predicate,
				validBuiltins: sortFilterBuiltins,
				computedFields: request.computedFields,
				validateExpression: (expression) =>
					validateExpressionAgainstSchemas(
						expression,
						context,
						sortFilterBuiltins,
						computedFieldMap,
					),
			});
			continue;
		}

		if (aggregation.type === "countBy") {
			validateExpressionAgainstSchemas(
				aggregation.groupBy,
				context,
				sortFilterBuiltins,
				computedFieldMap,
			);
			validateStrictPrimaryEventRefsInExpression(
				aggregation.groupBy,
				context,
				sortFilterBuiltins,
				computedFieldMap,
			);
			assertComparableExpression(
				inferViewExpressionType({
					context,
					computedFieldMap,
					expression: aggregation.groupBy,
				}),
				"countBy",
			);
			continue;
		}

		validateExpressionAgainstSchemas(
			aggregation.expression,
			context,
			displayBuiltins,
			computedFieldMap,
		);
		assertNumericExpression(
			inferViewExpressionType({
				context,
				computedFieldMap,
				expression: aggregation.expression,
			}),
			`${aggregation.type} aggregation`,
		);
	}
};

const validateEventsQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "events" }>,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	const eventsDisplayBuiltins = new Set([
		...displayBuiltins,
		...eventDisplayBuiltins,
		...eventSchemaDisplayBuiltins,
	]);
	const eventsSortFilterBuiltins = new Set([
		...sortFilterBuiltins,
		...eventSortFilterBuiltins,
		...eventSchemaSortFilterBuiltins,
	]);

	const computedFieldMap = validateComputedFields({
		context,
		validBuiltins: eventsDisplayBuiltins,
		computedFields: request.computedFields,
	});

	validateExpressionAgainstSchemas(
		request.sort.expression,
		context,
		eventsSortFilterBuiltins,
		computedFieldMap,
	);
	validateStrictPrimaryEventRefsInExpression(
		request.sort.expression,
		context,
		eventsSortFilterBuiltins,
		computedFieldMap,
	);
	assertSortableExpression(
		inferViewExpressionType({
			context,
			computedFieldMap,
			expression: request.sort.expression,
		}),
	);

	if (request.filter) {
		validateStrictPrimaryEventRefsInPredicate(
			request.filter,
			context,
			eventsSortFilterBuiltins,
			request.computedFields,
		);
	}

	for (const field of request.fields) {
		validateExpressionAgainstSchemas(
			field.expression,
			context,
			eventsDisplayBuiltins,
			computedFieldMap,
		);
	}
};

const validateTimeSeriesQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "timeSeries" }>,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	const timeSeriesSortFilterBuiltins = new Set([
		...sortFilterBuiltins,
		...eventSortFilterBuiltins,
		...eventSchemaSortFilterBuiltins,
	]);

	const computedFieldMap = validateComputedFields({
		context,
		validBuiltins: timeSeriesSortFilterBuiltins,
		computedFields: request.computedFields,
	});

	if (request.filter) {
		validateStrictPrimaryEventRefsInPredicate(
			request.filter,
			context,
			timeSeriesSortFilterBuiltins,
			request.computedFields,
		);
	}

	if (request.metric.type === "sum") {
		validateExpressionAgainstSchemas(
			request.metric.expression,
			context,
			timeSeriesSortFilterBuiltins,
			computedFieldMap,
		);
		validateStrictPrimaryEventRefsInExpression(
			request.metric.expression,
			context,
			timeSeriesSortFilterBuiltins,
			computedFieldMap,
		);
		assertNumericExpression(
			inferViewExpressionType({
				context,
				computedFieldMap,
				expression: request.metric.expression,
			}),
			"sum metric",
		);
	}
};

export const validateQueryEngineReferences = (
	request: QueryEngineRequest,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
	match(request)
		.with({ mode: "entities" }, (req) => validateEntityQueryEngineReferences(req, context))
		.with({ mode: "events" }, (req) => validateEventsQueryEngineReferences(req, context))
		.with({ mode: "timeSeries" }, (req) => validateTimeSeriesQueryEngineReferences(req, context))
		.with({ mode: "aggregate" }, (req) => validateAggregateQueryEngineReferences(req, context))
		.exhaustive();
};

export const validateSavedViewDisplayConfiguration = (
	displayConfiguration: DisplayConfiguration,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	computedFields?: ViewComputedField[],
): void => {
	if (isPrimaryEventMode(context)) {
		throw new QueryEngineValidationError(
			"Saved view display configuration only supports entity-mode queries",
		);
	}

	const computedFieldMap = validateComputedFields({
		context,
		computedFields,
		validBuiltins: displayBuiltins,
	});

	validateExpressionAgainstSchemas(
		displayConfiguration.entityIdProperty,
		context,
		displayBuiltins,
		computedFieldMap,
	);
	assertStringExpression(
		inferViewExpressionType({
			context,
			computedFieldMap,
			expression: displayConfiguration.entityIdProperty,
		}),
		"Saved view entityIdProperty",
	);

	for (const refs of [
		displayConfiguration.grid.eyebrowProperty,
		displayConfiguration.grid.imageProperty,
		displayConfiguration.grid.titleProperty,
		displayConfiguration.grid.calloutProperty,
		displayConfiguration.grid.primarySubtitleProperty,
		displayConfiguration.grid.secondarySubtitleProperty,
		displayConfiguration.list.eyebrowProperty,
		displayConfiguration.list.imageProperty,
		displayConfiguration.list.titleProperty,
		displayConfiguration.list.calloutProperty,
		displayConfiguration.list.primarySubtitleProperty,
		displayConfiguration.list.secondarySubtitleProperty,
	]) {
		if (refs) {
			validateExpressionAgainstSchemas(refs, context, displayBuiltins, computedFieldMap);
		}
	}

	for (const column of displayConfiguration.table.columns) {
		validateExpressionAgainstSchemas(column.expression, context, displayBuiltins, computedFieldMap);
	}
};
