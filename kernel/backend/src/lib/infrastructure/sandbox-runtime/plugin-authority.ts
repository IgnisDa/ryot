import { SandboxScriptMetadata } from "@ryot-app/contract/modules/sandbox/schemas";
import { Schema } from "effect";

import { SandboxPluginRevision } from "./execution-principal";

export const PluginSandboxAuthority = Schema.Struct({
	schemaScope: SandboxPluginRevision.fields.schemaScope,
	configSchema: SandboxPluginRevision.fields.configSchema,
	workflowScripts: SandboxPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: SandboxPluginRevision.fields.userBootstrapScriptSlugs,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptMetadata.fields.kind.schema.members[0]),
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;
