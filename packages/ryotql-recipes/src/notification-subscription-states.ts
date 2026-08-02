import { AutomationRuleId, SignalSchemaSlug } from "@ryot/contract/schema/brands";
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
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const notificationSubscriptionState = table(
	"notificationSubscriptionState",
	"notificationSubscriptionState",
);
const selection = {
	id: selectedField(column(notificationSubscriptionState, "id"), AutomationRuleId),
	isActive: selectedField(column(notificationSubscriptionState, "isActive"), Schema.Boolean),
	createdAt: selectedField(column(notificationSubscriptionState, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(notificationSubscriptionState, "updatedAt"), IsoDateString),
	signalSchemaSlug: selectedField(
		column(notificationSubscriptionState, "signalSchemaSlug"),
		SignalSchemaSlug,
	),
};

export const notificationSubscriptionStatesRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit: number }) => ({
		queries: {
			notificationSubscriptionStates: selectedRows(notificationSubscriptionState, {
				after: input.after,
				limit: input.limit,
				selection,
				orderBy: [
					ascending(column(notificationSubscriptionState, "signalSchemaSlug")),
					ascending(column(notificationSubscriptionState, "id")),
				],
			}),
		},
		map: ({ notificationSubscriptionStates }) => Result.succeed(notificationSubscriptionStates),
	}),
);

export const notificationSubscriptionStateRecipe = defineRecipe(
	(input: { readonly id: string }) => ({
		queries: {
			notificationSubscriptionState: selectedOptionalRow(notificationSubscriptionState, {
				selection,
				orderBy: [ascending(column(notificationSubscriptionState, "id"))],
				where: eq(column(notificationSubscriptionState, "id"), literal(input.id)),
			}),
		},
		map: ({ notificationSubscriptionState: state }) => Result.succeed(state),
	}),
);

export type NotificationSubscriptionStateList = Recipe.Success<
	typeof notificationSubscriptionStatesRecipe
>;
export type NotificationSubscriptionState = NonNullable<
	Recipe.Success<typeof notificationSubscriptionStateRecipe>
>;
