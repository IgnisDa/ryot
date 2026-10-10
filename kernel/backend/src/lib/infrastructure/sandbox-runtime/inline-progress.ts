import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	workflowHostRequestSchema,
	workflowInlineRequestSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Schema } from "effect";

import { SandboxHttpProgress } from "./http-progress";

export const SandboxInlineProgress = Schema.Union([
	Schema.TaggedStruct("Completed", {
		value: jsonValueSchema,
		request: workflowInlineRequestSchema,
	}),
	Schema.TaggedStruct("Http", {
		progress: SandboxHttpProgress,
		request: workflowHostRequestSchema,
	}),
]);
export type SandboxInlineProgress = typeof SandboxInlineProgress.Type;
