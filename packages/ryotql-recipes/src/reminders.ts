import { NotificationOutcome } from "@ryot-app/contract/modules/notifications/delivery";
import {
	ReminderReason,
	ReminderScheduleEvidence,
	ReminderState,
} from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, NotificationSubscriptionId, ReminderId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	countAll,
	defineRecipe,
	eq,
	inArray,
	isNull,
	literal,
	or,
	type Recipe,
	selectedAggregate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const remindersRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly after?: string | undefined;
		readonly entityId?: EntityId | undefined;
		readonly states: ReadonlyArray<ReminderState>;
	}) => {
		const reminder = table("reminder", "reminder");
		return {
			map: ({ reminders }) => Result.succeed(reminders),
			queries: {
				reminders: selectedRows(reminder, {
					limit: input.limit,
					after: input.after,
					orderBy: [
						ascending(column(reminder, "dueAt")),
						ascending(column(reminder, "createdAt")),
						ascending(column(reminder, "id")),
					],
					where: and(
						isNull(column(reminder, "removedAt")),
						inArray(column(reminder, "state"), input.states.map(literal)),
						...(input.entityId === undefined
							? []
							: [
									or(
										eq(column(reminder, "entityId"), literal(input.entityId)),
										eq(column(reminder, "parentEntityId"), literal(input.entityId)),
									),
								]),
					),
					selection: {
						id: selectedField(column(reminder, "id"), ReminderId),
						state: selectedField(column(reminder, "state"), ReminderState),
						revision: selectedField(column(reminder, "revision"), Schema.Int),
						createdAt: selectedField(column(reminder, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(reminder, "updatedAt"), IsoDateString),
						dueAt: selectedField(column(reminder, "dueAt"), Schema.NullOr(IsoDateString)),
						entityId: selectedField(column(reminder, "entityId"), Schema.NullOr(EntityId)),
						reason: selectedField(column(reminder, "reason"), Schema.NullOr(ReminderReason)),
						message: selectedField(column(reminder, "message"), Schema.NullOr(Schema.String)),
						timezone: selectedField(column(reminder, "timezone"), Schema.NullOr(Schema.String)),
						settledAt: selectedField(column(reminder, "settledAt"), Schema.NullOr(IsoDateString)),
						outcome: selectedField(column(reminder, "outcome"), Schema.NullOr(NotificationOutcome)),
						entityTitle: selectedField(
							column(reminder, "entityTitle"),
							Schema.NullOr(Schema.String),
						),
						replacementId: selectedField(
							column(reminder, "replacementId"),
							Schema.NullOr(ReminderId),
						),
						parentEntityId: selectedField(
							column(reminder, "parentEntityId"),
							Schema.NullOr(EntityId),
						),
						processingAt: selectedField(
							column(reminder, "processingAt"),
							Schema.NullOr(IsoDateString),
						),
						originalSchedule: selectedField(
							column(reminder, "originalSchedule"),
							Schema.NullOr(ReminderScheduleEvidence),
						),
					},
				}),
			},
		};
	},
);

export type RemindersResult = Recipe.Success<typeof remindersRecipe>;

export const reminderReadinessRecipe = defineRecipe(() => {
	const channel = table("notificationChannel", "channel");
	const subscription = table("notificationSubscription", "subscription");
	return {
		map: ({ channels, subscriptions }) =>
			Result.succeed({
				enabledChannels: channels.count,
				subscriptionId: subscriptions?.id ?? null,
				subscriptionEnabled: subscriptions?.isActive === true,
			}),
		queries: {
			channels: selectedAggregate(channel, {
				measures: { count: countAll },
				where: eq(column(channel, "isDisabled"), literal(false)),
			}),
			subscriptions: selectedOptionalRow(subscription, {
				orderBy: [ascending(column(subscription, "id"))],
				where: and(
					isNull(column(subscription, "signalSchemaPluginId")),
					eq(column(subscription, "signalSchemaSlug"), literal("reminder.due")),
				),
				selection: {
					id: selectedField(column(subscription, "id"), NotificationSubscriptionId),
					isActive: selectedField(column(subscription, "isActive"), Schema.Boolean),
				},
			}),
		},
	};
});
export type ReminderReadinessResult = Recipe.Success<typeof reminderReadinessRecipe>;
