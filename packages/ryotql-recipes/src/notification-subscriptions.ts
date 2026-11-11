import {
	NotificationSubscriptionId,
	PluginId,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const notificationSubscription = table("notificationSubscription", "notificationSubscription");
const selection = {
	id: selectedField(column(notificationSubscription, "id"), NotificationSubscriptionId),
	isActive: selectedField(column(notificationSubscription, "isActive"), Schema.Boolean),
	createdAt: selectedField(column(notificationSubscription, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(notificationSubscription, "updatedAt"), IsoDateString),
	signalSchemaSlug: selectedField(
		column(notificationSubscription, "signalSchemaSlug"),
		SignalSchemaSlug,
	),
	signalSchemaPluginId: selectedField(
		column(notificationSubscription, "signalSchemaPluginId"),
		Schema.NullOr(PluginId),
	),
};

export const notificationSubscriptionsRecipe = defineRecipe({
	map: ({ notificationSubscriptions }) => Result.succeed(notificationSubscriptions),
	queries: {
		notificationSubscriptions: selectedRows(notificationSubscription, {
			selection,

			limit: 20,
			maxLimit: 1000,
			orderBy: [
				ascending(column(notificationSubscription, "signalSchemaSlug")),
				ascending(column(notificationSubscription, "id")),
			],
		}),
	},
});

export const notificationSubscriptionRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			id: {
				label: "id",
				type: "string",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ notificationSubscription: subscription }) => Result.succeed(subscription),
		queries: {
			notificationSubscription: selectedOptionalRow(notificationSubscription, {
				selection,
				orderBy: [ascending(column(notificationSubscription, "id"))],
				where: eq(column(notificationSubscription, "id"), recipeParameters.value("id")),
			}),
		},
	});
})();

export type NotificationSubscriptionList = Recipe.Success<typeof notificationSubscriptionsRecipe>;
export type NotificationSubscription = NonNullable<
	Recipe.Success<typeof notificationSubscriptionRecipe>
>;
