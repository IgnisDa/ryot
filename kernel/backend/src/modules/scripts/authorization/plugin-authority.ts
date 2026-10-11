import { SandboxScriptKind } from "@ryot-app/contract/modules/scripts/schemas";
import { Schema } from "effect";

import { ScriptPluginRevision } from "./principal";

export const PluginSandboxAuthority = Schema.Struct({
	packageId: ScriptPluginRevision.fields.packageId,
	schemaScope: ScriptPluginRevision.fields.schemaScope,
	configSchema: ScriptPluginRevision.fields.configSchema,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptKind),
	workflowScripts: ScriptPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: ScriptPluginRevision.fields.userBootstrapScriptSlugs,
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;
