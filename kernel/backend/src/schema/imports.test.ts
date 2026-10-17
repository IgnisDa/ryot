import { expect, layer } from "@effect/vitest";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { user } from "./tables/auth";
import {
	importActivity,
	importBatch,
	importCapture,
	importIssue,
	importOutcome,
	importRun,
} from "./tables/imports";

const capture = {
	ordinal: 0,
	id: "capture",
	payload: null,
	state: "sealed",
	checkpoint: null,
	phase: "collection",
} satisfies typeof importCapture.$inferSelect.data;
const batch = {
	ordinal: 0,
	id: "batch",
	summary: [],
	state: "pending",
	captureId: capture.id,
	inputFingerprint: "batch-input",
} satisfies typeof importBatch.$inferSelect.data;
const activity = {
	wait: null,
	id: "parent",
	completed: 0,
	batchId: null,
	parentId: null,
	unit: "records",
	kind: "reading",
	exactTotal: null,
	state: "running",
	lastAdvancedAt: "2026-10-01T00:00:00.000Z",
} satisfies typeof importActivity.$inferSelect.data;
const outcome = {
	reason: null,
	receiptId: null,
	unit: "records",
	result: "skipped",
	recordKind: "entry",
	operationId: "operation",
	inputFingerprint: "operation-input",
	attribution: { sourceLabel: null, recordId: "record", sourceIdentifier: null },
} satisfies typeof importOutcome.$inferSelect.data;
const issue = {
	id: "issue",
	attribution: null,
	recordKind: "entry",
	severity: "warning",
	operationId: outcome.operationId,
	reason: { key: null, code: "provider-unavailable" },
} satisfies typeof importIssue.$inferSelect.data;
const execution = { operationIds: [], executionId: "execution", workflowName: "workflow" };

const seedRun = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	const runId = crypto.randomUUID();
	yield* session.run((db) =>
		db.insert(user).values({ id: runId, name: "Owner", email: `${runId}@example.test` }),
	);
	yield* session.run((db) =>
		db
			.insert(importRun)
			.values({ id: runId, userId: runId, source: "data-json", accountGeneration: "generation" }),
	);
	return runId;
});

