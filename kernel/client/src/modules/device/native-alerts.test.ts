import { expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PluginDeviceRequest } from "@ryot-app/plugin-client-contract";
import { DateTime, Effect } from "effect";

import {
	cancelNativeAlert,
	removeDeliveredNativeAlerts,
	scheduleNativeAlert,
} from "#/modules/device/native-alerts";

type NativeAlerts = Parameters<typeof scheduleNativeAlert>[0];
const request: Extract<PluginDeviceRequest, { action: "schedule" }> = {
	body: "",
	key: "rest",
	audible: true,
	action: "schedule",
	title: "Rest complete",
	pluginId: PluginId.make("fitness"),
	deadline: "2030-01-01T00:00:00.000Z",
	target: {
		search: "",
		path: "/editor",
		kind: "plugin-route",
		packageId: PluginPackageId.make("ryot/fitness"),
	},
};

it.effect("cancels both pending and delivered instances of a native alert", () =>
	Effect.gen(function* () {
		const pending: unknown[] = [];
		const delivered: unknown[] = [];
		yield* cancelNativeAlert(
			{
				cancel: (input) => {
					pending.push(input);
					return Promise.resolve();
				},
				removeDeliveredNotificationsById: (input) => {
					delivered.push(input);
					return Promise.resolve();
				},
			},
			7,
		);
		expect(pending).toEqual([{ notifications: [{ id: 7 }] }]);
		expect(delivered).toEqual([{ ids: [7] }]);
	}),
);

const deliveredHarness = (notifications: { id: number; title: string; body: string }[]) => {
	const removedIds: number[][] = [];
	return {
		removedIds,
		platform: {
			getDeliveredNotifications: () => Promise.resolve({ notifications }),
			removeDeliveredNotificationsById: ({ ids }: { ids: number[] }) => {
				removedIds.push(ids);
				return Promise.resolve();
			},
		},
	};
};

it.effect("removes every delivered native notification", () =>
	Effect.gen(function* () {
		const state = deliveredHarness([
			{ id: 7, title: "Delivered 7", body: "Delivered notification" },
			{ id: 8, title: "Delivered 8", body: "Delivered notification" },
		]);
		yield* removeDeliveredNativeAlerts(state.platform);
		expect(state.removedIds).toEqual([[7, 8]]);
	}),
);

it.effect("does not call removal when there are no delivered notifications", () =>
	Effect.gen(function* () {
		const state = deliveredHarness([]);
		yield* removeDeliveredNativeAlerts(state.platform);
		expect(state.removedIds).toEqual([]);
	}),
);

const harness = (options: { denied?: boolean; exact?: boolean } = {}) => {
	const calls: Parameters<NativeAlerts["schedule"]>[0][] = [];
	const channels: Parameters<NativeAlerts["createChannel"]>[0][] = [];
	const updates: Parameters<NativeAlerts["update"]>[0][] = [];
	let prompted = 0;
	const adapter: NativeAlerts = {
		checkPermissions: () => Promise.resolve({ display: "prompt" }),
		createChannel: (channel) => {
			channels.push(channel);
			return Promise.resolve();
		},
		schedule: (input) => {
			calls.push(input);
			return Promise.resolve({ notifications: [{ id: 7 }] });
		},
		update: (input) => {
			updates.push(input);
			return Promise.resolve({ notifications: [{ id: 7 }] });
		},
		checkExactNotificationSetting: () =>
			Promise.resolve({ exact_alarm: options.exact ? "granted" : "denied" }),
		requestPermissions: () => {
			prompted++;
			return Promise.resolve({ display: options.denied ? "denied" : "granted" });
		},
	};
	return { calls, adapter, updates, channels, prompted: () => prompted };
};

it.effect("uses inexact Android scheduling without opening system settings", () =>
	Effect.gen(function* () {
		const h = harness();
		expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({ status: "inexact" });
		expect(h.calls).toEqual([
			{
				notifications: [
					{
						id: 7,
						body: "",
						sound: "default",
						foreground: false,
						title: "Rest complete",
						isExactMandatory: false,
						isExactNotification: false,
						channelId: "scheduled-audible",
						schedule: {
							repeats: false,
							allowWhileIdle: true,
							at: DateTime.toDateUtc(DateTime.makeUnsafe(request.deadline)),
						},
					},
				],
			},
		]);
		expect(h.prompted()).toBe(1);
	}),
);

it.effect("upgrades to exact scheduling through the non-prompting update path", () =>
	Effect.gen(function* () {
		const h = harness({ exact: true });
		expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({
			status: "scheduled",
		});
		expect(h.calls[0]?.notifications[0]?.isExactNotification).toBe(false);
		expect(h.updates[0]?.notifications[0]?.isExactNotification).toBe(true);
	}),
);

it.effect("does not schedule after notification permission is denied", () =>
	Effect.gen(function* () {
		const h = harness({ denied: true });
		expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({ status: "denied" });
		expect(h.calls).toEqual([]);
		expect(h.channels).toEqual([]);
	}),
);

it.effect("reports permission revocation during scheduling without requesting exact access", () =>
	Effect.gen(function* () {
		const h = harness({ exact: true });
		h.adapter.update = (input) => {
			h.updates.push(input);
			h.adapter.checkExactNotificationSetting = () => Promise.resolve({ exact_alarm: "denied" });
			return Promise.resolve({ notifications: [{ id: 7 }] });
		};
		expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({ status: "inexact" });
	}),
);

it.effect("selects a quiet Android channel and bundled silence for pre-channel devices", () =>
	Effect.gen(function* () {
		const h = harness({ exact: true });
		expect(yield* scheduleNativeAlert(h.adapter, true, 7, { ...request, audible: false })).toEqual({
			status: "scheduled",
		});
		expect(h.calls[0]?.notifications[0]).toMatchObject({
			sound: "silent.wav",
			channelId: "scheduled-silent",
		});
		expect(h.channels).toContainEqual({
			importance: 2,
			vibration: false,
			id: "scheduled-silent",
			name: "Silent timer alerts",
		});
	}),
);

it.effect("leaves iOS muted alerts without a sound and never checks Android alarm settings", () =>
	Effect.gen(function* () {
		const h = harness();
		h.adapter.checkExactNotificationSetting = () => {
			throw new Error("Android only");
		};
		expect(yield* scheduleNativeAlert(h.adapter, false, 7, { ...request, audible: false })).toEqual(
			{ status: "scheduled" },
		);
		expect(h.calls[0]?.notifications[0]?.sound).toBeUndefined();
		expect(h.channels).toEqual([]);
	}),
);

it.effect("schedules audible iOS alerts in the background without Android settings", () =>
	Effect.gen(function* () {
		const h = harness();
		h.adapter.checkExactNotificationSetting = () => {
			throw new Error("Android only");
		};
		expect(yield* scheduleNativeAlert(h.adapter, false, 7, request)).toEqual({
			status: "scheduled",
		});
		expect(h.calls[0]?.notifications[0]).toMatchObject({ sound: "default", foreground: false });
		expect(h.channels).toEqual([]);
	}),
);
