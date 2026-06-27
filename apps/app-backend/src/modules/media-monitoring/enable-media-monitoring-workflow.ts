import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError, NotFound } from "@ryot/contract/errors";
import { MediaMonitoringStatus } from "@ryot/contract/modules/media-monitoring/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const EnableMediaMonitoringWorkflowError = Schema.Union(DbError, NotFound);

export type EnableMediaMonitoringWorkflowError = typeof EnableMediaMonitoringWorkflowError.Type;

export const EnableMediaMonitoringWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	executionId: Schema.String,
});

export type EnableMediaMonitoringWorkflowPayload = typeof EnableMediaMonitoringWorkflowPayload.Type;

export const EnableMediaMonitoringWorkflow = Workflow.make({
	success: MediaMonitoringStatus,
	name: "EnableMediaMonitoringWorkflow",
	error: EnableMediaMonitoringWorkflowError,
	payload: EnableMediaMonitoringWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeEnableMediaMonitoring = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: EnableMediaMonitoringWorkflowPayload,
) => engine.execute(EnableMediaMonitoringWorkflow, { payload, executionId: payload.executionId });
