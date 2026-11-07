import { afterEach, describe, expect } from "bun:test";

import type {
	LiveUpdateFrame,
	PopulateEntitiesBody,
} from "@ryot-app/contract/modules/live-updates/messages";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { EntityUpdate } from "@ryot-app/plugin-client-sdk";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";

import type { LiveUpdateListeners } from "#/api/live-updates";
import { ServerOrigin } from "#/api/origin";
import { makeLiveUpdatesApi } from "#/api/ports.test-layer";

import { EntityWatchService } from "./service";
import { EntityWatchTransport } from "./transport";

const updates: EntityUpdate[] = [];
const cleanups: Array<() => Promise<void>> = [];
const scope = { userId: "user-1", serverUrl: ServerOrigin.make("https://ryot.example") };
const entityFrame = (entityId: string, reason: EntityUpdate["reason"]): LiveUpdateFrame => ({
	reason,
	type: "entity-updated",
	entityId: EntityId.make(entityId),
});

afterEach(() => {
	updates.length = 0;
	return Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const settle = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			for (let i = 0; i < 20; i++) {
				yield* Effect.promise(() => Promise.resolve());
			}
		}),
	);

function setup() {
	let now = 0;
	let available = true;
	let changed: undefined | (() => void);
	const timers: { at: number; cancelled: boolean; callback: () => void }[] = [];
	const asks: PopulateEntitiesBody[] = [];
	const connections: { fail: () => void; interrupted: boolean; listeners: LiveUpdateListeners }[] =
		[];
	const overflows: number[] = [];
	const layer = EntityWatchService.layer.pipe(
		Layer.provide(
			makeLiveUpdatesApi({
				populate: (_scope, body) =>
					Effect.sync(() => {
						asks.push(body);
					}),
				events: (_scope, listeners) =>
					Effect.callback<never>((resume) => {
						const connection = {
							listeners,
							interrupted: false,
							fail: () => resume(Effect.die("closed")),
						};
						connections.push(connection);
						return Effect.sync(() => {
							connection.interrupted = true;
						});
					}),
			}),
		),
		Layer.provide(
			Layer.succeed(EntityWatchTransport, {
				available: () => available,
				reportOverflow: (count) => overflows.push(count),
				subscribe: (next) => {
					changed = next;
					return () => {
						changed = undefined;
					};
				},
				schedule: (delay, callback) => {
					const timer = { callback, at: now + delay, cancelled: false };
					timers.push(timer);
					return () => {
						timer.cancelled = true;
					};
				},
			}),
		),
	);
	const runtime = ManagedRuntime.make(layer);
	cleanups.push(() => runtime.dispose());
	const service = runtime.runSync(EntityWatchService);
	const advance = (ms: number) => {
		now += ms;
		for (const timer of timers.splice(0)) {
			if (timer.cancelled) {
				continue;
			}
			if (timer.at <= now) {
				timer.callback();
			} else {
				timers.push(timer);
			}
		}
	};
	return {
		asks,
		runtime,
		service,
		advance,
		overflows,
		connections,
		setAvailable: (next: boolean) => {
			available = next;
			changed?.();
		},
	};
}

