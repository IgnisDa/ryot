import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";

export const ProcessIntegrationRunWorkflow = Workflow.make("ProcessIntegrationRunWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: IntegrationRunError satisfies DurableSchema,
	payload: IntegrationRunJobData satisfies DurableSchema,
	idempotencyKey: ({ runId }) => runId,
});
