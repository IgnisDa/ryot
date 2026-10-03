import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { NotificationChannelId } from "../../schema/brands";
import {
	CreateNotificationChannelBody,
	NotificationNotFoundError,
	NotificationRequestError,
	UpdateNotificationChannelBody,
} from "./schemas";

export const NotificationsGroup = HttpApiGroup.make("notifications")
	.annotate(OpenApi.Description, "Manage and test notification channels.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("createChannel", "/notifications/channels", {
			payload: CreateNotificationChannelBody,
			error: [NotificationRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ id: NotificationChannelId }).pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Create a notification channel."),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")(
			"updateChannel",
			"/notifications/channels/:channelId",
			{
				payload: UpdateNotificationChannelBody,
				params: { channelId: NotificationChannelId },
				success: Schema.Struct({ id: NotificationChannelId }),
				error: [NotificationNotFoundError.pipe(HttpApiSchema.status(404))],
			},
		).annotate(OpenApi.Description, "Update a notification channel by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"deleteChannel",
			"/notifications/channels/:channelId",
			{
				params: { channelId: NotificationChannelId },
				success: Schema.Struct({ id: NotificationChannelId }),
				error: [NotificationNotFoundError.pipe(HttpApiSchema.status(404))],
			},
		).annotate(OpenApi.Description, "Delete a notification channel by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")(
			"testChannels",
			"/notifications/channels/test",
			{ success: Schema.Void.pipe(HttpApiSchema.status(202)) },
		).annotate(OpenApi.Description, "Send a test notification through configured channels."),
	)
	.middleware(AuthMiddleware);
