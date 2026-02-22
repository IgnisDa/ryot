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

import type { TranslateEntityWorkflowPayload } from "./entity-translation-workflow";

const processSandboxTranslation = (payload: TranslateEntityWorkflowPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		userId: null,
		driverName: "translate",
		executionKind: "provider",
		scriptId: payload.scriptId,
		executionId: `${executionId}-sandbox-translate`,
		context: {
			language: payload.language,
			externalId: payload.externalId,
			properties: payload.properties,
			entitySchemaSlug: payload.entitySchemaSlug,
		},
	}).pipe(Effect.mapError(toSandboxRunError));

export type TranslateEntityWorkflowOperationsValue = {
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class TranslateEntityWorkflowOperations extends Context.Tag(
	"TranslateEntityWorkflowOperations",
)<TranslateEntityWorkflowOperations, TranslateEntityWorkflowOperationsValue>() {}

export const TranslateEntityWorkflowOperationsLive = Layer.effect(
	TranslateEntityWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxTranslation(payload, executionId).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					Effect.flatMap((result) =>
						resolveProviderSandboxArtifact({
							executionId: `${executionId}-sandbox-translate`,
							result,
						}).pipe(
							Effect.provideService(DbRunner, runWithDb),
							Effect.provideService(SandboxRepository, repository),
						),
					),
				),
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
