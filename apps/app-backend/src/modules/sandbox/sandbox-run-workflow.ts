import { SandboxRunError } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

const RunSandboxWorkflowPayload = Schema.Struct({
	...SandboxExecutionPayload.fields,
	// Effect injects this into child payloads before strict excess-property decoding.
	"~@effect/workflow/parent": Schema.optional(Schema.Unknown),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

export const RunSandboxWorkflow = Workflow.make("RunSandboxWorkflow", {
	error: SandboxRunError satisfies DurableSchema,
	success: SandboxCompletedResult satisfies DurableSchema,
	payload: RunSandboxWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});
