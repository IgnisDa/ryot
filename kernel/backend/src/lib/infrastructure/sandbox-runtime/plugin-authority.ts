import { SandboxScriptKind } from "@ryot-app/contract/modules/sandbox/schemas";
import { Schema } from "effect";

import { SandboxPluginRevision } from "./execution-principal";

export const PluginSandboxAuthority = Schema.Struct({
	packageId: SandboxPluginRevision.fields.packageId,
	schemaScope: SandboxPluginRevision.fields.schemaScope,
	configSchema: SandboxPluginRevision.fields.configSchema,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptKind),
	workflowScripts: SandboxPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: SandboxPluginRevision.fields.userBootstrapScriptSlugs,
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;
