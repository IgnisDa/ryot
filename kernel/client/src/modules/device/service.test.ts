import { describe, expect, layer } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PluginDeviceRequest, PluginNavigationTarget } from "@ryot-app/plugin-client-contract";
import { Deferred, Effect, Fiber, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { noopDevicePlatform } from "#/modules/device/platform.test-layer";
import { DevicePlatform, DeviceService } from "#/modules/device/service";
import { emptyDeviceState, type DeviceState } from "#/modules/device/state";
import { DeviceStateAccessError } from "#/persistence/storage";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://one.test") };
const otherScope = { ...scope, userId: "user-2" };
const pluginId = PluginId.make("fitness");
const target: PluginNavigationTarget = {
	search: "",
	path: "/editor",
	kind: "plugin-route",
	packageId: PluginPackageId.make("ryot/fitness"),
};
const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		pluginId,
		kind: "plugin",
		contentHash: "hash",
		revisionId: "revision-1",
		installationId: "installation-1",
		packageId: PluginPackageId.make("ryot/fitness"),
	},
];
const schedule: PluginDeviceRequest = {
	target,
	pluginId,
	body: "",
	key: "rest",
	audible: true,
	action: "schedule",
	title: "Rest complete",
	deadline: "2026-10-15T10:00:00.000Z",
};

const harness = (initial: DeviceState = emptyDeviceState) => {
	let stored = initial;
	const cancelled: number[] = [];
	const scheduled: number[] = [];
	const awake: boolean[] = [];
	const haptics: NonNullable<
		Extract<PluginDeviceRequest, { readonly action: "haptic" }>["kind"]
	>[] = [];
	const navigated: PluginNavigationTarget[] = [];
	let tap: ((id: number) => void) | undefined;
	let foreground: ((active: boolean) => void) | undefined;
	let delivered: ((id: number) => void) | undefined;
	let listens = 0;
	const platform = Layer.succeed(DevicePlatform, {
		cancel: (id) =>
			Effect.sync(() => {
				cancelled.push(id);
			}),
		haptic: (kind) =>
			Effect.sync(() => {
				haptics.push(kind);
			}),
		awake: (enabled) =>
			Effect.sync(() => {
				awake.push(enabled);
			}),
		schedule: (id) =>
			Effect.sync(() => {
				scheduled.push(id);
				return { status: "scheduled" } as const;
			}),
		listen: (onTap, onForeground, onDelivered) =>
			Effect.sync(() => {
				listens++;
				tap = onTap;
				foreground = onForeground;
				delivered = onDelivered;
				return () => {};
			}),
	});
	return {
		awake,
		haptics,
		cancelled,
		scheduled,
		navigated,
		stored: () => stored,
		listens: () => listens,
		tap: (id: number) => tap?.(id),
		delivered: (id: number) => delivered?.(id),
		foreground: (active: boolean) => foreground?.(active),
		layer: DeviceService.layer.pipe(
			Layer.provide(platform),
			Layer.provide(
				makeClientStorage({
					getDeviceState: Effect.sync(() => stored),
					setDeviceState: (state) =>
						Effect.sync(() => {
							stored = state;
						}),
				}),
			),
		),
	};
};

