import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { Cause, Clock, Effect, type Exit, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	recordProviderImportBodyOutcome,
	recordProviderImportBodySettled,
	recordProviderImportBodyStarted,
	recordProviderImportPhaseAttempt,
	type ProviderImportPhase,
} from "#lib/infrastructure/runtime-metrics";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";
import { ProviderEntityImportWorkflowPayload } from "./schemas";

export class EntityImportError extends Schema.TaggedError<EntityImportError>()(
	"EntityImportError",
	{ message: Schema.String, stage: Schema.Literals(["population", "provider-import-automation"]) },
) {}

export const EntityImportWorkflow = Workflow.make("EntityImportWorkflow", {
	success: ListedEntity satisfies DurableSchema,
	error: EntityImportError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: ProviderEntityImportWorkflowPayload satisfies DurableSchema,
});

const attemptOutcome = (exit: Exit.Exit<unknown, unknown>) => {
	if (exit._tag === "Success") {
		return "success";
	}
	return Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "failure";
};

/** Records one phase attempt; a replayed body records another attempt for the same execution. */
const measureImportPhase = <A, R>(
	phase: ProviderImportPhase,
	executionId: string,
	effect: Effect.Effect<A, EntityImportError, R>,
) =>
	Effect.flatMap(Clock.currentTimeMillis, (startedAtMs) =>
		Effect.onExit(effect, (exit) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAtMs) =>
				recordProviderImportPhaseAttempt({
					phase,
					executionId,
					startedAtMs,
					finishedAtMs,
					outcome: attemptOutcome(exit),
				}),
			),
		),
	);

const runImportPhases = Effect.fn("runEntityImportPhases")(function* (
	payload: ProviderEntityImportWorkflowPayload,
	executionId: string,
) {
	const engine = yield* WorkflowEngine;
	const populationExecutionId = `${executionId}-provider-population`;
	const importedEntity = yield* measureImportPhase(
		"population",
		executionId,
		engine
			.execute(ProviderEntityPopulationWorkflow, {
				executionId: populationExecutionId,
				payload: {
					mode: "ensure",
					command: payload.command,
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
		executionId,
		operations
			.completeProviderEntityImport(payload, importedEntity, executionId)
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
	payload: ProviderEntityImportWorkflowPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({
		executionId,
		providerId: payload.providerId,
		externalId: payload.externalId,
		entitySchemaSlug: payload.entitySchemaSlug,
		...(payload.entityScope.userId ? { userId: payload.entityScope.userId } : {}),
	});
	yield* recordProviderImportBodyStarted;
	return yield* Effect.onExit(runImportPhases(payload, executionId), (exit) =>
		Effect.andThen(
			recordProviderImportBodySettled,
			exit._tag === "Success"
				? recordProviderImportBodyOutcome({ outcome: "success", failureStage: "none" })
				: Option.match(Cause.findErrorOption(exit.cause), {
						onNone: () => Effect.void,
						onSome: (error) =>
							recordProviderImportBodyOutcome({ outcome: "failure", failureStage: error.stage }),
					}),
		),
	);
});

export const EntityImportWorkflowDefinitionsLive = implementWorkflow(
	EntityImportWorkflow,
	runEntityImportWorkflow,
);
