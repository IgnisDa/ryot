import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { Context, type Effect } from "effect";

export const KERNEL_EVENT_CREATE_WORKFLOW = "kernel:event-create";
export const KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW = "kernel:library-entity-import";

export class KernelWorkflowReferences extends Context.Tag("KernelWorkflowReferences")<
	KernelWorkflowReferences,
	{
		readonly execute: (
			workflowSlug: string,
			input: JsonValue,
			executionId: string,
		) => Effect.Effect<JsonValue, SandboxRunError, WorkflowEngine>;
	}
>() {}
