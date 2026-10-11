import type { SandboxRunError } from "@ryot-app/contract/errors";
import {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import {
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Effect } from "effect";
import { Context, Schema } from "effect";

export const SandboxTrust = Schema.Literals(["system", "user"]);

export const sandboxSubjectUserId = (subject: SandboxExecutionSubject) => {
	if (subject.type === "user") {
		return subject.userId;
	}
	return subject.type === "automation-run" ? subject.executionUserId : null;
};

export const SandboxPluginRevision = Schema.Struct({
	id: PluginId,
	configSchema: AppSchema,
	packageId: PluginPackageId,
	revisionId: PluginRevisionId,
	ownerId: Schema.NullOr(UserId),
	configRevisionId: PluginConfigRevisionId,
	scope: Schema.Literals(["system", "user"]),
	userBootstrapScriptSlugs: Schema.Array(Schema.String),
	compiledHashes: Schema.Record(Schema.String, Schema.String),
	workflowScripts: Schema.Record(Schema.String, Schema.String),
	schemaScope: Schema.Struct({
		signalSchemaSlugs: Schema.Array(Schema.String),
		entitySchemaSlugs: Schema.Array(Schema.String),
		relationshipSchemaSlugs: Schema.Array(Schema.String),
		eventSchemas: Schema.Array(
			Schema.Struct({ eventSchemaSlug: Schema.String, entitySchemaSlug: Schema.String }),
		),
	}),
});

export type SandboxPluginRevision = Schema.Schema.Type<typeof SandboxPluginRevision>;

export const SandboxInstallationInitialization = Schema.Struct({
	activationId: Schema.String,
	installationId: Schema.String,
});
export type SandboxInstallationInitialization = typeof SandboxInstallationInitialization.Type;

export const SandboxExecutionPrincipal = Schema.Struct({
	scriptId: SandboxScriptId,
	scriptSlug: Schema.String,
	contentHash: Schema.String,
	metadata: SandboxScriptMetadata,
	subject: SandboxExecutionSubject,
	providerId: Schema.NullOr(SandboxProviderId),
	kernelScript: Schema.optional(Schema.Literal(true)),
	pluginRevision: Schema.NullOr(SandboxPluginRevision),
	initialization: Schema.optional(SandboxInstallationInitialization),
}).pipe(
	Schema.check(
		Schema.makeFilter((principal) => {
			const { subject, pluginRevision } = principal;
			if (
				principal.initialization &&
				(subject.type !== "user" || pluginRevision === null || principal.metadata.kind !== "script")
			) {
				return "Installation initialization requires a pinned user bootstrap script";
			}
			if (principal.kernelScript === true && pluginRevision !== null) {
				return "Kernel identity cannot accompany a plugin revision";
			}
			if (
				subject.type === "automation-run" &&
				(subject.pluginId !== (pluginRevision?.id ?? null) ||
					subject.pluginRevisionId !== (pluginRevision?.revisionId ?? null) ||
					subject.pluginConfigRevisionId !== (pluginRevision?.configRevisionId ?? null))
			) {
				return "Automation ownership must match the exact plugin and config pin";
			}
			const userId = sandboxSubjectUserId(subject);
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

export class SandboxExecutionAuthority extends Context.Service<
	SandboxExecutionAuthority,
	{
		readonly resolve: (
			principal: SandboxExecutionPrincipal,
		) => Effect.Effect<typeof SandboxTrust.Type, SandboxRunError>;
	}
>()("SandboxExecutionAuthority") {}
