import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	workflowHostRequestSchema,
	workflowInlineRequestSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Schema } from "effect";

// The host keeps HTTP continuation state opaque; the host functions that produce it validate it
// again before resuming.
export const SandboxInlineProgress = Schema.Union([
	Schema.TaggedStruct("Completed", {
		value: jsonValueSchema,
		request: workflowInlineRequestSchema,
	}),
	Schema.TaggedStruct("Http", { progress: Schema.Unknown, request: workflowHostRequestSchema }),
]);
export type SandboxInlineProgress = typeof SandboxInlineProgress.Type;
