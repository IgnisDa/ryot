import { Workflow } from "@effect/workflow";
import { Schema } from "effect";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";

export const ProcessIntegrationRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: IntegrationRunError,
	payload: IntegrationRunJobData,
	idempotencyKey: ({ runId }) => runId,
	name: "ProcessIntegrationRunWorkflow",
});
