import { expect, it } from "@effect/vitest";
import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { Deferred, Effect, Exit, ManagedRuntime, Scope } from "effect";
import { TestClock } from "effect/testing";

import { EntityUpdateBatcher } from "./update-batcher";

const settle = Effect.gen(function* () {
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
});

const update = (entityId: string, reason: EntityUpdatedFrame["reason"]): EntityUpdatedFrame => ({
	reason,
	entityId,
});

it.effect("uses a fixed window and keeps the latest reason per entity", () =>
	Effect.gen(function* () {
		const batches: EntityUpdatedFrame[][] = [];
		const drains: number[] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => Effect.sync(() => void batches.push([...updates])),
			onDrain: () => void drains.push(batches.length),
		});
		yield* batcher.push(update("entity-1", "populated"));
		yield* batcher.push(update("entity-1", "translated"));
		yield* TestClock.adjust("249 millis");
		yield* batcher.push(update("entity-2", "populated"));
		yield* TestClock.adjust("1 millis");
		yield* settle;

		expect(batches).toEqual([[update("entity-1", "translated"), update("entity-2", "populated")]]);
		expect(drains).toEqual([1]);
	}),
);

it.effect("flushes at the maximum batch size", () =>
	Effect.gen(function* () {
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => Effect.sync(() => void batches.push([...updates])),
		});
		for (let index = 0; index < 25; index += 1) {
			yield* batcher.push(update(`entity-${index}`, "populated"));
		}
		yield* batcher.push(update("entity-25", "translated"));
		yield* settle;

		expect(batches[0]).toHaveLength(25);
		expect(batches[0]?.at(-1)).toEqual(update("entity-24", "populated"));

		yield* TestClock.adjust("250 millis");
		yield* settle;
		expect(batches[1]).toEqual([update("entity-25", "translated")]);
	}),
);

it.effect("allows one trailing batch while keeping one batch in flight", () =>
	Effect.gen(function* () {
		const first = yield* Deferred.make<void>();
		const second = yield* Deferred.make<void>();
		const drains: number[] = [];
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => {
				batches.push([...updates]);
				return Deferred.await(batches.length === 1 ? first : second);
			},
			onDrain: () => void drains.push(batches.length),
		});
		yield* batcher.push(update("entity-1", "populated"));
		yield* TestClock.adjust("250 millis");
		yield* settle;
		yield* batcher.push(update("entity-2", "translated"));
		yield* TestClock.adjust("250 millis");
		yield* settle;

		expect(batches).toHaveLength(1);
		yield* Deferred.succeed(first, undefined);
		yield* settle;
		expect(batches).toEqual([
			[update("entity-1", "populated")],
			[update("entity-2", "translated")],
		]);
		expect(drains).toEqual([]);

		yield* Deferred.succeed(second, undefined);
		yield* settle;
		expect(drains).toEqual([2]);
	}),
);

it.effect("accumulates while blocked and flushes on unblock", () =>
	Effect.gen(function* () {
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => Effect.sync(() => void batches.push([...updates])),
		});
		yield* batcher.setBlocked(true);
		yield* batcher.push(update("entity-1", "populated"));
		yield* batcher.push(update("entity-2", "translated"));
		yield* TestClock.adjust("1 second");
		expect(batches).toEqual([]);

		yield* batcher.setBlocked(false);
		yield* settle;
		expect(batches).toEqual([[update("entity-1", "populated"), update("entity-2", "translated")]]);
	}),
);

it.effect("does not drain blocked pending updates until they flush", () =>
	Effect.gen(function* () {
		const first = yield* Deferred.make<void>();
		const batches: EntityUpdatedFrame[][] = [];
		const drains: number[] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => {
				batches.push([...updates]);
				return batches.length === 1 ? Deferred.await(first) : Effect.void;
			},
			onDrain: () => void drains.push(batches.length),
		});
		yield* batcher.push(update("entity-1", "populated"));
		yield* TestClock.adjust("250 millis");
		yield* settle;
		yield* batcher.setBlocked(true);
		yield* batcher.push(update("entity-2", "translated"));
		yield* Deferred.succeed(first, undefined);
		yield* settle;

		expect(batches).toEqual([[update("entity-1", "populated")]]);
		expect(drains).toEqual([]);

		yield* batcher.setBlocked(false);
		yield* settle;
		expect(batches).toEqual([
			[update("entity-1", "populated")],
			[update("entity-2", "translated")],
		]);
		expect(drains).toEqual([2]);
	}),
);

