import { expect, it } from "@effect/vitest";
import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";

import { EntityInterestCoordinator } from "./coordinator";

const settle = Effect.gen(function* () {
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
});

const ignoreUpdate = () => undefined;

it.effect("declares the union and removes unmounted owners", () =>
	Effect.gen(function* () {
		const declarations: string[][] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (_streamId, entityIds) =>
				Effect.sync(() => {
					declarations.push([...entityIds]);
					return [];
				}),
		});
		yield* coordinator.setInterest("a", ["entity-1", "entity-2"], ignoreUpdate);
		yield* coordinator.setInterest("b", ["entity-2", "entity-3"], ignoreUpdate);
		yield* coordinator.setConnection("stream-1");
		yield* settle;

		expect(declarations.at(-1)).toEqual(["entity-1", "entity-2", "entity-3"]);

		yield* coordinator.removeInterest("a");
		yield* settle;
		expect(declarations.at(-1)).toEqual(["entity-2", "entity-3"]);
	}),
);

it.effect("does not redeclare an unchanged owner set", () =>
	Effect.gen(function* () {
		const declarations: string[][] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (_streamId, entityIds) =>
				Effect.sync(() => {
					declarations.push([...entityIds]);
					return [];
				}),
		});
		yield* coordinator.setInterest("surface", ["entity-1", "entity-2"], ignoreUpdate);
		yield* coordinator.setConnection("stream-1");
		yield* settle;
		yield* coordinator.setInterest("surface", ["entity-2", "entity-1"], ignoreUpdate);
		yield* settle;

		expect(declarations).toEqual([["entity-1", "entity-2"]]);
	}),
);

it.effect("limits the declared union", () =>
	Effect.gen(function* () {
		const declarations: string[][] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (_streamId, entityIds) =>
				Effect.sync(() => {
					declarations.push([...entityIds]);
					return [];
				}),
		});
		yield* coordinator.setInterest(
			"surface",
			Array.from({ length: MAX_INTEREST_ENTITY_IDS + 1 }, (_, index) => `entity-${index}`),
			ignoreUpdate,
		);
		yield* coordinator.setConnection("stream-1");
		yield* settle;

		expect(declarations[0]).toHaveLength(MAX_INTEREST_ENTITY_IDS);
	}),
);

it.effect("routes terminal and stream updates through owner indexes", () =>
	Effect.gen(function* () {
		const ownerB: EntityUpdatedFrame[] = [];
		const ownerA: EntityUpdatedFrame[] = [];
		const replacement: EntityUpdatedFrame[] = [];
		const terminal = { entityId: "entity-1", reason: "populated" } as const;
		let declarationCount = 0;
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: () =>
				Effect.sync(() => {
					declarationCount += 1;
					return declarationCount === 1 ? [terminal] : [];
				}),
		});
		yield* coordinator.setInterest("a", ["entity-1"], (frame) => ownerA.push(frame));
		yield* coordinator.setInterest("b", ["entity-2"], (frame) => ownerB.push(frame));
		yield* coordinator.setConnection("stream-1");
		yield* settle;

		const second = { entityId: "entity-2", reason: "translated" } as const;
		yield* coordinator.receive(second);
		yield* coordinator.setInterest("a", ["entity-2"], (frame) => replacement.push(frame));
		yield* coordinator.receive(terminal);
		yield* coordinator.receive(second);

		expect(ownerA).toEqual([terminal]);
		expect(replacement).toEqual([second]);
		expect(ownerB).toEqual([second, second]);
	}),
);

it.effect("coalesces interest changes made during a declaration", () =>
	Effect.gen(function* () {
		const first = yield* Deferred.make<readonly EntityUpdatedFrame[]>();
		const declarations: string[][] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (_streamId, entityIds) => {
				declarations.push([...entityIds]);
				return declarations.length === 1 ? Deferred.await(first) : Effect.succeed([]);
			},
		});
		yield* coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		yield* coordinator.setConnection("stream-1");
		yield* settle;
		yield* coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		yield* Deferred.succeed(first, []);
		yield* settle;

		expect(declarations).toEqual([["entity-1"], ["entity-2"]]);
	}),
);

