import type { DbError } from "@ryot-app/contract/errors";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { Effect } from "effect";
import { Context, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type {
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { ScriptExecutionWorkflowPayload } from "#modules/scripts/executions/workflow-payload";

export const BackgroundWorkInput = Schema.Struct({
	id: Schema.String,
	key: Schema.String,
	scope: Schema.String,
	featureInput: JsonValue,
	contentHash: Schema.String,
	accountGeneration: AccountGeneration,
	execution: ScriptExecutionWorkflowPayload,
	purpose: Schema.Literals(["user-script", "event-projection", "relationship-projection"]),
});
export type BackgroundWorkInput = typeof BackgroundWorkInput.Type;

export const projectionInputCoordinationKey = (userId: string) => `projection-inputs:${userId}`;

export class BackgroundWorkExecutor extends Context.Service<
	BackgroundWorkExecutor,
	{ execute: (job: BackgroundWorkInput) => Effect.Effect<unknown, DbError> }
>()("@ryot-app/kernel-backend/modules/background-work/model/BackgroundWorkExecutor") {}

export class ProjectionInputReadiness extends Context.Service<
	ProjectionInputReadiness,
	{ ready: (account: AccountGeneration) => Effect.Effect<boolean, DbError> }
>()("@ryot-app/kernel-backend/modules/background-work/model/ProjectionInputReadiness") {}

export class ProjectionInputFence extends Context.Service<
	ProjectionInputFence,
	{
		lock: (account: AccountGeneration) => Effect.Effect<void, DbError>;
		advance: (account: AccountGeneration) => Effect.Effect<void, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/background-work/model/ProjectionInputFence") {}

export class ProjectionBindings extends Context.Service<
	ProjectionBindings,
	{
		resolve: (input: {
			userId: UserId;
			pluginId: string;
			scriptSlug: string;
		}) => Effect.Effect<
			null | {
				pluginPin: ScriptPluginRevision;
				principal: ScriptExecutionPrincipal;
				accountGeneration: AccountGeneration;
			},
			DbError
		>;
	}
>()("@ryot-app/kernel-backend/modules/background-work/model/ProjectionBindings") {}

export class BackgroundWorkProjectionFinalizer extends Context.Service<
	BackgroundWorkProjectionFinalizer,
	{
		failed: (job: BackgroundWorkInput) => Effect.Effect<void, DbError>;
		settled: (job: BackgroundWorkInput) => Effect.Effect<void, DbError>;
		prepare: (job: BackgroundWorkInput) => Effect.Effect<boolean, DbError>;
		publish: (
			job: BackgroundWorkInput,
			output: unknown,
		) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
	}
>()("@ryot-app/kernel-backend/modules/background-work/model/BackgroundWorkProjectionFinalizer") {}
