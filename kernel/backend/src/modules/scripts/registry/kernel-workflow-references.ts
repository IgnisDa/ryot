import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	SandboxExecutionSubject,
	SandboxExecutionGrants,
} from "@ryot-app/contract/modules/scripts/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, type Effect, type Scope } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

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
