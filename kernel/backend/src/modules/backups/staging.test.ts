import { expect, layer } from "@effect/vitest";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { count, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { BackupArchiveError } from "#modules/backups/archive/error";
import { BackupsRepository } from "#modules/backups/runs/repository";
import { BackupStaging } from "#modules/backups/staging";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import {
	backupRun,
	backupStagingRecord,
	backupStagingReference,
	backupStagingRun,
} from "#schema/tables/backups";

const stagingLayer = Layer.mergeAll(BackupStaging.layer, BackupsRepository.layer).pipe(
	Layer.provideMerge(revisionDatabaseLayer),
);

const createStage = () =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const staging = yield* BackupStaging;
		const repository = yield* BackupsRepository;
		const userId = UserId.make(yield* randomUuid);
		yield* session.run((db) =>
			db
				.insert(user)
				.values({ id: userId, name: "Backup staging test", email: `${userId}@example.test` }),
		);
		yield* Effect.addFinalizer(() =>
			session
				.run((db) => db.delete(user).where(eq(user.id, userId)))
				.pipe(Effect.asVoid, Effect.orDie),
		);
		const run = yield* repository.createRun({ userId, kind: "restore" });
		const runId = BackupRunId.make(run.id);
		yield* staging.begin(runId);
		return { runId, session, staging };
	});

layer(stagingLayer)((test) => {
	test.effect("rejects a duplicate record ID across sections in one namespace", () =>
		Effect.gen(function* () {
			const { runId, staging } = yield* createStage();
			yield* staging.putRecords(runId, "entity", "entities.ndjson", [
				{ id: "same-id", value: { title: "First" } },
			]);

			assertExitFails(
				yield* Effect.exit(
					staging.putRecords(runId, "entity", "entity-dependencies.ndjson", [
						{ id: "same-id", value: { title: "Second" } },
					]),
				),
				new BackupArchiveError({
					reason: "duplicate_record_id",
					path: "entity-dependencies.ndjson",
					message: "Duplicate record id in backup section 'entity-dependencies.ndjson'",
				}),
			);
		}),
	);

	test.effect("validates forward references and cycles after staging their records", () =>
		Effect.gen(function* () {
			const { runId, staging } = yield* createStage();
			yield* staging.addReferences(runId, [
				{ sourceId: "e1", targetId: "e2", sourceNamespace: "entity", targetNamespace: "entity" },
				{ sourceId: "e2", targetId: "e1", sourceNamespace: "entity", targetNamespace: "entity" },
			]);
			yield* staging.putRecords(runId, "entity", "entities.ndjson", [
				{ id: "e1", value: { title: "First" } },
				{ id: "e2", value: { title: "Second" } },
			]);
			yield* staging.validateReferences(runId);

			yield* staging.setMappings(runId, "entity", [
				{ id: "e1", destinationId: "destination-e1" },
				{ id: "e2", destinationId: "destination-e2" },
			]);
			expect(yield* staging.resolveMappings(runId, "entity", ["e1", "e2"])).toEqual(
				new Map([
					["e1", "destination-e1"],
					["e2", "destination-e2"],
				]),
			);

			yield* staging.addReferences(runId, [
				{
					sourceId: "e1",
					targetId: "missing",
					sourceNamespace: "entity",
					targetNamespace: "entity",
				},
			]);
			assertExitFails(
				yield* Effect.exit(staging.validateReferences(runId)),
				new BackupArchiveError({
					reason: "missing_reference_mapping",
					message: "Backup contains a reference without a staged target mapping",
				}),
			);
		}),
	);

	test.effect("pages records by uncompressed JSON byte size", () =>
		Effect.gen(function* () {
			const { runId, staging } = yield* createStage();
			const value = { payload: "x".repeat(3 * 1024 * 1024) };
			yield* staging.putRecords(
				runId,
				"entity",
				"entities.ndjson",
				["1", "2", "3"].map((id) => ({ id, value })),
			);

			const firstPage = yield* staging.listRecords(runId, "entities.ndjson");
			expect(firstPage.map(({ id }) => id)).toEqual(["1", "2"]);
			const nextPage = yield* staging.listRecords(runId, "entities.ndjson", firstPage.at(-1)?.id);
			expect(nextPage.map(({ id }) => id)).toEqual(["3"]);
		}),
	);

	test.effect("cleanup cascades to staged records and references", () =>
		Effect.gen(function* () {
			const { runId, session, staging } = yield* createStage();
			yield* staging.putRecords(runId, "entity", "entities.ndjson", [
				{ id: "e1", value: { title: "First" } },
				{ id: "e2", value: { title: "Second" } },
			]);
			yield* staging.addReferences(runId, [
				{ sourceId: "e1", targetId: "e2", sourceNamespace: "entity", targetNamespace: "entity" },
			]);

			const [recordRows, referenceRows] = yield* Effect.all([
				session.run((db) =>
					db
						.select({ count: count() })
						.from(backupStagingRecord)
						.where(eq(backupStagingRecord.runId, runId)),
				),
				session.run((db) =>
					db
						.select({ count: count() })
						.from(backupStagingReference)
						.where(eq(backupStagingReference.runId, runId)),
				),
			]);
			expect(recordRows[0]?.count).toBe(2);
			expect(referenceRows[0]?.count).toBe(1);

			yield* staging.cleanup(runId);

			const [recordsAfterCleanup, referencesAfterCleanup] = yield* Effect.all([
				session.run((db) =>
					db
						.select({ count: count() })
						.from(backupStagingRecord)
						.where(eq(backupStagingRecord.runId, runId)),
				),
				session.run((db) =>
					db
						.select({ count: count() })
						.from(backupStagingReference)
						.where(eq(backupStagingReference.runId, runId)),
				),
			]);
			expect(recordsAfterCleanup[0]?.count).toBe(0);
			expect(referencesAfterCleanup[0]?.count).toBe(0);
		}),
	);

	test.effect("recovers expired and terminal stages but keeps a live run staged", () =>
		Effect.gen(function* () {
			const expired = yield* createStage();
			const terminal = yield* createStage();
			const live = yield* createStage();

			yield* expired.session.run((db) =>
				db
					.update(backupStagingRun)
					.set({ expiresAt: new Date(0) })
					.where(eq(backupStagingRun.id, expired.runId)),
			);
			yield* terminal.session.run((db) =>
				db.update(backupRun).set({ status: "completed" }).where(eq(backupRun.id, terminal.runId)),
			);
			yield* live.staging.recoverAbandoned();

			const hasStage = (runId: BackupRunId) =>
				live.session
					.run((db) =>
						db
							.select({ id: backupStagingRun.id })
							.from(backupStagingRun)
							.where(eq(backupStagingRun.id, runId))
							.limit(1),
					)
					.pipe(Effect.map((rows) => rows.length > 0));
			expect(yield* hasStage(expired.runId)).toBe(false);
			expect(yield* hasStage(terminal.runId)).toBe(false);
			expect(yield* hasStage(live.runId)).toBe(true);
		}),
	);
});
