import type { DisplayConfiguration } from "~/modules/saved-views/schemas";
import type { ViewRuntimeRequest } from "~/modules/view-runtime/schemas";
import { buildComputedFieldMap, orderComputedFields } from "./computed-fields";
import { ViewRuntimeValidationError } from "./errors";
import type {
	RuntimeRef,
	ViewComputedField,
	ViewExpression,
} from "./expression";
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
	resolveRuntimeReference,
	sortFilterBuiltins,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "./reference";

type ValidationSchemaRow = ViewRuntimeSchemaLike;
type ValidationEventJoinRow = ViewRuntimeEventJoinLike;

export const validateRuntimeReferenceAgainstSchemas = (
	reference: RuntimeRef,
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
	validBuiltins: ReadonlySet<string>,
): void => {
	if (reference.type === "computed-field") {
		throw new ViewRuntimeValidationError(
			"Computed field references are not allowed in this context",
		);
	}

	if (reference.type === "entity-column") {
		getSchemaForReference(context.schemaMap, reference);
		if (!validBuiltins.has(reference.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column 'entity.${reference.slug}.@${reference.column}'`,
			);
		}
		if (
			!getEntityColumnPropertyDefinition(reference.column) &&
			reference.column !== "image"
		) {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column 'entity.${reference.slug}.@${reference.column}'`,
			);
		}
		return;
	}

	if (reference.type === "event-join-column") {
		getEventJoinForReference(context.eventJoinMap, reference);
		if (!getEventJoinColumnPropertyDefinition(reference.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column 'event.${reference.joinKey}.@${reference.column}'`,
			);
		}
		return;
	}

	if (reference.type === "event-join-property") {
		const join = getEventJoinForReference(context.eventJoinMap, reference);
		const propertyType = getEventJoinPropertyType(join, reference.property);
		if (!propertyType) {
			throw new ViewRuntimeValidationError(
				`Property '${reference.property}' not found for event join '${join.key}'`,
			);
		}
		return;
	}

	const schema = getSchemaForReference(context.schemaMap, reference);
	const propertyType = getPropertyType(schema, reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${reference.property}' not found in schema '${reference.slug}'`,
		);
	}
};

export const validateReferenceAgainstSchemas = (
	reference: string,
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
	validBuiltins: ReadonlySet<string>,
): void => {
	validateRuntimeReferenceAgainstSchemas(
		resolveRuntimeReference(reference),
		context,
		validBuiltins,
	);
};

export const validateExpressionAgainstSchemas = (
	expression: ViewExpression,
	context: ViewRuntimeReferenceContext<
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
			if (!computedFieldMap.has(expression.reference.key)) {
				throw new ViewRuntimeValidationError(
					`Computed field '${expression.reference.key}' is not part of this runtime request`,
				);
			}

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
		expression.type === "integer"
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
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const orderedComputedFields = orderComputedFields(input.computedFields);

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

export const validateViewRuntimeReferences = (
	request: ViewRuntimeRequest,
	context: ViewRuntimeReferenceContext<
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
	context: ViewRuntimeReferenceContext<
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
		displayConfiguration.grid.badgeProperty,
		displayConfiguration.grid.subtitleProperty,
		displayConfiguration.list.imageProperty,
		displayConfiguration.list.titleProperty,
		displayConfiguration.list.badgeProperty,
		displayConfiguration.list.subtitleProperty,
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
