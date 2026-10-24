import type { AppPlugin } from "@capacitor/app";
import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { Effect } from "effect";

import { DevicePlatformError } from "#/modules/device/service";

export const listenDeviceEvents = Effect.fn("listenDeviceEvents")(
	function* (
		platform: {
			readonly native: boolean;
			readonly document: Pick<
				Document,
				"visibilityState" | "addEventListener" | "removeEventListener"
			>;
			readonly notifications: Pick<LocalNotificationsPlugin, "addListener">;
			readonly app: Pick<AppPlugin, "addListener" | "getState">;
		},
		tap: (id: number) => void,
		foreground: (active: boolean) => void,
		receivedAlert: (id: number) => void,
	) {
		let nativeActive = !platform.native;
		const visibility = () => {
			foreground(nativeActive && platform.document.visibilityState === "visible");
		};
		yield* Effect.acquireRelease(
			Effect.sync(() => platform.document.addEventListener("visibilitychange", visibility)),
			() =>
				Effect.sync(() => platform.document.removeEventListener("visibilitychange", visibility)),
		);
		if (platform.native) {
			yield* Effect.acquireRelease(
				Effect.tryPromise(() =>
					platform.notifications.addListener(
						"localNotificationActionPerformed",
						({ notification }) => tap(notification.id),
					),
				),
				(handle) => Effect.tryPromise(() => handle.remove()).pipe(Effect.ignore),
			);
			yield* Effect.acquireRelease(
				Effect.tryPromise(() =>
					platform.notifications.addListener("localNotificationReceived", ({ id }) =>
						receivedAlert(id),
					),
				),
				(handle) => Effect.tryPromise(() => handle.remove()).pipe(Effect.ignore),
			);
			yield* Effect.acquireRelease(
				Effect.tryPromise(() =>
					platform.app.addListener("appStateChange", ({ isActive }) => {
						nativeActive = isActive;
						visibility();
					}),
				),
				(handle) => Effect.tryPromise(() => handle.remove()).pipe(Effect.ignore),
			);
			const current = yield* Effect.tryPromise(() => platform.app.getState());
			nativeActive = current.isActive;
		}
		visibility();
	},
	Effect.mapError((cause) => new DevicePlatformError({ cause })),
);
