import { expect, test } from "bun:test";

import { MigrationReportDetail } from "@ryot-app/contract/modules/instance-admin/migration-report";
import {
	eventStreamId,
	StreamKeySchema,
} from "@ryot-app/kernel-backend/modules/events/stream-repository";
import { Effect, Schema, Stream } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { migrateWorkoutRecords } from "./workout-records";

const schemas = {
	eventSchema: { pluginId: "fitness", slug: "workout-set" },
	workoutEntitySchema: { slug: "workout", pluginId: "fitness" },
	exerciseEntitySchema: { slug: "exercise", pluginId: "fitness" },
};

const record = (eventId: string, overrides: Record<string, unknown> = {}) => ({
	eventId,
	setOrderKey: 0,
	properties: {},
	userId: "user-a",
	exerciseOrderKey: 0,
	outsideSession: false,
	entityId: "exercise-a",
	workoutId: "workout-a",
	workoutUserId: "user-a",
	kind: "reps_and_weight",
	exerciseId: "exercise-a",
	sessionEntityId: "workout-a",
	endedAt: "2026-10-01T11:00:00.456Z",
	confirmedAt: "2026-10-01T10:30:00.789Z",
	workoutStartedAtKey: "2026-10-01T10:00:00.123Z",
	...overrides,
});

const decodeJsonRows = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
);
const decodeWarnings = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Array(MigrationReportDetail)),
);

const makeConnection = (
	pages: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>,
	updatedCount?: number,
) => {
	const reads: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
	const streamBatches: Array<ReturnType<typeof decodeJsonRows>> = [];
	const patchBatches: Array<ReturnType<typeof decodeJsonRows>> = [];
	const warnings: Array<MigrationReportDetail> = [];
	const reports: Array<ReturnType<typeof decodeJsonRows>[number]> = [];
	const writes: Array<string> = [];
	const unexpected = Effect.die(new Error("Unexpected connection operation"));
	const connection: SqlConnection.Connection = {
		executeRaw: () => unexpected,
		executeValues: () => unexpected,
		executeUnprepared: () => unexpected,
		executeValuesUnprepared: () => unexpected,
		executeStream: () => Stream.die(new Error("Unexpected connection stream")),
		execute: (sql, params) =>
			Effect.sync(() => {
				if (sql.includes('FROM "event" ev')) {
					reads.push({ sql, params });
					return pages[reads.length - 1] ?? [];
				}
				writes.push(sql);
				if (sql.includes('INSERT INTO "event_stream"')) {
					streamBatches.push(decodeJsonRows(params[0]));
					return [];
				}
				if (sql.includes('UPDATE "event"')) {
					const patches = decodeJsonRows(params[0]);
					patchBatches.push(patches);
					return Array.from({ length: updatedCount ?? patches.length }, () => ({}));
				}
				if (sql.includes("WITH summary AS")) {
					expect(params[1]).toBe("workout-set-completion-outside-session");
					const details = decodeWarnings(params[5]);
					expect(params[3]).toBe(details.length);
					warnings.push(...details);
					return [];
				}
				if (sql.includes('INSERT INTO "migration_report"')) {
					reports.push(...decodeJsonRows(params[0]));
					return [];
				}
				throw new Error(`Unexpected SQL: ${sql}`);
			}),
	};
	return { reads, writes, reports, warnings, connection, patchBatches, streamBatches };
};

test("scans one ID cursor across batches and bulk-seeds exact distinct owner/exercise streams", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const rows = Array.from({ length: 1002 }, (_, index) =>
				record(`event-${index.toString().padStart(4, "0")}`, {
					userId: index % 2 === 0 ? "user-a" : "user-b",
					workoutUserId: index % 2 === 0 ? "user-a" : "user-b",
					kind: index % 2 === 0 ? "reps_and_weight" : "duration",
					entityId: index < 2 ? "shared-exercise" : `exercise-${index}`,
					exerciseId: index < 2 ? "shared-exercise" : `exercise-${index}`,
				}),
			);
			const pages = [rows.slice(0, 500), rows.slice(500, 1000), rows.slice(1000)];
			const harness = makeConnection(pages);
			yield* migrateWorkoutRecords(harness.connection, schemas);
			expect(harness.reads.map(({ params }) => params)).toEqual([
				["workout-set", "fitness", "workout", "fitness", "exercise", "fitness", 500],
				["workout-set", "fitness", "workout", "fitness", "exercise", "fitness", "event-0499", 500],
				["workout-set", "fitness", "workout", "fitness", "exercise", "fitness", "event-0999", 500],
				["workout-set", "fitness", "workout", "fitness", "exercise", "fitness", "event-1001", 500],
			]);
			for (const { sql } of harness.reads) {
				expect(sql).toContain('ORDER BY ev."id" COLLATE "C"');
				expect(sql).toContain('LEFT JOIN "entity" w');
				expect(sql).toContain('LEFT JOIN "entity" ex');
			}
			expect(harness.reads[1]?.sql).toContain('ev."id" COLLATE "C" > $7::text COLLATE "C"');
			expect(harness.streamBatches).toEqual(
				pages.map((page) =>
					page.map((row) => {
						const key = Schema.decodeSync(StreamKeySchema)({
							userId: row.userId,
							entityId: row.entityId,
							eventSchemaSlug: "workout-set",
							eventSchemaPluginId: "fitness",
						});
						return { ...key, id: eventStreamId(key) };
					}),
				),
			);
			expect(
				harness.writes.filter((sql) => sql.includes('INSERT INTO "event_stream"')),
			).toHaveLength(3);
			for (const sql of harness.writes) {
				if (sql.includes('INSERT INTO "event_stream"')) {
					expect(sql).toContain("ON CONFLICT DO NOTHING");
				}
			}
			expect(harness.patchBatches).toEqual([]);
			expect(harness.reports.map(({ count, message }) => ({ count, message }))).toEqual([
				{ count: 1002, message: "set event(s) examined" },
				{ count: 0, message: "set event(s) updated" },
			]);
		}),
	));

