import { unknownToMessage } from "@ryot-app/contract/errors";
import { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { Schema } from "effect";

import { IngestionPayloadError } from "#modules/uploads/object-storage/ingestion-payloads";

export class ImportRunError extends Schema.TaggedError<ImportRunError>()("ImportRunError", {
	message: Schema.String,
	reason: Schema.optional(ImportRunFailureReason),
}) {}

export const toWorkflowError = (cause: unknown) =>
	cause instanceof ImportRunError
		? cause
		: new ImportRunError({
				message: unknownToMessage(cause),
				...(cause instanceof IngestionPayloadError
					? {
							reason: {
								code:
									cause.kind === "unavailable"
										? ("captured-input-unavailable" as const)
										: ("captured-input-corrupt" as const),
							},
						}
					: {}),
			});
