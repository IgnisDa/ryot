import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { AutomationRuleId, SignalSchemaSlug } from "../../schema/brands";
import {
	CatalogSignalSchema,
	InstalledNotificationRule,
	InstallNotificationRuleBody,
} from "./schemas";

const ruleIdParam = HttpApiSchema.param("ruleId", AutomationRuleId);
const signalSchemaSlugParam = HttpApiSchema.param("signalSchemaSlug", SignalSchemaSlug);

export const AutomationsGroup = HttpApiGroup.make("automations")
	.annotate(OpenApi.Description, "Manages automation catalogs and notification rules.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listCatalog", "/automations/catalog")
			.annotate(OpenApi.Description, "Lists available automation signal schemas.")
			.addSuccess(Schema.Array(CatalogSignalSchema)),
	)
	.add(
		HttpApiEndpoint.get("getCatalog")`/automations/catalog/${signalSchemaSlugParam}`
			.annotate(OpenApi.Description, "Returns an automation signal schema from the catalog.")
			.addSuccess(CatalogSignalSchema)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("listRules", "/automations/rules")
			.annotate(OpenApi.Description, "Lists installed notification rules.")
			.addSuccess(Schema.Array(InstalledNotificationRule)),
	)
	.add(
		HttpApiEndpoint.get("getRule")`/automations/rules/${ruleIdParam}`
			.annotate(OpenApi.Description, "Returns an installed notification rule.")
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("installRule", "/automations/rules")
			.annotate(OpenApi.Description, "Installs a notification rule.")
			.setPayload(InstallNotificationRuleBody)
			.addSuccess(InstalledNotificationRule, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.post("activateRule")`/automations/rules/${ruleIdParam}/activate`
			.annotate(OpenApi.Description, "Activates an installed notification rule.")
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("deactivateRule")`/automations/rules/${ruleIdParam}/deactivate`
			.annotate(OpenApi.Description, "Deactivates an installed notification rule.")
			.addSuccess(InstalledNotificationRule)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("deleteRule")`/automations/rules/${ruleIdParam}`
			.annotate(OpenApi.Description, "Deletes an installed notification rule.")
			.addSuccess(Schema.Struct({ id: AutomationRuleId }))
			.addError(NotFound, { status: 404 }),
	);
