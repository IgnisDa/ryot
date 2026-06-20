import { Workflow } from "@effect/workflow";
import { SandboxRunError } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";

export const RunSandboxWorkflow = Workflow.make({
	error: SandboxRunError,
	name: "RunSandboxWorkflow",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
