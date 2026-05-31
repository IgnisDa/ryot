import { describe, expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";

import { DbService, TransactionRunner, TransactionRunnerLive } from "./service";

// A fake DbService whose `transaction` mirrors Drizzle's commit-on-resolve /
// rollback-on-reject contract and records the outcome order, so we can assert
// the runner's interruption semantics without a real PostgreSQL connection.
const makeRunner = () => {
	const order: string[] = [];
	const transaction = <T>(run: (tx: unknown) => Promise<T>): Promise<T> =>
		run({}).then(
			(value) => {
				order.push("committed");
				return value;
			},
			(error) => {
				order.push("rolled-back");
				throw error;
			},
		);
	const db = Object.assign(Object.create(null), { transaction });
	const layer = TransactionRunnerLive.pipe(
		Layer.provide(Layer.succeed(DbService, { _tag: "DbService", db, pool: Object.create(null) })),
	);
	return { layer, order };
};

describe("TransactionRunner", () => {
	it.effect("commits and returns the value when the effect succeeds", () => {
		const { layer, order } = makeRunner();
		return Effect.gen(function* () {
			const runInTransaction = yield* TransactionRunner;
			const result = yield* runInTransaction(Effect.succeed(42));
			expect(result).toBe(42);
			expect(order).toEqual(["committed"]);
		}).pipe(Effect.provide(layer));
	});

	it.effect("rolls back and restores the original typed failure", () => {
		const { layer, order } = makeRunner();
		return Effect.gen(function* () {
			const runInTransaction = yield* TransactionRunner;
			const exit = yield* Effect.exit(
				runInTransaction(Effect.fail(new BadRequest({ message: "no" }))),
			);
			expect(exit).toEqual(Exit.fail(new BadRequest({ message: "no" })));
			expect(order).toEqual(["rolled-back"]);
		}).pipe(Effect.provide(layer));
	});

	it.effect("completes the transaction before honoring an interrupt of the caller", () => {
		const { layer, order } = makeRunner();
		return Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const inTransaction = yield* Deferred.make<void>();

			const transactional = Effect.gen(function* () {
				yield* Deferred.succeed(inTransaction, undefined);
				yield* Deferred.await(release);
			});

			const runInTransaction = yield* TransactionRunner;
			const fiber = yield* Effect.fork(
				runInTransaction(transactional).pipe(
					Effect.onInterrupt(() => Effect.sync(() => order.push("caller-interrupted"))),
				),
			);

			// Request interruption while the transaction is mid-flight, then let it finish.
			yield* Deferred.await(inTransaction);
			const interrupting = yield* Effect.fork(Fiber.interrupt(fiber));
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(interrupting);

			// The commit lands before the caller observes the interrupt — the transaction
			// is never abandoned in-flight.
			expect(order).toEqual(["committed", "caller-interrupted"]);
		}).pipe(Effect.provide(layer));
	});
});
