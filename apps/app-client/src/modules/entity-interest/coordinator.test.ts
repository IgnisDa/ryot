import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";
import { describe, expect, it } from "vitest";

import { EntityInterestCoordinator } from "./coordinator";

const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

const ignoreUpdate = () => undefined;

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

const controlledRetryDelay = () => {
	const delays: Array<{ delayMs: number; signal: AbortSignal; release: () => void }> = [];
	return {
		delays,
		retryDelay: (delayMs: number, signal: AbortSignal) =>
			new Promise<void>((resolve) => {
				delays.push({ delayMs, release: resolve, signal });
				signal.addEventListener("abort", () => resolve(), { once: true });
			}),
	};
};

describe("entity-interest coordinator", () => {
	it("declares the union and removes unmounted owners", async () => {
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve([]);
		});
		coordinator.setInterest("a", ["entity-1", "entity-2"], ignoreUpdate);
		coordinator.setInterest("b", ["entity-2", "entity-3"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		expect(declarations.at(-1)).toEqual(["entity-1", "entity-2", "entity-3"]);

		coordinator.removeInterest("a");
		await settle();
		expect(declarations.at(-1)).toEqual(["entity-2", "entity-3"]);
	});

	it("does not redeclare an unchanged owner set", async () => {
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve([]);
		});
		coordinator.setInterest("surface", ["entity-1", "entity-2"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		coordinator.setInterest("surface", ["entity-2", "entity-1"], ignoreUpdate);
		await settle();

		expect(declarations).toEqual([["entity-1", "entity-2"]]);
	});

	it("limits the declared union", async () => {
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve([]);
		});
		coordinator.setInterest(
			"surface",
			Array.from({ length: MAX_INTEREST_ENTITY_IDS + 1 }, (_, index) => `entity-${index}`),
			ignoreUpdate,
		);
		coordinator.setConnection("stream-1");
		await settle();

		expect(declarations[0]).toHaveLength(MAX_INTEREST_ENTITY_IDS);
	});

	it("routes updates through owner indexes", async () => {
		const ownerB: EntityUpdatedFrame[] = [];
		const ownerA: EntityUpdatedFrame[] = [];
		const ownerAReplacement: EntityUpdatedFrame[] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, _entityIds) =>
			Promise.resolve([]),
		);
		coordinator.setInterest("a", ["entity-1"], (frame) => ownerA.push(frame));
		coordinator.setInterest("b", ["entity-2"], (frame) => ownerB.push(frame));
		coordinator.setConnection("stream-1");
		await settle();

		const first = { entityId: "entity-1", reason: "populated" } as const;
		const second = { entityId: "entity-2", reason: "translated" } as const;
		coordinator.receive(first);
		coordinator.receive(second);

		expect(ownerA).toEqual([first]);
		expect(ownerB).toEqual([second]);

		coordinator.setInterest("a", ["entity-2"], (frame) => ownerAReplacement.push(frame));
		coordinator.receive(first);
		coordinator.receive(second);

		expect(ownerA).toEqual([first]);
		expect(ownerAReplacement).toEqual([second]);
		expect(ownerB).toEqual([second, second]);
	});

	it("publishes terminal and stream updates without population redeclaration", async () => {
		const declarations: string[][] = [];
		const updates: EntityUpdatedFrame[] = [];
		const terminal = { entityId: "entity-1", reason: "populated" } as const;
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve(declarations.length === 1 ? [terminal] : []);
		});
		coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		coordinator.setConnection("stream-1");
		await settle();

		expect(declarations).toHaveLength(1);
		expect(updates).toEqual([terminal]);

		coordinator.receive(terminal);
		await settle();
		expect(declarations).toHaveLength(1);
		expect(updates).toEqual([terminal, terminal]);
	});

	it("coalesces interest changes made during a declaration", async () => {
		const first = deferred<readonly EntityUpdatedFrame[]>();
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return declarations.length === 1 ? first.promise : Promise.resolve([]);
		});
		coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		first.resolve([]);
		await settle();

		expect(declarations).toEqual([["entity-1"], ["entity-2"]]);
	});

	it("retries a failed declaration with bounded exponential delays", async () => {
		const retry = controlledRetryDelay();
		const declarations: string[][] = [];
		const failures: Array<[number, number]> = [];
		const coordinator = new EntityInterestCoordinator(
			(_streamId, entityIds) => {
				declarations.push([...entityIds]);
				return declarations.length < 3
					? Promise.reject(new Error("declaration failed"))
					: Promise.resolve([]);
			},
			retry.retryDelay,
			(_error, attempt, retryDelayMs) => failures.push([attempt, retryDelayMs]),
		);
		coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		expect(retry.delays[0]?.delayMs).toBe(1_000);
		retry.delays[0]?.release();
		await settle();
		expect(retry.delays[1]?.delayMs).toBe(2_000);
		retry.delays[1]?.release();
		await settle();

		expect(declarations).toEqual([["entity-1"], ["entity-1"], ["entity-1"]]);
		expect(failures).toEqual([
			[1, 1_000],
			[2, 2_000],
		]);
	});

	it("coalesces changes while waiting to retry", async () => {
		const retry = controlledRetryDelay();
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return declarations.length === 1
				? Promise.reject(new Error("declaration failed"))
				: Promise.resolve([]);
		}, retry.retryDelay);
		coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		coordinator.setInterest("surface", ["entity-3"], ignoreUpdate);
		retry.delays[0]?.release();
		await settle();

		expect(declarations).toEqual([["entity-1"], ["entity-3"]]);
	});

	it("invalidates a declaration when the stream is replaced", async () => {
		const first = deferred<readonly EntityUpdatedFrame[]>();
		const declarations: Array<{ entityIds: string[]; signal: AbortSignal; streamId: string }> = [];
		const updates: EntityUpdatedFrame[] = [];
		const coordinator = new EntityInterestCoordinator((streamId, entityIds, signal) => {
			declarations.push({ streamId, entityIds: [...entityIds], signal });
			return declarations.length === 1 ? first.promise : Promise.resolve([]);
		});
		coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		coordinator.setConnection("stream-1");
		coordinator.setConnection("stream-2");

		expect(declarations[0]?.signal.aborted).toBe(true);
		first.resolve([{ entityId: "entity-1", reason: "populated" }]);
		await settle();

		expect(declarations.map(({ streamId }) => streamId)).toEqual(["stream-1", "stream-2"]);
		expect(updates).toEqual([]);
	});

	it("does not disconnect a newer stream when an older stream ends", async () => {
		const first = deferred<readonly EntityUpdatedFrame[]>();
		const declarations: string[] = [];
		const updates: EntityUpdatedFrame[] = [];
		const coordinator = new EntityInterestCoordinator((streamId) => {
			declarations.push(streamId);
			return declarations.length === 1 ? first.promise : Promise.resolve([]);
		});
		coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		coordinator.setConnection("stream-old");
		coordinator.setConnection("stream-new");
		coordinator.disconnect("stream-old");

		first.resolve([]);
		await settle();
		coordinator.receive({ entityId: "entity-1", reason: "translated" });
		coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		await settle();

		expect(declarations).toEqual(["stream-old", "stream-new", "stream-new"]);
		expect(updates).toEqual([{ entityId: "entity-1", reason: "translated" }]);
	});

	it("cancels retry work on disconnect", async () => {
		const retry = controlledRetryDelay();
		const declarations: string[] = [];
		const coordinator = new EntityInterestCoordinator((streamId) => {
			declarations.push(streamId);
			return Promise.reject(new Error("declaration failed"));
		}, retry.retryDelay);
		coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		coordinator.disconnect("stream-1");
		await settle();

		expect(retry.delays[0]?.signal.aborted).toBe(true);
		expect(declarations).toEqual(["stream-1"]);
	});

	it("can reconnect after disconnect", async () => {
		const declarations: string[] = [];
		const updates: EntityUpdatedFrame[] = [];
		const coordinator = new EntityInterestCoordinator((streamId) => {
			declarations.push(streamId);
			return Promise.resolve([]);
		});
		coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		coordinator.setConnection("stream-1");
		await settle();

		coordinator.setConnection(undefined);
		coordinator.setConnection("stream-2");
		await settle();
		coordinator.receive({ entityId: "entity-1", reason: "translated" });

		expect(declarations).toEqual(["stream-1", "stream-2"]);
		expect(updates).toEqual([{ entityId: "entity-1", reason: "translated" }]);
	});

	it("cancels declarations and listener emission on disposal", async () => {
		const first = deferred<readonly EntityUpdatedFrame[]>();
		const signals: AbortSignal[] = [];
		const updates: EntityUpdatedFrame[] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, _entityIds, signal) => {
			signals.push(signal);
			return first.promise;
		});
		coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		coordinator.setConnection("stream-1");
		coordinator.dispose();

		expect(signals[0]?.aborted).toBe(true);
		first.resolve([{ entityId: "entity-1", reason: "populated" }]);
		coordinator.receive({ entityId: "entity-1", reason: "translated" });
		coordinator.setConnection("stream-2");
		await settle();

		expect(signals).toHaveLength(1);
		expect(updates).toEqual([]);
	});

	it("cancels retry work on disposal", async () => {
		const retry = controlledRetryDelay();
		let declarationCount = 0;
		const coordinator = new EntityInterestCoordinator(() => {
			declarationCount += 1;
			return Promise.reject(new Error("declaration failed"));
		}, retry.retryDelay);
		coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		coordinator.setConnection("stream-1");
		await settle();

		coordinator.dispose();
		await settle();

		expect(retry.delays[0]?.signal.aborted).toBe(true);
		expect(declarationCount).toBe(1);
	});
});
