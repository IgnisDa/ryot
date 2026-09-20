import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { configValuesSchema, integrationRecordSchema } from "@ryot-app/sandbox-sdk/core";
import { Schema } from "effect";

import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

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
	pluginRevision: SandboxPluginRevision,
	executionSettings: ImportSourceExecutionSettings,
	sourcePayload: Schema.Record(Schema.String, jsonValueSchema),
	namedArtifactPaths: Schema.Record(Schema.String, Schema.String),
});
export type ImportSourceState = typeof ImportSourceState.Type;
