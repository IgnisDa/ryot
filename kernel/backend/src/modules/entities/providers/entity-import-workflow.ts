import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Effect, type Exit, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { childLifecycleCommand } from "#modules/automations/lifecycle/command";
import { enqueueEventCreate } from "#modules/events/event-create-workflow";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	type ProviderImportPhase,
	recordProviderImportBodyOutcome,
	recordProviderImportBodySettled,
	recordProviderImportBodyStarted,
	recordProviderImportPhaseAttempt,
} from "#platform/observability/runtime-metrics";
import { implementWorkflow } from "#platform/workflow/scope";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";
import { ProviderEntityImportWorkflowPayload } from "./schemas";

export class EntityImportError extends Schema.TaggedError<
	EntityImportError,
	{ readonly brand: unique symbol }
>()("EntityImportError", {
	message: Schema.String,
	stage: Schema.Literals(["population", "provider-import-automation", "entry-event"]),
}) {}

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
	effect: Effect.Effect<A, EntityImportError, R>,
) =>
	Effect.flatMap(Clock.currentTimeMillis, (startedAtMs) =>
		Effect.onExit(effect, (exit) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAtMs) =>
				recordProviderImportPhaseAttempt({
					phase,
					startedAtMs,
					finishedAtMs,
					outcome: attemptOutcome(exit),
				}),
			),
		),
	);

const recordEntryEvent = (
	payload: ProviderEntityImportWorkflowPayload,
	entityId: ListedEntity["id"],
	eventSchemaSlug: EventSchemaSlug,
) =>
	enqueueEventCreate({
		userId: payload.entityScope.userId,
		payload: [{ entityId, properties: {}, eventSchemaSlug }],
		command: { ...childLifecycleCommand(payload.command, "entry-event"), writeContext: null },
	}).pipe(
		Effect.mapError(
			(error) => new EntityImportError({ stage: "entry-event", message: error.message }),
		),
		Effect.flatMap((result) =>
			result.failure === null
				? Effect.void
				: Effect.fail(
						new EntityImportError({ stage: "entry-event", message: result.failure.reason.code }),
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
		dispatchAdmittedWorkflow(
			engine,
			ProviderEntityPopulationWorkflow,
			payload.command.accountGeneration,
			{
				executionId: populationExecutionId,
				payload: {
					level: "base",
					mode: "ensure",
					command: payload.command,
					pluginId: payload.pluginId,
					providerId: payload.providerId,
					externalId: payload.externalId,
					entityScope: payload.entityScope,
					executionId: populationExecutionId,
					entitySchemaSlug: payload.entitySchemaSlug,
				},
			},
		).pipe(
			Effect.mapError(
				(error) => new EntityImportError({ stage: "population", message: error.message }),
			),
		),
	);
	const operations = yield* EntityImportWorkflowOperations;
	yield* measureImportPhase(
		"provider-import-automation",
		operations
			.completeProviderEntityImport(payload, importedEntity, executionId)
			.pipe(
				Effect.mapError(
					(error) =>
						new EntityImportError({ message: error.message, stage: "provider-import-automation" }),
				),
			),
	);
	if (payload.entryEventSchemaSlug !== undefined) {
		yield* measureImportPhase(
			"entry-event",
			recordEntryEvent(payload, importedEntity.id, payload.entryEventSchemaSlug),
		);
	}
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
