import { ExceptionCode } from "@capacitor/core";
import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import type { PluginDeviceRequest } from "@ryot-app/plugin-client-contract";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Clock, DateTime, Effect } from "effect";

import {
	type AlertChannelNames,
	AlertChannelsUnsupported,
	platformError,
} from "#/modules/device/service";

type NativeAlerts = Pick<
	LocalNotificationsPlugin,
	| "update"
	| "schedule"
	| "checkPermissions"
	| "requestPermissions"
	| "checkExactNotificationSetting"
>;

/** Android 7 has no notification channels, so Capacitor rejects channel calls as unavailable. */
const channelError = (cause: unknown) =>
	isObjectRecord(cause) && cause["code"] === ExceptionCode.Unavailable
		? new AlertChannelsUnsupported()
		: platformError(cause);

/** Android keeps an existing channel's settings and updates only its name, so this also renames them. */
export const createNativeAlertChannels = Effect.fn("createNativeAlertChannels")(function* (
	platform: Pick<LocalNotificationsPlugin, "createChannel">,
	names: AlertChannelNames,
) {
	yield* Effect.tryPromise({
		catch: channelError,
		try: () =>
			platform.createChannel({
				importance: 4,
				vibration: false,
				name: names.audible,
				id: "scheduled-audible",
			}),
	});
	yield* Effect.tryPromise({
		catch: channelError,
		try: () =>
			platform.createChannel({
				importance: 2,
				vibration: false,
				name: names.silent,
				id: "scheduled-silent",
			}),
	});
});

export const cancelNativeAlert = Effect.fn("cancelNativeAlert")(function* (
	platform: Pick<LocalNotificationsPlugin, "cancel" | "removeDeliveredNotificationsById">,
	id: number,
) {
	yield* Effect.tryPromise({
		catch: platformError,
		try: () => platform.cancel({ notifications: [{ id }] }),
	});
	yield* Effect.tryPromise({
		catch: platformError,
		try: () => platform.removeDeliveredNotificationsById({ ids: [id] }),
	});
});

export const removeDeliveredNativeAlerts = Effect.fn("removeDeliveredNativeAlerts")(function* (
	platform: Pick<
		LocalNotificationsPlugin,
		"getDeliveredNotifications" | "removeDeliveredNotificationsById"
	>,
) {
	const delivered = yield* Effect.tryPromise({
		catch: platformError,
		try: () => platform.getDeliveredNotifications(),
	});
	const ids = delivered.notifications.map(({ id }) => id);
	if (ids.length > 0) {
		yield* Effect.tryPromise({
			catch: platformError,
			try: () => platform.removeDeliveredNotificationsById({ ids }),
		});
	}
});

export const scheduleNativeAlert = Effect.fn("scheduleNativeAlert")(function* (
	platform: NativeAlerts,
	android: boolean,
	id: number,
	request: Extract<PluginDeviceRequest, { action: "schedule" }>,
) {
	let permission = yield* Effect.tryPromise({
		catch: platformError,
		try: () => platform.checkPermissions(),
	});
	if (permission.display === "prompt" || permission.display === "prompt-with-rationale") {
		permission = yield* Effect.tryPromise({
			catch: platformError,
			try: () => platform.requestPermissions(),
		});
	}
	if (permission.display !== "granted") {
		return { status: "denied" } as const;
	}
	if (Date.parse(request.deadline) <= (yield* Clock.currentTimeMillis)) {
		return { status: "done" } as const;
	}
	const exact =
		!android ||
		(yield* Effect.tryPromise({
			catch: platformError,
			try: () => platform.checkExactNotificationSetting(),
		})).exact_alarm === "granted";
	let sound: string | undefined;
	if (request.audible) {
		sound = "default";
	} else if (android) {
		sound = "silent.wav";
	}
	const notification = {
		id,
		sound,
		foreground: false,
		body: request.body,
		title: request.title,
		isExactMandatory: false,
		isExactNotification: false,
		channelId: request.audible ? "scheduled-audible" : "scheduled-silent",
		schedule: {
			repeats: false,
			allowWhileIdle: true,
			at: DateTime.toDateUtc(DateTime.makeUnsafe(request.deadline)),
		},
	};
	const result = yield* Effect.tryPromise({
		catch: platformError,
		try: () => platform.schedule({ notifications: [notification] }),
	});
	if (android && exact) {
		yield* Effect.tryPromise({
			catch: platformError,
			try: () =>
				platform.update({ notifications: [{ ...notification, isExactNotification: true }] }),
		});
		const current = yield* Effect.tryPromise({
			catch: platformError,
			try: () => platform.checkExactNotificationSetting(),
		});
		return {
			status: current.exact_alarm === "granted" && !result.warning ? "scheduled" : "inexact",
		} as const;
	}
	return { status: exact ? "scheduled" : "inexact" } as const;
});
