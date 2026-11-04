import type { AppPlugin } from "@capacitor/app";
import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { Effect } from "effect";

import { platformError } from "#/modules/device/service";

export const listenDeviceEvents = Effect.fn("listenDeviceEvents")(function* (
	platform: {
		readonly native: boolean;
		readonly app: Pick<AppPlugin, "getState" | "addListener">;
		readonly notifications: Pick<LocalNotificationsPlugin, "addListener">;
		readonly document: Pick<
			Document,
			"visibilityState" | "addEventListener" | "removeEventListener"
		>;
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
		() => Effect.sync(() => platform.document.removeEventListener("visibilitychange", visibility)),
	);
	if (platform.native) {
		yield* Effect.acquireRelease(
			Effect.tryPromise({
				catch: platformError,
				try: () =>
					platform.notifications.addListener(
						"localNotificationActionPerformed",
						({ notification }) => tap(notification.id),
					),
			}),
			(handle) => Effect.promise(() => handle.remove()).pipe(Effect.ignoreCause),
		);
		yield* Effect.acquireRelease(
			Effect.tryPromise({
				catch: platformError,
				try: () =>
					platform.notifications.addListener("localNotificationReceived", ({ id }) =>
						receivedAlert(id),
					),
			}),
			(handle) => Effect.promise(() => handle.remove()).pipe(Effect.ignoreCause),
		);
		yield* Effect.acquireRelease(
			Effect.tryPromise({
				catch: platformError,
				try: () =>
					platform.app.addListener("appStateChange", ({ isActive }) => {
						nativeActive = isActive;
						visibility();
					}),
			}),
			(handle) => Effect.promise(() => handle.remove()).pipe(Effect.ignoreCause),
		);
		const current = yield* Effect.tryPromise({
			catch: platformError,
			try: () => platform.app.getState(),
		});
		nativeActive = current.isActive;
	}
	visibility();
});
