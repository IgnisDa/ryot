import { Workflow } from "@effect/workflow";

import { SandboxRunError } from "../../lib/errors";
import { SandboxCompletedResult, SandboxExecutionPayload } from "./schemas";

export const RunSandboxWorkflow = Workflow.make({
	error: SandboxRunError,
	name: "RunSandboxWorkflow",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
