import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { CreateEntityBody, ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const EntityCreateWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

export type EntityCreateWorkflowError = typeof EntityCreateWorkflowError.Type;

export const EntityCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	body: CreateEntityBody,
	origin: AutomationOrigin,
	executionId: Schema.String,
});

export type EntityCreateWorkflowPayload = typeof EntityCreateWorkflowPayload.Type;

export const EntityCreateWorkflow = Workflow.make({
	success: ListedEntity,
	name: "EntityCreateWorkflow",
	error: EntityCreateWorkflowError,
	payload: EntityCreateWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeEntityCreate = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: EntityCreateWorkflowPayload,
) => engine.execute(EntityCreateWorkflow, { payload, executionId: payload.executionId });
