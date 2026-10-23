import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { AutomationRunId, NotificationSubscriptionId } from "../../schema/brands";
import {
	AutomationHistoryInternalError,
	AutomationHistoryNotFound,
	AutomationHistoryRetryBody,
	AutomationHistoryRetryConflict,
	AutomationHistoryRetryResult,
} from "./history-schemas";
import {
	AutomationConflictError,
	AutomationNotFoundError,
	InstallNotificationRuleBody,
} from "./schemas";

export const AutomationsGroup = HttpApiGroup.make("automations")
	.annotate(OpenApi.Description, "Manages notification rules.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("installRule", "/automations/rules", {
			payload: InstallNotificationRuleBody,
			success: Schema.Struct({ id: NotificationSubscriptionId }).pipe(HttpApiSchema.status(201)),
			error: [
				AutomationNotFoundError.pipe(HttpApiSchema.status(404)),
				AutomationConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Installs a notification rule."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")(
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
		AuthenticatedMutationEndpoint.post("protected")(
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
		AuthenticatedMutationEndpoint.delete("protected")("deleteRule", "/automations/rules/:ruleId", {
			params: { ruleId: NotificationSubscriptionId },
			success: Schema.Struct({ id: NotificationSubscriptionId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deletes an installed notification rule."),
	)
	.middleware(AuthMiddleware);

const historyErrors = [
	AutomationHistoryNotFound.pipe(HttpApiSchema.status(404)),
	AutomationHistoryInternalError.pipe(HttpApiSchema.status(500)),
];
export const AutomationHistoryGroup = HttpApiGroup.make("automationHistory")
	.annotate(OpenApi.Description, "Queues eligible automation run retries.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("retryRun", "/automations/runs/:runId/retry", {
			params: { runId: AutomationRunId },
			payload: AutomationHistoryRetryBody,
			success: AutomationHistoryRetryResult.pipe(HttpApiSchema.status(202)),
			error: [...historyErrors, AutomationHistoryRetryConflict.pipe(HttpApiSchema.status(409))],
		}).annotate(
			OpenApi.Description,
			"Queues the next attempt of an eligible failed run with its exact retained pins.",
		),
	)
	.middleware(AuthMiddleware);
