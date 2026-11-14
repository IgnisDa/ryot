import { Layer } from "effect";

import { PostgresWorkflowEngine } from "#platform/workflow/engine";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

// Each build persists workflows in its own migrated database.
export const postgresWorkflowEngineTestLayer = PostgresWorkflowEngine.pipe(
	Layer.provide(WorkflowExecutionNotifications.layer),
	Layer.provide(isolatedDatabaseLayer("workflow_engine")),
);
