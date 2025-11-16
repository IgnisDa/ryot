import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "@ryot/contract/modules/sandbox/schemas";
import { Context, Effect, Layer } from "effect";

import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import type { EntityImportPayload } from "./entity-import-workflow";

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toSandboxRunError));

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class EntityImportWorkflowOperations extends Context.Tag("EntityImportWorkflowOperations")<
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsValue
>() {}

export const EntityImportWorkflowOperationsLive = Layer.effect(
	EntityImportWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				processSandbox: (payload, executionId) =>
					processSandboxEntityDetails(payload, executionId).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies EntityImportWorkflowOperationsValue,
	),
);
