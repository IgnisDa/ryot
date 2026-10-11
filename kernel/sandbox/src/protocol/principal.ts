import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
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
import { Schema } from "effect";

export const sandboxSubjectUserId = (subject: SandboxExecutionSubject) => {
	if (subject.type === "user") {
		return subject.userId;
	}
	return subject.type === "automation-run" ? subject.executionUserId : null;
};

export const ScriptPluginRevision = Schema.Struct({
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

export type ScriptPluginRevision = Schema.Schema.Type<typeof ScriptPluginRevision>;

type PluginRevisionPin = Pick<ScriptPluginRevision, "revisionId" | "configRevisionId">;

export const sameRevisionPin = (left: PluginRevisionPin, right: PluginRevisionPin) =>
	left.revisionId === right.revisionId && left.configRevisionId === right.configRevisionId;

export const samePluginPin = (
	revision: PluginRevisionPin,
	pins: {
		readonly pluginRevisionId: string | null;
		readonly pluginConfigRevisionId: string | null;
	},
) =>
	revision.revisionId === pins.pluginRevisionId &&
	revision.configRevisionId === pins.pluginConfigRevisionId;

export const ScriptInstallationInitialization = Schema.Struct({
	activationId: Schema.String,
	installationId: Schema.String,
});
export type ScriptInstallationInitialization = typeof ScriptInstallationInitialization.Type;

export const principalOwner = (
	principal: { readonly pluginRevision: { readonly id: string } | null } | null | undefined,
) => definitionOwner(principal?.pluginRevision?.id ?? null);

export const ScriptExecutionPrincipal = Schema.Struct({
	scriptId: SandboxScriptId,
	scriptSlug: Schema.String,
	contentHash: Schema.String,
	metadata: SandboxScriptMetadata,
	subject: SandboxExecutionSubject,
	providerId: Schema.NullOr(SandboxProviderId),
	kernelScript: Schema.optional(Schema.Literal(true)),
	pluginRevision: Schema.NullOr(ScriptPluginRevision),
	initialization: Schema.optional(ScriptInstallationInitialization),
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

export type ScriptExecutionPrincipal = Schema.Schema.Type<typeof ScriptExecutionPrincipal>;

export const isUserBootstrapPrincipal = (principal: ScriptExecutionPrincipal) =>
	principal.metadata.kind === "script" &&
	principal.pluginRevision?.userBootstrapScriptSlugs.includes(principal.scriptSlug) === true;
