import { Workflow } from "@effect/workflow";
import { SandboxRunError } from "@ryot/contract/errors";
import { Layer, Schema } from "effect";

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
	(payload, executionId) => runMediaTrendingRefresh(payload, executionId),
);

export const MediaTrendingRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MediaTrendingRefreshWorkflowLive,
);
