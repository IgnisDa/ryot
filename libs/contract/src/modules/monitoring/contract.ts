import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { MonitoringStatus } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const MonitoringGroup = HttpApiGroup.make("monitoring")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("status")`/monitoring/${entityIdParam}`
			.addSuccess(MonitoringStatus)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.put("enable")`/monitoring/${entityIdParam}`
			.addSuccess(MonitoringStatus)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("disable")`/monitoring/${entityIdParam}`
			.addSuccess(MonitoringStatus)
			.addError(NotFound, { status: 404 }),
	);
