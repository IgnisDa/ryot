import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { NotificationSubscriptionId } from "../../schema/brands";
import {
	AutomationConflictError,
	AutomationNotFoundError,
	InstallNotificationRuleBody,
} from "./schemas";

export const AutomationsGroup = HttpApiGroup.make("automations")
	.annotate(OpenApi.Description, "Manages notification rules.")
	.add(
		AuthenticatedMutationEndpoint.post("write")("installRule", "/automations/rules", {
			payload: InstallNotificationRuleBody,
			success: Schema.Struct({ id: NotificationSubscriptionId }).pipe(HttpApiSchema.status(201)),
			error: [
				AutomationNotFoundError.pipe(HttpApiSchema.status(404)),
				AutomationConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a notification rule."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("write")(
			"activateRule",
			"/automations/rules/:ruleId/activate",
			{
				params: { ruleId: NotificationSubscriptionId },
				success: Schema.Struct({ id: NotificationSubscriptionId }),
				error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
			},
		).annotate(OpenApi.Description, "Activates an installed notification rule."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("write")(
			"deactivateRule",
			"/automations/rules/:ruleId/deactivate",
			{
				params: { ruleId: NotificationSubscriptionId },
				success: Schema.Struct({ id: NotificationSubscriptionId }),
				error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
			},
		).annotate(OpenApi.Description, "Deactivates an installed notification rule."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("write")("deleteRule", "/automations/rules/:ruleId", {
			params: { ruleId: NotificationSubscriptionId },
			success: Schema.Struct({ id: NotificationSubscriptionId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deletes an installed notification rule."),
	)
	.middleware(AuthMiddleware);
