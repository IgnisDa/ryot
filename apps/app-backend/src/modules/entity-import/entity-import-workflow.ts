import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";

import { synchronizeProviderEntity } from "./provider-entity-synchronizer";

export const EntityImportPayload = Schema.Struct({
	scriptId: SandboxScriptId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;

	return yield* Activity.make({
		name: "check-existing-entity",
		success: Schema.NullOr(ListedEntity),
		execute: runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			}),
		).pipe(dieOnDbError),
	});
});

export const runEntityImportWorkflow = Effect.fn("runEntityImportWorkflow")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: { activityPrefix?: string } = {},
) {
	const existing = yield* checkExistingEntity(payload);
	if (existing && existing.populatedAt !== null) {
		return existing;
	}

	return yield* synchronizeProviderEntity(payload, executionId, {
		mode: "initial",
		activityPrefix: options.activityPrefix,
	});
});

export const BuiltinEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "BuiltinEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const BuiltinEntityImportWorkflowLive = BuiltinEntityImportWorkflow.toLayer(
	(payload, executionId) => runEntityImportWorkflow(payload, executionId),
);

export const BuiltinEntityImportWorkflowDefinitionsLive = BuiltinEntityImportWorkflowLive;
