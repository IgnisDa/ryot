import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { NotificationChannelId } from "../../schema/brands";
import {
	CreateNotificationChannelBody,
	ListedNotificationChannel,
	NotificationNotFoundError,
	NotificationRequestError,
	UpdateNotificationChannelBody,
} from "./schemas";

export const NotificationsGroup = HttpApiGroup.make("notifications")
	.annotate(OpenApi.Description, "Manage and test notification channels.")
	.add(
		HttpApiEndpoint.post("createChannel", "/notifications/channels", {
			payload: CreateNotificationChannelBody,
			error: [NotificationRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ id: NotificationChannelId }).pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Create a notification channel."),
	)
	.add(
		HttpApiEndpoint.patch("updateChannel", "/notifications/channels/:channelId", {
			success: ListedNotificationChannel,
			payload: UpdateNotificationChannelBody,
			params: { channelId: NotificationChannelId },
			error: [NotificationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Update a notification channel by ID."),
	)
	.add(
		HttpApiEndpoint.delete("deleteChannel", "/notifications/channels/:channelId", {
			params: { channelId: NotificationChannelId },
			success: Schema.Struct({ id: NotificationChannelId }),
			error: [NotificationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Delete a notification channel by ID."),
	)
	.add(
		HttpApiEndpoint.post("testChannels", "/notifications/channels/test", {
			success: Schema.Void.pipe(HttpApiSchema.status(202)),
		}).annotate(OpenApi.Description, "Send a test notification through configured channels."),
	)
	.middleware(AuthMiddleware);
