import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError, NotFound } from "@ryot/contract/errors";
import { MediaMonitoringStatus } from "@ryot/contract/modules/media-monitoring/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const DisableMediaMonitoringWorkflowError = Schema.Union(DbError, NotFound);

export type DisableMediaMonitoringWorkflowError = typeof DisableMediaMonitoringWorkflowError.Type;

export const DisableMediaMonitoringWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	executionId: Schema.String,
});

export type DisableMediaMonitoringWorkflowPayload =
	typeof DisableMediaMonitoringWorkflowPayload.Type;

export const DisableMediaMonitoringWorkflow = Workflow.make({
	success: MediaMonitoringStatus,
	name: "DisableMediaMonitoringWorkflow",
	error: DisableMediaMonitoringWorkflowError,
	payload: DisableMediaMonitoringWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeDisableMediaMonitoring = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: DisableMediaMonitoringWorkflowPayload,
) => engine.execute(DisableMediaMonitoringWorkflow, { payload, executionId: payload.executionId });
