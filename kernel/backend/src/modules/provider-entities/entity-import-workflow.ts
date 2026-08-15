import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { Cause, Clock, Effect, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	recordProviderImportCompleted,
	recordProviderImportPhase,
	recordProviderImportSettled,
	recordProviderImportStarted,
	type ProviderImportPhase,
} from "#lib/infrastructure/runtime-metrics";
import type { DurableSchema } from "#lib/infrastructure/workflow";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";
import { EntityImportPayload } from "./schemas";

export class EntityImportError extends Schema.TaggedError<EntityImportError>()(
	"EntityImportError",
	{ message: Schema.String, stage: Schema.Literals(["population", "provider-import-automation"]) },
) {}

export const EntityImportWorkflow = Workflow.make("EntityImportWorkflow", {
	success: ListedEntity satisfies DurableSchema,
	error: EntityImportError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: EntityImportPayload satisfies DurableSchema,
});

const measureImportPhase = <A, R>(
	phase: ProviderImportPhase,
	effect: Effect.Effect<A, EntityImportError, R>,
) =>
	Effect.flatMap(Clock.currentTimeMillis, (startedAt) =>
		Effect.onExit(effect, (exit) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAt) =>
				recordProviderImportPhase({
					phase,
					durationMs: Math.max(0, finishedAt - startedAt),
					outcome: exit._tag === "Success" ? "success" : "failure",
				}),
			),
		),
	);

const runImportPhases = Effect.fn("runEntityImportPhases")(function* (
	payload: EntityImportPayload,
	executionId: string,
) {
	const engine = yield* WorkflowEngine;
	const populationExecutionId = `${executionId}-provider-population`;
	const importedEntity = yield* measureImportPhase(
		"population",
		engine
			.execute(ProviderEntityPopulationWorkflow, {
				executionId: populationExecutionId,
				payload: {
					mode: "ensure",
					origin: payload.origin,
					providerId: payload.providerId,
					externalId: payload.externalId,
					entityScope: payload.entityScope,
					executionId: populationExecutionId,
					entitySchemaSlug: payload.entitySchemaSlug,
				},
			})
			.pipe(
				Effect.mapError(
					(error) => new EntityImportError({ stage: "population", message: error.message }),
				),
			),
	);
	const operations = yield* EntityImportWorkflowOperations;
	yield* measureImportPhase(
		"provider-import-automation",
		operations
			.runProviderImportAutomations(payload, importedEntity, executionId)
			.pipe(
				Effect.mapError(
					(error) =>
						new EntityImportError({ message: error.message, stage: "provider-import-automation" }),
				),
			),
	);
	return importedEntity;
});

export const runEntityImportWorkflow = Effect.fn("EntityImportWorkflow")(function* (
	payload: EntityImportPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({
		executionId,
		providerId: payload.providerId,
		externalId: payload.externalId,
		entitySchemaSlug: payload.entitySchemaSlug,
		...(payload.entityScope.userId ? { userId: payload.entityScope.userId } : {}),
	});
	yield* recordProviderImportStarted;
	return yield* Effect.onExit(runImportPhases(payload, executionId), (exit) =>
		Effect.andThen(
			recordProviderImportSettled,
			exit._tag === "Success"
				? recordProviderImportCompleted({ outcome: "success", failureStage: "none" })
				: Option.match(Cause.findErrorOption(exit.cause), {
						onNone: () => Effect.void,
						onSome: (error) =>
							recordProviderImportCompleted({ outcome: "failure", failureStage: error.stage }),
					}),
		),
	);
});

export const EntityImportWorkflowDefinitionsLive =
	EntityImportWorkflow.toLayer(runEntityImportWorkflow);
