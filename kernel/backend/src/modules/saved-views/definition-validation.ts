import {
	SavedViewBadRequest,
	type SavedViewLayouts,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { Effect } from "effect";

import { validateSavedViewLayouts } from "#modules/definition-registry/service";

type SavedViewDefinitionInput = {
	readonly layouts: SavedViewLayouts;
};

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	input: SavedViewDefinitionInput,
) {
	const validationIssue = validateSavedViewLayouts(input);
	if (validationIssue) {
		return yield* new SavedViewBadRequest({
			reason: {
				code: "invalid-definition",
				issue: validationIssue.issue,
				layout: validationIssue.layout,
				...(validationIssue.field === undefined ? {} : { field: validationIssue.field }),
			},
		});
	}
	return yield* Effect.void;
});
