import { DurableQueue } from "@effect/workflow";
import { Cause, Effect } from "effect";

import { SandboxRunError, unknownToMessage } from "#lib/errors";
import type { EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { decodeEntityResolveResult, decodeEntitySearchResult } from "#modules/entities/population";
import { runEntityImportWorkflow } from "#modules/entities/workflows";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

const toSandboxError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const processSandboxEntityDetails = (
	payload: { userId: UserId; scriptId: SandboxScriptId; externalId: string },
	executionId: string,
) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toSandboxError));

export const resolveSandboxEntityExternalId = (input: {
	value: string;
	userId: UserId;
	scriptId: SandboxScriptId;
	executionId: string;
	identifierType: string;
}) =>
	DurableQueue.process(SandboxExecutionQueue, {
		userId: input.userId,
		driverName: "resolve",
		scriptId: input.scriptId,
		executionId: input.executionId,
		context: { value: input.value, identifierType: input.identifierType },
	}).pipe(
		Effect.mapError(toSandboxError),
		Effect.flatMap((result) =>
			result.error
				? Effect.fail(new SandboxRunError({ message: result.error }))
				: decodeEntityResolveResult(result.value).pipe(
						Effect.mapError(
							() =>
								new SandboxRunError({
									message: "Entity resolve script returned an unexpected shape",
								}),
						),
					),
		),
	);

export const searchSandboxEntities = (input: {
	query: string;
	userId: UserId;
	scriptId: SandboxScriptId;
	executionId: string;
}) =>
	DurableQueue.process(SandboxExecutionQueue, {
		userId: input.userId,
		driverName: "search",
		scriptId: input.scriptId,
		executionId: input.executionId,
		context: { query: input.query, page: 1, pageSize: 5 },
	}).pipe(
		Effect.mapError(toSandboxError),
		Effect.flatMap((result) =>
			result.error
				? Effect.fail(new SandboxRunError({ message: result.error }))
				: decodeEntitySearchResult(result.value).pipe(
						Effect.map((parsed) => parsed.items),
						Effect.mapError(
							() =>
								new SandboxRunError({
									message: "Entity search script returned an unexpected shape",
								}),
						),
					),
		),
	);

export const importMediaEntityViaWorkflow = (input: {
	userId: UserId;
	scriptId: SandboxScriptId;
	externalId: string;
	executionId: string;
	entitySchemaId: EntitySchemaId;
	activityPrefix: string;
}) =>
	runEntityImportWorkflow(
		{
			userId: input.userId,
			scriptId: input.scriptId,
			externalId: input.externalId,
			executionId: input.executionId,
			entitySchemaId: input.entitySchemaId,
		},
		input.executionId,
		(entityPayload, childExecutionId) =>
			processSandboxEntityDetails(entityPayload, childExecutionId),
		{ skipLibraryMembership: true, activityPrefix: input.activityPrefix },
	).pipe(
		Effect.map((entity) => ({ id: entity.id })),
		Effect.catchAllCause((cause) =>
			Effect.fail(new SandboxRunError({ message: unknownToMessage(Cause.squash(cause)) })),
		),
	);
