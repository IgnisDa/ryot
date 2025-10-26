import { Schema } from "effect";

import { ImportRunId, UserId } from "#lib/schema/brands";

export const ImportRunJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	source: Schema.String,
	filePath: Schema.optional(Schema.String),
	sourcePayloadKey: Schema.optional(Schema.String),
	sourcePayload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
