import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { Context, type Effect } from "effect";

export const KERNEL_EVENT_CREATE_WORKFLOW = "kernel:event-create";
export const KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW = "kernel:process-import-chunks";
export const KERNEL_ENTITY_IMPORT_WORKFLOW = "kernel:entity-import";
export const KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW = "kernel:provider-entity-population";

export class KernelWorkflowReferences extends Context.Tag("KernelWorkflowReferences")<
	KernelWorkflowReferences,
	{
		readonly execute: (
			workflowSlug: string,
			input: JsonValue,
			authority: ExecutionAuthority,
			executionId: string,
			parentExecutionId: string,
			callerScriptId: SandboxScriptId,
		) => Effect.Effect<JsonValue, SandboxRunError, WorkflowEngine>;
	}
>() {}
