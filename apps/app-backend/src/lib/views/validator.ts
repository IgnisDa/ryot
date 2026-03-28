import type { DisplayConfiguration } from "~/modules/saved-views/schemas";
import type { ViewRuntimeRequest } from "~/modules/view-runtime/schemas";
import { ViewRuntimeValidationError } from "./errors";
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

export const validateReferenceAgainstSchemas = (
	reference: string,
	context: ViewRuntimeReferenceContext<
		ValidationSchemaRow,
		ValidationEventJoinRow
	>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const parsed = resolveRuntimeReference(reference);

	if (parsed.type === "entity-column") {
		getSchemaForReference(context.schemaMap, parsed);
		if (!validBuiltins.has(parsed.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column 'entity.${parsed.slug}.@${parsed.column}'`,
			);
		}
		if (
			!getEntityColumnPropertyDefinition(parsed.column) &&
			parsed.column !== "image"
		) {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column 'entity.${parsed.slug}.@${parsed.column}'`,
			);
		}
		return;
	}

	if (parsed.type === "event-join-column") {
		getEventJoinForReference(context.eventJoinMap, parsed);
		if (!getEventJoinColumnPropertyDefinition(parsed.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column 'event.${parsed.joinKey}.@${parsed.column}'`,
			);
		}
		return;
	}

	if (parsed.type === "event-join-property") {
		const join = getEventJoinForReference(context.eventJoinMap, parsed);
		const propertyType = getEventJoinPropertyType(join, parsed.property);
		if (!propertyType) {
			throw new ViewRuntimeValidationError(
				`Property '${parsed.property}' not found for event join '${join.key}'`,
			);
		}
		return;
	}

	const schema = getSchemaForReference(context.schemaMap, parsed);
	const propertyType = getPropertyType(schema, parsed.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsed.property}' not found in schema '${parsed.slug}'`,
		);
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
		for (const reference of field.references) {
			validateReferenceAgainstSchemas(reference, context, displayBuiltins);
		}
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
		for (const reference of refs ?? []) {
			validateReferenceAgainstSchemas(reference, context, displayBuiltins);
		}
	}

	for (const column of displayConfiguration.table.columns) {
		for (const reference of column.property) {
			validateReferenceAgainstSchemas(reference, context, displayBuiltins);
		}
	}
};
