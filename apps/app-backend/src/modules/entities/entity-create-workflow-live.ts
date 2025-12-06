import { Activity } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { asRecord } from "@ryot/ts-utils/predicates";
import { DateTime, Effect, Schema } from "effect";

import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";

import {
	EntityCreateWorkflow,
	EntityCreateWorkflowError,
	type EntityCreateWorkflowPayload,
} from "./entity-create-workflow";
import { EntitiesService } from "./service";

const WriteEntityResult = Schema.Struct({
	entity: ListedEntity,
	entitySchemaSlug: Schema.String,
	operation: Schema.Literal("create", "update", "noop"),
});

export const runEntityCreateWorkflow = Effect.fn("runEntityCreateWorkflow")(function* (
	payload: EntityCreateWorkflowPayload,
) {
	const entities = yield* EntitiesService;

	const result = yield* Activity.make({
		name: "write-entity",
		success: WriteEntityResult,
		error: EntityCreateWorkflowError,
		execute: entities.create(payload.userId, payload.body),
	});

	if (result.operation === "create") {
		const occurrenceId = `entity-create-${result.entity.id}`;
		yield* dispatchLifecycleSubscriptions({
			userId: payload.userId,
			correlationId: occurrenceId,
			target: { kind: "entity", schemaId: result.entity.entitySchemaId },
			automation: {
				occurrenceId,
				automationDepth: 1,
				operation: "create",
				origin: payload.origin,
				committedAt: DateTime.unsafeMake(result.entity.createdAt),
				source: {
					kind: "entity",
					after: {
						id: result.entity.id,
						name: result.entity.name,
						entitySchemaSlug: result.entitySchemaSlug,
						entitySchemaId: result.entity.entitySchemaId,
						properties: asRecord(result.entity.properties) ?? {},
					},
				},
			},
		}).pipe(
			Effect.mapError(() => new DbError({ message: "Entity create subscription dispatch failed" })),
		);
	}

	return result.entity;
});

export const EntityCreateWorkflowDefinitionsLive = EntityCreateWorkflow.toLayer((payload) =>
	runEntityCreateWorkflow(payload),
);
