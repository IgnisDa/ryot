import { SandboxRunError } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const SandboxSubmissionWorkflow = Workflow.make("SandboxSubmissionWorkflow", {
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	success: SandboxCompletedResult satisfies DurableSchema,
	payload: SandboxExecutionPayload satisfies DurableSchema,
});
