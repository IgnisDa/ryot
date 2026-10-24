import {
	NotificationDeliveryReason,
	NotificationDeliveryResult,
	NotificationOutcome,
} from "@ryot-app/contract/modules/notifications/delivery";
import {
	column,
	defineRecipe,
	descending,
	eq,
	join,
	literal,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const notificationOutcomeRecipe = defineRecipe((input: { readonly id: string }) => {
	const notification = table("notification", "notification");
	return {
		map: ({ notifications }) => Result.succeed(notifications.items[0] ?? null),
		queries: {
			notifications: selectedRows(notification, {
				limit: 1,
				orderBy: [descending(column(notification, "id"))],
				where: eq(column(notification, "id"), literal(input.id)),
				selection: {
					id: selectedField(column(notification, "id"), Schema.String),
					createdAt: selectedField(column(notification, "createdAt"), IsoDateString),
					settledAt: selectedField(column(notification, "settledAt"), Schema.NullOr(IsoDateString)),
					outcome: selectedField(
						column(notification, "outcome"),
						Schema.NullOr(NotificationOutcome),
					),
					state: selectedField(
						column(notification, "state"),
						Schema.Literals(["admitted", "settled"]),
					),
					reason: selectedField(
						column(notification, "reason"),
						Schema.NullOr(NotificationDeliveryReason),
					),
				},
			}),
		},
	};
});

export const notificationDeliveriesRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly notificationId: string;
		readonly after?: string | undefined;
	}) => {
		const delivery = table("notificationDelivery", "delivery");
		return {
			map: ({ deliveries }) => Result.succeed(deliveries),
			queries: {
				deliveries: selectedRows(delivery, {
					limit: input.limit,
					after: input.after,
					orderBy: [descending(column(delivery, "id"))],
					where: eq(column(delivery, "notificationId"), literal(input.notificationId)),
					selection: {
						id: selectedField(column(delivery, "id"), Schema.String),
						description: selectedField(column(delivery, "description"), Schema.String),
						claimedAt: selectedField(column(delivery, "claimedAt"), Schema.NullOr(IsoDateString)),
						settledAt: selectedField(column(delivery, "settledAt"), Schema.NullOr(IsoDateString)),
						status: selectedField(
							column(delivery, "status"),
							NotificationDeliveryResult.fields.status,
						),
						reason: selectedField(
							column(delivery, "reason"),
							Schema.NullOr(NotificationDeliveryReason),
						),
						channel: selectedField(
							column(delivery, "channel"),
							NotificationDeliveryResult.fields.channel,
						),
						channelId: selectedField(
							column(delivery, "channelId"),
							NotificationDeliveryResult.fields.channelId,
						),
					},
				}),
			},
		};
	},
);

export type NotificationOutcomeResult = Recipe.Success<typeof notificationOutcomeRecipe>;
export type NotificationDeliveriesResult = Recipe.Success<typeof notificationDeliveriesRecipe>;

export const reminderDeliveriesRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly reminderId: string;
		readonly after?: string | undefined;
	}) => {
		const delivery = table("notificationDelivery", "delivery");
		const notification = table("notification", "notification");
		return {
			map: ({ deliveries }) => Result.succeed(deliveries),
			queries: {
				deliveries: selectedRows(delivery, {
					limit: input.limit,
					after: input.after,
					orderBy: [descending(column(delivery, "id"))],
					where: eq(column(notification, "reminderId"), literal(input.reminderId)),
					joins: [
						join(
							"inner",
							notification,
							eq(column(notification, "id"), column(delivery, "notificationId")),
						),
					],
					selection: {
						id: selectedField(column(delivery, "id"), Schema.String),
						description: selectedField(column(delivery, "description"), Schema.String),
						status: selectedField(
							column(delivery, "status"),
							NotificationDeliveryResult.fields.status,
						),
						reason: selectedField(
							column(delivery, "reason"),
							Schema.NullOr(NotificationDeliveryReason),
						),
						channel: selectedField(
							column(delivery, "channel"),
							NotificationDeliveryResult.fields.channel,
						),
					},
				}),
			},
		};
	},
);
export type ReminderDeliveriesResult = Recipe.Success<typeof reminderDeliveriesRecipe>;
