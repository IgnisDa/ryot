import { Workflow } from "@effect/workflow";
import { SandboxRunError } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Schema } from "effect";

const RunSandboxWorkflowPayload = Schema.Struct({
	...SandboxExecutionPayload.fields,
	// Effect injects this into child payloads before strict excess-property decoding.
	"~@effect/workflow/parent": Schema.optional(Schema.Unknown),
}).annotations({ parseOptions: { onExcessProperty: "error" as const } });

export const RunSandboxWorkflow = Workflow.make({
	error: SandboxRunError,
	name: "RunSandboxWorkflow",
	success: SandboxCompletedResult,
	payload: RunSandboxWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
