import { AutomationRuleId, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	table,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const notificationSubscription = table("notificationSubscription", "notificationSubscription");
const selection = {
	id: selectedField(column(notificationSubscription, "id"), AutomationRuleId),
	isActive: selectedField(column(notificationSubscription, "isActive"), Schema.Boolean),
	createdAt: selectedField(column(notificationSubscription, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(notificationSubscription, "updatedAt"), IsoDateString),
	signalSchemaSlug: selectedField(
		column(notificationSubscription, "signalSchemaSlug"),
		SignalSchemaSlug,
	),
};

export const notificationSubscriptionsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit: number }) => ({
		map: ({ notificationSubscriptions }) => Result.succeed(notificationSubscriptions),
		queries: {
			notificationSubscriptions: selectedRows(notificationSubscription, {
				selection,
				after: input.after,
				limit: input.limit,
				orderBy: [
					ascending(column(notificationSubscription, "signalSchemaSlug")),
					ascending(column(notificationSubscription, "id")),
				],
			}),
		},
	}),
);

export const notificationSubscriptionRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ notificationSubscription: subscription }) => Result.succeed(subscription),
	queries: {
		notificationSubscription: selectedOptionalRow(notificationSubscription, {
			selection,
			orderBy: [ascending(column(notificationSubscription, "id"))],
			where: eq(column(notificationSubscription, "id"), literal(input.id)),
		}),
	},
}));

export type NotificationSubscriptionList = Recipe.Success<typeof notificationSubscriptionsRecipe>;
export type NotificationSubscription = NonNullable<
	Recipe.Success<typeof notificationSubscriptionRecipe>
>;
