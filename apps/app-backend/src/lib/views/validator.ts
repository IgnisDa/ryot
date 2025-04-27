import type { ViewRuntimeRequest } from "~/modules/view-runtime/schemas";
import { ViewRuntimeValidationError } from "./errors";
import { validateFilterExpressionAgainstSchemas } from "./predicate-validator";
import {
	displayBuiltins,
	getPropertyType,
	getSchemaForReference,
	resolveRuntimeReference,
	sortFilterBuiltins,
	type ViewRuntimeSchemaLike,
} from "./reference";

type ValidationSchemaRow = ViewRuntimeSchemaLike;

export const validateReferenceAgainstSchemas = (
	reference: string,
	schemaMap: Map<string, ValidationSchemaRow>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const parsed = resolveRuntimeReference(reference);

	if (parsed.type === "top-level") {
		if (!validBuiltins.has(parsed.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported column '@${parsed.column}'`,
			);
		}
		return;
	}

	const schema = getSchemaForReference(schemaMap, parsed);
	const propertyType = getPropertyType(schema, parsed.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsed.property}' not found in schema '${parsed.slug}'`,
		);
	}
};

export const validateViewRuntimeReferences = (
	request: ViewRuntimeRequest,
	schemaMap: Map<string, ValidationSchemaRow>,
): void => {
	for (const field of request.sort.fields) {
		validateReferenceAgainstSchemas(field, schemaMap, sortFilterBuiltins);
	}

	for (const filter of request.filters) {
		validateReferenceAgainstSchemas(
			filter.field,
			schemaMap,
			sortFilterBuiltins,
		);
		validateFilterExpressionAgainstSchemas(filter, schemaMap);
	}

	if (request.layout === "table") {
		for (const column of request.displayConfiguration.columns) {
			for (const reference of column.property) {
				validateReferenceAgainstSchemas(reference, schemaMap, displayBuiltins);
			}
		}
		return;
	}

	const dc = request.displayConfiguration;
	for (const refs of [
		dc.imageProperty,
		dc.titleProperty,
		dc.badgeProperty,
		dc.subtitleProperty,
	]) {
		for (const reference of refs ?? []) {
			validateReferenceAgainstSchemas(reference, schemaMap, displayBuiltins);
		}
	}
};
