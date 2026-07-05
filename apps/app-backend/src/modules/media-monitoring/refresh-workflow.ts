import { Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";

import type { MediaMonitoringTarget } from "./repository";

export const MediaMonitoringRefreshPayload = Schema.Struct({
	entityId: EntityId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	sandboxScriptId: SandboxScriptId,
});

export type MediaMonitoringRefreshPayload = typeof MediaMonitoringRefreshPayload.Type;

export const MediaMonitoringRefreshWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "MediaMonitoringRefreshWorkflow",
	payload: MediaMonitoringRefreshPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const runMediaMonitoringRefreshWorkflow = Effect.fn("MediaMonitoringRefreshWorkflow")(
	function* (payload: MediaMonitoringRefreshPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			entityId: payload.entityId,
			externalId: payload.externalId,
			entitySchemaSlug: payload.entitySchemaSlug,
			sandboxScriptId: payload.sandboxScriptId,
		});
		const engine = yield* WorkflowEngine;
		const refreshExecutionId = `${payload.executionId}-provider-refresh`;
		yield* engine.execute(ProviderEntityPopulationWorkflow, {
			executionId: refreshExecutionId,
			payload: {
				userId: null,
				mode: "refresh",
				externalId: payload.externalId,
				executionId: refreshExecutionId,
				scriptId: payload.sandboxScriptId,
				origin: { kind: "provider_refresh" },
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "MediaMonitoringRefreshWorkflow" }),
);

export const MediaMonitoringRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MediaMonitoringRefreshWorkflow.toLayer(runMediaMonitoringRefreshWorkflow),
);

export const mediaMonitoringPayloadFromTarget = (
	target: MediaMonitoringTarget,
	executionId: string,
) => ({
	executionId,
	entityId: target.entityId,
	externalId: target.externalId,
	entitySchemaSlug: target.entitySchemaSlug,
	sandboxScriptId: target.sandboxScriptId,
});
