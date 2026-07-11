import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	source: Schema.String,
	filePath: Schema.optional(Schema.String),
	sourcePayloadKey: Schema.optional(Schema.String),
	sourcePayload: Schema.optional(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
	namedArtifactPaths: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
