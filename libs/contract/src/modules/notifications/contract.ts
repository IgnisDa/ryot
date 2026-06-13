import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { NotificationPlatformId } from "../../schema/brands";
import {
	CreateNotificationPlatformBody,
	ListedNotificationPlatform,
	NotificationDeliveryResult,
	UpdateNotificationPlatformBody,
} from "./schemas";

const platformIdParam = HttpApiSchema.param("platformId", NotificationPlatformId);

export const NotificationsGroup = HttpApiGroup.make("notifications")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.addError(NotFound, { status: 404 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listPlatforms", "/notifications/platforms").addSuccess(
			Schema.Array(ListedNotificationPlatform),
		),
	)
	.add(
		HttpApiEndpoint.post("createPlatform", "/notifications/platforms")
			.setPayload(CreateNotificationPlatformBody)
			.addSuccess(Schema.Struct({ id: NotificationPlatformId }), { status: 201 }),
	)
	.add(
		HttpApiEndpoint.patch("updatePlatform")`/notifications/platforms/${platformIdParam}`
			.setPayload(UpdateNotificationPlatformBody)
			.addSuccess(ListedNotificationPlatform),
	)
	.add(
		HttpApiEndpoint.del("deletePlatform")`/notifications/platforms/${platformIdParam}`.addSuccess(
			Schema.Struct({ id: NotificationPlatformId }),
		),
	)
	.add(
		HttpApiEndpoint.post("testPlatforms", "/notifications/platforms/test").addSuccess(
			Schema.Array(NotificationDeliveryResult),
		),
	);
