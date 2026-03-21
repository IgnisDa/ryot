import { SandboxRunError } from "@ryot/contract/errors";
import { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

import { SandboxExecutionResult } from "./execution-result";

export const SandboxSubmissionWorkflow = Workflow.make("SandboxSubmissionWorkflow", {
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	success: SandboxExecutionResult satisfies DurableSchema,
	payload: SandboxExecutionPayload satisfies DurableSchema,
});
