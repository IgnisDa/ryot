import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "@ryot/contract/modules/sandbox/schemas";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import { resolveProviderSandboxArtifact } from "#modules/sandbox/provider-artifacts";
import { SandboxRepository } from "#modules/sandbox/repository";

import type { EntityImportPayload } from "./entity-import-workflow";

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		executionKind: "provider",
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
	Effect.gen(function* () {
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxEntityDetails(payload, executionId).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					Effect.flatMap((result) =>
						resolveProviderSandboxArtifact({
							executionId: `${executionId}-sandbox-details`,
							result,
						}).pipe(
							Effect.provideService(DbRunner, runWithDb),
							Effect.provideService(SandboxRepository, repository),
						),
					),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
