import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

type WorkflowReferenceRow = typeof schema.sandboxWorkflowReference.$inferSelect;

type SandboxWorkflowReference = Omit<WorkflowReferenceRow, "scriptId"> & {
	readonly scriptId: SandboxScriptId;
	readonly pluginId: string;
	readonly contentHash: string;
};

export class SandboxWorkflowReferenceRegistrationError extends Schema.TaggedError<SandboxWorkflowReferenceRegistrationError>()(
	"SandboxWorkflowReferenceRegistrationError",
	{
		message: Schema.String,
		reason: Schema.Literals(["plugin-inactive", "execution-conflict", "script-mismatch"]),
	},
) {}

const toReference = (
	row: WorkflowReferenceRow & { pluginId: string; contentHash: string },
): SandboxWorkflowReference => ({ ...row, scriptId: SandboxScriptId.make(row.scriptId) });

export class SandboxWorkflowReferenceRepository extends Context.Service<SandboxWorkflowReferenceRepository>()(
	"SandboxWorkflowReferenceRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const lockIngestionShared = Effect.fn(
				"SandboxWorkflowReferenceRepository.lockIngestionShared",
			)(function* () {
				yield* database.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
					),
				);
			});

			const registerInTransaction = Effect.fn(
				"SandboxWorkflowReferenceRepository.registerInTransaction",
			)(function* (input: {
				userId?: string;
				allowInactive?: boolean;
				pluginId: string;
				executionId: string;
				contentHash: string;
				scriptId: SandboxScriptId;
			}) {
				const [plugin] = yield* database.run((db) =>
					db
						.select({
							slug: schema.plugin.slug,
							ownerId: schema.plugin.ownerId,
							installationId: schema.pluginInstallation.id,
						})
						.from(schema.plugin)
						.leftJoin(
							schema.pluginInstallation,
							and(
								eq(schema.pluginInstallation.pluginId, schema.plugin.id),
								input.userId ? eq(schema.pluginInstallation.userId, input.userId) : sql`false`,
							),
						)
						.where(
							and(
								eq(schema.plugin.id, input.pluginId),
								input.allowInactive ? undefined : eq(schema.plugin.status, "active"),
							),
						)
						.limit(1),
				);
				if (!plugin) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: `Plugin '${input.pluginId}' is not active`,
					});
				}
				if (plugin.ownerId !== null && (!input.userId || !plugin.installationId)) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: `Private plugin '${input.pluginId}' requires an exact user installation`,
					});
				}
				if (input.userId && !plugin.installationId) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: `Plugin '${input.pluginId}' has no installation for user '${input.userId}'`,
					});
				}
				const [script] = yield* database.run((db) =>
					db
						.select({ id: schema.sandboxScript.id })
						.from(schema.sandboxScript)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.sandboxScript.pluginRevisionId),
						)
						.where(
							and(
								eq(schema.sandboxScript.id, input.scriptId),
								eq(schema.sandboxScript.contentHash, input.contentHash),
								eq(schema.pluginRevision.pluginId, input.pluginId),
							),
						)
						.limit(1),
				);
				if (!script) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "script-mismatch",
						message: `Script '${input.scriptId}' does not match plugin '${input.pluginId}' and its content hash`,
					});
				}
				const reference = {
					scriptId: input.scriptId,
					executionId: input.executionId,
					pluginInstallationId: plugin.installationId,
				};
				const inserted = yield* database.run((db) =>
					db
						.insert(schema.sandboxWorkflowReference)
						.values(reference)
						.onConflictDoNothing()
						.returning({ executionId: schema.sandboxWorkflowReference.executionId }),
				);
				if (inserted.length > 0) {
					return { status: "registered" } as const;
				}
				const [existing] = yield* database.run((db) =>
					db
						.select()
						.from(schema.sandboxWorkflowReference)
						.where(eq(schema.sandboxWorkflowReference.executionId, input.executionId))
						.limit(1),
				);
				if (
					existing?.scriptId === input.scriptId &&
					existing.pluginInstallationId === plugin.installationId
				) {
					return { status: "already-registered" } as const;
				}
				return yield* new SandboxWorkflowReferenceRegistrationError({
					reason: "execution-conflict",
					message: `Execution '${input.executionId}' is pinned to another script`,
				});
			});

			const release = Effect.fn("SandboxWorkflowReferenceRepository.release")(function* (
				executionId: string,
			) {
				yield* database.run((db) =>
					db
						.delete(schema.sandboxWorkflowReference)
						.where(eq(schema.sandboxWorkflowReference.executionId, executionId)),
				);
			});

			const hasReferences = Effect.fn("SandboxWorkflowReferenceRepository.hasReferences")(
				function* (pluginId: string) {
					const [row] = yield* database.run((db) =>
						db
							.select({ executionId: schema.sandboxWorkflowReference.executionId })
							.from(schema.sandboxWorkflowReference)
							.innerJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.sandboxWorkflowReference.scriptId),
							)
							.innerJoin(
								schema.pluginRevision,
								eq(schema.pluginRevision.id, schema.sandboxScript.pluginRevisionId),
							)
							.where(eq(schema.pluginRevision.pluginId, pluginId))
							.limit(1),
					);
					return row !== undefined;
				},
			);

			const hasInstallationReferences = Effect.fn(
				"SandboxWorkflowReferenceRepository.hasInstallationReferences",
			)(function* (pluginInstallationId: string) {
				const [row] = yield* database.run((db) =>
					db
						.select({ executionId: schema.sandboxWorkflowReference.executionId })
						.from(schema.sandboxWorkflowReference)
						.where(eq(schema.sandboxWorkflowReference.pluginInstallationId, pluginInstallationId))
						.limit(1),
				);
				return row !== undefined;
			});

			const listReferences = Effect.fn("SandboxWorkflowReferenceRepository.listReferences")(
				function* (pluginId?: string) {
					const rows = yield* database.run((db) => {
						const query = db
							.select({
								...getTableColumns(schema.sandboxWorkflowReference),
								pluginId: schema.pluginRevision.pluginId,
								contentHash: schema.sandboxScript.contentHash,
							})
							.from(schema.sandboxWorkflowReference)
							.innerJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.sandboxWorkflowReference.scriptId),
							)
							.innerJoin(
								schema.pluginRevision,
								eq(schema.pluginRevision.id, schema.sandboxScript.pluginRevisionId),
							);
						return pluginId ? query.where(eq(schema.pluginRevision.pluginId, pluginId)) : query;
					});
					return rows.map(toReference);
				},
			);

			return {
				release,
				hasReferences,
				listReferences,
				lockIngestionShared,
				registerInTransaction,
				hasInstallationReferences,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