describe("device authority", () => {
	const hapticRouting = harness();
	layer(hapticRouting.layer)((test) => {
		test.effect("routes selection haptics and defaults to impact", () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				yield* service.start;
				yield* service.setScope(scope);
				yield* service.outcome(scope, contributors, "frame", true, { pluginId, action: "haptic" });
				yield* service.outcome(scope, contributors, "frame", true, {
					pluginId,
					action: "haptic",
					kind: "selection",
				});
				expect(hapticRouting.haptics).toEqual(["impact", "selection"]);
			}),
		);
	});
	const scopedAlerts = harness();
	layer(scopedAlerts.layer)((test) => {
		test.effect("replaces scoped keys with fresh IDs and ignores stale taps", () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				let refreshes = 0;
				const unsubscribe = service.subscribeAlerts(() => {
					refreshes++;
				});
				yield* service.start;
				yield* service.start;
				yield* service.setScope(scope, (to) => scopedAlerts.navigated.push(to));
				expect(yield* service.outcome(scope, contributors, "frame", true, schedule)).toEqual({
					outcome: "success",
					value: { status: "scheduled" },
				});
				yield* service.outcome(scope, contributors, "frame", true, schedule);
				expect(scopedAlerts.scheduled).toEqual([1, 2]);
				expect(scopedAlerts.cancelled).toEqual([1]);
				scopedAlerts.delivered(1);
				scopedAlerts.delivered(2);
				expect(refreshes).toBe(1);
				scopedAlerts.tap(1);
				expect(scopedAlerts.navigated).toEqual([]);
				scopedAlerts.tap(2);
				expect(scopedAlerts.navigated).toEqual([target]);
				yield* service.outcome(scope, contributors, "frame", true, {
					pluginId,
					key: "rest",
					action: "cancel",
				});
				expect(scopedAlerts.cancelled).toEqual([1, 2]);
				expect(scopedAlerts.stored().alerts).toEqual([]);
				expect(scopedAlerts.listens()).toBe(1);
				unsubscribe();
			}),
		);
	});
	const coldTap = harness({
		nextId: 8,
		shortcuts: [],
		alerts: [
			{
				id: 7,
				target,
				pluginId,
				key: "rest",
				installationId: "installation-1",
				scope: '["https://one.test","user-1"]',
			},
		],
	});
	layer(coldTap.layer)((test) => {
		test.effect(
			"restores cold taps only for the authenticated owner and cancels departing alerts",
			() =>
				Effect.gen(function* () {
					const service = yield* DeviceService;
					yield* service.start;
					coldTap.tap(7);
					expect(coldTap.navigated).toEqual([]);
					yield* service.setScope(scope, (to) => coldTap.navigated.push(to));
					expect(coldTap.navigated).toEqual([target]);
					yield* service.setScope(otherScope, (to) => coldTap.navigated.push(to));
					coldTap.tap(7);
					expect(coldTap.navigated).toEqual([target]);
					expect(coldTap.cancelled).toEqual([7]);
					expect(yield* service.outcome(scope, contributors, "frame", true, schedule)).toEqual({
						outcome: "failure",
						reason: "invalid-request",
					});
					expect(yield* service.outcome(otherScope, [], "frame", true, schedule)).toEqual({
						outcome: "failure",
						reason: "invalid-request",
					});
				}),
		);
	});
	const awakeDemand = harness();
	layer(awakeDemand.layer)((test) => {
		test.effect("aggregates awake demand and keeps scheduled alerts after frame disposal", () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				yield* service.start;
				yield* service.setScope(scope);
				yield* service.outcome(scope, contributors, "a", true, {
					pluginId,
					enabled: true,
					action: "awake",
				});
				yield* service.outcome(scope, contributors, "b", true, {
					pluginId,
					enabled: true,
					action: "awake",
				});
				yield* service.setFrameActive("a", false);
				yield* service.setFrameActive("b", false);
				yield* service.setFrameActive("a", true);
				expect(awakeDemand.awake).toEqual([true, false, true]);
				awakeDemand.foreground(false);
				yield* service.setFrameActive("a", true);
				awakeDemand.foreground(true);
				yield* service.setFrameActive("a", true);
				expect(awakeDemand.awake).toEqual([true, false, true, false, true]);
				yield* service.outcome(scope, contributors, "a", true, schedule);
				yield* service.releaseFrame("a");
				expect(awakeDemand.awake).toEqual([true, false, true, false, true, false]);
				expect(awakeDemand.cancelled).toEqual([]);
				expect(awakeDemand.stored().alerts).toHaveLength(1);
			}),
		);
	});
	let unreadableWrites = 0;
	const unreadablePlatform = Layer.succeed(DevicePlatform, {
		...noopDevicePlatform,
		schedule: () => Effect.die("must not schedule"),
	});
	const unreadableStorage = makeClientStorage({
		setDeviceState: () =>
			Effect.sync(() => {
				unreadableWrites++;
			}),
		getDeviceState: Effect.fail(new DeviceStateAccessError({ cause: "corrupt" })),
	});
	layer(
		DeviceService.layer.pipe(Layer.provide(unreadablePlatform), Layer.provide(unreadableStorage)),
	)((test) => {
		test.effect("does not overwrite unreadable metadata or schedule without durable identity", () =>
			Effect.gen(function* () {
				const service = yield* DeviceService;
				expect(yield* service.outcome(scope, contributors, "frame", true, schedule)).toEqual({
					outcome: "failure",
					reason: "transport",
				});
				expect(unreadableWrites).toBe(0);
			}),
		);
	});
	const gate = Deferred.makeUnsafe<void>();
	const entered = Deferred.makeUnsafe<void>();
	const cancelledDuringScheduling: number[] = [];
	const navigatedDuringScheduling: PluginNavigationTarget[] = [];
	let tapDuringScheduling: ((id: number) => void) | undefined;
	const serializationPlatform = Layer.succeed(DevicePlatform, {
		...noopDevicePlatform,
		cancel: (id) =>
			Effect.sync(() => {
				cancelledDuringScheduling.push(id);
			}),
		listen: (tap) =>
			Effect.sync(() => {
				tapDuringScheduling = tap;
				return () => {};
			}),
		schedule: () =>
			Deferred.succeed(entered, undefined).pipe(
				Effect.andThen(Deferred.await(gate)),
				Effect.as({ status: "scheduled" } as const),
			),
	});
	layer(
		DeviceService.layer.pipe(
			Layer.provide(serializationPlatform),
			Layer.provide(makeClientStorage()),
		),
	)((test) => {
		test.effect(
			"finishes interrupted native scheduling before cancelling the departing scope",
			() =>
				Effect.gen(function* () {
					const service = yield* DeviceService;
					yield* service.start;
					yield* service.setScope(scope, (to) => navigatedDuringScheduling.push(to));
					const saving = yield* Effect.forkChild(
						service.outcome(scope, contributors, "a", true, schedule),
					);
					yield* Deferred.await(entered);
					const interrupted = yield* Effect.forkChild(Fiber.interrupt(saving), {
						startImmediately: true,
					});
					const leaving = yield* Effect.forkChild(
						service.setScope(otherScope, (to) => navigatedDuringScheduling.push(to)),
						{ startImmediately: true },
					);
					tapDuringScheduling?.(1);
					expect(navigatedDuringScheduling).toEqual([]);
					yield* Deferred.succeed(gate, undefined);
					yield* Fiber.join(interrupted);
					yield* Fiber.join(leaving);
					expect(cancelledDuringScheduling).toEqual([1]);
				}),
		);
	});
});
