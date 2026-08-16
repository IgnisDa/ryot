import {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import {
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Schema } from "effect";

export const SandboxPluginRevision = Schema.Struct({
	id: PluginId,
	slug: Schema.String,
	configSchema: AppSchema,
	revisionId: PluginRevisionId,
	ownerId: Schema.NullOr(UserId),
	configRevisionId: PluginConfigRevisionId,
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
}).pipe(
	Schema.check(
		Schema.makeFilter((principal) => {
			const { subject, pluginRevision } = principal;
			if (
				subject.type === "automation-run" &&
				(subject.pluginId !== (pluginRevision?.id ?? null) ||
					subject.pluginRevisionId !== (pluginRevision?.revisionId ?? null) ||
					subject.pluginConfigRevisionId !== (pluginRevision?.configRevisionId ?? null))
			) {
				return "Automation ownership must match the exact plugin and config pin";
			}
			let userId = subject.type === "user" ? subject.userId : null;
			if (subject.type === "automation-run") {
				userId = subject.executionUserId;
			}
			return (
				pluginRevision === null ||
				(pluginRevision.scope === "system"
					? pluginRevision.ownerId === null
					: pluginRevision.ownerId !== null && pluginRevision.ownerId === userId) ||
				"Plugin ownership must match the execution user"
			);
		}),
	),
);

export type SandboxExecutionPrincipal = Schema.Schema.Type<typeof SandboxExecutionPrincipal>;
