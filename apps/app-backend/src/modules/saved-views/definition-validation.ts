import {
	SavedViewBadRequest,
	type SavedViewLayoutName,
	type SavedViewLayouts,
} from "@ryot/contract/modules/saved-views/schemas";
import { Effect, Match } from "effect";

import { getSavedViewValidationError } from "#modules/definition-registry/service";

type SavedViewDefinitionInput = {
	readonly layouts: SavedViewLayouts;
};

const toValidationReason = (validationError: string) => {
	const layout = Match.value(validationError).pipe(
		Match.when(
			(value) => value.startsWith("Grid layout:"),
			() => "grid" as const,
		),
		Match.when(
			(value) => value.startsWith("List layout:"),
			() => "list" as const,
		),
		Match.orElse(() => "table" as const),
	) satisfies SavedViewLayoutName;
	const detail = validationError.slice(validationError.indexOf(":") + 1).trim();
	const field = detail
		.match(/(?:mapping field '([^']+)'|^(\w+Field) must)/)
		?.slice(1)
		.find(Boolean);
	const issue = Match.value(detail).pipe(
		Match.when("must contain exactly one named query", () => "query-count" as const),
		Match.when("query must have rows output", () => "output-kind" as const),
		Match.when("query pagination must not contain a cursor", () => "cursor-pagination" as const),
		Match.when(
			"query must use explicit field selections",
			() => "explicit-fields-required" as const,
		),
		Match.when("query must not include nested results", () => "nested-results" as const),
		Match.when("must have at least one column", () => "columns-empty" as const),
		Match.when(
			(value) => value.startsWith("mapping field '"),
			() => "mapping-field-missing" as const,
		),
		Match.when(
			(value) => value.endsWith("must resolve to text"),
			() => "field-kind" as const,
		),
		Match.when(
			"entityIdField must project an entity primary key",
			() => "entity-id-source" as const,
		),
		Match.when(
			(value) => value.endsWith("must use an explicit JSON cast for AssetLocator"),
			() => "image-cast" as const,
		),
		Match.orElse(() => "query-invalid" as const),
	);
	return {
		code: "invalid-definition" as const,
		layout,
		issue,
		...(field ? { field } : {}),
	};
};

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	input: SavedViewDefinitionInput,
) {
	const validationError = getSavedViewValidationError(input);
	if (validationError) {
		return yield* new SavedViewBadRequest({ reason: toValidationReason(validationError) });
	}
	return yield* Effect.void;
});
