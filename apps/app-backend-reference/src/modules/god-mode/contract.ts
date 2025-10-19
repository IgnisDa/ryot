import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AdminMiddleware } from "../../lib/auth";
import { Unauthorized } from "../../lib/errors";
import { SystemStatus } from "./schemas";

export const GodModeGroup = HttpApiGroup.make("god-mode")
	.add(
		HttpApiEndpoint.get("systemStatus", "/god-mode/status")
			.addSuccess(SystemStatus)
			.addError(Unauthorized, { status: 401 })
			.middleware(AdminMiddleware),
	)
	.annotate(
		OpenApi.Description,
		"Admin-only operations protected by the X-Admin-Access-Token header",
	);
