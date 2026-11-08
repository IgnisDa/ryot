import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Duration, Effect, Layer, Queue, Schema } from "effect";

import { Broadcast } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { job } from "#schema/tables/jobs";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { type JobKind, JobQueue, makeJobKind } from "./queue";
import { type JobContext, JobHandlers, JobWorkerLive, registerJobHandler } from "./worker";

const Payload = Schema.Struct({ value: Schema.String });

const testLayer = Layer.mergeAll(JobQueue.layer, Layer.effect(Broadcast, Broadcast.make)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("jobs")),
);

type Run = JobContext & { readonly value: string };

const startWorker = <E>(
	kind: JobKind<typeof Payload>,
	run: (payload: typeof Payload.Type, context: JobContext) => Effect.Effect<void, E>,
) =>
	Layer.build(
		JobWorkerLive.pipe(
			Layer.provide(registerJobHandler(kind, run)),
			Layer.provide(JobHandlers.layer),
		),
	);

const recorder = Effect.map(Queue.unbounded<Run>(), (runs) => ({
	runs,
	record: (payload: typeof Payload.Type, context: JobContext) =>
		Queue.offer(runs, { ...payload, ...context }),
}));

const nextRun = (runs: Queue.Queue<Run>) =>
	Queue.take(runs).pipe(Effect.timeout(Duration.seconds(10)));

const rowsOf = (kind: JobKind<typeof Payload>) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		return yield* session.run((db) => db.select().from(job).where(eq(job.kind, kind.name)));
	});

