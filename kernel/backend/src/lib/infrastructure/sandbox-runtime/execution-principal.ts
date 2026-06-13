import {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Schema } from "effect";

export const SandboxPluginRevision = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	configSchema: AppSchema,
	ownerId: Schema.NullOr(UserId),
	scope: Schema.Literals(["system", "user"]),
	userBootstrapScriptSlugs: Schema.Array(Schema.String),
	compiledHashes: Schema.Record(Schema.String, Schema.String),
	workflowScripts: Schema.Record(Schema.String, Schema.String),
	schemaScope: Schema.Struct({
		entitySchemaSlugs: Schema.Array(Schema.String),
		relationshipSchemaSlugs: Schema.Array(Schema.String),
		eventSchemas: Schema.Array(
			Schema.Struct({ eventSchemaSlug: Schema.String, entitySchemaSlug: Schema.String }),
		),
	}),
});

export type SandboxPluginRevision = Schema.Schema.Type<typeof SandboxPluginRevision>;

export const SandboxExecutionPrincipal = Schema.Struct({
	scriptId: SandboxScriptId,
	scriptSlug: Schema.String,
	contentHash: Schema.String,
	metadata: SandboxScriptMetadata,
	subject: SandboxExecutionSubject,
	providerId: Schema.NullOr(SandboxProviderId),
	pluginRevision: Schema.NullOr(SandboxPluginRevision),
});

export type SandboxExecutionPrincipal = Schema.Schema.Type<typeof SandboxExecutionPrincipal>;
