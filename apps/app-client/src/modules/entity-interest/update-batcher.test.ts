import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntityUpdateBatcher } from "./update-batcher";

const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const deferred = <T>() => {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value: T) => resolvePromise?.(value),
	};
};

const update = (entityId: string, reason: EntityUpdatedFrame["reason"]): EntityUpdatedFrame => ({
	reason,
	entityId,
});

describe("entity update batcher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses a fixed window and keeps the latest reason per entity", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdatedFrame[][] = [];
		const drains: number[] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: (updates) => {
				batches.push([...updates]);
			},
			onDrain: () => drains.push(batches.length),
		});

		batcher.push(update("entity-1", "populated"));
		batcher.push(update("entity-1", "translated"));
		await vi.advanceTimersByTimeAsync(249);
		batcher.push(update("entity-2", "populated"));
		await vi.advanceTimersByTimeAsync(1);

		expect(batches).toEqual([[update("entity-1", "translated"), update("entity-2", "populated")]]);
		expect(drains).toEqual([1]);
	});

	it("flushes at the maximum batch size", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: (updates) => {
				batches.push([...updates]);
			},
		});

		for (let index = 0; index < 25; index += 1) {
			batcher.push(update(`entity-${index}`, "populated"));
		}
		batcher.push(update("entity-25", "translated"));
		await settle();

		expect(batches[0]).toHaveLength(25);
		expect(batches[0]?.at(-1)).toEqual(update("entity-24", "populated"));

		await vi.advanceTimersByTimeAsync(250);
		expect(batches).toHaveLength(2);
		expect(batches[1]).toEqual([update("entity-25", "translated")]);
	});

	it("allows one trailing batch while keeping one batch in flight", async () => {
		vi.useFakeTimers();
		const drains: number[] = [];
		const first = deferred<void>();
		const second = deferred<void>();
		const signals: AbortSignal[] = [];
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: async (updates, signal) => {
				batches.push([...updates]);
				signals.push(signal);
				if (batches.length === 1) {
					await first.promise;
				} else {
					await second.promise;
				}
			},
			onDrain: () => drains.push(batches.length),
		});

		batcher.push(update("entity-1", "populated"));
		await vi.advanceTimersByTimeAsync(250);
		batcher.push(update("entity-2", "translated"));
		await vi.advanceTimersByTimeAsync(250);

		expect(batches).toHaveLength(1);
		first.resolve();
		await settle();

		expect(batches).toEqual([
			[update("entity-1", "populated")],
			[update("entity-2", "translated")],
		]);
		expect(drains).toEqual([]);
		expect(signals[0]).not.toBe(signals[1]);
		second.resolve();
		await settle();

		expect(drains).toEqual([2]);
	});

	it("accumulates while blocked and flushes on unblock", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdatedFrame[][] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: (updates) => {
				batches.push([...updates]);
			},
		});

		batcher.setBlocked(true);
		batcher.push(update("entity-1", "populated"));
		batcher.push(update("entity-2", "translated"));
		await vi.advanceTimersByTimeAsync(1_000);
		expect(batches).toEqual([]);

		batcher.setBlocked(false);
		await settle();

		expect(batches).toEqual([[update("entity-1", "populated"), update("entity-2", "translated")]]);
	});

	it("does not drain blocked pending updates until they flush", async () => {
		vi.useFakeTimers();
		const first = deferred<void>();
		const batches: EntityUpdatedFrame[][] = [];
		const drains: number[] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: async (updates) => {
				batches.push([...updates]);
				if (batches.length === 1) {
					await first.promise;
				}
			},
			onDrain: () => drains.push(batches.length),
		});

		batcher.push(update("entity-1", "populated"));
		await vi.advanceTimersByTimeAsync(250);
		batcher.setBlocked(true);
		batcher.push(update("entity-2", "translated"));
		first.resolve();
		await settle();

		expect(batches).toEqual([[update("entity-1", "populated")]]);
		expect(drains).toEqual([]);

		batcher.setBlocked(false);
		await settle();

		expect(batches).toEqual([
			[update("entity-1", "populated")],
			[update("entity-2", "translated")],
		]);
		expect(drains).toEqual([2]);
	});

	it("reports a failed batch once without retrying it", async () => {
		vi.useFakeTimers();
		const error = new Error("send failed");
		const errors: unknown[] = [];
		const events: string[] = [];
		let attempts = 0;
		const batcher = new EntityUpdateBatcher({
			onBatch: () => {
				attempts += 1;
				throw error;
			},
			onDrain: () => events.push("drain"),
			onError: (cause) => {
				errors.push(cause);
				events.push("error");
			},
		});

		batcher.push(update("entity-1", "populated"));
		await vi.advanceTimersByTimeAsync(250);
		await vi.advanceTimersByTimeAsync(30_000);

		expect(attempts).toBe(1);
		expect(errors).toEqual([error]);
		expect(events).toEqual(["error", "drain"]);
	});

	it("aborts an active batch and clears pending updates on disposal", async () => {
		vi.useFakeTimers();
		const first = deferred<void>();
		let signal: AbortSignal | undefined;
		const batches: EntityUpdatedFrame[][] = [];
		const drains: string[] = [];
		const batcher = new EntityUpdateBatcher({
			onBatch: async (updates, batchSignal) => {
				batches.push([...updates]);
				signal = batchSignal;
				await first.promise;
			},
			onDrain: () => drains.push("drain"),
		});

		batcher.push(update("entity-1", "populated"));
		await vi.advanceTimersByTimeAsync(250);
		batcher.push(update("entity-2", "translated"));
		batcher.dispose();
		first.resolve();
		await settle();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(signal?.aborted).toBe(true);
		expect(batches).toEqual([[update("entity-1", "populated")]]);
		expect(drains).toEqual([]);
	});
});
