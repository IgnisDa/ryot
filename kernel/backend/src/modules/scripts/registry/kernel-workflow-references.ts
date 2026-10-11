import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SandboxExecutionSubject,
	SandboxExecutionGrants,
} from "@ryot-app/contract/modules/sandbox/schemas";
import type { ScriptExecutionPrincipal } from "@ryot-app/sandbox/protocol/principal";
import { Context, type Effect, type Scope } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

export class KernelWorkflowReferences extends Context.Service<
	KernelWorkflowReferences,
	{
		readonly resolveArtifactGrants: (
			input: unknown,
			subject: SandboxExecutionSubject,
			grants: SandboxExecutionGrants | undefined,
		) => Effect.Effect<SandboxExecutionGrants | undefined, SandboxRunError, Scope.Scope>;
		readonly execute: (
			workflowSlug: string,
			input: JsonValue,
			lane: ExecutionLane,
			executionId: string,
			parentExecutionId: string,
			callerAuthority: ScriptExecutionPrincipal,
			artifactOwnerExecutionId?: string,
		) => Effect.Effect<JsonValue, SandboxRunError, WorkflowEngine>;
	}
>()("KernelWorkflowReferences") {}
