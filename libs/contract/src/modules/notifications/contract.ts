import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { NotificationChannelId } from "../../schema/brands";
import {
	CreateNotificationChannelBody,
	ListedNotificationChannel,
	UpdateNotificationChannelBody,
} from "./schemas";

const channelIdParam = HttpApiSchema.param("channelId", NotificationChannelId);

export const NotificationsGroup = HttpApiGroup.make("notifications")
	.annotate(OpenApi.Description, "Manage and test notification channels.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.addError(NotFound, { status: 404 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listChannels", "/notifications/channels")
			.annotate(OpenApi.Description, "List configured notification channels.")
			.addSuccess(Schema.Array(ListedNotificationChannel)),
	)
	.add(
		HttpApiEndpoint.post("createChannel", "/notifications/channels")
			.annotate(OpenApi.Description, "Create a notification channel.")
			.setPayload(CreateNotificationChannelBody)
			.addSuccess(Schema.Struct({ id: NotificationChannelId }), { status: 201 }),
	)
	.add(
		HttpApiEndpoint.patch("updateChannel")`/notifications/channels/${channelIdParam}`
			.annotate(OpenApi.Description, "Update a notification channel by ID.")
			.setPayload(UpdateNotificationChannelBody)
			.addSuccess(ListedNotificationChannel),
	)
	.add(
		HttpApiEndpoint.del("deleteChannel")`/notifications/channels/${channelIdParam}`
			.annotate(OpenApi.Description, "Delete a notification channel by ID.")
			.addSuccess(Schema.Struct({ id: NotificationChannelId })),
	)
	.add(
		HttpApiEndpoint.post("testChannels", "/notifications/channels/test")
			.annotate(OpenApi.Description, "Send a test notification through configured channels.")
			.addSuccess(Schema.Void, {
				status: 202,
			}),
	);
