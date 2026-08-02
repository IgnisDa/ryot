import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
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
		HttpApiEndpoint.post("installRule", "/automations/rules", {
			payload: InstallNotificationRuleBody,
			success: Schema.Struct({ id: NotificationSubscriptionId }).pipe(HttpApiSchema.status(201)),
			error: [
				AutomationNotFoundError.pipe(HttpApiSchema.status(404)),
				AutomationConflictError.pipe(HttpApiSchema.status(409)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Installs a notification rule."),
	)
	.add(
		HttpApiEndpoint.post("activateRule", "/automations/rules/:ruleId/activate", {
			params: { ruleId: NotificationSubscriptionId },
			success: Schema.Struct({ id: NotificationSubscriptionId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Activates an installed notification rule."),
	)
	.add(
		HttpApiEndpoint.post("deactivateRule", "/automations/rules/:ruleId/deactivate", {
			params: { ruleId: NotificationSubscriptionId },
			success: Schema.Struct({ id: NotificationSubscriptionId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Deactivates an installed notification rule."),
	)
	.add(
		HttpApiEndpoint.delete("deleteRule", "/automations/rules/:ruleId", {
			params: { ruleId: NotificationSubscriptionId },
			success: Schema.Struct({ id: NotificationSubscriptionId }),
			error: [AutomationNotFoundError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Deletes an installed notification rule."),
	)
	.middleware(AuthMiddleware);

const historyErrors = [
	AutomationHistoryNotFound.pipe(HttpApiSchema.status(404)),
	AutomationHistoryInternalError.pipe(HttpApiSchema.status(500)),
];
export const AutomationHistoryGroup = HttpApiGroup.make("automationHistory")
	.annotate(OpenApi.Description, "Queues eligible automation run retries.")
	.add(
		HttpApiEndpoint.post("retryRun", "/automations/runs/:runId/retry", {
			params: { runId: AutomationRunId },
			payload: AutomationHistoryRetryBody,
			success: AutomationHistoryRetryResult.pipe(HttpApiSchema.status(202)),
			error: [...historyErrors, AutomationHistoryRetryConflict.pipe(HttpApiSchema.status(409))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(
				OpenApi.Description,
				"Queues the next attempt of an eligible failed run with its exact retained pins.",
			),
	)
	.middleware(AuthMiddleware);
