import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { NotificationChannelId } from "../../schema/brands";
import {
	CreateNotificationChannelBody,
	ListedNotificationChannel,
	UpdateNotificationChannelBody,
} from "./schemas";

export const NotificationsGroup = HttpApiGroup.make("notifications")
	.annotate(OpenApi.Description, "Manage and test notification channels.")
	.add(
		HttpApiEndpoint.get("listChannels", "/notifications/channels", {
			success: Schema.Array(ListedNotificationChannel),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "List configured notification channels."),
	)
	.add(
		HttpApiEndpoint.post("createChannel", "/notifications/channels", {
			payload: CreateNotificationChannelBody,
			success: Schema.Struct({ id: NotificationChannelId }).pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create a notification channel."),
	)
	.add(
		HttpApiEndpoint.patch("updateChannel", "/notifications/channels/:channelId", {
			params: { channelId: NotificationChannelId },
			payload: UpdateNotificationChannelBody,
			success: ListedNotificationChannel,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Update a notification channel by ID."),
	)
	.add(
		HttpApiEndpoint.delete("deleteChannel", "/notifications/channels/:channelId", {
			params: { channelId: NotificationChannelId },
			success: Schema.Struct({ id: NotificationChannelId }),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Delete a notification channel by ID."),
	)
	.add(
		HttpApiEndpoint.post("testChannels", "/notifications/channels/test", {
			success: Schema.Void.pipe(HttpApiSchema.status(202)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Send a test notification through configured channels."),
	)
	.middleware(AuthMiddleware);
