import type { ReminderDeliveryConfiguration } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, NotificationSubscriptionId, ReminderId } from "@ryot-app/contract/schema/brands";
import type { RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import type { RemindersResult } from "@ryot-app/ryotql-recipes/reminders";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { ReactNode } from "react";

import type { AutomationsApi } from "#/api/automations";
import { ServerOrigin } from "#/api/origin";
import { makeAutomationsApi, makeRemindersApi } from "#/api/ports.test-layer";
import type { RemindersApi } from "#/api/reminders";
import { testHostServices } from "#/host-services.test-support";

export type ReminderTestRow = RemindersResult["items"][number];
export type ReminderTestQueryDocument = Parameters<RyotClientAdapter["query"]>[0];

export type ReminderTestQuery = (
	document: ReminderTestQueryDocument,
) => Effect.Effect<unknown, RyotClientError>;

const page = (items: readonly unknown[], hasMore = false, nextCursor: null | string = null) => ({
	items,
	type: "rows",
	pageInfo: { hasMore, limit: 20, nextCursor },
});

export const makeReminderRow = (overrides: Partial<ReminderTestRow> = {}): ReminderTestRow => ({
	revision: 4,
	reason: null,
	outcome: null,
	timezone: "UTC",
	settledAt: null,
	state: "scheduled",
	processingAt: null,
	replacementId: null,
	parentEntityId: null,
	message: "A reminder",
	originalSchedule: null,
	entityTitle: "Example target",
	id: ReminderId.make("reminder-1"),
	dueAt: "2026-11-02T12:00:00.000Z",
	entityId: EntityId.make("target-1"),
	createdAt: "2026-10-28T10:00:00.000Z",
	updatedAt: "2026-10-28T10:00:00.000Z",
	...overrides,
});

export const defaultReminderQueryResponse = (document: ReminderTestQueryDocument): unknown => {
	if ("reminders" in document.queries) {
		return { data: { reminders: page([]) } };
	}
	if ("channels" in document.queries && "subscriptions" in document.queries) {
		return {
			data: {
				channels: { type: "aggregate", items: [{ count: 1 }] },
				subscriptions: {
					...page([
						{ isActive: true, id: NotificationSubscriptionId.make("reminder-subscription-1") },
					]),
					pageInfo: { limit: 2, hasMore: false, nextCursor: null },
				},
			},
		};
	}
	if ("deliveries" in document.queries) {
		return { data: { deliveries: page([]) } };
	}
	return { data: {} };
};

export const defaultReminderDeliveryConfiguration: ReminderDeliveryConfiguration = {
	deliveryEnabled: true,
	dispatchersEnabled: true,
	scanSchedule: "every 5 minutes",
};

export const mountReminderTestScreen = (
	content: ReactNode,
	options: {
		readonly query?: ReminderTestQuery;
		readonly remindersApi?: Partial<RemindersApi["Service"]>;
		readonly automationsApi?: Partial<AutomationsApi["Service"]>;
		readonly deliveryConfiguration?: ReminderDeliveryConfiguration;
	} = {},
) => {
	const queryDocuments: ReminderTestQueryDocument[] = [];
	const clock = createTestRyotClock({
		query: (document) => {
			queryDocuments.push(document);
			return options.query?.(document) ?? Effect.succeed(defaultReminderQueryResponse(document));
		},
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			makeRemindersApi({
				deliveryConfiguration: () =>
					Effect.succeed(options.deliveryConfiguration ?? defaultReminderDeliveryConfiguration),
				...options.remindersApi,
			}),
			makeAutomationsApi(options.automationsApi),
		),
	);
	const root = createRootRoute({ component: Outlet });
	const main = createRoute({ path: "/", component: () => content, getParentRoute: () => root });
	const channels = createRoute({
		getParentRoute: () => root,
		path: "/settings/notification-channels",
		component: () => <p>Notification channels</p>,
	});
	const entity = createRoute({
		path: "/e/$entityId",
		getParentRoute: () => root,
		component: () => <p>Entity</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([main, channels, entity]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const view = render(
		<RyotProvider
			runtime={clock.runtime}
			hostServices={testHostServices(
				{ userId: "user-1", serverUrl: ServerOrigin.make("https://example.test") },
				runtime,
			)}
		>
			<RouterProvider router={router} />
		</RyotProvider>,
	);
	return {
		router,
		queryDocuments,
		advance: clock.advance,
		dispose: () => {
			view.unmount();
			return Effect.runPromise(Effect.all([runtime.disposeEffect, Effect.promise(clock.dispose)]));
		},
	};
};
