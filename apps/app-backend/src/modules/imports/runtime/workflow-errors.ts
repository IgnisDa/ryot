import { unknownToMessage } from "@ryot/contract/errors";
import { Schema } from "effect";

export class ImportRunError extends Schema.TaggedErrorClass<ImportRunError>()("ImportRunError", {
	message: Schema.String,
}) {}

export const toWorkflowError = (cause: unknown) =>
	new ImportRunError({ message: unknownToMessage(cause) });
