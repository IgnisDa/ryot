import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";

import type { DbRunner } from "#lib/db/service";
import type { EntitiesService } from "#modules/entities/service";
import type { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import type { RelationshipsRepository } from "#modules/relationships/repository";
import type { CronTask } from "#modules/scheduler/types";

import type { MediaTrendingWorkflowOperations } from "./operations-workflow";
import { runMediaTrendingRefresh } from "./refresh";
import type { MediaTrendingRepository } from "./repository";

export type InfrequentCronTask = CronTask<
	SandboxRunError,
	| DbRunner
	| EntitiesService
	| WorkflowEngine
	| WorkflowInstance
	| RelationshipsRepository
	| MediaTrendingRepository
	| RelationshipSchemasRepository
	| MediaTrendingWorkflowOperations
>;

export const mediaTrendingInfrequentTask: InfrequentCronTask = {
	name: "media-trending-refresh",
	run: ({ executionId }) => runMediaTrendingRefresh({ executionId }),
};
