import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Duration, Effect, Layer, Queue, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { job } from "#schema/tables/jobs";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { type JobKind, JobQueue, makeJobKind } from "./queue";
import { type JobContext, JobHandlers, JobWorkerLive, registerJobHandler } from "./worker";

const Payload = Schema.Struct({ value: Schema.String });

const testLayer = JobQueue.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("jobs")));

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

	test.effect("reclaims a running job whose lease lapsed", () =>
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
						lockedUntil: sql`now() - interval '1 second'`,
					}),
			);
			const { runs, record } = yield* recorder;
			yield* startWorker(kind, record);

			expect(yield* nextRun(runs)).toEqual({ value: "y", attempt: 2, id: "abandoned" });
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
