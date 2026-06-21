import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { MediaMonitoringStatus } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const MediaMonitoringGroup = HttpApiGroup.make("mediaMonitoring")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("status")`/media-monitoring/${entityIdParam}`
			.addSuccess(MediaMonitoringStatus)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.put("enable")`/media-monitoring/${entityIdParam}`
			.addSuccess(MediaMonitoringStatus)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("disable")`/media-monitoring/${entityIdParam}`
			.addSuccess(MediaMonitoringStatus)
			.addError(NotFound, { status: 404 }),
	);
