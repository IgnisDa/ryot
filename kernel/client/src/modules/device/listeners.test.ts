import type { PluginListenerHandle } from "@capacitor/core";
import { expect, it, layer } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";

import { listenDeviceEvents } from "#/modules/device/listeners";
import { noopDevicePlatform } from "#/modules/device/platform.test-layer";
import { DevicePlatform, DeviceService } from "#/modules/device/service";
import { makeClientStorage } from "#/persistence/storage.test-layer";

type Step = "state" | NativeListener;
type NativeListener = "app" | "action" | "received";

const harness = (
	options: {
		failure?: Step;
		blocked?: Step;
		native?: boolean;
		active?: boolean;
		removeFailure?: NativeListener;
		blockedRemoval?: NativeListener;
		visibility?: DocumentVisibilityState;
	} = {},
) => {
	const acquired: string[] = [];
	const released: string[] = [];
	const foreground: boolean[] = [];
	const events = new EventTarget();
	const entered = Promise.withResolvers<void>();
	const pendingHandle = Promise.withResolvers<PluginListenerHandle>();
	const pendingState = Promise.withResolvers<{ isActive: boolean }>();
	const removalEntered = Promise.withResolvers<void>();
	const pendingRemoval = Promise.withResolvers<void>();
	let failure = options.failure;
	let blocked = options.blocked;
	let blockedRemoval = options.blockedRemoval;
	let visibility = options.visibility ?? "visible";
	let releaseHandle: undefined | (() => void);
	const register = (name: NativeListener) => {
		if (failure === name) {
			return Promise.reject(new Error(name));
		}
		const handle = {
			remove: () => {
				released.push(name);
				if (blockedRemoval === name) {
					removalEntered.resolve();
					return pendingRemoval.promise;
				}
				return options.removeFailure === name
					? Promise.reject(new Error(`remove ${name}`))
					: Promise.resolve();
			},
		};
		if (blocked === name) {
			releaseHandle = () => {
				acquired.push(name);
				pendingHandle.resolve(handle);
			};
			entered.resolve();
			return pendingHandle.promise;
		}
		acquired.push(name);
		return Promise.resolve(handle);
	};
	const platform: Parameters<typeof listenDeviceEvents>[0] = {
		native: options.native ?? true,
		notifications: {
			addListener: (name) =>
				register(name === "localNotificationActionPerformed" ? "action" : "received"),
		},
		app: {
			addListener: () => register("app"),
			getState: () => {
				if (failure === "state") {
					return Promise.reject(new Error("state"));
				}
				if (blocked === "state") {
					entered.resolve();
					return pendingState.promise;
				}
				return Promise.resolve({ isActive: options.active ?? true });
			},
		},
		document: {
			get visibilityState() {
				return visibility;
			},
			addEventListener: (...args: Parameters<EventTarget["addEventListener"]>) => {
				acquired.push("dom");
				events.addEventListener(...args);
			},
			removeEventListener: (...args: Parameters<EventTarget["removeEventListener"]>) => {
				released.push("dom");
				events.removeEventListener(...args);
			},
		},
	};
	return {
		acquired,
		released,
		foreground,
		retry: () => {
			failure = undefined;
		},
		entered: Effect.promise(() => entered.promise),
		removalEntered: Effect.promise(() => removalEntered.promise),
		resumeRemoval: () => {
			blockedRemoval = undefined;
			pendingRemoval.resolve();
		},
		resume: () => {
			blocked = undefined;
			releaseHandle?.();
			pendingState.resolve({ isActive: true });
		},
		visibility: (next: DocumentVisibilityState) => {
			visibility = next;
			events.dispatchEvent(new Event("visibilitychange"));
		},
		layer: DeviceService.layer.pipe(
			Layer.provide(
				Layer.succeed(DevicePlatform, {
					...noopDevicePlatform,
					listen: (tap, onForeground, received) =>
						listenDeviceEvents(
							platform,
							tap,
							(active) => {
								foreground.push(active);
								onForeground(active);
							},
							received,
						),
				}),
			),
			Layer.provide(makeClientStorage()),
		),
	};
};

const failureCases = [
	["action", ["dom"]],
	["received", ["action", "dom"]],
	["app", ["received", "action", "dom"]],
	["state", ["app", "received", "action", "dom"]],
] as const;

for (const [failure, expectedReleased] of failureCases) {
	const h = harness({ failure });
	layer(h.layer)((test) => {
		test.effect(`releases prior listeners when ${failure} fails, then retries and stops once`, () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				expect(Exit.isFailure(yield* Effect.exit(service.start))).toBe(true);
				expect(h.released).toEqual(expectedReleased);
				expect(h.foreground).toEqual([]);
				h.visibility("hidden");
				expect(h.foreground).toEqual([]);
				h.retry();
				yield* service.start;
				yield* service.start;
				expect(h.foreground).toEqual([false]);
				yield* service.stop;
				yield* service.stop;
				expect(h.released).toEqual([...expectedReleased, "app", "received", "action", "dom"]);
				h.visibility("visible");
				expect(h.foreground).toEqual([false]);
				expect(h.acquired).toHaveLength(expectedReleased.length + 4);
			}),
		);
	});
}

for (const [blocked, expectedReleased] of [
	["action", ["action", "dom"]],
	["received", ["received", "action", "dom"]],
	["app", ["app", "received", "action", "dom"]],
] as const) {
	const h = harness({ blocked });
	layer(h.layer)((test) => {
		test.effect(`releases the eventual ${blocked} handle when start is interrupted`, () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				const starting = yield* Effect.forkChild(service.start);
				yield* h.entered;
				const interrupting = yield* Effect.forkChild(Fiber.interrupt(starting), {
					startImmediately: true,
				});
				expect(h.released).toEqual([]);
				h.resume();
				yield* Fiber.join(interrupting);
				expect(h.released).toEqual(expectedReleased);
				expect(h.foreground).toEqual([]);
				const previousReleased = [...h.released];
				yield* service.start;
				expect(h.foreground).toEqual([true]);
				yield* service.stop;
				expect(h.released).toEqual([...previousReleased, "app", "received", "action", "dom"]);
			}),
		);
	});
}

