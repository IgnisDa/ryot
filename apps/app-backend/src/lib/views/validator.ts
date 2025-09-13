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
	assertSortableExpression,
	inferViewExpressionType,
} from "./expression-analysis";
import { validateViewPredicateAgainstSchemas } from "./predicate-validator";
import {
	displayBuiltins,
	getEntityColumnPropertyDefinition,
	getEventJoinColumnPropertyDefinition,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	type QueryEngineEventJoinLike,
	type QueryEngineReferenceContext,
	type QueryEngineSchemaLike,
	sortFilterBuiltins,
} from "./reference";

type ValidationSchemaRow = QueryEngineSchemaLike;
type ValidationEventJoinRow = QueryEngineEventJoinLike;

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
		if (
			context.eventSchemaSlugs &&
			!context.eventSchemaSlugs.has(reference.eventSchemaSlug)
		) {
			throw new QueryEngineValidationError(
				`Event schema '${reference.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}
		// Path validation is not performed here because event schemas can differ
		// per entity schema, making cross-schema property resolution complex. The
		// SQL subquery handles invalid paths gracefully by returning NULL.
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
			"Event reference path must not be empty",
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

export const validateQueryEngineReferences = (
	request: QueryEngineRequest,
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
