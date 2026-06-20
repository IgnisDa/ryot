import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { decodeTrendingDriverResult, type TrendingDriverItem } from "./schemas";

const fetchSandboxTrending = (input: { scriptId: SandboxScriptId; executionId: string }) =>
	DurableQueue.process(SandboxExecutionQueue, {
		context: {},
		userId: null,
		driverName: "trending",
		scriptId: input.scriptId,
		executionId: input.executionId,
	}).pipe(
		Effect.mapError(toSandboxRunError),
		Effect.flatMap((result) => {
			if (result.error) {
				return Effect.fail(new SandboxRunError({ message: result.error }));
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
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				fetchTrending: (input) =>
					fetchSandboxTrending(input).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies MediaTrendingWorkflowOperationsValue,
	),
);
