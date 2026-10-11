import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { configValuesSchema, integrationRecordSchema } from "@ryot-app/plugin-backend-sdk/core";
import { ScriptPluginRevision } from "@ryot-app/sandbox/protocol/principal";
import { Schema } from "effect";

export const ImportIntegrationExecutionSettings = Schema.Struct({
	syncOwnership: integrationRecordSchema.fields.syncOwnership,
	minimumProgress: integrationRecordSchema.fields.minimumProgress,
	maximumProgress: integrationRecordSchema.fields.maximumProgress,
	providerSpecifics: integrationRecordSchema.fields.providerSpecifics,
});

export const ImportSourceExecutionSettings = Schema.Struct({
	userSettings: configValuesSchema,
	integration: Schema.optional(ImportIntegrationExecutionSettings),
});
export type ImportSourceExecutionSettings = typeof ImportSourceExecutionSettings.Type;

export const ImportSourceState = Schema.Struct({
	source: Schema.String,
	pluginId: Schema.String,
	workflowScriptId: SandboxScriptId,
	pluginInstallationId: Schema.String,
	pluginRevision: ScriptPluginRevision,
	executionSettings: ImportSourceExecutionSettings,
	sourcePayload: Schema.Record(Schema.String, JsonValue),
	namedArtifactPaths: Schema.Record(Schema.String, Schema.String),
});
export type ImportSourceState = typeof ImportSourceState.Type;
