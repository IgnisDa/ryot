import { Workflow } from "@effect/workflow";
import { SandboxRunError } from "@ryot/contract/errors";
import { Effect, Layer, Schema } from "effect";

import { runMediaTrendingRefresh } from "./refresh";

export const MediaTrendingRefreshPayload = Schema.Struct({
	executionId: Schema.String,
});

export type MediaTrendingRefreshPayload = typeof MediaTrendingRefreshPayload.Type;

export const MediaTrendingRefreshWorkflow = Workflow.make({
	error: SandboxRunError,
	name: "MediaTrendingRefreshWorkflow",
	payload: MediaTrendingRefreshPayload,
	idempotencyKey: ({ executionId }) => executionId,
	success: Schema.Struct({
		synced: Schema.Boolean,
		itemCount: Schema.Number,
		providerCount: Schema.Number,
	}),
});

const MediaTrendingRefreshWorkflowLive = MediaTrendingRefreshWorkflow.toLayer(
	(payload, executionId) =>
		runMediaTrendingRefresh(payload).pipe(
			Effect.withSpan("MediaTrendingRefreshWorkflow", { attributes: { executionId } }),
			Effect.annotateLogs({ executionId, workflow: "MediaTrendingRefreshWorkflow" }),
		),
);

export const MediaTrendingRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MediaTrendingRefreshWorkflowLive,
);
