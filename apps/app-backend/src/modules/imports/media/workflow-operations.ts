import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { FileSystem, HttpClient, Path } from "@effect/platform";
import { DurableQueue } from "@effect/workflow";
import { Cause, Effect, Layer } from "effect";

import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import { SandboxRunError, unknownToMessage } from "#lib/errors";
import { RedisService } from "#lib/redis";
import type { EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	decodeEntityResolveResult,
	decodeEntitySearchResult,
} from "#modules/entity-import/population";
import {
	EntityImportWorkflowOperations,
	runEntityImportWorkflow,
} from "#modules/entity-import/workflows";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { loadOneTimeMediaImportAdapterResult } from "./source-loaders";
import { MediaImportWorkflowOperations } from "./workflow-types";

const toSandboxError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const resolveSandboxEntityExternalId = (input: {
	value: string;
	userId: UserId;
	executionId: string;
	identifierType: string;
	scriptId: SandboxScriptId;
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

const searchSandboxEntities = (input: {
	query: string;
	userId: UserId;
	executionId: string;
	scriptId: SandboxScriptId;
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

const importMediaEntityViaWorkflow = (input: {
	userId: UserId;
	externalId: string;
	executionId: string;
	activityPrefix: string;
	scriptId: SandboxScriptId;
	entitySchemaId: EntitySchemaId;
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
		{ activityPrefix: input.activityPrefix },
	).pipe(
		Effect.map((entity) => ({ id: entity.id })),
		Effect.catchAllCause((cause) =>
			Effect.fail(new SandboxRunError({ message: unknownToMessage(Cause.squash(cause)) })),
		),
	);

export const MediaImportWorkflowOperationsLive = Layer.effect(
	MediaImportWorkflowOperations,
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const entities = yield* EntitiesService;
		const fs = yield* FileSystem.FileSystem;
		const httpClient = yield* HttpClient.HttpClient;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const entitySchemasRepository = yield* EntitySchemasRepository;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		const entityImportOperations = yield* EntityImportWorkflowOperations;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		return {
			loadAdapterResult: (payload) =>
				loadOneTimeMediaImportAdapterResult(payload).pipe(
					Effect.provideService(AppConfig, config),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
					Effect.provideService(RedisService, redis),
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(HttpClient.HttpClient, httpClient),
					Effect.provideService(EntitiesRepository, entitiesRepository),
				),
			searchEntities: (input) =>
				searchSandboxEntities(input).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
			importEntity: (input) =>
				importMediaEntityViaWorkflow(input).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(EntitiesService, entities),
					Effect.provideService(EntitiesRepository, entitiesRepository),
					Effect.provideService(EntitySchemasRepository, entitySchemasRepository),
					Effect.provideService(RelationshipsRepository, relationshipsRepository),
					Effect.provideService(EntityImportWorkflowOperations, entityImportOperations),
					Effect.provideService(RelationshipSchemasRepository, relationshipSchemasRepository),
				),
			resolveExternalId: (input) =>
				resolveSandboxEntityExternalId(input).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		};
	}),
);