const interruptedState = harness({ blocked: "state" });
layer(interruptedState.layer)((test) => {
	test.effect(
		"interrupts initial state acquisition without retaining listeners or publishing late state",
		() => {
			const h = interruptedState;
			return Effect.gen(function* () {
				const service = yield* DeviceService;
				const starting = yield* Effect.forkChild(service.start);
				yield* h.entered;
				yield* Fiber.interrupt(starting);
				expect(h.released).toEqual(["app", "received", "action", "dom"]);
				h.resume();
				expect(h.foreground).toEqual([]);
				yield* service.start;
				expect(h.foreground).toEqual([true]);
				yield* service.stop;
				expect(h.released).toEqual([
					"app",
					"received",
					"action",
					"dom",
					"app",
					"received",
					"action",
					"dom",
				]);
			});
		},
	);
});

const concurrentRegistration = harness({ blocked: "received" });
layer(concurrentRegistration.layer)((test) => {
	test.effect(
		"serializes concurrent start and stop while a native registration is in flight",
		() => {
			const h = concurrentRegistration;
			return Effect.gen(function* () {
				const service = yield* DeviceService;
				const starting = yield* Effect.forkChild(service.start);
				yield* h.entered;
				const repeated = yield* Effect.forkChild(service.start, { startImmediately: true });
				const stopping = yield* Effect.forkChild(service.stop, { startImmediately: true });
				expect(h.acquired).toEqual(["dom", "action"]);
				expect(h.released).toEqual([]);
				h.resume();
				yield* Fiber.join(starting);
				yield* Fiber.join(repeated);
				yield* Fiber.join(stopping);
				expect(h.acquired).toEqual(["dom", "action", "received", "app"]);
				expect(h.released).toEqual(["app", "received", "action", "dom"]);
				yield* service.start;
				yield* service.stop;
				expect(h.released).toEqual([
					"app",
					"received",
					"action",
					"dom",
					"app",
					"received",
					"action",
					"dom",
				]);
			});
		},
	);
});

for (const active of [false, true]) {
	const h = harness({ active });
	layer(h.layer)((test) => {
		test.effect(
			`publishes native initial foreground ${active} and tracks document visibility`,
			() =>
				Effect.gen(function* () {
					const service = yield* DeviceService;
					yield* service.start;
					expect(h.foreground).toEqual([active]);
					h.visibility("hidden");
					h.visibility("visible");
					expect(h.foreground).toEqual([active, false, active]);
					yield* service.stop;
				}),
		);
	});
}

const webRegistration = harness({ native: false });
layer(webRegistration.layer)((test) => {
	test.effect("registers only document visibility on web and releases it on stop", () => {
		const h = webRegistration;
		return Effect.gen(function* () {
			const service = yield* DeviceService;
			yield* service.start;
			expect(h.acquired).toEqual(["dom"]);
			expect(h.foreground).toEqual([true]);
			h.visibility("hidden");
			expect(h.foreground).toEqual([true, false]);
			yield* service.stop;
			expect(h.released).toEqual(["dom"]);
			h.visibility("visible");
			expect(h.foreground).toEqual([true, false]);
		});
	});
});

const failedRemoval = harness({ removeFailure: "app" });
layer(failedRemoval.layer)((test) => {
	test.effect("releases remaining listeners when one native removal fails", () => {
		const h = failedRemoval;
		return Effect.gen(function* () {
			const service = yield* DeviceService;
			yield* service.start;
			yield* service.stop;
			expect(h.released).toEqual(["app", "received", "action", "dom"]);
		});
	});
});

const interruptedStop = harness({ blockedRemoval: "app" });
layer(interruptedStop.layer)((test) => {
	test.effect("finishes interrupted stop before a queued restart acquires listeners", () =>
		Effect.gen(function* () {
			const h = interruptedStop;
			const service = yield* DeviceService;
			yield* service.start;
			const stopping = yield* Effect.forkChild(service.stop);
			yield* h.removalEntered;
			const interrupting = yield* Effect.forkChild(Fiber.interrupt(stopping), {
				startImmediately: true,
			});
			const restarting = yield* Effect.forkChild(service.start, { startImmediately: true });
			expect(h.acquired).toEqual(["dom", "action", "received", "app"]);
			expect(h.released).toEqual(["app"]);
			h.resumeRemoval();
			yield* Fiber.join(interrupting);
			yield* Fiber.join(restarting);
			expect(h.acquired).toEqual([
				"dom",
				"action",
				"received",
				"app",
				"dom",
				"action",
				"received",
				"app",
			]);
			expect(h.released).toEqual(["app", "received", "action", "dom"]);
			yield* service.stop;
			expect(h.released).toEqual([
				"app",
				"received",
				"action",
				"dom",
				"app",
				"received",
				"action",
				"dom",
			]);
		}),
	);
});

it.effect(
	"constructs the service synchronously and closes its completed registration on disposal",
	() =>
		Effect.gen(function* () {
			const h = harness();
			const runtime = ManagedRuntime.make(h.layer);
			const service = runtime.runSync(DeviceService);
			expect(h.acquired).toEqual([]);
			yield* service.start;
			expect(h.released).toEqual([]);
			yield* runtime.disposeEffect;
			expect(h.released).toEqual(["app", "received", "action", "dom"]);
		}),
);
