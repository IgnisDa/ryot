import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { withoutSchemaServices } from "#lib/shared/schema";

import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";
import { EntityImportPayload } from "./schemas";

export class EntityImportError extends Schema.TaggedErrorClass<EntityImportError>()(
	"EntityImportError",
	{
		message: Schema.String,
		stage: Schema.Literal("population"),
	},
) {}

export const EntityImportWorkflow = Workflow.make("EntityImportWorkflow", {
	success: withoutSchemaServices(ListedEntity),
	error: withoutSchemaServices(EntityImportError),
	payload: withoutSchemaServices(EntityImportPayload),
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
	return yield* engine
		.execute(ProviderEntityPopulationWorkflow, {
			executionId: populationExecutionId,
			payload: {
				mode: "ensure",
				origin: payload.origin,
				userId: payload.userId,
				providerId: payload.providerId,
				externalId: payload.externalId,
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
});

export const EntityImportWorkflowDefinitionsLive =
	EntityImportWorkflow.toLayer(runEntityImportWorkflow);
