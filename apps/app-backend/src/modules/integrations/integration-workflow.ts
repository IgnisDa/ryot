import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";

export const ProcessIntegrationRunWorkflow = Workflow.make("ProcessIntegrationRunWorkflow", {
	success: withoutSchemaServices(Schema.Void),
	error: withoutSchemaServices(IntegrationRunError),
	payload: withoutSchemaServices(IntegrationRunJobData),
	idempotencyKey: ({ runId }) => runId,
});
