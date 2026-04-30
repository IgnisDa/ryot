import type { RuntimeRef } from "@ryot/ts-utils";
import type { QueryEngineRequest } from "~/modules/query-engine";
import type { DisplayConfiguration } from "~/modules/saved-views";
import {
	getComputedFieldOrThrow,
	prepareComputedFields,
} from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import type { ViewComputedField, ViewExpression } from "./expression";
import {
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

	const serializedDefinition =
		serializeComparablePropertyDefinition(firstDefinition);
	for (const definition of restDefinitions) {
		if (
			serializeComparablePropertyDefinition(definition) !== serializedDefinition
		) {
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
	validBuiltins: ReadonlySet<string>,
): void => {
	if (reference.path[0] === "properties") {
		const propertyPath = reference.path.slice(1);
		if (!reference.eventSchemaSlug) {
			// Without a schema slug the property path cannot be validated — we accept
			// it and rely on SQL-level null results for unknown paths.
			return;
		}

		const eventSchemas = eventSchemaMap.get(reference.eventSchemaSlug);
		if (!eventSchemas?.length) {
			throw new QueryEngineValidationError(
				`Event schema '${reference.eventSchemaSlug}' is not available for the requested event schemas`,
			);
		}

		getEventPropertyDefinition(
			eventSchemas,
			reference.eventSchemaSlug,
			propertyPath,
		);

		return;
	}

	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event reference path must not be empty",
		);
	}

	if (!validBuiltins.has(column)) {
		throw new QueryEngineValidationError(
			`Unsupported event column 'event.${column}'`,
		);
	}

	if (!getEventColumnPropertyDefinition(column)) {
		throw new QueryEngineValidationError(
			`Unsupported event column 'event.${column}'`,
		);
	}
};
const validateEventSchemaReference = (
	reference: Extract<RuntimeRef, { type: "event-schema" }>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const [column] = reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event schema reference path must not be empty",
		);
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

export const validateRuntimeReferenceAgainstSchemas = (
	reference: RuntimeRef,
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
	validBuiltins: ReadonlySet<string>,
): void => {
	if (reference.type === "computed-field") {
		throw new QueryEngineValidationError(
			"Computed field references are not allowed in this context",
		);
	}

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
			throw new QueryEngineValidationError(
				"Entity reference path must not be empty",
			);
		}
		if (!validBuiltins.has(column)) {
			throw new QueryEngineValidationError(
				`Unsupported entity column 'entity.${reference.slug}.${column}'`,
			);
		}
		if (!getEntityColumnPropertyDefinition(column) && column !== "image") {
			throw new QueryEngineValidationError(
				`Unsupported entity column 'entity.${reference.slug}.${column}'`,
			);
		}
		return;
	}

	if (reference.type === "event-aggregate") {
		if (context.supportsPrimaryEventRefs) {
			throw new QueryEngineValidationError(
				"event-aggregate references are not supported in this query mode",
			);
		}

		if (
			context.eventSchemaSlugs &&
			!context.eventSchemaSlugs.has(reference.eventSchemaSlug)
		) {
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
			throw new QueryEngineValidationError(
				"Entity schema reference path must not be empty",
			);
		}
		if (reference.path.length > 1) {
			throw new QueryEngineValidationError(
				`Entity schema column 'entity-schema.${reference.path.join(".")}' does not support nested paths`,
			);
		}
		if (!validBuiltins.has(column)) {
			throw new QueryEngineValidationError(
				`Entity schema column 'entity-schema.${column}' is not valid in this context`,
			);
		}
		if (!getEntitySchemaColumnPropertyDefinition(column)) {
			throw new QueryEngineValidationError(
				`Unsupported entity schema column 'entity-schema.${column}'`,
			);
		}
		return;
	}

	if (reference.type === "event") {
		if (!context.supportsPrimaryEventRefs || !context.eventSchemaMap) {
			throw new QueryEngineValidationError(
				"Primary event references are not supported in this query mode",
			);
		}

		validateEventReference(reference, context.eventSchemaMap, validBuiltins);
		return;
	}

	if (reference.type === "event-schema") {
		if (!context.supportsPrimaryEventRefs || !context.eventSchemaMap) {
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
		throw new QueryEngineValidationError(
			"Event join reference path must not be empty",
		);
	}
	if (!getEventJoinColumnPropertyDefinition(column)) {
		throw new QueryEngineValidationError(
			`Unsupported event join column 'event.${reference.joinKey}.${column}'`,
		);
	}
};

export const validateExpressionAgainstSchemas = (
	expression: ViewExpression,
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
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

		validateRuntimeReferenceAgainstSchemas(
			expression.reference,
			context,
			validBuiltins,
		);
		return;
	}

	if (expression.type === "arithmetic") {
		validateExpressionAgainstSchemas(
			expression.left,
			context,
			validBuiltins,
			computedFieldMap,
		);
		validateExpressionAgainstSchemas(
			expression.right,
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
		});
		validateExpressionAgainstSchemas(
			expression.whenTrue,
			context,
			validBuiltins,
			computedFieldMap,
		);
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
		validateExpressionAgainstSchemas(
			value,
			context,
			validBuiltins,
			computedFieldMap,
		);
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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>;
}) => {
	const { computedFieldMap, orderedComputedFields } = prepareComputedFields(
		input.computedFields,
	);

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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
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
	assertSortableExpression(
		inferViewExpressionType({
			context,
			computedFieldMap,
			expression: request.sort.expression,
		}),
	);

	if (request.filter) {
		validateViewPredicateAgainstSchemas({
			context,
			predicate: request.filter,
			computedFields: request.computedFields,
			validBuiltins: sortFilterBuiltins,
		});
	}

	for (const field of request.fields) {
		validateExpressionAgainstSchemas(
			field.expression,
			context,
			displayBuiltins,
			computedFieldMap,
		);
	}
};

const validateAggregateQueryEngineReferences = (
	request: Extract<QueryEngineRequest, { mode: "aggregate" }>,
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
): void => {
	const computedFieldMap = validateComputedFields({
		context,
		validBuiltins: displayBuiltins,
		computedFields: request.computedFields,
	});

	if (request.filter) {
		validateViewPredicateAgainstSchemas({
			context,
			predicate: request.filter,
			validBuiltins: sortFilterBuiltins,
			computedFields: request.computedFields,
		});
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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
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
	assertSortableExpression(
		inferViewExpressionType({
			context,
			computedFieldMap,
			expression: request.sort.expression,
		}),
	);

	if (request.filter) {
		validateViewPredicateAgainstSchemas({
			context,
			predicate: request.filter,
			computedFields: request.computedFields,
			validBuiltins: eventsSortFilterBuiltins,
		});
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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
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
		validateViewPredicateAgainstSchemas({
			context,
			predicate: request.filter,
			computedFields: request.computedFields,
			validBuiltins: timeSeriesSortFilterBuiltins,
		});
	}

	if (request.metric.type === "sum") {
		validateExpressionAgainstSchemas(
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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
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
	context: QueryEngineReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
	computedFields?: ViewComputedField[],
): void => {
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
			validateExpressionAgainstSchemas(
				refs,
				context,
				displayBuiltins,
				computedFieldMap,
			);
		}
	}

	for (const column of displayConfiguration.table.columns) {
		validateExpressionAgainstSchemas(
			column.expression,
			context,
			displayBuiltins,
			computedFieldMap,
		);
	}
};