test("deduplicates streams per batch, preserves zeros/missing values and warning detail provenance", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const harness = makeConnection([
				[
					record("A", {
						outsideSession: true,
						confirmedAt: "2026-10-01T09:59:59.987Z",
						properties: {
							reps: 0,
							pace: 1,
							oneRm: 2,
							weight: 0,
							volume: 3,
							duration: 0,
							distance: 0,
							note: "keep",
							personalBests: ["weight"],
						},
					}),
					record("a", {
						properties: { duration: 1.2345, weight: 1.2345678, distance: 1.2345678915 },
					}),
				],
				[
					record("b", { outsideSession: true, confirmedAt: "2026-10-01T09:59:59.987Z" }),
					record("z", { endedAt: null }),
				],
			]);
			yield* migrateWorkoutRecords(harness.connection, schemas);
			expect(harness.streamBatches.map((batch) => batch.length)).toEqual([1, 1]);
			expect(harness.streamBatches[0]).toEqual(harness.streamBatches[1]);
			expect(harness.patchBatches).toEqual([
				[
					{ id: "A", setProperties: {}, removeKeys: ["pace", "oneRm", "volume", "personalBests"] },
					{
						id: "a",
						removeKeys: [],
						setProperties: { duration: 1.235, weight: 1.234568, distance: 1.234567892 },
					},
				],
			]);
			expect(harness.warnings).toEqual(
				Array.from({ length: 2 }, () => ({
					key: "workout-a:0:0",
					label: "Workout workout-a — exercise 0, set 0",
					sentence:
						"This set's completion timestamp falls outside the recorded workout interval. Its original completion time was kept unchanged.",
					provenance: [
						{ key: "Workout", value: "workout-a" },
						{ key: "User", value: "user-a" },
						{ value: "0", key: "Exercise order" },
						{ value: "0", key: "Set order" },
						{ key: "Confirmed at", value: "2026-10-01T09:59:59.987Z" },
						{ key: "Started at", value: "2026-10-01T10:00:00.123Z" },
						{ key: "Ended at", value: "2026-10-01T11:00:00.456Z" },
					],
				})),
			);
			for (const sql of harness.writes.filter((query) => query.includes('UPDATE "event"'))) {
				expect(sql).not.toContain("occurred_at");
				expect(sql).not.toContain("created_at");
				expect(sql).not.toContain("updated_at");
			}
		}),
	));

test.each([
	{ sessionEntityId: null },
	{ workoutId: null },
	{ workoutUserId: "other-user" },
	{ exerciseId: null },
	{ workoutStartedAtKey: null },
	{ workoutStartedAtKey: "invalid" },
	{ endedAt: "invalid" },
	{ kind: null },
	{ kind: "unsupported" },
	{ properties: { weight: null } },
	{ properties: { reps: "0" } },
])("aborts malformed record %j", (overrides) => {
	const harness = makeConnection([[record("bad-event", overrides)]]);
	return expect(
		Effect.runPromise(migrateWorkoutRecords(harness.connection, schemas)),
	).rejects.toThrow("set event bad-event for user user-a, exercise exercise-a");
});

test("aborts an incomplete patch write", () => {
	const harness = makeConnection([[record("event", { properties: { pace: 1 } })]], 0);
	return expect(
		Effect.runPromise(migrateWorkoutRecords(harness.connection, schemas)),
	).rejects.toThrow("expected to patch 1 set event(s) in one bounded batch, but updated 0");
});

test("reports an empty scan without writing streams or patches", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const harness = makeConnection([]);
			yield* migrateWorkoutRecords(harness.connection, schemas);
			expect(harness.reads).toHaveLength(1);
			expect(harness.streamBatches).toEqual([]);
			expect(harness.patchBatches).toEqual([]);
			expect(harness.warnings).toEqual([]);
			expect(harness.reports.map(({ count }) => count)).toEqual([0, 0]);
		}),
	));
