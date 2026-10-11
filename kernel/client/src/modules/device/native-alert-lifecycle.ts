import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { Effect } from "effect";

export const synchronizeNativeAlerts = Effect.fn("synchronizeNativeAlerts")(function* (
	platform: Pick<
		LocalNotificationsPlugin,
		"getDeliveredNotifications" | "removeDeliveredNotificationsById"
	>,
	active: boolean,
) {
	const delivered = yield* Effect.tryPromise(() => platform.getDeliveredNotifications());
	const ids = delivered.notifications.map(({ id }) => id);
	if (active && ids.length > 0) {
		yield* Effect.tryPromise(() => platform.removeDeliveredNotificationsById({ ids }));
	}
});
