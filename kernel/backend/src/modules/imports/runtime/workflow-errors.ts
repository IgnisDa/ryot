import { unknownToMessage } from "@ryot-app/contract/errors";
import { Schema } from "effect";

export class ImportRunError extends Schema.TaggedError<ImportRunError>()("ImportRunError", {
	message: Schema.String,
}) {}

export const toWorkflowError = (cause: unknown) =>
	new ImportRunError({ message: unknownToMessage(cause) });
