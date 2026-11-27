import { Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#boot/workflow-engine";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";

export const ProcessIntegrationRunWorkflow = Workflow.make("ProcessIntegrationRunWorkflow", {
	idempotencyKey: ({ runId }) => runId,
	success: Schema.Void satisfies DurableSchema,
	error: IntegrationRunError satisfies DurableSchema,
	payload: IntegrationRunJobData satisfies DurableSchema,
});
