import { AutomationRunAttempt } from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Duration, Schema } from "effect";

import { makeJobKind } from "#platform/jobs/queue";

export const AutomationRunPayload = Schema.Struct({
	runId: AutomationRunId,
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
});
export type AutomationRunPayload = typeof AutomationRunPayload.Type;

export const AutomationRunJob = makeJobKind("automation-run", {
	concurrency: 16,
	backoff: Duration.seconds(2),
	payload: AutomationRunPayload,
});
