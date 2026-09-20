import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SandboxExecutionSubject,
	SandboxExecutionGrants,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { Context, type Effect, type Scope } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";

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
			subject: SandboxExecutionSubject,
			lane: ExecutionLane,
			executionId: string,
			parentExecutionId: string,
			callerAuthority: SandboxExecutionPrincipal,
			artifactOwnerExecutionId?: string,
		) => Effect.Effect<JsonValue, SandboxRunError, WorkflowEngine>;
	}
>()("KernelWorkflowReferences") {}
