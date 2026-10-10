import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { Effect } from "effect";

export const synchronizeNativeAlerts = Effect.fn("synchronizeNativeAlerts")(function* (
	platform: Pick<
		LocalNotificationsPlugin,
		"getPending" | "getDeliveredNotifications" | "removeDeliveredNotificationsById"
	>,
	active: boolean,
) {
	const pending = yield* Effect.tryPromise(() => platform.getPending());
	const delivered = yield* Effect.tryPromise(() => platform.getDeliveredNotifications());
	const ids = delivered.notifications.map(({ id }) => id);
	yield* Effect.logInfo("[device-alerts] app state", {
		active,
		delivered: ids,
		pending: pending.notifications.map(({ id }) => id),
	});
	if (active && ids.length > 0) {
		yield* Effect.tryPromise(() => platform.removeDeliveredNotificationsById({ ids }));
	}
});
