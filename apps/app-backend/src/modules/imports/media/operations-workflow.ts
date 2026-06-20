import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { FileSystem, HttpClient, Path } from "@effect/platform";
import { DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	decodeEntityResolveResult,
	decodeEntitySearchResult,
	decodeSandboxDriverResult,
} from "#modules/entity-import/population";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { loadOneTimeMediaImportAdapterResult } from "./source-loaders";
import { MediaImportWorkflowOperations } from "./types-workflow";

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
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) =>
			decodeSandboxDriverResult(
				result,
				decodeEntityResolveResult,
				"Entity resolve script returned an unexpected shape",
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
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) =>
			decodeSandboxDriverResult(
				result,
				decodeEntitySearchResult,
				"Entity search script returned an unexpected shape",
			).pipe(Effect.map((parsed) => parsed.items)),
		),
	);

export const MediaImportWorkflowOperationsLive = Layer.effect(
	MediaImportWorkflowOperations,
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const fs = yield* FileSystem.FileSystem;
		const httpClient = yield* HttpClient.HttpClient;
		const entitiesRepository = yield* EntitiesRepository;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;

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
				Effect.gen(function* () {
					const engine = yield* WorkflowEngine;
					const entity = yield* engine.execute(ProviderEntityPopulationWorkflow, {
						executionId: input.executionId,
						payload: {
							mode: "ensure",
							userId: input.userId,
							scriptId: input.scriptId,
							externalId: input.externalId,
							executionId: input.executionId,
							entitySchemaId: input.entitySchemaId,
						},
					});
					return { id: entity.id };
				}),
			resolveExternalId: (input) =>
				resolveSandboxEntityExternalId(input).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		};
	}),
);
