import { Activity } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import { asRecord } from "@ryot/ts-utils/predicates";
import { DateTime, Effect, Schema } from "effect";

import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";

import { bootstrapNewUser } from "./bootstrap";
import {
	BootstrapUserWorkflow,
	type BootstrapUserWorkflowPayload,
} from "./bootstrap-user-workflow";

const BootstrapUserResult = Schema.Struct({
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	entity: Schema.Struct({
		id: EntityId,
		name: Schema.String,
		createdAt: Schema.String,
		properties: Schema.Unknown,
	}),
});

export const runBootstrapUserWorkflow = Effect.fn("runBootstrapUserWorkflow")(function* (
	payload: BootstrapUserWorkflowPayload,
) {
	const envelope = yield* Activity.make({
		error: DbError,
		name: "bootstrap-user",
		execute: bootstrapNewUser(payload.userId),
		success: Schema.NullOr(BootstrapUserResult),
	});

	if (envelope) {
		const occurrenceId = `entity-create-${envelope.entity.id}`;
		yield* dispatchLifecycleSubscriptions({
			userId: payload.userId,
			correlationId: occurrenceId,
			target: { kind: "entity", schemaId: envelope.entitySchemaId },
			automation: {
				occurrenceId,
				automationDepth: 1,
				operation: "create",
				origin: { kind: "bootstrap" },
				committedAt: DateTime.unsafeMake(envelope.entity.createdAt),
				source: {
					kind: "entity",
					after: {
						id: envelope.entity.id,
						name: envelope.entity.name,
						entitySchemaId: envelope.entitySchemaId,
						entitySchemaSlug: envelope.entitySchemaSlug,
						properties: asRecord(envelope.entity.properties) ?? {},
					},
				},
			},
		}).pipe(
			Effect.mapError(
				() => new DbError({ message: "Bootstrap entity subscription dispatch failed" }),
			),
		);
	}
});

export const BootstrapUserWorkflowDefinitionsLive = BootstrapUserWorkflow.toLayer((payload) =>
	runBootstrapUserWorkflow(payload),
);
