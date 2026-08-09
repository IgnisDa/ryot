import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type WorkflowReferenceRow = typeof schema.sandboxWorkflowReference.$inferSelect;

type SandboxWorkflowReference = Omit<WorkflowReferenceRow, "scriptId"> & {
	readonly scriptId: SandboxScriptId;
};

export class SandboxWorkflowReferenceRegistrationError extends Schema.TaggedError<SandboxWorkflowReferenceRegistrationError>()(
	"SandboxWorkflowReferenceRegistrationError",
	{
		message: Schema.String,
		reason: Schema.Literals(["plugin-inactive", "execution-conflict"]),
	},
) {}

const toReference = (row: WorkflowReferenceRow): SandboxWorkflowReference => ({
	...row,
	scriptId: SandboxScriptId.make(row.scriptId),
});

export class SandboxWorkflowReferenceRepository extends Context.Service<SandboxWorkflowReferenceRepository>()(
	"SandboxWorkflowReferenceRepository",
	{
		make: Effect.sync(() => {
			const lockIngestionShared = Effect.fn(
				"SandboxWorkflowReferenceRepository.lockIngestionShared",
			)(function* () {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.execute(
						sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
					),
				);
			});

			const registerInTransaction = Effect.fn(
				"SandboxWorkflowReferenceRepository.registerInTransaction",
			)(function* (input: {
				userId?: string;
				pluginId: string;
				executionId: string;
				contentHash: string;
				scriptId: SandboxScriptId;
			}) {
				const db = yield* Database;
				const [plugin] = yield* mapDatabaseErrors(
					db
						.select({
							slug: schema.plugin.slug,
							scope: schema.plugin.scope,
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
						.where(and(eq(schema.plugin.id, input.pluginId), eq(schema.plugin.status, "active")))
						.limit(1),
				);
				if (!plugin) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: `Plugin '${input.pluginId}' is not active`,
					});
				}
				if (plugin.scope === "user" && (!input.userId || !plugin.installationId)) {
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
				const reference = {
					pluginId: input.pluginId,
					scriptId: input.scriptId,
					executionId: input.executionId,
					contentHash: input.contentHash,
					pluginInstallationId: plugin.installationId,
				};
				const inserted = yield* mapDatabaseErrors(
					db
						.insert(schema.sandboxWorkflowReference)
						.values(reference)
						.onConflictDoNothing()
						.returning({ executionId: schema.sandboxWorkflowReference.executionId }),
				);
				if (inserted.length > 0) {
					return { status: "registered" } as const;
				}
				const [existing] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxWorkflowReference)
						.where(eq(schema.sandboxWorkflowReference.executionId, input.executionId))
						.limit(1),
				);
				if (
					existing?.pluginId === input.pluginId &&
					existing.scriptId === input.scriptId &&
					existing.contentHash === input.contentHash &&
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
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.delete(schema.sandboxWorkflowReference)
						.where(eq(schema.sandboxWorkflowReference.executionId, executionId)),
				);
			});

			const hasReferences = Effect.fn("SandboxWorkflowReferenceRepository.hasReferences")(
				function* (pluginId: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({ executionId: schema.sandboxWorkflowReference.executionId })
							.from(schema.sandboxWorkflowReference)
							.where(eq(schema.sandboxWorkflowReference.pluginId, pluginId))
							.limit(1),
					);
					return row !== undefined;
				},
			);

			const hasInstallationReferences = Effect.fn(
				"SandboxWorkflowReferenceRepository.hasInstallationReferences",
			)(function* (pluginInstallationId: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
					const db = yield* Database;
					const query = db.select().from(schema.sandboxWorkflowReference);
					const rows = yield* mapDatabaseErrors(
						pluginId ? query.where(eq(schema.sandboxWorkflowReference.pluginId, pluginId)) : query,
					);
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
