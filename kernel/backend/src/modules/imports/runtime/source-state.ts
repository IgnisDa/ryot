import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

export const ImportSourceState = Schema.Struct({
	source: Schema.String,
	pluginId: Schema.String,
	workflowScriptId: SandboxScriptId,
	pluginInstallationId: Schema.String,
	pluginRevision: SandboxPluginRevision,
	sourcePayload: Schema.Record(Schema.String, jsonValueSchema),
	namedArtifactPaths: Schema.Record(Schema.String, Schema.String),
});
export type ImportSourceState = typeof ImportSourceState.Type;
