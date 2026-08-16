import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AutomationHistoryService } from "./history-service";

export const AutomationHistoryRoutesLive = HttpApiBuilder.group(
	AppContract,
	"automationHistory",
	(handlers) =>
		handlers
			.handle("listRuns", ({ query }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).listRuns(yield* CurrentUser, query);
				}),
			)
			.handle("getRun", ({ params }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).getRun(yield* CurrentUser, params.runId);
				}),
			)
			.handle("retryRun", ({ params, payload }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).retryRun(
						yield* CurrentUser,
						params.runId,
						payload,
					);
				}),
			),
);

export const GodModeAutomationHistoryRoutesLive = HttpApiBuilder.group(
	AppContract,
	"godModeAutomationHistory",
	(handlers) =>
		handlers
			.handle("listRuns", ({ query: { userId, ...filters } }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).listAdminRuns(filters, userId);
				}),
			)
			.handle("getRun", ({ params }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).getAdminRun(params.runId);
				}),
			)
			.handle("retryRun", ({ params, payload }) =>
				Effect.gen(function* () {
					return yield* (yield* AutomationHistoryService).retryAdminRun(params.runId, payload);
				}),
			),
);
