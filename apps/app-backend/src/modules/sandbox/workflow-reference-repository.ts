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
				pluginSlug: string;
				executionId: string;
				contentHash: string;
				scriptId: SandboxScriptId;
			}) {
				const db = yield* Database;
				const [plugin] = yield* mapDatabaseErrors(
					db
						.select({ slug: schema.plugin.slug })
						.from(schema.plugin)
						.where(
							and(eq(schema.plugin.slug, input.pluginSlug), eq(schema.plugin.status, "active")),
						)
						.limit(1),
				);
				if (!plugin) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: `Plugin '${input.pluginSlug}' is not active`,
					});
				}
				const inserted = yield* mapDatabaseErrors(
					db
						.insert(schema.sandboxWorkflowReference)
						.values(input)
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
					existing?.pluginSlug === input.pluginSlug &&
					existing.scriptId === input.scriptId &&
					existing.contentHash === input.contentHash
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
				function* (pluginSlug: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({ executionId: schema.sandboxWorkflowReference.executionId })
							.from(schema.sandboxWorkflowReference)
							.where(eq(schema.sandboxWorkflowReference.pluginSlug, pluginSlug))
							.limit(1),
					);
					return row !== undefined;
				},
			);

			const listReferences = Effect.fn("SandboxWorkflowReferenceRepository.listReferences")(
				function* (pluginSlug?: string) {
					const db = yield* Database;
					const query = db.select().from(schema.sandboxWorkflowReference);
					const rows = yield* mapDatabaseErrors(
						pluginSlug
							? query.where(eq(schema.sandboxWorkflowReference.pluginSlug, pluginSlug))
							: query,
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
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
