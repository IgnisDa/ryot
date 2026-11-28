import { JsonValue } from "@ryot-app/contract/schema/json";
import { workflowHostRequestSchema } from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import { Schema } from "effect";

// The host keeps HTTP continuation state opaque; the host functions that produce it validate it
// again before resuming.
export const SandboxInlineProgress = Schema.Union([
	Schema.TaggedStruct("Completed", { value: JsonValue, request: workflowHostRequestSchema }),
	Schema.TaggedStruct("Http", { progress: Schema.Unknown, request: workflowHostRequestSchema }),
]);
export type SandboxInlineProgress = typeof SandboxInlineProgress.Type;