layer(testLayer, { excludeTestServices: true })((test) => {
	test.effect("runs a job queued inside a transaction once it commits, then deletes it", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("committed", { payload: Payload });
			const session = yield* DatabaseSession;
			const queue = yield* JobQueue;
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, record);

			yield* session.transaction(queue.enqueue(kind, { value: "a" }));

			const run = yield* nextRun(runs);
			expect(run).toMatchObject({ value: "a", attempt: 1 });
			yield* Effect.sleep(Duration.millis(200));
			expect(yield* rowsOf(kind)).toEqual([]);
		}),
	);

	test.effect("carries a NUL character in a job payload", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("nul-payload", { payload: Payload });
			const queue = yield* JobQueue;
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, record);

			yield* queue.enqueue(kind, { value: "a\u0000b" });

			expect((yield* nextRun(runs)).value).toBe("a\u0000b");
		}),
	);

	test.effect("queues a job under an explicit ID once however often it is asked", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("explicit-id", { payload: Payload });
			const queue = yield* JobQueue;

			expect(yield* queue.enqueue(kind, { value: "first" }, { id: "explicit" })).toBe(true);
			expect(yield* queue.enqueue(kind, { value: "again" }, { id: "explicit" })).toBe(false);

			expect((yield* rowsOf(kind)).map((row) => row.payload)).toEqual([{ value: "first" }]);
		}),
	);

	test.effect("coalesces queued jobs that share a key", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("coalesced", { payload: Payload });
			const queue = yield* JobQueue;

			expect(yield* queue.enqueue(kind, { value: "first" }, { key: "k" })).toBe(true);
			expect(yield* queue.enqueue(kind, { value: "second" }, { key: "k" })).toBe(false);
			expect(yield* queue.enqueue(kind, { value: "other" }, { key: "other" })).toBe(true);

			const rows = yield* rowsOf(kind);
			expect(rows).toHaveLength(2);
			expect(rows.map((row) => row.payload)).toContainEqual({ value: "first" });
			expect(rows.map((row) => row.payload)).toContainEqual({ value: "other" });
		}),
	);

	test.effect(
		"retries a failing job with backoff and keeps it as failed after its last attempt",
		() =>
			Effect.gen(function* () {
				const kind = makeJobKind("failing", {
					maxAttempts: 2,
					payload: Payload,
					backoff: Duration.millis(50),
				});
				const queue = yield* JobQueue;
				const { runs, record } = yield* recorder;
				yield* startWorker(kind, (payload, context) =>
					record(payload, context).pipe(Effect.andThen(Effect.fail("boom"))),
				);

				yield* queue.enqueue(kind, { value: "x" });

				expect((yield* nextRun(runs)).attempt).toBe(1);
				expect((yield* nextRun(runs)).attempt).toBe(2);
				yield* Effect.sleep(Duration.millis(300));
				const [row] = yield* rowsOf(kind);
				assert(row !== undefined);
				expect(row.status).toBe("failed");
				expect(row.attempts).toBe(2);
				expect(row.error).toContain("boom");
				expect(yield* Queue.size(runs)).toBe(0);
			}),
	);

	test.effect("drops a failed job when another is already queued under its key", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("superseded", { payload: Payload, backoff: Duration.millis(50) });
			const queue = yield* JobQueue;
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, (payload, context) =>
				record(payload, context).pipe(
					Effect.andThen(
						payload.value === "first"
							? queue
									.enqueue(kind, { value: "second" }, { key: "same" })
									.pipe(Effect.andThen(Effect.fail("boom")))
							: Effect.void,
					),
				),
			);

			yield* queue.enqueue(kind, { value: "first" }, { key: "same" });

			expect((yield* nextRun(runs)).value).toBe("first");
			expect((yield* nextRun(runs)).value).toBe("second");
			yield* Effect.sleep(Duration.millis(300));
			expect(yield* rowsOf(kind)).toEqual([]);
			expect(yield* Queue.size(runs)).toBe(0);
		}),
	);

	test.effect("recovers an interrupted job at startup", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("abandoned", { payload: Payload });
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(job)
					.values({
						attempts: 1,
						priority: 0,
						maxAttempts: 5,
						id: "abandoned",
						kind: kind.name,
						status: "running",
						payload: { value: "y" },
					}),
			);
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, record);

			expect(yield* nextRun(runs)).toEqual({ value: "y", attempt: 2, id: "abandoned" });
		}),
	);

	test.effect("startup keeps the newer keyed job and fails an exhausted attempt", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("startup-settlement", { payload: Payload });
			const session = yield* DatabaseSession;
			const queue = yield* JobQueue;
			yield* session.run((db) =>
				db.insert(job).values([
					{
						priority: 0,
						key: "same",
						attempts: 1,
						maxAttempts: 5,
						kind: kind.name,
						status: "running",
						payload: { value: "old" },
						id: "superseded-at-startup",
					},
					{
						priority: 0,
						attempts: 5,
						maxAttempts: 5,
						kind: kind.name,
						status: "running",
						id: "exhausted-at-startup",
						payload: { value: "exhausted" },
					},
				]),
			);
			yield* queue.enqueue(kind, { value: "new" }, { key: "same" });
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, (payload, context) =>
				record(payload, context).pipe(Effect.andThen(Effect.never)),
			);
			expect((yield* nextRun(runs)).value).toBe("new");
			const rows = yield* rowsOf(kind);
			expect(rows).toHaveLength(2);
			expect(rows.find((row) => row.id === "exhausted-at-startup")).toMatchObject({
				attempts: 5,
				status: "failed",
			});
			expect(yield* Queue.size(runs)).toBe(0);
		}),
	);

	test.effect("graceful shutdown requeues unfinished work without spending an attempt", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("shutdown", { payload: Payload });
			const queue = yield* JobQueue;
			const { runs, record } = yield* recorder;
			yield* queue.enqueue(kind, { value: "unfinished" });
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* startWorker(kind, (payload, context) =>
						record(payload, context).pipe(Effect.andThen(Effect.never)),
					);
					expect((yield* nextRun(runs)).attempt).toBe(1);
				}),
			);
			expect(yield* rowsOf(kind)).toMatchObject([{ attempts: 0, status: "queued" }]);
			yield* startWorker(kind, record);
			expect((yield* nextRun(runs)).attempt).toBe(1);
		}),
	);

	test.effect("runs no more jobs of a kind at once than its concurrency", () =>
		Effect.gen(function* () {
			const kind = makeJobKind("serial", { concurrency: 1, payload: Payload });
			const queue = yield* JobQueue;
			let active = 0;
			let peak = 0;
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, (payload, context) =>
				Effect.gen(function* () {
					active += 1;
					peak = Math.max(peak, active);
					yield* Effect.sleep(Duration.millis(50));
					active -= 1;
					yield* record(payload, context);
				}),
			);

			yield* queue.enqueue(kind, { value: "1" });
			yield* queue.enqueue(kind, { value: "2" });
			yield* queue.enqueue(kind, { value: "3" });

			yield* nextRun(runs);
			yield* nextRun(runs);
			yield* nextRun(runs);
			expect(peak).toBe(1);
		}),
	);
});
