import type { DisplayConfiguration } from "~/modules/saved-views/schemas";
import type { ViewRuntimeRequest } from "~/modules/view-runtime/schemas";
import { ViewRuntimeValidationError } from "./errors";
import type { RuntimeRef, ViewExpression } from "./expression";
import { validateFilterExpressionAgainstSchemas } from "./predicate-validator";
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
): void => {
	if (expression.type === "literal") {
		return;
	}

	if (expression.type === "reference") {
		validateRuntimeReferenceAgainstSchemas(
			expression.reference,
			context,
			validBuiltins,
		);
		return;
	}

	for (const value of expression.values) {
		validateExpressionAgainstSchemas(value, context, validBuiltins);
	}
};

export const validateViewRuntimeReferences = (
	request: ViewRuntimeRequest,
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
): void => {
	for (const field of request.sort.fields) {
		validateReferenceAgainstSchemas(field, context, sortFilterBuiltins);
	}

	for (const filter of request.filters) {
		validateReferenceAgainstSchemas(filter.field, context, sortFilterBuiltins);
		validateFilterExpressionAgainstSchemas(filter, context);
	}

	for (const field of request.fields) {
		validateExpressionAgainstSchemas(
			field.expression,
			context,
			displayBuiltins,
		);
	}
};

export const validateSavedViewDisplayConfiguration = (
	displayConfiguration: DisplayConfiguration,
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
): void => {
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
			validateExpressionAgainstSchemas(refs, context, displayBuiltins);
		}
	}

	for (const column of displayConfiguration.table.columns) {
		validateExpressionAgainstSchemas(
			column.expression,
			context,
			displayBuiltins,
		);
	}
};
