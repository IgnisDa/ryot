import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { AutomationRuleId, SignalSchemaId } from "../../schema/brands";
import {
	CatalogSignalSchema,
	InstalledNotificationRule,
	InstallNotificationRuleBody,
} from "./schemas";

const ruleIdParam = HttpApiSchema.param("ruleId", AutomationRuleId);
const signalSchemaIdParam = HttpApiSchema.param("signalSchemaId", SignalSchemaId);

export const AutomationsGroup = HttpApiGroup.make("automations")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listCatalog", "/automations/catalog").addSuccess(
			Schema.Array(CatalogSignalSchema),
		),
	)
	.add(
		HttpApiEndpoint.get("getCatalog")`/automations/catalog/${signalSchemaIdParam}`
			.addSuccess(CatalogSignalSchema)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("listRules", "/automations/rules").addSuccess(
			Schema.Array(InstalledNotificationRule),
		),
	)
	.add(
		HttpApiEndpoint.get("getRule")`/automations/rules/${ruleIdParam}`
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("installRule", "/automations/rules")
			.setPayload(InstallNotificationRuleBody)
			.addSuccess(InstalledNotificationRule, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.post("activateRule")`/automations/rules/${ruleIdParam}/activate`
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("deactivateRule")`/automations/rules/${ruleIdParam}/deactivate`
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("deleteRule")`/automations/rules/${ruleIdParam}`
			.addSuccess(Schema.Struct({ id: AutomationRuleId }))
			.addError(NotFound, { status: 404 }),
	);