layer(isolatedDatabaseLayer("ingestion_identity"))((test) => {
	test.effect("projects identities from JSON and cascades run-local references", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const runId = yield* seedRun();
			const [storedCapture] = yield* session.run((db) =>
				db.insert(importCapture).values({ runId, data: capture }).returning(),
			);
			expect(storedCapture).toEqual({
				runId,
				ordinal: 0,
				data: capture,
				id: "capture",
				phase: "collection",
			});
			const [storedBatch] = yield* session.run((db) =>
				db
					.insert(importBatch)
					.values({ runId, data: batch, ...execution })
					.returning(),
			);
			expect(storedBatch).toEqual({
				runId,
				data: batch,
				...execution,
				ordinal: 0,
				id: "batch",
				captureId: "capture",
			});
			const [parent] = yield* session.run((db) =>
				db.insert(importActivity).values({ runId, data: activity }).returning(),
			);
			expect(parent).toEqual({
				runId,
				id: "parent",
				batchId: null,
				data: activity,
				parentId: null,
			});
			const child = { ...activity, id: "child", batchId: batch.id, parentId: activity.id };
			expect(
				yield* session.run((db) =>
					db.insert(importActivity).values({ runId, data: child }).returning(),
				),
			).toEqual([{ runId, data: child, id: "child", batchId: "batch", parentId: "parent" }]);
			expect(
				yield* session.run((db) =>
					db.insert(importOutcome).values({ runId, data: outcome }).returning(),
				),
			).toEqual([{ runId, data: outcome, operationId: "operation" }]);
			expect(
				yield* session.run((db) =>
					db.insert(importIssue).values({ runId, data: issue }).returning(),
				),
			).toEqual([{ runId, data: issue, id: "issue" }]);
			yield* session.run((db) => db.delete(importRun).where(eq(importRun.id, runId)));
			for (const table of [
				importActivity,
				importCapture,
				importBatch,
				importOutcome,
				importIssue,
			]) {
				expect(
					yield* session.run((db) => db.select().from(table).where(eq(table.runId, runId))),
				).toEqual([]);
			}
		}),
	);

	test.effect("rejects absent and null required JSON identities", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const runId = yield* seedRun();
			for (const [table, data, keys] of [
				["import_activity", activity, ["id"]],
				["import_capture", capture, ["id", "phase", "ordinal"]],
				["import_batch", batch, ["id", "captureId", "ordinal"]],
				["import_outcome", outcome, ["operationId"]],
				["import_issue", issue, ["id"]],
			] as const) {
				for (const key of keys) {
					for (const value of [
						sql`${stableStringify(data)}::jsonb - ${key}`,
						sql`${stableStringify(data)}::jsonb || jsonb_build_object(${key}::text, null)`,
					]) {
						const columns =
							table === "import_batch" ? sql`, execution_id, workflow_name, operation_ids` : sql``;
						const values =
							table === "import_batch" ? sql`, 'execution', 'workflow', ARRAY[]::text[]` : sql``;
						const error = yield* Effect.flip(
							session.run((db) =>
								db.execute(sql`
							insert into ${sql.identifier(table)} (run_id, data${columns}) values (${runId}, ${value}${values})
						`),
							),
						);
						expect(error).toMatchObject({ code: "23502", _tag: "DbError" });
					}
				}
			}
		}),
	);

	test.effect("keeps ordinal uniqueness, phase, nonnegative and self-parent constraints", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const runId = yield* seedRun();
			yield* session.run((db) => db.insert(importCapture).values({ runId, data: capture }));
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db.insert(importCapture).values({ runId, data: { ...capture, id: "duplicate" } }),
					),
				),
			).toMatchObject({ code: "23505", constraint: "import_capture_ordinal_unique" });
			yield* session.run((db) =>
				db
					.insert(importCapture)
					.values({ runId, data: { ...capture, id: "application", phase: "application" } }),
			);
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db
							.insert(importCapture)
							.values({ runId, data: { ...capture, ordinal: -1, id: "negative" } }),
					),
				),
			).toMatchObject({ code: "23514", constraint: "import_capture_ordinal_check" });
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db.execute(
							sql`insert into import_capture (run_id, data) values (${runId}, ${stableStringify({ ...capture, phase: "invalid" })}::jsonb)`,
						),
					),
				),
			).toMatchObject({ code: "23514", constraint: "import_capture_phase_check" });
			yield* session.run((db) =>
				db.insert(importBatch).values({ runId, data: batch, ...execution }),
			);
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db
							.insert(importBatch)
							.values({ runId, data: { ...batch, id: "duplicate" }, ...execution }),
					),
				),
			).toMatchObject({ code: "23505", constraint: "import_batch_ordinal_unique" });
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db
							.insert(importBatch)
							.values({ runId, data: { ...batch, ordinal: -1, id: "negative" }, ...execution }),
					),
				),
			).toMatchObject({ code: "23514", constraint: "import_batch_ordinal_check" });
			expect(
				yield* Effect.flip(
					session.run((db) =>
						db
							.insert(importActivity)
							.values({ runId, data: { ...activity, parentId: activity.id } }),
					),
				),
			).toMatchObject({ code: "23514", constraint: "import_activity_parent_check" });
		}),
	);

	test.effect(
		"rejects cross-run parent, batch and capture references and cascades capture deletion",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runId = yield* seedRun();
				const otherRunId = yield* seedRun();
				yield* session.run((db) => db.insert(importCapture).values({ runId, data: capture }));
				yield* session.run((db) =>
					db.insert(importBatch).values({ runId, data: batch, ...execution }),
				);
				yield* session.run((db) => db.insert(importActivity).values({ runId, data: activity }));
				for (const data of [
					{ ...activity, id: "child", parentId: activity.id },
					{ ...activity, id: "child", batchId: batch.id },
				]) {
					expect(
						yield* Effect.flip(
							session.run((db) => db.insert(importActivity).values({ data, runId: otherRunId })),
						),
					).toMatchObject({ code: "23503" });
				}
				expect(
					yield* Effect.flip(
						session.run((db) =>
							db.insert(importBatch).values({ data: batch, runId: otherRunId, ...execution }),
						),
					),
				).toMatchObject({ code: "23503" });
				yield* session.run((db) => db.delete(importCapture).where(eq(importCapture.runId, runId)));
				expect(
					yield* session.run((db) =>
						db.select().from(importBatch).where(eq(importBatch.runId, runId)),
					),
				).toEqual([]);
			}),
	);
});
