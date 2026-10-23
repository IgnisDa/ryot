import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	type SandboxExecutionSubject,
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
import type { WorkflowDurableCallRequest } from "@ryot-app/plugin-backend-sdk/workflow";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { PluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";
import type {
	ScriptExecutionPrincipal,
	ScriptInstallationInitialization,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import { installationExecutionGate } from "../authorization/installation-gate";

type SandboxScriptPin = Omit<ScriptExecutionPrincipal, "subject">;

const executionUser = alias(schema.user, "execution_user");

const installationUser = alias(schema.user, "installation_user");

const sandboxScriptPin = <T extends SandboxScriptPin>(pin: T) => pin;

type StoredScriptMetadata = (typeof schema.sandboxScript.$inferSelect)["metadata"];

export const isWorkflowCallTargetKind = (
	request: WorkflowDurableCallRequest,
	kind: StoredScriptMetadata["kind"],
) =>
	((request.kind === "child" || request.kind === "workflow-child") && kind === "workflow") ||
	(request.kind === "activity" && kind === "script");

export class SandboxRepository extends Context.Service<SandboxRepository>()("SandboxRepository", {
	make: Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const getScript = Effect.fn("SandboxRepository.getScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({
						id: schema.sandboxScript.id,
						metadata: schema.sandboxScript.metadata,
						providerId: schema.sandboxScript.providerId,
						contentHash: schema.sandboxScript.contentHash,
						compiledCode: schema.sandboxScript.compiledCode,
						compiledFormat: schema.sandboxScript.compiledFormat,
					})
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);

			if (!row) {
				return null;
			}
			return { ...row, id: SandboxScriptId.make(row.id) };
		});

		const isPluginScript = Effect.fn("SandboxRepository.isPluginScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ pluginId: schema.sandboxScript.pluginRevisionId })
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row?.pluginId != null;
		});

		const getScriptPin = Effect.fn("SandboxRepository.getScriptPin")(function* (
			scriptId: SandboxScriptId,
			expectedRevision?: Pick<ScriptPluginRevision, "id" | "revisionId" | "configRevisionId">,
			subject?: SandboxExecutionSubject,
			initialization?: ScriptInstallationInitialization,
		) {
			const executionUserId = subject === undefined ? null : sandboxSubjectUserId(subject);
			if (initialization && subject?.type !== "user") {
				return null;
			}
			const [row] = yield* database.run((db) =>
				db
					.select({
						id: schema.sandboxScript.id,
						accountId: executionUser.id,
						slug: schema.sandboxScript.slug,
						pluginStatus: schema.plugin.status,
						pluginOwnerId: schema.plugin.ownerId,
						kernelSlug: schema.kernelScript.slug,
						metadata: schema.sandboxScript.metadata,
						installationUserId: installationUser.id,
						configId: schema.pluginConfigRevision.id,
						pluginPackageId: schema.plugin.packageId,
						activationId: schema.plugin.activationId,
						pluginId: schema.pluginRevision.pluginId,
						accountDisabledAt: executionUser.disabledAt,
						providerId: schema.sandboxScript.providerId,
						installationId: schema.pluginInstallation.id,
						contentHash: schema.sandboxScript.contentHash,
						activeRevisionId: schema.plugin.activeRevisionId,
						providerPluginId: schema.sandboxProvider.pluginId,
						accountGeneration: executionUser.accountGeneration,
						installationDisabledAt: installationUser.disabledAt,
						installationHealth: schema.pluginInstallation.health,
						pluginRevisionId: schema.sandboxScript.pluginRevisionId,
						sandboxAuthority: schema.pluginRevision.sandboxAuthority,
						installationIsHidden: schema.pluginInstallation.isHidden,
						configOwnerUserId: schema.pluginConfigRevision.ownerUserId,
						installationIsInitialized: schema.pluginInstallation.isInitialized,
						installationUninstalledAt: schema.pluginInstallation.uninstalledAt,
						configPluginRevisionId: schema.pluginConfigRevision.pluginRevisionId,
						environmentConfigRevisionId: schema.plugin.environmentConfigRevisionId,
						sourcePresent: sql<boolean>`${schema.sandboxScript.source} is not null`,
						installationIncompatibilityReason: schema.pluginInstallation.incompatibilityReason,
						installationActiveConfigRevisionId: schema.pluginInstallation.activeConfigRevisionId,
						configPayloadPresent: sql<boolean>`${schema.pluginConfigRevision.encryptedPayload} is not null`,
						compiledHashes: sql<
							Record<string, string>
						>`coalesce((select jsonb_object_agg(s.slug, s.content_hash) from ${schema.sandboxScript} s where s.plugin_revision_id = ${schema.sandboxScript.pluginRevisionId}), '{}'::jsonb)`,
					})
					.from(schema.sandboxScript)
					.leftJoin(schema.kernelScript, eq(schema.kernelScript.scriptId, schema.sandboxScript.id))
					.leftJoin(
						schema.pluginRevision,
						eq(schema.pluginRevision.id, schema.sandboxScript.pluginRevisionId),
					)
					.leftJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
					.leftJoin(
						schema.sandboxProvider,
						eq(schema.sandboxProvider.id, schema.sandboxScript.providerId),
					)
					.leftJoin(executionUser, sql`${executionUser.id} = ${executionUserId}`)
					.leftJoin(
						schema.pluginInstallation,
						and(
							eq(schema.pluginInstallation.pluginId, schema.pluginRevision.pluginId),
							eq(
								schema.pluginInstallation.userId,
								sql`coalesce(${executionUserId}, ${schema.plugin.ownerId})`,
							),
						),
					)
					.leftJoin(installationUser, eq(installationUser.id, schema.pluginInstallation.userId))
					.leftJoin(
						schema.pluginConfigRevision,
						eq(
							schema.pluginConfigRevision.id,
							sql`coalesce(${expectedRevision?.configRevisionId ?? null}, case when ${schema.plugin.ownerId} is null then ${schema.plugin.environmentConfigRevisionId} else ${schema.pluginInstallation.activeConfigRevisionId} end)`,
						),
					)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			if (!row) {
				return null;
			}
			let accountDisabled = false;
			if (executionUserId !== null && subject !== undefined && subject.type !== "system") {
				if (
					row.accountId === null ||
					subject.accountGeneration?.userId !== executionUserId ||
					row.accountGeneration !== subject.accountGeneration.token
				) {
					return null;
				}
				accountDisabled = row.accountDisabledAt !== null;
			}
			if (row.pluginId === null) {
				if (expectedRevision || initialization || accountDisabled) {
					return null;
				}
				return row.providerId === null
					? sandboxScriptPin({
							...(row.kernelSlug === row.slug && row.sourcePresent
								? { kernelScript: true as const }
								: {}),
							providerId: null,
							scriptSlug: row.slug,
							pluginRevision: null,
							metadata: row.metadata,
							contentHash: row.contentHash,
							scriptId: SandboxScriptId.make(row.id),
						})
					: null;
			}
			const decodedAuthority = Schema.decodeUnknownOption(PluginSandboxAuthority)(
				row.sandboxAuthority,
			);
			if (Option.isNone(decodedAuthority)) {
				return null;
			}
			const authority = decodedAuthority.value;
			// A reset rebuilds the account while it stays disabled, so only its own bootstrap may run.
			const bootstrapScript =
				row.metadata.kind === "script" && authority.userBootstrapScriptSlugs.includes(row.slug);
			if (authority.packageId !== row.pluginPackageId || (accountDisabled && !bootstrapScript)) {
				return null;
			}
			if (
				expectedRevision &&
				(expectedRevision.id !== row.pluginId ||
					expectedRevision.revisionId !== row.pluginRevisionId)
			) {
				return null;
			}
			if (
				(!expectedRevision &&
					(row.pluginStatus !== "active" || row.activeRevisionId !== row.pluginRevisionId)) ||
				!row.pluginRevisionId ||
				!authority.scriptKinds[row.slug] ||
				authority.scriptKinds[row.slug] !== row.metadata.kind ||
				(row.providerId !== null && row.providerPluginId !== row.pluginId)
			) {
				return null;
			}
			const { pluginId } = row;
			const pluginScope = row.pluginOwnerId === null ? "system" : "user";
			let configRevisionId: string | undefined = expectedRevision?.configRevisionId;
			if (pluginScope === "system") {
				if (!expectedRevision) {
					configRevisionId = row.environmentConfigRevisionId ?? undefined;
				}
			}
			if (pluginScope === "user" || executionUserId !== null) {
				if (
					row.installationId === null ||
					row.installationUserId === null ||
					(pluginScope === "user" &&
						executionUserId !== null &&
						executionUserId !== row.pluginOwnerId)
				) {
					return null;
				}
				if (
					!installationExecutionGate({
						initialization,
						bootstrapScript,
						activationId: row.activationId,
						exactPin: expectedRevision !== undefined,
						installation: {
							id: row.installationId,
							health: row.installationHealth,
							isHidden: row.installationIsHidden,
							isInitialized: row.installationIsInitialized,
							uninstalledAt: row.installationUninstalledAt,
							incompatibilityReason: row.installationIncompatibilityReason,
						},
					}) ||
					(pluginScope === "user" && row.pluginStatus !== "active") ||
					(row.installationDisabledAt !== null && !bootstrapScript)
				) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: "Sandbox installation is unavailable",
						data: {
							pluginId: PluginId.make(pluginId),
							installationId: row.installationId,
							code:
								row.installationIncompatibilityReason === "package-identity-conflict"
									? "package-identity-conflict"
									: "installation-unavailable",
						},
					});
				}
				if (!expectedRevision && pluginScope === "user") {
					configRevisionId = row.installationActiveConfigRevisionId ?? undefined;
				}
			}
			if (!configRevisionId) {
				return null;
			}
			if (
				row.configId !== configRevisionId ||
				!row.configPayloadPresent ||
				row.configPluginRevisionId !== row.pluginRevisionId ||
				row.configOwnerUserId !== row.pluginOwnerId
			) {
				return null;
			}
			return sandboxScriptPin({
				...(initialization ? { initialization } : {}),
				scriptSlug: row.slug,
				metadata: row.metadata,
				contentHash: row.contentHash,
				scriptId: SandboxScriptId.make(row.id),
				providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
				pluginRevision: {
					scope: pluginScope,
					id: PluginId.make(row.pluginId),
					schemaScope: authority.schemaScope,
					compiledHashes: row.compiledHashes,
					configSchema: authority.configSchema,
					workflowScripts: authority.workflowScripts,
					packageId: PluginPackageId.make(authority.packageId),
					revisionId: PluginRevisionId.make(row.pluginRevisionId),
					userBootstrapScriptSlugs: authority.userBootstrapScriptSlugs,
					configRevisionId: PluginConfigRevisionId.make(configRevisionId),
					ownerId: row.pluginOwnerId ? UserId.make(row.pluginOwnerId) : null,
				},
			});
		});

		const resolveWorkflowCallScript = Effect.fn("SandboxRepository.resolveWorkflowCallScript")(
			function* (revision: ScriptPluginRevision | null, request: WorkflowDurableCallRequest) {
				if (
					request.kind === "host" ||
					request.kind === "sleep" ||
					((request.kind === "child" || request.kind === "workflow-child") &&
						request.args.workflowSlug.startsWith("kernel:"))
				) {
					return null;
				}
				if (!revision) {
					return null;
				}
				const scriptSlug =
					request.kind === "activity"
						? request.args.scriptSlug
						: revision.workflowScripts[request.args.workflowSlug];
				if (!scriptSlug) {
					return null;
				}
				const contentHash = revision.compiledHashes[scriptSlug];
				if (!contentHash) {
					return null;
				}
				const [target] = yield* database.run((db) =>
					db
						.select({ id: schema.sandboxScript.id, metadata: schema.sandboxScript.metadata })
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, scriptSlug),
								eq(schema.sandboxScript.pluginRevisionId, revision.revisionId),
								eq(schema.sandboxScript.contentHash, contentHash),
							),
						)
						.limit(1),
				);
				if (!target || !isWorkflowCallTargetKind(request, target.metadata.kind)) {
					return null;
				}
				return { kind: target.metadata.kind, scriptId: SandboxScriptId.make(target.id) };
			},
		);

		return { getScript, getScriptPin, isPluginScript, resolveWorkflowCallScript };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
