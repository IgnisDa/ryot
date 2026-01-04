import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
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
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.addError(NotFound, { status: 404 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listChannels", "/notifications/channels").addSuccess(
			Schema.Array(ListedNotificationChannel),
		),
	)
	.add(
		HttpApiEndpoint.post("createChannel", "/notifications/channels")
			.setPayload(CreateNotificationChannelBody)
			.addSuccess(Schema.Struct({ id: NotificationChannelId }), { status: 201 }),
	)
	.add(
		HttpApiEndpoint.patch("updateChannel")`/notifications/channels/${channelIdParam}`
			.setPayload(UpdateNotificationChannelBody)
			.addSuccess(ListedNotificationChannel),
	)
	.add(
		HttpApiEndpoint.del("deleteChannel")`/notifications/channels/${channelIdParam}`.addSuccess(
			Schema.Struct({ id: NotificationChannelId }),
		),
	)
	.add(
		HttpApiEndpoint.post("testChannels", "/notifications/channels/test").addSuccess(Schema.Void, {
			status: 202,
		}),
	);
