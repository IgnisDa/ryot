import { badRequest } from "@ryot/contract/errors";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { Effect } from "effect";

import { getSavedViewValidationError } from "#modules/definition-registry/service";

export { getSavedViewValidationError } from "#modules/definition-registry/service";

type SavedViewDefinitionInput = {
	readonly layouts: SavedViewLayouts;
};

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	input: SavedViewDefinitionInput,
) {
	const validationError = getSavedViewValidationError(input);
	if (validationError) {
		return yield* badRequest(validationError);
	}
	return yield* Effect.void;
});
