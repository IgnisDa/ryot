import {
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import type {
	SandboxExecutionPrincipal,
	SandboxPluginRevision,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";

type SandboxScriptPin = Omit<SandboxExecutionPrincipal, "subject">;

const sandboxScriptPin = <T extends SandboxScriptPin>(pin: T) => pin;

const storedScriptSelection = {
	id: schema.sandboxScript.id,
	slug: schema.sandboxScript.slug,
	name: schema.sandboxScript.name,
	source: schema.sandboxScript.source,
	metadata: schema.sandboxScript.metadata,
	providerId: schema.sandboxScript.providerId,
	compiledCode: schema.sandboxScript.compiledCode,
	compiledFormat: schema.sandboxScript.compiledFormat,
};

type StoredScriptRow = Pick<
	typeof schema.sandboxScript.$inferSelect,
	"id" | "slug" | "name" | "source" | "metadata" | "providerId" | "compiledCode" | "compiledFormat"
>;

const toStoredScript = (row: StoredScriptRow) => ({ ...row, id: SandboxScriptId.make(row.id) });

export const isWorkflowCallTargetKind = (
	request: WorkflowDurableCallRequest,
	kind: StoredScriptRow["metadata"]["kind"],
) =>
	((request.kind === "child" || request.kind === "workflow-child") && kind === "workflow") ||
	(request.kind === "activity" && kind === "script");

export class SandboxRepository extends Context.Service<SandboxRepository>()("SandboxRepository", {
	make: Effect.gen(function* () {
		const environmentConfig = yield* PluginEnvironmentConfig;
		const getScript = Effect.fn("SandboxRepository.getScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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
			expectedRevision?: Pick<SandboxPluginRevision, "id" | "revisionId" | "configRevisionId">,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.sandboxScript.id,
						pluginSlug: schema.plugin.slug,
						slug: schema.sandboxScript.slug,
						pluginScope: schema.plugin.scope,
						pluginStatus: schema.plugin.status,
						pluginOwnerId: schema.plugin.ownerId,
						metadata: schema.sandboxScript.metadata,
						pluginId: schema.pluginRevision.pluginId,
						providerId: schema.sandboxScript.providerId,
						contentHash: schema.sandboxScript.contentHash,
						pluginManifest: schema.pluginRevision.manifest,
						activeRevisionId: schema.plugin.activeRevisionId,
						providerPluginId: schema.sandboxProvider.pluginId,
						pluginRevisionId: schema.sandboxScript.pluginRevisionId,
					})
					.from(schema.sandboxScript)
					.leftJoin(
						schema.pluginRevision,
						eq(schema.pluginRevision.id, schema.sandboxScript.pluginRevisionId),
					)
					.leftJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
					.leftJoin(
						schema.sandboxProvider,
						eq(schema.sandboxProvider.id, schema.sandboxScript.providerId),
					)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			if (!row) {
				return null;
			}
			if (row.pluginId === null) {
				if (expectedRevision) {
					return null;
				}
				return row.providerId === null
					? sandboxScriptPin({
							providerId: null,
							scriptSlug: row.slug,
							pluginRevision: null,
							metadata: row.metadata,
							contentHash: row.contentHash,
							scriptId: SandboxScriptId.make(row.id),
						})
					: null;
			}
			if (
				expectedRevision &&
				(expectedRevision.id !== row.pluginId ||
					expectedRevision.revisionId !== row.pluginRevisionId)
			) {
				return null;
			}
			const declaration = row.pluginManifest?.scripts.find(({ slug }) => slug === row.slug);
			if (
				(!expectedRevision &&
					(row.pluginStatus !== "active" || row.activeRevisionId !== row.pluginRevisionId)) ||
				!row.pluginSlug ||
				!row.pluginScope ||
				!row.pluginManifest ||
				!row.pluginRevisionId ||
				(row.pluginScope === "system") !== (row.pluginOwnerId === null) ||
				declaration?.kind !== row.metadata.kind ||
				(row.providerId !== null && row.providerPluginId !== row.pluginId)
			) {
				return null;
			}
			const manifest = row.pluginManifest;
			const scripts = yield* mapDatabaseErrors(
				db
					.select({
						slug: schema.sandboxScript.slug,
						contentHash: schema.sandboxScript.contentHash,
					})
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.pluginRevisionId, row.pluginRevisionId)),
			);
			let configRevisionId: string | undefined = expectedRevision?.configRevisionId;
			if (!expectedRevision) {
				if (row.pluginScope === "system") {
					configRevisionId = environmentConfig.find(row.pluginId)?.configRevisionId;
				} else {
					const [state] = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.pluginInstallation)
							.where(
								and(
									eq(schema.pluginInstallation.pluginId, row.pluginId),
									eq(schema.pluginInstallation.userId, row.pluginOwnerId ?? ""),
								),
							)
							.limit(1),
					);
					if (
						!state ||
						state.isDisabled ||
						state.uninstalledAt ||
						!["ready", "installing"].includes(state.health)
					) {
						return null;
					}
					configRevisionId = state.activeConfigRevisionId ?? undefined;
				}
			}
			if (!configRevisionId) {
				return null;
			}
			const [config] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.pluginConfigRevision)
					.where(eq(schema.pluginConfigRevision.id, configRevisionId))
					.limit(1),
			);
			if (
				!config?.encryptedPayload ||
				config.pluginRevisionId !== row.pluginRevisionId ||
				config.ownerUserId !== row.pluginOwnerId ||
				config.scope !== (row.pluginScope === "system" ? "environment" : "installation")
			) {
				return null;
			}
			return sandboxScriptPin({
				scriptSlug: row.slug,
				metadata: row.metadata,
				contentHash: row.contentHash,
				scriptId: SandboxScriptId.make(row.id),
				providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
				pluginRevision: {
					slug: row.pluginSlug,
					scope: row.pluginScope,
					id: PluginId.make(row.pluginId),
					configSchema: manifest.configSchema,
					revisionId: PluginRevisionId.make(row.pluginRevisionId),
					configRevisionId: PluginConfigRevisionId.make(configRevisionId),
					ownerId: row.pluginOwnerId ? UserId.make(row.pluginOwnerId) : null,
					compiledHashes: Object.fromEntries(
						scripts.map(({ slug, contentHash }) => [slug, contentHash]),
					),
					workflowScripts: Object.fromEntries(
						manifest.workflows.map(({ slug, scriptSlug }) => [slug, scriptSlug]),
					),
					userBootstrapScriptSlugs:
						row.pluginScope === "system"
							? manifest.userBootstrap.map(({ scriptSlug }) => scriptSlug)
							: [],
					schemaScope: {
						entitySchemaSlugs: manifest.entitySchemas.map(({ slug }) => slug),
						relationshipSchemaSlugs: manifest.relationshipSchemas.map(({ slug }) => slug),
						eventSchemas: manifest.entitySchemas.flatMap((entitySchema) =>
							entitySchema.eventSchemas.map((eventSchema) => ({
								eventSchemaSlug: eventSchema.slug,
								entitySchemaSlug: entitySchema.slug,
							})),
						),
					},
				},
			});
		});

		const resolveWorkflowCallScript = Effect.fn("SandboxRepository.resolveWorkflowCallScript")(
			function* (revision: SandboxPluginRevision | null, request: WorkflowDurableCallRequest) {
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
				const db = yield* Database;
				const [target] = yield* mapDatabaseErrors(
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

		const getStoredScript = Effect.fn("SandboxRepository.getStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select(storedScriptSelection)
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row ? toStoredScript(row) : null;
		});

		const listStoredScripts = Effect.fn("SandboxRepository.listStoredScripts")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db.select(storedScriptSelection).from(schema.sandboxScript),
			);
			return rows.map(toStoredScript);
		});

		return {
			getScript,
			getScriptPin,
			isPluginScript,
			getStoredScript,
			listStoredScripts,
			resolveWorkflowCallScript,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
