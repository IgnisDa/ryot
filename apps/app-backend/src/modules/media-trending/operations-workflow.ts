import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxRepository } from "#modules/sandbox/repository";

import {
	decodeTrendingDriverResult,
	TRENDING_DRIVER_NAME,
	type TrendingDriverItem,
} from "./schemas";

const fetchSandboxTrending = (input: { scriptId: SandboxScriptId; executionId: string }) =>
	processSandboxExecution({
		context: {},
		userId: null,
		scriptId: input.scriptId,
		executionId: input.executionId,
		driverName: TRENDING_DRIVER_NAME,
	}).pipe(
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) => {
			if (result.error) {
				return Effect.fail(new SandboxRunError({ message: result.error.message }));
			}

			return decodeTrendingDriverResult(result.value).pipe(
				Effect.mapError(
					(error) =>
						new SandboxRunError({
							message: `Trending script returned an unexpected shape: ${error.message}`,
						}),
				),
				Effect.map((parsed) => parsed.items),
			);
		}),
	);

export type MediaTrendingWorkflowOperationsValue = {
	fetchTrending: (input: {
		executionId: string;
		scriptId: SandboxScriptId;
	}) => Effect.Effect<
		ReadonlyArray<TrendingDriverItem>,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class MediaTrendingWorkflowOperations extends Context.Tag("MediaTrendingWorkflowOperations")<
	MediaTrendingWorkflowOperations,
	MediaTrendingWorkflowOperationsValue
>() {}

export const MediaTrendingWorkflowOperationsLive = Layer.effect(
	MediaTrendingWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		return {
			fetchTrending: (input) =>
				fetchSandboxTrending(input).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		} satisfies MediaTrendingWorkflowOperationsValue;
	}),
);
