import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AutomationHistoryService } from "./history-service";

export const AutomationHistoryRoutesLive = HttpApiBuilder.group(
	AppContract,
	"automationHistory",
	(handlers) =>
		handlers.handle("retryRun", ({ params, payload }) =>
			Effect.gen(function* () {
				return yield* (yield* AutomationHistoryService).retryRun(
					yield* CurrentUser,
					params.runId,
					payload,
				);
			}),
		),
);
