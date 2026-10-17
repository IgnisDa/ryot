import { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	column,
	defineRecipe,
	descending,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const notificationChannelsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit: number }) => {
		const notificationChannel = table("notificationChannel", "notificationChannel");
		return {
			map: ({ notificationChannels }) => Result.succeed(notificationChannels),
			queries: {
				notificationChannels: selectedRows(notificationChannel, {
					after: input.after,
					limit: input.limit,
					orderBy: [
						descending(column(notificationChannel, "createdAt")),
						descending(column(notificationChannel, "id")),
					],
					selection: {
						id: selectedField(column(notificationChannel, "id"), NotificationChannelId),
						createdAt: selectedField(column(notificationChannel, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(notificationChannel, "updatedAt"), IsoDateString),
						isDisabled: selectedField(column(notificationChannel, "isDisabled"), Schema.Boolean),
						description: selectedField(column(notificationChannel, "description"), Schema.String),
						channel: selectedField(column(notificationChannel, "channel"), NotificationChannelKind),
					},
				}),
			},
		};
	},
);

export type NotificationChannelsResult = Recipe.Success<typeof notificationChannelsRecipe>;

export type NotificationChannelSummary = NotificationChannelsResult["items"][number];
