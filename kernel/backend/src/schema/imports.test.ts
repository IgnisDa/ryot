import { expect } from "bun:test";

import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { user } from "./tables/auth";
import { importActivity, importIssue, importItem, importRun } from "./tables/imports";

const batch = {
	ordinal: 0,
	id: "batch",
	summary: [],
	state: "pending",
	captureId: "capture",
	inputFingerprint: "batch-input",
};
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
const issue = {
	id: "issue",
	attribution: null,
	recordKind: "entry",
	severity: "warning",
	operationId: "operation",
	reason: { key: null, code: "provider-unavailable" },
} satisfies typeof importIssue.$inferSelect.data;
const seedRun = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	const runId = yield* randomUuid;
	yield* session.run((db) =>
		db.insert(user).values({ id: runId, name: "Owner", email: `${runId}@example.test` }),
	);
	yield* session.run((db) =>
		db.insert(importRun).values({ id: runId, userId: runId, source: "data-json" }),
	);
	return runId;
});

const payloadData = {
	ordinal: 0,
	state: "sealed",
	checkpoint: null,
	phase: "collection",
	stagingExecutionId: null,
	inputFingerprint: "input",
	payload: { byteSize: 1, locator: "locator", checksum: "checksum" },
};

const payloadItem = (runId: string, overrides: Record<string, unknown> = {}, id = "payload") => ({
	id,
	runId,
	kind: "payload" as const,
	data: { ...payloadData, ...overrides },
});

const batchItem = (runId: string, overrides: Record<string, unknown> = {}, id = "batch") => ({
	id,
	runId,
	kind: "batch" as const,
	operationIds: [],
	data: { ...batch, ...overrides },
});

layer(isolatedDatabaseLayer("ingestion_identity"))((test) => {
	test.effect(
		"projects item columns from their data and cascades with the run",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runId = yield* seedRun();
				const [payload] = yield* session.run((db) =>
					db.insert(importItem).values(payloadItem(runId)).returning(),
				);
				expect(payload).toMatchObject({ ordinal: 0, captureId: null, phase: "collection" });
				const [stored] = yield* session.run((db) =>
					db.insert(importItem).values(batchItem(runId)).returning(),
				);
				expect(stored).toMatchObject({ ordinal: 0, phase: null, captureId: "capture" });
				const [parent] = yield* session.run((db) =>
					db.insert(importActivity).values({ runId, data: activity }).returning(),
				);
				expect(parent).toEqual({ runId, id: "parent", data: activity, parentId: null });
				const child = { ...activity, id: "child", parentId: activity.id };
				expect(
					yield* session.run((db) =>
						db.insert(importActivity).values({ runId, data: child }).returning(),
					),
				).toEqual([{ runId, data: child, id: "child", parentId: "parent" }]);
				expect(
					yield* session.run((db) =>
						db.insert(importIssue).values({ runId, data: issue }).returning(),
					),
				).toEqual([{ runId, data: issue, id: "issue" }]);
				yield* session.run((db) => db.delete(importRun).where(eq(importRun.id, runId)));
				for (const table of [importActivity, importItem, importIssue]) {
					expect(
						yield* session.run((db) => db.select().from(table).where(eq(table.runId, runId))),
					).toEqual([]);
				}
			}),
		testTimeout,
	);

	test.effect(
		"rejects absent and null required JSON identities",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runId = yield* seedRun();
				for (const [table, data, key] of [
					["import_activity", activity, "id"],
					["import_issue", issue, "id"],
				] as const) {
					for (const value of [
						sql`${stableStringify(data)}::jsonb - ${key}`,
						sql`${stableStringify(data)}::jsonb || jsonb_build_object(${key}::text, null)`,
					]) {
						const error = yield* Effect.flip(
							session.run((db) =>
								db.execute(
									sql`insert into ${sql.identifier(table)} (run_id, data) values (${runId}, ${value})`,
								),
							),
						);
						expect(error).toMatchObject({ code: "23502", _tag: "DbError" });
					}
				}
			}),
		testTimeout,
	);

	test.effect(
		"keeps per-kind ordinals unique and enforces phase, ordinal, batch and staging constraints",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runId = yield* seedRun();
				const rejected = (values: typeof importItem.$inferInsert) =>
					Effect.flip(session.run((db) => db.insert(importItem).values(values)));
				yield* session.run((db) => db.insert(importItem).values(payloadItem(runId)));
				expect(yield* rejected(payloadItem(runId, {}, "duplicate"))).toMatchObject({
					code: "23505",
					constraint: "import_item_payload_ordinal_unique",
				});
				yield* session.run((db) =>
					db.insert(importItem).values(payloadItem(runId, { phase: "application" }, "application")),
				);
				expect(yield* rejected(payloadItem(runId, { ordinal: -1 }, "negative"))).toMatchObject({
					code: "23514",
					constraint: "import_item_ordinal_check",
				});
				expect(yield* rejected(payloadItem(runId, { phase: "invalid" }, "phase"))).toMatchObject({
					code: "23514",
					constraint: "import_item_phase_check",
				});
				expect(
					yield* rejected(payloadItem(runId, { ordinal: null }, "unstaged")),
				).toMatchObject({ code: "23514", constraint: "import_item_staging_check" });
				expect(
					yield* rejected(payloadItem(runId, { ordinal: 9, stagingExecutionId: "s" }, "both")),
				).toMatchObject({ code: "23514", constraint: "import_item_staging_check" });
				yield* session.run((db) =>
					db
						.insert(importItem)
						.values(payloadItem(runId, { ordinal: null, stagingExecutionId: "s" }, "staged")),
				);
				yield* session.run((db) => db.insert(importItem).values(batchItem(runId)));
				expect(yield* rejected(batchItem(runId, {}, "duplicate"))).toMatchObject({
					code: "23505",
					constraint: "import_item_batch_ordinal_unique",
				});
				expect(yield* rejected(batchItem(runId, { ordinal: 2, captureId: null }, "no-capture"))).toMatchObject({
					code: "23514",
					constraint: "import_item_batch_check",
				});
				expect(
					yield* Effect.flip(
						session.run((db) =>
							db.insert(importActivity).values({ runId, data: { ...activity, parentId: activity.id } }),
						),
					),
				).toMatchObject({ code: "23514", constraint: "import_activity_parent_check" });
			}),
		testTimeout,
	);

	test.effect(
		"rejects cross-run activity parents",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runId = yield* seedRun();
				const otherRunId = yield* seedRun();
				yield* session.run((db) => db.insert(importActivity).values({ runId, data: activity }));
				expect(
					yield* Effect.flip(
						session.run((db) =>
							db.insert(importActivity).values({
								runId: otherRunId,
								data: { ...activity, id: "child", parentId: activity.id },
							}),
						),
					),
				).toMatchObject({ code: "23503" });
			}),
		testTimeout,
	);
});
