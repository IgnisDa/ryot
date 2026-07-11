import { SandboxRunError } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

const RunSandboxWorkflowPayload = Schema.Struct({
	...SandboxExecutionPayload.fields,
	// Effect injects this into child payloads before strict excess-property decoding.
	"~@effect/workflow/parent": Schema.optional(Schema.Unknown),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

export const RunSandboxWorkflow = Workflow.make("RunSandboxWorkflow", {
	error: withoutSchemaServices(SandboxRunError),
	success: withoutSchemaServices(SandboxCompletedResult),
	payload: withoutSchemaServices(RunSandboxWorkflowPayload),
	idempotencyKey: ({ executionId }) => executionId,
});
