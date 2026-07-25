import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	source: Schema.String,
	pluginSlug: Schema.String,
	workflowScriptId: SandboxScriptId,
	filePath: Schema.optional(Schema.String),
	sourcePayloadKey: Schema.optional(Schema.String),
	uploadIntentIds: Schema.optional(Schema.Array(Schema.String)),
	sourcePayload: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
	namedArtifactPaths: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
