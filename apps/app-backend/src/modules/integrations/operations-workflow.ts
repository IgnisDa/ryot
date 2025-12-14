import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { HttpClient } from "@effect/platform";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { MediaImportAdapterResultSchema } from "#modules/imports/media/adapter-result";
import { resolveProviderSandboxArtifact } from "#modules/sandbox/provider-artifacts";
import { SandboxRepository } from "#modules/sandbox/repository";

import type { IntegrationRecord } from "./repository";
import { loadYankAdapterResult, runYoutubeMusicHistorySandbox } from "./worker";

export type IntegrationRunOperationsValue = {
	loadYankAdapterResult: (integration: IntegrationRecord) => Effect.Effect<
		{
			cleanupPaths: ReadonlyArray<string>;
			adapterResult: typeof MediaImportAdapterResultSchema.Type;
		},
		{ cleanupPaths: ReadonlyArray<string>; message: string }
	>;
	runSandboxHistory: (input: {
		userId: UserId;
		executionId: string;
		scriptId: SandboxScriptId;
		context: { authCookie: string; timezone: string };
	}) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class IntegrationRunOperations extends Context.Tag("IntegrationRunOperations")<
	IntegrationRunOperations,
	IntegrationRunOperationsValue
>() {}

export const IntegrationRunOperationsLive = Layer.effect(
	IntegrationRunOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const httpClient = yield* HttpClient.HttpClient;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;

		return {
			loadYankAdapterResult: (integration) =>
				loadYankAdapterResult(integration).pipe(
					Effect.provideService(HttpClient.HttpClient, httpClient),
				),
			runSandboxHistory: (input) =>
				runYoutubeMusicHistorySandbox(input).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					Effect.flatMap((result) =>
						resolveProviderSandboxArtifact({ executionId: input.executionId, result }).pipe(
							Effect.provideService(DbRunner, runWithDb),
							Effect.provideService(SandboxRepository, repository),
						),
					),
				),
		} satisfies IntegrationRunOperationsValue;
	}),
);
