import type { RuntimeRef } from "@ryot/ts-utils";

import type { QueryEngineRequest } from "~/modules/query-engine";
import type { DisplayConfiguration } from "~/modules/saved-views";

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
	getSchemaForReference,
	type QueryEngineEventJoinLike,
	type QueryEngineEventSchemaLike,
	type QueryEngineReferenceContext,
	type QueryEngineSchemaLike,
	serializeComparablePropertyDefinition,
	sortFilterBuiltins,
} from "./reference";

type ValidationSchemaRow = QueryEngineSchemaLike;
type ValidationEventJoinRow = QueryEngineEventJoinLike;

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

export const validateRuntimeReferenceAgainstSchemas = (
	reference: RuntimeRef,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
	validBuiltins: ReadonlySet<string>,
): void => {
	if (reference.type === "computed-field") {
		throw new QueryEngineValidationError(
			"Computed field references are not allowed in this context",
		);
	}

	const primaryEventMode = isPrimaryEventMode(context);

	if (reference.type === "entity") {
		const schema = getSchemaForReference(context.schemaMap, reference);

		if (reference.path[0] === "properties") {
			const propertyPath = reference.path.slice(1);
			const propertyType = getPropertyType(schema, propertyPath);
			if (!propertyType) {
				throw new QueryEngineValidationError(
					`Property '${propertyPath.join(".")}' not found in schema '${reference.slug}'`,
				);
			}
			return;
		}

		const [column] = reference.path;
		if (!column) {
			throw new QueryEngineValidationError("Entity reference path must not be empty");
		}
		if (column === "image") {
			return;
		}
		if (!validBuiltins.has(column)) {
			throw new QueryEngineValidationError(
				`Unsupported entity column 'entity.${reference.slug}.${column}'`,
			);
		}
		if (!getEntityColumnPropertyDefinition(column)) {
			throw new QueryEngineValidationError(
				`Unsupported entity column 'entity.${reference.slug}.${column}'`,
			);
		}
		return;
	}

	if (reference.type === "event-aggregate") {
		if (primaryEventMode) {
			throw new QueryEngineValidationError(
				"event-aggregate references are not supported in this query mode",
			);
		}

		if (context.eventSchemaSlugs && !context.eventSchemaSlugs.has(reference.eventSchemaSlug)) {
			throw new QueryEngineValidationError(
				`Event schema '${reference.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}
		if (reference.path[0] !== "properties") {
			throw new QueryEngineValidationError(
				`Event aggregate path must start with 'properties' (received '${reference.path[0]}')`,
			);
		}

		const propertyPath = reference.path.slice(1);
		const eventSchemas = context.eventSchemaMap?.get(reference.eventSchemaSlug);
		if (!eventSchemas?.length) {
			throw new QueryEngineValidationError(
				`Event schema '${reference.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}

		const propertyDefinition = getEventPropertyDefinition(
			eventSchemas,
			reference.eventSchemaSlug,
			propertyPath,
		);
		if (
			reference.aggregation !== "count" &&
			!["integer", "number"].includes(propertyDefinition.type)
		) {
			throw new QueryEngineValidationError(
				`${reference.aggregation} event aggregate requires a numeric property, received '${propertyDefinition.type}'`,
			);
		}
		return;
	}

	if (reference.type === "entity-schema") {
		const [column] = reference.path;
		if (!column) {
			throw new QueryEngineValidationError("Entity schema reference path must not be empty");
		}
		if (reference.path.length > 1) {
			throw new QueryEngineValidationError(
				`Entity schema column 'entity-schema.${reference.path.join(".")}' does not support nested paths`,
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
		return;
	}

	if (reference.type === "event") {
		if (!primaryEventMode || !context.eventSchemaMap) {
			throw new QueryEngineValidationError(
				"Primary event references are not supported in this query mode",
			);
		}

		validateEventReference(
			reference,
			context.eventSchemaMap,
			context.requirePrimaryEventSchemaSlug ?? false,
			validBuiltins,
		);
		return;
	}

	if (reference.type === "event-schema") {
		if (!primaryEventMode || !context.eventSchemaMap) {
			throw new QueryEngineValidationError(
				"Primary event schema references are not supported in this query mode",
			);
		}

		validateEventSchemaReference(reference, validBuiltins);
		return;
	}

	const join = getEventJoinForReference(context.eventJoinMap, reference);

	if (reference.path[0] === "properties") {
		const propertyPath = reference.path.slice(1);
		getEventJoinPropertyType(join, propertyPath);
		return;
	}

	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError("Event join reference path must not be empty");
	}
	if (!getEventJoinColumnPropertyDefinition(column)) {
		throw new QueryEngineValidationError(
			`Unsupported event join column 'event.${reference.joinKey}.${column}'`,
		);
	}
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
	// oxlint-disable-next-line oxc/no-map-spread
	return dependencies.flatMap((key) => {
		if (seen.has(key)) {
			return [];
		}

		const field = getComputedFieldOrThrow(computedFieldMap, key);
		seen.add(key);
		return [field, ...collectComputedFieldsInExpression(field.expression, computedFieldMap, seen)];
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
	if (expression.type === "literal") {
		return;
	}

	if (expression.type === "reference") {
		if (expression.reference.type === "computed-field") {
			getComputedFieldOrThrow(computedFieldMap, expression.reference.key);

			return;
		}

		validateRuntimeReferenceAgainstSchemas(expression.reference, context, validBuiltins);
		return;
	}

	if (expression.type === "arithmetic") {
		validateExpressionAgainstSchemas(expression.left, context, validBuiltins, computedFieldMap);
		validateExpressionAgainstSchemas(expression.right, context, validBuiltins, computedFieldMap);
		inferViewExpressionType({
			context,
			expression,
			computedFieldMap,
		});
		return;
	}

	if (
		expression.type === "round" ||
		expression.type === "floor" ||
		expression.type === "integer" ||
		expression.type === "transform"
	) {
		validateExpressionAgainstSchemas(
			expression.expression,
			context,
			validBuiltins,
			computedFieldMap,
		);
		inferViewExpressionType({
			context,
			expression,
			computedFieldMap,
		});
		return;
	}

	if (expression.type === "conditional") {
		validateViewPredicateAgainstSchemas({
			context,
			predicate: expression.condition,
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
		validateExpressionAgainstSchemas(expression.whenTrue, context, validBuiltins, computedFieldMap);
		validateExpressionAgainstSchemas(
			expression.whenFalse,
			context,
			validBuiltins,
			computedFieldMap,
		);
		inferViewExpressionType({
			context,
			expression,
			computedFieldMap,
		});
		return;
	}

	for (const value of expression.values) {
		validateExpressionAgainstSchemas(value, context, validBuiltins, computedFieldMap);
	}

	inferViewExpressionType({
		context,
		expression,
		computedFieldMap,
	});
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

const validateEntityQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "entities" }>,
	context: QueryEngineReferenceContext<ValidationSchemaRow, ValidationEventJoinRow>,
): void => {
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
	// Validate computed fields using display builtins combined with event builtins
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
	if (request.mode === "entities") {
		validateEntityQueryEngineReferences(request, context);
		return;
	}

	if (request.mode === "events") {
		validateEventsQueryEngineReferences(request, context);
		return;
	}

	if (request.mode === "timeSeries") {
		validateTimeSeriesQueryEngineReferences(request, context);
		return;
	}

	validateAggregateQueryEngineReferences(request, context);
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

	for (const refs of [
		displayConfiguration.grid.imageProperty,
		displayConfiguration.grid.titleProperty,
		displayConfiguration.grid.calloutProperty,
		displayConfiguration.grid.primarySubtitleProperty,
		displayConfiguration.grid.secondarySubtitleProperty,
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
