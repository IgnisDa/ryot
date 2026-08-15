import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { type DurableSchema, withoutWorkflowParent } from "#lib/infrastructure/workflow";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";
import { EntityImportPayload } from "./schemas";

export class EntityImportError extends Schema.TaggedError<EntityImportError>()(
	"EntityImportError",
	{
		message: Schema.String,
		stage: Schema.Literals(["population", "provider-import-automation"]),
	},
) {}

export const EntityImportWorkflow = Workflow.make("EntityImportWorkflow", {
	success: ListedEntity satisfies DurableSchema,
	error: EntityImportError satisfies DurableSchema,
	payload: EntityImportPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
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
		...(payload.userId ? { userId: payload.userId } : {}),
	});
	const engine = yield* WorkflowEngine;
	const populationExecutionId = `${executionId}-provider-population`;
	const importedEntity = yield* engine
		.execute(ProviderEntityPopulationWorkflow, {
			executionId: populationExecutionId,
			payload: {
				mode: "ensure",
				origin: payload.origin,
				userId: payload.userId,
				providerId: payload.providerId,
				externalId: payload.externalId,
				entityScope: payload.entityScope,
				executionId: populationExecutionId,
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		})
		.pipe(
			withoutWorkflowParent,
			Effect.mapError(
				(error) => new EntityImportError({ stage: "population", message: error.message }),
			),
		);
	const operations = yield* EntityImportWorkflowOperations;
	yield* operations
		.runProviderImportAutomations(payload, importedEntity, executionId)
		.pipe(
			Effect.mapError(
				(error) =>
					new EntityImportError({ stage: "provider-import-automation", message: error.message }),
			),
		);
	return importedEntity;
});

export const EntityImportWorkflowDefinitionsLive =
	EntityImportWorkflow.toLayer(runEntityImportWorkflow);
