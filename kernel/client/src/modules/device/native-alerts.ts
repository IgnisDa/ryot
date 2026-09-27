import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import type { PluginDeviceRequest } from "@ryot-app/plugin-client-contract";
import { Clock, DateTime, Effect } from "effect";

type NativeAlerts = Pick<
	LocalNotificationsPlugin,
	| "checkPermissions"
	| "requestPermissions"
	| "checkExactNotificationSetting"
	| "createChannel"
	| "schedule"
	| "update"
>;

export const cancelNativeAlert = Effect.fn("cancelNativeAlert")(function* (
	platform: Pick<LocalNotificationsPlugin, "cancel" | "removeDeliveredNotificationsById">,
	id: number,
) {
	yield* Effect.tryPromise(() => platform.cancel({ notifications: [{ id }] }));
	yield* Effect.tryPromise(() => platform.removeDeliveredNotificationsById({ ids: [id] }));
});

export const scheduleNativeAlert = Effect.fn("scheduleNativeAlert")(function* (
	platform: NativeAlerts,
	android: boolean,
	id: number,
	request: Extract<PluginDeviceRequest, { action: "schedule" }>,
) {
	let permission = yield* Effect.tryPromise(() => platform.checkPermissions());
	if (permission.display === "prompt" || permission.display === "prompt-with-rationale") {
		permission = yield* Effect.tryPromise(() => platform.requestPermissions());
	}
	if (permission.display !== "granted") {
		return { status: "denied" } as const;
	}
	if (Date.parse(request.deadline) <= (yield* Clock.currentTimeMillis)) {
		return { status: "done" } as const;
	}
	const exact =
		!android ||
		(yield* Effect.tryPromise(() => platform.checkExactNotificationSetting())).exact_alarm ===
			"granted";
	if (android) {
		yield* Effect.tryPromise(() =>
			platform.createChannel({
				importance: 4,
				vibration: false,
				name: "Timer alerts",
				id: "scheduled-audible",
			}),
		);
		yield* Effect.tryPromise(() =>
			platform.createChannel({
				importance: 2,
				vibration: false,
				id: "scheduled-silent",
				name: "Silent timer alerts",
			}),
		);
	}
	let sound: string | undefined;
	if (request.audible) {
		sound = "default";
	} else if (android) {
		sound = "silent.wav";
	}
	const notification = {
		id,
		sound,
		foreground: true,
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
	const result = yield* Effect.tryPromise(() =>
		platform.schedule({ notifications: [notification] }),
	);
	if (android && exact) {
		yield* Effect.tryPromise(() =>
			platform.update({ notifications: [{ ...notification, isExactNotification: true }] }),
		);
		const current = yield* Effect.tryPromise(() => platform.checkExactNotificationSetting());
		return {
			status: current.exact_alarm === "granted" && !result.warning ? "scheduled" : "inexact",
		} as const;
	}
	return { status: exact ? "scheduled" : "inexact" } as const;
});
