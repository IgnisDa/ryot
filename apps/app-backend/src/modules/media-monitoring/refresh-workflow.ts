import { Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";

import type { MediaMonitoringTarget } from "./repository";

export const MediaMonitoringRefreshPayload = Schema.Struct({
	entityId: EntityId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
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

export const runMediaMonitoringRefreshWorkflow = Effect.fn("runMediaMonitoringRefreshWorkflow")(
	function* (payload: MediaMonitoringRefreshPayload) {
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
				entitySchemaId: payload.entitySchemaId,
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		});
	},
);

export const MediaMonitoringRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MediaMonitoringRefreshWorkflow.toLayer((payload) => runMediaMonitoringRefreshWorkflow(payload)),
);

export const mediaMonitoringPayloadFromTarget = (
	target: MediaMonitoringTarget,
	executionId: string,
) => ({
	executionId,
	entityId: target.entityId,
	externalId: target.externalId,
	entitySchemaId: target.entitySchemaId,
	sandboxScriptId: target.sandboxScriptId,
	entitySchemaSlug: target.entitySchemaSlug,
});