describe("EntityWatchService", () => {
	it.live(
		"asks once per batch, splitting interactive from background",
		() =>
			Effect.gen(function* () {
				const { asks, advance, service } = setup();
				service.watch(scope, { visible: ["b"], foreground: ["a"] }, (update) =>
					updates.push(update),
				);
				service.watch(scope, { foreground: [], visible: ["c"] }, (update) => updates.push(update));
				service.acquire(scope);
				yield* Effect.promise(settle);
				advance(100);
				yield* Effect.promise(settle);
				expect(asks).toEqual([
					{ entityIds: ["a"], priority: "interactive" },
					{ entityIds: ["b", "c"], priority: "background" },
				]);
			}),
		testTimeout,
	);

	it.live(
		"costs no request for an unchanged page and upgrades an entity that becomes foreground",
		() =>
			Effect.gen(function* () {
				const { asks, advance, service } = setup();
				const owner = service.watch(scope, { foreground: [], visible: ["a"] }, () => undefined);
				service.acquire(scope);
				advance(100);
				yield* Effect.promise(settle);
				asks.length = 0;
				owner.update({ foreground: [], visible: ["a"] });
				advance(100);
				yield* Effect.promise(settle);
				expect(asks).toEqual([]);
				owner.update({ visible: [], foreground: ["a"] });
				advance(100);
				yield* Effect.promise(settle);
				expect(asks).toEqual([{ entityIds: ["a"], priority: "interactive" }]);
			}),
		testTimeout,
	);

	it.live(
		"splits a large ask to the populate limit",
		() =>
			Effect.gen(function* () {
				const { asks, advance, service } = setup();
				const visible = Array.from({ length: 250 }, (_, index) => `id-${index}`);
				service.watch(scope, { visible, foreground: [] }, () => undefined);
				service.acquire(scope);
				advance(100);
				yield* Effect.promise(settle);
				expect(asks.map(({ entityIds }) => entityIds.length)).toEqual([100, 100, 50]);
			}),
		testTimeout,
	);

	it.live(
		"delivers frames only to owners of the entity and asks again after population",
		() =>
			Effect.gen(function* () {
				const { asks, advance, service, connections } = setup();
				service.watch(scope, { visible: [], foreground: ["a"] }, (update) => updates.push(update));
				service.acquire(scope);
				yield* Effect.promise(settle);
				advance(100);
				yield* Effect.promise(settle);
				asks.length = 0;
				connections[0]?.listeners.onFrame(entityFrame("other", "populated"));
				expect(updates).toEqual([]);
				connections[0]?.listeners.onFrame(entityFrame("a", "populated"));
				expect(updates).toEqual([{ reason: "populated", entityId: EntityId.make("a") }]);
				advance(100);
				yield* Effect.promise(settle);
				expect(asks).toEqual([{ entityIds: ["a"], priority: "interactive" }]);
				asks.length = 0;
				connections[0]?.listeners.onFrame(entityFrame("a", "translated"));
				advance(100);
				yield* Effect.promise(settle);
				expect(asks).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"retries a lost stream with backoff, then asks again and refreshes derived data on reconnect",
		() =>
			Effect.gen(function* () {
				const { asks, advance, runtime, service, connections } = setup();
				service.watch(scope, { foreground: [], visible: ["a"] }, () => undefined);
				service.acquire(scope);
				let refreshes = 0;
				const fiber = runtime.runFork(
					service.derivedDataUpdates(scope).pipe(
						Stream.runForEach(() =>
							Effect.sync(() => {
								refreshes++;
							}),
						),
					),
				);
				yield* Effect.promise(settle);
				connections[0]?.listeners.onConnected();
				advance(100);
				yield* Effect.promise(settle);
				expect(refreshes).toBe(0);
				asks.length = 0;
				connections[0]?.fail();
				yield* Effect.promise(settle);
				advance(999);
				expect(connections).toHaveLength(1);
				advance(1);
				yield* Effect.promise(settle);
				expect(connections).toHaveLength(2);
				connections[1]?.listeners.onConnected();
				advance(100);
				yield* Effect.promise(settle);
				expect(refreshes).toBe(1);
				expect(asks).toEqual([{ entityIds: ["a"], priority: "background" }]);
				connections[1]?.listeners.onFrame({ type: "derived-data-updated" });
				yield* Effect.promise(settle);
				expect(refreshes).toBe(2);
				yield* Fiber.interrupt(fiber);
			}),
		testTimeout,
	);

	it.live(
		"stops while unavailable and ignores a replaced connection",
		() =>
			Effect.gen(function* () {
				const { service, connections, setAvailable } = setup();
				service.watch(scope, { visible: [], foreground: ["a"] }, (update) => updates.push(update));
				service.acquire(scope);
				yield* Effect.promise(settle);
				setAvailable(false);
				yield* Effect.promise(settle);
				expect(connections[0]?.interrupted).toBe(true);
				connections[0]?.listeners.onFrame(entityFrame("a", "populated"));
				expect(updates).toEqual([]);
				setAvailable(true);
				yield* Effect.promise(settle);
				expect(connections).toHaveLength(2);
			}),
		testTimeout,
	);

	it.live(
		"releases the stream with its last lease",
		() =>
			Effect.gen(function* () {
				const { service, connections } = setup();
				const first = service.acquire(scope);
				const second = service.acquire(scope);
				yield* Effect.promise(settle);
				first();
				expect(connections[0]?.interrupted).toBe(false);
				second();
				yield* Effect.promise(settle);
				expect(connections[0]?.interrupted).toBe(true);
			}),
		testTimeout,
	);
});