it.effect("retries failures with bounded exponential delays and the latest interests", () =>
	Effect.gen(function* () {
		const declarations: string[][] = [];
		const failures: Array<[number, number]> = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (_streamId, entityIds) => {
				declarations.push([...entityIds]);
				return declarations.length < 3
					? Effect.fail(new Error("declaration failed"))
					: Effect.succeed([]);
			},
			onDeclarationFailure: (_error, attempt, retryDelayMs) =>
				Effect.sync(() => failures.push([attempt, retryDelayMs])),
		});
		yield* coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		yield* coordinator.setConnection("stream-1");
		yield* settle;
		yield* coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);

		yield* TestClock.adjust("1 second");
		yield* settle;
		yield* TestClock.adjust("2 seconds");
		yield* settle;

		expect(declarations).toEqual([["entity-1"], ["entity-2"], ["entity-2"]]);
		expect(failures).toEqual([
			[1, 1_000],
			[2, 2_000],
		]);
	}),
);

it.effect("cancels stale declarations without disconnecting a newer stream", () =>
	Effect.gen(function* () {
		const declarations: string[] = [];
		const updates: EntityUpdatedFrame[] = [];
		let interruptions = 0;
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (streamId) => {
				declarations.push(streamId);
				return streamId === "stream-old"
					? Effect.never.pipe(
							Effect.onInterrupt(() => Effect.sync(() => void (interruptions += 1))),
						)
					: Effect.succeed([]);
			},
		});
		yield* coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		yield* coordinator.setConnection("stream-old");
		yield* settle;
		yield* coordinator.setConnection("stream-new");
		yield* coordinator.disconnect("stream-old");
		yield* settle;
		yield* coordinator.receive({ entityId: "entity-1", reason: "translated" });
		yield* coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		yield* settle;

		expect(interruptions).toBe(1);
		expect(declarations).toEqual(["stream-old", "stream-new", "stream-new"]);
		expect(updates).toEqual([{ entityId: "entity-1", reason: "translated" }]);
	}),
);

it.effect("routes concurrent interest changes to the replacement stream during cancellation", () =>
	Effect.gen(function* () {
		const interrupted = yield* Deferred.make<void>();
		const releaseInterrupt = yield* Deferred.make<void>();
		const declarations: Array<[string, string[]]> = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (streamId, entityIds) => {
				declarations.push([streamId, [...entityIds]]);
				return streamId === "stream-old"
					? Effect.never.pipe(
							Effect.onInterrupt(() =>
								Deferred.succeed(interrupted, undefined).pipe(
									Effect.andThen(Deferred.await(releaseInterrupt)),
								),
							),
						)
					: Effect.succeed([]);
			},
		});
		yield* coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		yield* coordinator.setConnection("stream-old");
		yield* settle;
		const replacement = yield* Effect.forkChild(coordinator.setConnection("stream-new"));
		yield* Deferred.await(interrupted);
		yield* coordinator.setInterest("surface", ["entity-2"], ignoreUpdate);
		yield* settle;
		yield* Deferred.succeed(releaseInterrupt, undefined);
		yield* Fiber.join(replacement);
		yield* settle;

		expect(declarations).toEqual([
			["stream-old", ["entity-1"]],
			["stream-new", ["entity-1"]],
			["stream-new", ["entity-2"]],
		]);
	}),
);

it.effect("cancels retry work on disconnect and can reconnect", () =>
	Effect.gen(function* () {
		const declarations: string[] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: (streamId) => {
				declarations.push(streamId);
				return streamId === "stream-1"
					? Effect.fail(new Error("declaration failed"))
					: Effect.succeed([]);
			},
		});
		yield* coordinator.setInterest("surface", ["entity-1"], ignoreUpdate);
		yield* coordinator.setConnection("stream-1");
		yield* settle;
		yield* coordinator.disconnect("stream-1");
		yield* TestClock.adjust("30 seconds");
		yield* coordinator.setConnection("stream-2");
		yield* settle;

		expect(declarations).toEqual(["stream-1", "stream-2"]);
	}),
);

it.effect("scope disposal cancels work and disables routing", () =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const updates: EntityUpdatedFrame[] = [];
		let interruptions = 0;
		const coordinator = yield* EntityInterestCoordinator.make({
			declareInterest: () =>
				Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void (interruptions += 1)))),
		}).pipe(Effect.provideService(Scope.Scope, scope));
		yield* coordinator.setInterest("surface", ["entity-1"], (frame) => updates.push(frame));
		yield* coordinator.setConnection("stream-1");
		yield* settle;
		yield* Scope.close(scope, Exit.void);
		yield* coordinator.receive({ entityId: "entity-1", reason: "translated" });
		yield* coordinator.setConnection("stream-2");

		expect(interruptions).toBe(1);
		expect(updates).toEqual([]);
	}),
);
