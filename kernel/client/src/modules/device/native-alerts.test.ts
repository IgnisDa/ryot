import { expect } from "bun:test";

import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Text } from "@ryot-app/i18n/text";
import type { PluginDeviceRequest } from "@ryot-app/plugin-client-contract";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { DateTime, Effect } from "effect";

import {
	cancelNativeAlert,
	createNativeAlertChannels,
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
	pluginId: PluginId.make("other"),
	deadline: "2030-01-01T00:00:00.000Z",
	target: {
		search: "",
		path: "/editor",
		kind: "plugin-route",
		packageId: PluginPackageId.make("ryot/other"),
	},
};

it.effect(
	"cancels both pending and delivered instances of a native alert",
	() =>
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
	testTimeout,
);

it.effect(
	"creates both alert channels with the supplied names",
	() =>
		Effect.gen(function* () {
			const channels: unknown[] = [];
			yield* createNativeAlertChannels(
				{
					createChannel: (channel) => {
						channels.push(channel);
						return Promise.resolve();
					},
				},
				{ silent: Text("Silent"), audible: Text("Audible") },
			);
			expect(channels).toEqual([
				{ importance: 4, name: "Audible", vibration: false, id: "scheduled-audible" },
				{ importance: 2, name: "Silent", vibration: false, id: "scheduled-silent" },
			]);
		}),
	testTimeout,
);

it.effect(
	"classifies unavailable channel calls separately from other platform failures",
	() =>
		Effect.gen(function* () {
			const names = { silent: Text("Silent"), audible: Text("Audible") };
			const unavailable = yield* Effect.flip(
				createNativeAlertChannels(
					{
						createChannel: () =>
							Promise.reject(Object.assign(new Error("not available"), { code: "UNAVAILABLE" })),
					},
					names,
				),
			);
			expect(unavailable._tag).toBe("AlertChannelsUnsupported");
			const failed = yield* Effect.flip(
				createNativeAlertChannels(
					{ createChannel: () => Promise.reject(new Error("failed")) },
					names,
				),
			);
			expect(failed._tag).toBe("DevicePlatformError");
		}),
	testTimeout,
);

const deliveredHarness = (notifications: { id: number; body: string; title: string }[]) => {
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

it.effect(
	"removes every delivered native notification",
	() =>
		Effect.gen(function* () {
			const state = deliveredHarness([
				{ id: 7, title: "Delivered 7", body: "Delivered notification" },
				{ id: 8, title: "Delivered 8", body: "Delivered notification" },
			]);
			yield* removeDeliveredNativeAlerts(state.platform);
			expect(state.removedIds).toEqual([[7, 8]]);
		}),
	testTimeout,
);

it.effect(
	"does not call removal when there are no delivered notifications",
	() =>
		Effect.gen(function* () {
			const state = deliveredHarness([]);
			yield* removeDeliveredNativeAlerts(state.platform);
			expect(state.removedIds).toEqual([]);
		}),
	testTimeout,
);

const harness = (options: { exact?: boolean; denied?: boolean } = {}) => {
	const calls: Parameters<NativeAlerts["schedule"]>[0][] = [];
	const updates: Parameters<NativeAlerts["update"]>[0][] = [];
	let prompted = 0;
	const adapter: NativeAlerts = {
		checkPermissions: () => Promise.resolve({ display: "prompt" }),
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
	return { calls, adapter, updates, prompted: () => prompted };
};

it.effect(
	"uses inexact Android scheduling without opening system settings",
	() =>
		Effect.gen(function* () {
			const h = harness();
			expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({
				status: "inexact",
			});
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
	testTimeout,
);

it.effect(
	"upgrades to exact scheduling through the non-prompting update path",
	() =>
		Effect.gen(function* () {
			const h = harness({ exact: true });
			expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({
				status: "scheduled",
			});
			expect(h.calls[0]?.notifications[0]?.isExactNotification).toBe(false);
			expect(h.updates[0]?.notifications[0]?.isExactNotification).toBe(true);
		}),
	testTimeout,
);

it.effect(
	"does not schedule after notification permission is denied",
	() =>
		Effect.gen(function* () {
			const h = harness({ denied: true });
			expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({ status: "denied" });
			expect(h.calls).toEqual([]);
		}),
	testTimeout,
);

it.effect(
	"reports permission revocation during scheduling without requesting exact access",
	() =>
		Effect.gen(function* () {
			const h = harness({ exact: true });
			h.adapter.update = (input) => {
				h.updates.push(input);
				h.adapter.checkExactNotificationSetting = () => Promise.resolve({ exact_alarm: "denied" });
				return Promise.resolve({ notifications: [{ id: 7 }] });
			};
			expect(yield* scheduleNativeAlert(h.adapter, true, 7, request)).toEqual({
				status: "inexact",
			});
		}),
	testTimeout,
);

it.effect(
	"selects a quiet Android channel and bundled silence for pre-channel devices",
	() =>
		Effect.gen(function* () {
			const h = harness({ exact: true });
			expect(
				yield* scheduleNativeAlert(h.adapter, true, 7, { ...request, audible: false }),
			).toEqual({ status: "scheduled" });
			expect(h.calls[0]?.notifications[0]).toMatchObject({
				sound: "silent.wav",
				channelId: "scheduled-silent",
			});
		}),
	testTimeout,
);

it.effect(
	"leaves iOS muted alerts without a sound and never checks Android alarm settings",
	() =>
		Effect.gen(function* () {
			const h = harness();
			h.adapter.checkExactNotificationSetting = () => {
				throw new Error("Android only");
			};
			expect(
				yield* scheduleNativeAlert(h.adapter, false, 7, { ...request, audible: false }),
			).toEqual({ status: "scheduled" });
			expect(h.calls[0]?.notifications[0]?.sound).toBeUndefined();
		}),
	testTimeout,
);

it.effect(
	"schedules audible iOS alerts in the background without Android settings",
	() =>
		Effect.gen(function* () {
			const h = harness();
			h.adapter.checkExactNotificationSetting = () => {
				throw new Error("Android only");
			};
			expect(yield* scheduleNativeAlert(h.adapter, false, 7, request)).toEqual({
				status: "scheduled",
			});
			expect(h.calls[0]?.notifications[0]).toMatchObject({ sound: "default", foreground: false });
		}),
	testTimeout,
);
