import { Workflow } from "@effect/workflow";
import { Schema } from "effect";

import { ImportRunJobData } from "./jobs";
import { ImportRunError } from "./runtime/workflow-errors";

export const ProcessImportRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: ImportRunJobData,
	name: "ProcessImportRunWorkflow",
	idempotencyKey: ({ runId }) => runId,
});
