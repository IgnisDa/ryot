import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AutomationRuleId, SignalSchemaSlug } from "../../schema/brands";
import {
	AutomationConflictError,
	AutomationNotFoundError,
	CatalogSignalSchema,
	InstalledNotificationRule,
	InstallNotificationRuleBody,
} from "./schemas";

export const AutomationsGroup = HttpApiGroup.make("automations")
	.annotate(OpenApi.Description, "Manages automation catalogs and notification rules.")
	.add(
		HttpApiEndpoint.get("listCatalog", "/automations/catalog", {
			success: Schema.Array(CatalogSignalSchema),
		}).annotate(OpenApi.Description, "Lists available automation signal schemas."),
	)
	.add(
		HttpApiEndpoint.get("getCatalog", "/automations/catalog/:signalSchemaSlug", {
			success: CatalogSignalSchema,
			params: { signalSchemaSlug: SignalSchemaSlug },
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Returns an automation signal schema from the catalog."),
	)
	.add(
		HttpApiEndpoint.post("installRule", "/automations/rules", {
			payload: InstallNotificationRuleBody,
			success: InstalledNotificationRule.pipe(HttpApiSchema.status(201)),
			error: [
				AutomationNotFoundError.pipe(HttpApiSchema.status(404)),
				AutomationConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a notification rule."),
	)
	.add(
		HttpApiEndpoint.post("activateRule", "/automations/rules/:ruleId/activate", {
			success: InstalledNotificationRule,
			params: { ruleId: AutomationRuleId },
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Activates an installed notification rule."),
	)
	.add(
		HttpApiEndpoint.post("deactivateRule", "/automations/rules/:ruleId/deactivate", {
			success: InstalledNotificationRule,
			params: { ruleId: AutomationRuleId },
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deactivates an installed notification rule."),
	)
	.add(
		HttpApiEndpoint.delete("deleteRule", "/automations/rules/:ruleId", {
			params: { ruleId: AutomationRuleId },
			success: Schema.Struct({ id: AutomationRuleId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deletes an installed notification rule."),
	)
	.middleware(AuthMiddleware);
