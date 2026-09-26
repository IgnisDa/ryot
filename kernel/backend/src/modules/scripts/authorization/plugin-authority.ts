import { SandboxScriptKind } from "@ryot-app/contract/modules/sandbox/schemas";
import { ScriptPluginRevision } from "@ryot-app/sandbox/protocol/principal";
import { Schema } from "effect";

export const PluginSandboxAuthority = Schema.Struct({
	packageId: ScriptPluginRevision.fields.packageId,
	schemaScope: ScriptPluginRevision.fields.schemaScope,
	configSchema: ScriptPluginRevision.fields.configSchema,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptKind),
	workflowScripts: ScriptPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: ScriptPluginRevision.fields.userBootstrapScriptSlugs,
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;
