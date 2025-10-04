import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	runId: Schema.String,
	userId: Schema.String,
	source: Schema.String,
	filePath: Schema.optional(Schema.String),
	sourcePayloadKey: Schema.optional(Schema.String),
	sourcePayload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
