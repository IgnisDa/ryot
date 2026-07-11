import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { FileSystem, HttpClient, Path } from "@effect/platform";
import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import { type SandboxProviderId, SandboxScriptId, type UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { decodeSandboxDriverResult } from "#modules/entity-import/population";
import { LibraryEntityImportWorkflow } from "#modules/library-membership/library-entity-import-workflow";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import {
	decodeProviderResolveResult,
	decodeProviderSearchResult,
} from "#modules/sandbox/provider-contracts";
import { SandboxRepository } from "#modules/sandbox/repository";

import { loadOneTimeMediaImportAdapterResult } from "./source-loaders";
import { MediaImportWorkflowOperations } from "./types-workflow";

const resolveSandboxEntityExternalId = (input: {
	value: string;
	userId: UserId;
	executionId: string;
	identifierType: string;
	providerId: SandboxProviderId;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const scriptId = yield* Activity.make({
			error: SandboxRunError,
			success: SandboxScriptId,
			name: `resolve-provider-resolve-script-${input.executionId}`,
			execute: runWithDb(pluginRuntime.resolveResolveScript(input.providerId)).pipe(
				Effect.map(({ id }) => id),
				Effect.mapError(toSandboxRunError),
			),
		});
		return yield* processSandboxExecution({
			scriptId,
			executionId: input.executionId,
			authority: { type: "user", userId: input.userId },
			context: { value: input.value, identifierType: input.identifierType },
		});
	}).pipe(
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) =>
			decodeSandboxDriverResult(
				result,
				decodeProviderResolveResult,
				"Entity resolve script returned an unexpected shape",
			),
		),
	);

const searchSandboxEntities = (input: {
	query: string;
	userId: UserId;
	executionId: string;
	providerId: SandboxProviderId;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const scriptId = yield* Activity.make({
			error: SandboxRunError,
			success: SandboxScriptId,
			name: `resolve-provider-search-script-${input.executionId}`,
			execute: runWithDb(pluginRuntime.resolveSearchScript(input.providerId)).pipe(
				Effect.map(({ id }) => id),
				Effect.mapError(toSandboxRunError),
			),
		});
		return yield* processSandboxExecution({
			scriptId,
			executionId: input.executionId,
			authority: { type: "user", userId: input.userId },
			context: { query: input.query, page: 1, pageSize: 5 },
		});
	}).pipe(
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) =>
			decodeSandboxDriverResult(
				result,
				decodeProviderSearchResult,
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
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
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
				),
			resolveProvider: (providerSlug) =>
				runWithDb(pluginRuntime.findSchemaProviderBySlug(providerSlug)).pipe(
					Effect.map((resolved) =>
						resolved
							? {
									providerId: resolved.provider.id,
									entitySchemaSlug: resolved.entitySchemaSlug,
								}
							: null,
					),
				),
			searchEntities: (input) =>
				searchSandboxEntities(input).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
			importEntity: (input) =>
				Effect.gen(function* () {
					const engine = yield* WorkflowEngine;
					const entity = yield* engine.execute(LibraryEntityImportWorkflow, {
						executionId: input.executionId,
						payload: {
							origin: input.origin,
							userId: input.userId,
							providerId: input.providerId,
							externalId: input.externalId,
							executionId: input.executionId,
							entitySchemaSlug: input.entitySchemaSlug,
						},
					});
					return { id: entity.id };
				}),
			resolveExternalId: (input) =>
				resolveSandboxEntityExternalId(input).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
			writeCollectionMembership: (input) =>
				Effect.gen(function* () {
					const engine = yield* WorkflowEngine;
					yield* engine.execute(AddEntityToCollectionWorkflow, {
						executionId: input.executionId,
						payload: {
							properties: {},
							userId: input.userId,
							entityId: input.entityId,
							executionId: input.executionId,
							collectionId: input.collectionId,
						},
					});
				}),
		};
	}),
);