it.effect("reports a failed batch once without retrying it", () =>
	Effect.gen(function* () {
		const error = new Error("send failed");
		const errors: unknown[] = [];
		const events: string[] = [];
		let attempts = 0;
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: () => {
				attempts += 1;
				return Effect.fail(error);
			},
			onDrain: () => void events.push("drain"),
			onError: (cause) => {
				errors.push(cause);
				events.push("error");
			},
		});
		yield* batcher.push(update("entity-1", "populated"));
		yield* TestClock.adjust("250 millis");
		yield* settle;
		yield* TestClock.adjust("30 seconds");

		expect(attempts).toBe(1);
		expect(errors).toEqual([error]);
		expect(events).toEqual(["error", "drain"]);
	}),
);

it.effect("scope disposal interrupts the active batch and clears pending updates", () =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const interrupted = yield* Deferred.make<void>();
		const batches: EntityUpdatedFrame[][] = [];
		const drains: string[] = [];
		const batcher = yield* EntityUpdateBatcher.make({
			onBatch: (updates) => {
				batches.push([...updates]);
				return Effect.never.pipe(
					Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
				);
			},
			onDrain: () => void drains.push("drain"),
		}).pipe(Effect.provideService(Scope.Scope, scope));
		yield* batcher.push(update("entity-1", "populated"));
		yield* TestClock.adjust("250 millis");
		yield* settle;
		yield* batcher.push(update("entity-2", "translated"));
		yield* Scope.close(scope, Exit.void);
		yield* Deferred.await(interrupted);
		yield* settle;
		yield* TestClock.adjust("1 second");

		expect(batches).toEqual([[update("entity-1", "populated")]]);
		expect(drains).toEqual([]);
	}),
);

it.effect("ManagedRuntime owner replacement cannot carry pending or in-flight batches", () =>
	Effect.gen(function* () {
		const oldInterrupted = yield* Deferred.make<void>();
		const oldStarted = yield* Deferred.make<void>();
		const newDelivered = yield* Deferred.make<void>();
		const oldBatches: EntityUpdatedFrame[][] = [];
		const newBatches: EntityUpdatedFrame[][] = [];
		const oldRuntime = ManagedRuntime.make(
			EntityUpdateBatcher.layer({
				maxBatchSize: 1,
				onBatch: (updates) =>
					Effect.sync(() => void oldBatches.push([...updates])).pipe(
						Effect.andThen(Deferred.succeed(oldStarted, undefined)),
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Deferred.succeed(oldInterrupted, undefined)),
					),
			}),
		);

		yield* Effect.promise(() =>
			oldRuntime.runPromise(
				Effect.flatMap(EntityUpdateBatcher, (batcher) =>
					batcher.push(update("old-in-flight", "populated")),
				),
			),
		);
		yield* Deferred.await(oldStarted);
		yield* Effect.promise(() =>
			oldRuntime.runPromise(
				Effect.flatMap(EntityUpdateBatcher, (batcher) =>
					batcher.push(update("old-pending", "translated")),
				),
			),
		);
		yield* Effect.promise(() => oldRuntime.dispose());
		yield* Deferred.await(oldInterrupted);

		const newRuntime = ManagedRuntime.make(
			EntityUpdateBatcher.layer({
				maxBatchSize: 1,
				onBatch: (updates) =>
					Effect.sync(() => void newBatches.push([...updates])).pipe(
						Effect.andThen(Deferred.succeed(newDelivered, undefined)),
					),
			}),
		);
		yield* Effect.promise(() =>
			newRuntime.runPromise(
				Effect.flatMap(EntityUpdateBatcher, (batcher) =>
					batcher.push(update("new-owner", "populated")),
				),
			),
		);
		yield* Deferred.await(newDelivered);
		yield* Effect.promise(() => newRuntime.dispose());

		expect(oldBatches).toEqual([[update("old-in-flight", "populated")]]);
		expect(newBatches).toEqual([[update("new-owner", "populated")]]);
	}),
);
