import { DurableQueue, Workflow } from "@effect/workflow";
import { Cause, Effect, Exit, Layer, Match, Option, Schema } from "effect";

import { SandboxRunError, dieOnDbError, unknownToMessage } from "../../lib/errors";
import { CollectionsService } from "../collections/service";
import { populateGlobalEntity } from "./population";
import { ListedEntity } from "./schemas";

export const EntityImportPayload = Schema.Struct({
	userId: Schema.String,
	scriptId: Schema.String,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: Schema.String,
});

export type EntityImportPayload = typeof EntityImportPayload.Type;

export type EntityImportRunResult =
	| { readonly status: "pending" }
	| { readonly status: "failed"; readonly error: string }
	| { readonly status: "completed"; readonly data: ListedEntity };

export const EntityImportQueue = DurableQueue.make({
	success: ListedEntity,
	error: SandboxRunError,
	name: "EntityImportQueue",
	payload: EntityImportPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const EntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	name: "EntityImportWorkflow",
	payload: EntityImportPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const toWorkflowError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<EntityImportRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Import failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
	});

export const toEntityImportRunResult = (
	result: Workflow.Result<ListedEntity, SandboxRunError> | undefined,
): EntityImportRunResult => {
	if (!result) {
		return { status: "pending" };
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => ({ status: "pending" as const })),
		Match.orElse(({ exit }) =>
			Exit.match(exit, {
				onFailure: workflowFailureResult,
				onSuccess: (data) => ({ status: "completed" as const, data }),
			}),
		),
	);
};

export const EntityImportQueueWorkerLive = DurableQueue.worker(
	EntityImportQueue,
	(payload) =>
		Effect.gen(function* () {
			const collections = yield* CollectionsService;
			const entity = yield* populateGlobalEntity({
				userId: payload.userId,
				scriptId: payload.scriptId,
				externalId: payload.externalId,
				executionId: payload.executionId,
				entitySchemaId: payload.entitySchemaId,
			});
			yield* collections.ensureEntityInLibrary(payload.userId, entity.id).pipe(dieOnDbError);
			return entity;
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) }))),
	{ concurrency: 5 },
);

const EntityImportWorkflowLive = EntityImportWorkflow.toLayer((payload) =>
	DurableQueue.process(EntityImportQueue, payload).pipe(Effect.mapError(toWorkflowError)),
);

export const EntityImportWorkflowDefinitionsLive = Layer.mergeAll(
	EntityImportWorkflowLive,
	EntityImportQueueWorkerLive,
);
