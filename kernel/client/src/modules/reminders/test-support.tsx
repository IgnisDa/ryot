import type { ReminderDeliveryConfiguration } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, NotificationSubscriptionId, ReminderId } from "@ryot-app/contract/schema/brands";
import type { RyotClientError } from "@ryot-app/plugin-client-sdk";
import type { RemindersResult } from "@ryot-app/ryotql-recipes/reminders";
import { Effect, Layer } from "effect";
import type { ReactNode } from "react";

import type { AutomationsApi } from "#/api/automations";
import { makeAutomationsApi, makeRemindersApi } from "#/api/ports.test-layer";
import type { RemindersApi } from "#/api/reminders";
import { type HostedTestQueryDocument, mountHostedTestScreen } from "#/host-screen.test-support";

export type ReminderTestRow = RemindersResult["items"][number];

export type ReminderTestQuery = (
	document: HostedTestQueryDocument,
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

export const defaultReminderQueryResponse = (document: HostedTestQueryDocument): unknown => {
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
	const queryDocuments: HostedTestQueryDocument[] = [];
	const screen = mountHostedTestScreen(content, {
		routes: {
			"/e/$entityId": <p>Entity</p>,
			"/settings/notification-channels": <p>Notification channels</p>,
		},
		query: (document) => {
			queryDocuments.push(document);
			return options.query?.(document) ?? Effect.succeed(defaultReminderQueryResponse(document));
		},
		layer: Layer.mergeAll(
			makeRemindersApi({
				deliveryConfiguration: () =>
					Effect.succeed(options.deliveryConfiguration ?? defaultReminderDeliveryConfiguration),
				...options.remindersApi,
			}),
			makeAutomationsApi(options.automationsApi),
		),
	});
	return { ...screen, queryDocuments };
};
