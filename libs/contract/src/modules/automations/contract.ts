import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { AutomationRuleId, SignalId, SignalSchemaId, SubscriptionRunId } from "../../schema/brands";
import {
	AutomationRuleView,
	CatalogSignalSchema,
	CreateRuleBody,
	CreateSignalSchemaBody,
	InstallNotificationRuleBody,
	ListRunsParams,
	ListSignalsParams,
	RecipientSignal,
	SignalPage,
	SubscriptionRunPage,
	SubscriptionRunView,
	UpdateRuleBody,
	UserSignalSchemaView,
} from "./schemas";

const signalIdParam = HttpApiSchema.param("signalId", SignalId);
const runIdParam = HttpApiSchema.param("runId", SubscriptionRunId);
const ruleIdParam = HttpApiSchema.param("ruleId", AutomationRuleId);
const signalSchemaIdParam = HttpApiSchema.param("signalSchemaId", SignalSchemaId);

export const AutomationsGroup = HttpApiGroup.make("automations")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.addError(NotFound, { status: 404 })
	.addError(Conflict, { status: 409 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("installNotificationRule", "/automations/notification-rules")
			.setPayload(InstallNotificationRuleBody)
			.addSuccess(AutomationRuleView, { status: 201 }),
	)
	.add(
		HttpApiEndpoint.get("listSignals", "/automations/signals")
			.setUrlParams(ListSignalsParams)
			.addSuccess(SignalPage),
	)
	.add(
		HttpApiEndpoint.get("getSignal")`/automations/signals/${signalIdParam}`.addSuccess(
			RecipientSignal,
		),
	)
	.add(
		HttpApiEndpoint.get("listSubscriptionRuns", "/automations/subscription-runs")
			.setUrlParams(ListRunsParams)
			.addSuccess(SubscriptionRunPage),
	)
	.add(
		HttpApiEndpoint.get(
			"getSubscriptionRun",
		)`/automations/subscription-runs/${runIdParam}`.addSuccess(SubscriptionRunView),
	)
	.add(
		HttpApiEndpoint.get("listSignalSchemas", "/automations/signal-schemas").addSuccess(
			Schema.Array(CatalogSignalSchema),
		),
	)
	.add(
		HttpApiEndpoint.get(
			"getSignalSchema",
		)`/automations/signal-schemas/${signalSchemaIdParam}`.addSuccess(CatalogSignalSchema),
	)
	.add(
		HttpApiEndpoint.get("listRules", "/automations/rules").addSuccess(
			Schema.Array(AutomationRuleView),
		),
	)
	.add(
		HttpApiEndpoint.get("getRule")`/automations/rules/${ruleIdParam}`.addSuccess(
			AutomationRuleView,
		),
	)
	.add(
		HttpApiEndpoint.post("createRule", "/automations/rules")
			.setPayload(CreateRuleBody)
			.addSuccess(AutomationRuleView, { status: 201 }),
	)
	.add(
		HttpApiEndpoint.patch("updateRule")`/automations/rules/${ruleIdParam}`
			.setPayload(UpdateRuleBody)
			.addSuccess(AutomationRuleView),
	)
	.add(
		HttpApiEndpoint.del("deleteRule")`/automations/rules/${ruleIdParam}`.addSuccess(
			Schema.Struct({ id: AutomationRuleId }),
		),
	)
	.add(
		HttpApiEndpoint.get("listCustomSignalSchemas", "/automations/custom-signal-schemas").addSuccess(
			Schema.Array(UserSignalSchemaView),
		),
	)
	.add(
		HttpApiEndpoint.get(
			"getCustomSignalSchema",
		)`/automations/custom-signal-schemas/${signalSchemaIdParam}`.addSuccess(UserSignalSchemaView),
	)
	.add(
		HttpApiEndpoint.post("createCustomSignalSchema", "/automations/custom-signal-schemas")
			.setPayload(CreateSignalSchemaBody)
			.addSuccess(UserSignalSchemaView, { status: 201 }),
	)
	.add(
		HttpApiEndpoint.post(
			"archiveCustomSignalSchema",
		)`/automations/custom-signal-schemas/${signalSchemaIdParam}/archive`.addSuccess(
			UserSignalSchemaView,
		),
	);
