import { KeepAwake } from "@capacitor-community/keep-awake";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Clock, Effect, Fiber, Layer, Schema } from "effect";

import { synchronizeNativeAlerts } from "#/modules/device/native-alert-lifecycle";
import { cancelNativeAlert, scheduleNativeAlert } from "#/modules/device/native-alerts";
import { DevicePlatform, DevicePlatformError, DeviceState } from "#/modules/device/service";
import { lightImpact } from "#/modules/navigation/haptics";

const storageKey = "ryot:device-alerts";
const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(DeviceState));
const encodeState = Schema.encodeSync(Schema.fromJsonString(DeviceState));
const platformError = (cause: unknown) => new DevicePlatformError({ cause });

export const DevicePlatformLive = Layer.effect(
	DevicePlatform,
	Effect.gen(function* () {
		const runFork = Effect.runForkWith(yield* Effect.context());
		const scope = yield* Effect.scope;
		const native = Capacitor.isNativePlatform();
		const android = Capacitor.getPlatform() === "android";
		const callbacks = new Map<number, Fiber.Fiber<void>>();
		const delivered = new Map<number, Notification>();
		let onTap: ((id: number) => void) | undefined;
		let wakeLock: WakeLockSentinel | undefined;
		let awakeWanted = false;
		let awakeGeneration = 0;
		const cancelWeb = (id: number) => {
			const callback = callbacks.get(id);
			if (callback) {
				runFork(Fiber.interrupt(callback));
			}
			callbacks.delete(id);
			delivered.get(id)?.close();
			delivered.delete(id);
		};
		return {
			haptic: lightImpact,
			write: (state) =>
				Effect.try({
					catch: platformError,
					try: () => localStorage.setItem(storageKey, encodeState(state)),
				}),
			cancel: (id) =>
				native
					? cancelNativeAlert(LocalNotifications, id).pipe(Effect.mapError(platformError))
					: Effect.sync(() => cancelWeb(id)),
			read: Effect.try({
				catch: platformError,
				try: () => {
					const value = localStorage.getItem(storageKey);
					return value === null ? { nextId: 1, alerts: [], shortcuts: [] } : decodeState(value);
				},
			}),
			awake: (enabled) =>
				Effect.gen(function* () {
					awakeWanted = enabled;
					const generation = ++awakeGeneration;
					if (native) {
						yield* Effect.tryPromise(() =>
							enabled ? KeepAwake.keepAwake() : KeepAwake.allowSleep(),
						);
						return;
					}
					if (!enabled) {
						const previous = wakeLock;
						wakeLock = undefined;
						if (previous) {
							yield* Effect.tryPromise(() => previous.release());
						}
					} else if ("wakeLock" in navigator && document.visibilityState === "visible") {
						const lock = yield* Effect.tryPromise(() => navigator.wakeLock.request("screen"));
						if (awakeWanted && generation === awakeGeneration) {
							wakeLock = lock;
						} else {
							yield* Effect.tryPromise(() => lock.release());
						}
					}
				}).pipe(Effect.mapError(platformError)),
			schedule: (id, request) =>
				Effect.gen(function* () {
					if (Date.parse(request.deadline) <= (yield* Clock.currentTimeMillis)) {
						return { status: "done" } as const;
					}
					if (!native) {
						if (typeof Notification === "undefined") {
							return { status: "unsupported" } as const;
						}
						const permission =
							Notification.permission === "default"
								? yield* Effect.tryPromise(() => Notification.requestPermission())
								: Notification.permission;
						if (permission !== "granted") {
							return { status: "denied" } as const;
						}
						cancelWeb(id);
						const deliver = Effect.sync(() => {
							callbacks.delete(id);
							if (document.visibilityState === "visible") {
								return;
							}
							const notification = new Notification(request.title, {
								tag: String(id),
								body: request.body,
								silent: !request.audible,
							});
							delivered.set(id, notification);
							notification.addEventListener("click", () => {
								window.focus();
								onTap?.(id);
								notification.close();
							});
						});
						callbacks.set(
							id,
							runFork(
								Effect.sleep(
									Math.max(0, Date.parse(request.deadline) - (yield* Clock.currentTimeMillis)),
								).pipe(Effect.andThen(deliver)),
								{ onFiberStart: Fiber.runIn(scope) },
							),
						);
						return { status: "inexact" } as const;
					}
					return yield* scheduleNativeAlert(LocalNotifications, android, id, request);
				}).pipe(Effect.mapError(platformError)),
			listen: (tap, foreground, receivedAlert) => {
				let nativeActive = !native;
				const visibility = () => {
					const active = nativeActive && document.visibilityState === "visible";
					foreground(active);
					if (native) {
						runFork(synchronizeNativeAlerts(LocalNotifications, active).pipe(Effect.ignore));
					} else if (active) {
						for (const notification of delivered.values()) {
							notification.close();
						}
						delivered.clear();
					}
				};
				return Effect.gen(function* () {
					onTap = tap;
					document.addEventListener("visibilitychange", visibility);
					if (!native) {
						visibility();
						return () => {
							document.removeEventListener("visibilitychange", visibility);
						};
					}
					const action = yield* Effect.tryPromise(() =>
						LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) =>
							onTap?.(notification.id),
						),
					);
					const received = yield* Effect.tryPromise(() =>
						LocalNotifications.addListener("localNotificationReceived", ({ id }) =>
							receivedAlert(id),
						),
					);
					const app = yield* Effect.tryPromise(() =>
						App.addListener("appStateChange", ({ isActive }) => {
							nativeActive = isActive;
							visibility();
						}),
					);
					const current = yield* Effect.tryPromise(() => App.getState());
					nativeActive = current.isActive;
					visibility();
					return () => {
						document.removeEventListener("visibilitychange", visibility);
						void action.remove();
						void received.remove();
						void app.remove();
					};
				}).pipe(Effect.mapError(platformError));
			},
		};
	}),
);
