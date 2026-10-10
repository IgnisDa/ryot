import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { synchronizeNativeAlerts } from "#/modules/device/native-alert-lifecycle";

type NativeAlertPlatform = Parameters<typeof synchronizeNativeAlerts>[0];
type PendingNotifications = Awaited<ReturnType<NativeAlertPlatform["getPending"]>>;
type DeliveredNotifications = Awaited<ReturnType<NativeAlertPlatform["getDeliveredNotifications"]>>;

const pendingFixture: PendingNotifications = {
	notifications: [{ id: 9, title: "Pending", body: "Pending notification" }],
};
const deliveredFixture: DeliveredNotifications = {
	notifications: [
		{ id: 7, title: "Delivered 7", body: "Delivered notification" },
		{ id: 8, title: "Delivered 8", body: "Delivered notification" },
	],
};

const harness = (delivered: DeliveredNotifications) => {
	const removedIds: number[][] = [];
	const platform: NativeAlertPlatform = {
		getPending: () => Promise.resolve(pendingFixture),
		getDeliveredNotifications: () => Promise.resolve(delivered),
		removeDeliveredNotificationsById: ({ ids }) => {
			removedIds.push(ids);
			return Promise.resolve();
		},
	};
	return { platform, removedIds };
};

it.effect(
	"removes delivered notifications when active and leaves pending notifications unchanged",
	() =>
		Effect.gen(function* () {
			const state = harness(deliveredFixture);
			yield* synchronizeNativeAlerts(state.platform, true);
			expect(state.removedIds).toEqual([[7, 8]]);
		}),
);

it.effect("does not remove delivered notifications when inactive", () =>
	Effect.gen(function* () {
		const state = harness(deliveredFixture);
		yield* synchronizeNativeAlerts(state.platform, false);
		expect(state.removedIds).toEqual([]);
	}),
);

it.effect("does not call removal when there are no delivered notifications", () =>
	Effect.gen(function* () {
		const state = harness({ notifications: [] });
		yield* synchronizeNativeAlerts(state.platform, true);
		expect(state.removedIds).toEqual([]);
	}),
);
