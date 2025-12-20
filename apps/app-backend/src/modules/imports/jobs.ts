import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	source: Schema.String,
	filePath: Schema.optional(Schema.String),
	sourcePayloadKey: Schema.optional(Schema.String),
	sourcePayload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
