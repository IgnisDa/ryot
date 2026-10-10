import { Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

import { ImportRunJobData } from "./jobs";
import { ImportRunError } from "./runtime/workflow-errors";

export const ProcessImportRunWorkflow = Workflow.make("ProcessImportRunWorkflow", {
	idempotencyKey: ({ runId }) => runId,
	success: Schema.Void satisfies DurableSchema,
	error: ImportRunError satisfies DurableSchema,
	payload: ImportRunJobData satisfies DurableSchema,
});
