import { Layer, type Schema } from "effect";

import { Broadcast } from "#platform/broadcast";
import { PgClientLive } from "#platform/db/postgres";
import { PostgresWorkflowEngine } from "#platform/workflow/engine";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

export type DurableSchema = Schema.ConstraintCodec<unknown, unknown>;

export const WorkflowEngineLive = PostgresWorkflowEngine.pipe(
	Layer.provideMerge(WorkflowExecutionNotifications.liveLayer.pipe(Layer.provide(Broadcast.layer))),
	Layer.provide(PgClientLive),
);
