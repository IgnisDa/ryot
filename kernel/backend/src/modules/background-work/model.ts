import type { DbError } from "@ryot-app/contract/errors";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { Effect } from "effect";
import { Context, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ScriptExecutionWorkflowPayload } from "#modules/scripts/executions/workflow-payload";

export const BackgroundWorkInput = Schema.Struct({
	id: Schema.String,
	key: Schema.String,
	scope: Schema.String,
	featureInput: JsonValue,
	contentHash: Schema.String,
	accountGeneration: AccountGeneration,
	execution: ScriptExecutionWorkflowPayload,
	purpose: Schema.Literals(["user-script", "event-projection"]),
});
export type BackgroundWorkInput = typeof BackgroundWorkInput.Type;

export class BackgroundWorkExecutor extends Context.Service<
	BackgroundWorkExecutor,
	{ execute: (job: BackgroundWorkInput) => Effect.Effect<unknown, DbError> }
>()("BackgroundWorkExecutor") {}

export class BackgroundWorkProjectionFinalizer extends Context.Service<
	BackgroundWorkProjectionFinalizer,
	{
		failed: (job: BackgroundWorkInput) => Effect.Effect<void, DbError>;
		publish: (
			job: BackgroundWorkInput,
			output: unknown,
		) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
	}
>()("BackgroundWorkProjectionFinalizer") {}
