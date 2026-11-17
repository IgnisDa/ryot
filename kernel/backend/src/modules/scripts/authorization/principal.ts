import { SandboxRunError } from "@ryot-app/contract/errors";
import { AuthoredAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	KERNEL_NAMESPACE,
	LocalMessage,
	type Message,
	stampNamespace,
	stampTrustedNamespace,
	TrustedLocalMessage,
} from "@ryot-app/i18n/message";
import type { SandboxPrincipal } from "@ryot-app/sandbox/host/principal";
import { Effect, Result, Schema } from "effect";

export const PluginSchemaScope = Schema.Struct({
	signalSchemaSlugs: Schema.Array(Schema.String),
	entitySchemaSlugs: Schema.Array(Schema.String),
	relationshipSchemaSlugs: Schema.Array(Schema.String),
	eventSchemas: Schema.Array(
		Schema.Struct({ eventSchemaSlug: Schema.String, entitySchemaSlug: Schema.String }),
	),
});

export type PluginSchemaScope = typeof PluginSchemaScope.Type;

// `scriptsDigest` hashes the revision's compiled script hashes, so a revision that lost scripts no
// longer matches its pins. The scripts and schema scope themselves are read by revision ID.
export const ScriptPluginRevision = Schema.Struct({
	id: PluginId,
	packageId: PluginPackageId,
	scriptsDigest: Schema.String,
	revisionId: PluginRevisionId,
	ownerId: Schema.NullOr(UserId),
	configSchema: AuthoredAppSchema,
	configRevisionId: PluginConfigRevisionId,
	scope: Schema.Literals(["system", "user"]),
	userBootstrapScriptSlugs: Schema.Array(Schema.String),
	workflowScripts: Schema.Record(Schema.String, Schema.String),
});

export type ScriptPluginRevision = Schema.Schema.Type<typeof ScriptPluginRevision>;

type PluginRevisionPin = Pick<ScriptPluginRevision, "revisionId" | "configRevisionId">;

export const sameRevisionPin = (left: PluginRevisionPin, right: PluginRevisionPin) =>
	left.revisionId === right.revisionId && left.configRevisionId === right.configRevisionId;

export const samePluginPin = (
	revision: PluginRevisionPin,
	pins: {
		readonly pluginRevisionId: null | string;
		readonly pluginConfigRevisionId: null | string;
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
	principal: null | undefined | { readonly pluginRevision: null | { readonly id: string } },
) => definitionOwner(principal?.pluginRevision?.id ?? null);

/** The catalog namespace of messages a script produces: its plugin's, or the kernel's for kernel scripts. */
export const principalMessageNamespace = (
	principal: Pick<ScriptExecutionPrincipal, "kernelScript" | "pluginRevision">,
): null | string =>
	principal.pluginRevision?.id ?? (principal.kernelScript === true ? KERNEL_NAMESPACE : null);

const invalidNotification = (error: Schema.SchemaError) =>
	`Invalid notification message: ${error.message}`;

const decodeLocalMessage = Schema.decodeUnknownResult(LocalMessage);
const decodeTrustedLocalMessage = Schema.decodeUnknownResult(TrustedLocalMessage);

/**
 * A run's message stamped with its catalog namespace. Plugin messages are always stamped with the
 * plugin's own namespace; kernel scripts may also pass messages another namespace stamped, such as
 * a provider's definition name.
 */
const stampRunMessage = (
	principal: Pick<ScriptExecutionPrincipal, "kernelScript" | "pluginRevision">,
	message: unknown,
): Result.Result<Message, string> => {
	const namespace = principalMessageNamespace(principal);
	if (namespace === null) {
		return Result.fail("sendNotification requires plugin or kernel script authority");
	}
	return principal.pluginRevision === null
		? Result.mapBoth(decodeTrustedLocalMessage(message), {
				onFailure: invalidNotification,
				onSuccess: (trusted) => stampTrustedNamespace(namespace, trusted),
			})
		: Result.mapBoth(decodeLocalMessage(message), {
				onFailure: invalidNotification,
				onSuccess: (local) => stampNamespace(namespace, local),
			});
};

/** A run's `sendNotification` call as an admission for its recipient account, stamped with the run's catalog namespace. */
export const runNotification = (
	principal: Pick<ScriptExecutionPrincipal, "subject" | "kernelScript" | "pluginRevision">,
	hostCallDiscriminator: number,
	message: unknown,
): Result.Result<
	{ message: Message; sourceKey: string; sourceRunId: string; accountUserId: UserId },
	string
> => {
	const { subject } = principal;
	if (
		subject.type !== "automation-run" ||
		subject.accountUserId === null ||
		subject.executionUserId !== subject.accountUserId
	) {
		return Result.fail("sendNotification requires a user automation run");
	}
	const { accountUserId } = subject;
	return Result.map(stampRunMessage(principal, message), (stamped) => ({
		accountUserId,
		message: stamped,
		sourceRunId: subject.runId,
		sourceKey: `${subject.runId}-host-${hostCallDiscriminator}-notification`,
	}));
};

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
				subject.type === "agent" &&
				(pluginRevision !== null || principal.kernelScript || principal.providerId !== null)
			) {
				return "Agent executions cannot own plugin or kernel authority";
			}
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

export const decodeScriptExecutionPrincipal = (principal: SandboxPrincipal) =>
	Schema.decodeUnknownEffect(ScriptExecutionPrincipal)(principal).pipe(
		Effect.mapError(
			() =>
				new SandboxRunError({
					kind: "invalid-input",
					message: "Sandbox execution principal is invalid",
				}),
		),
	);
