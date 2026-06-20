import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	CreateRelationshipBody,
	RelationshipScope,
} from "@ryot/contract/modules/relationships/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const RelationshipCreateWorkflowError = Schema.Union(BadRequest, NotFound, DbError);

export type RelationshipCreateWorkflowError = typeof RelationshipCreateWorkflowError.Type;

export const RelationshipCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	origin: AutomationOrigin,
	executionId: Schema.String,
	body: CreateRelationshipBody,
});

export type RelationshipCreateWorkflowPayload = typeof RelationshipCreateWorkflowPayload.Type;

export const RelationshipCreateWorkflow = Workflow.make({
	success: RelationshipScope,
	name: "RelationshipCreateWorkflow",
	error: RelationshipCreateWorkflowError,
	payload: RelationshipCreateWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeRelationshipCreate = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: RelationshipCreateWorkflowPayload,
) => engine.execute(RelationshipCreateWorkflow, { payload, executionId: payload.executionId });
