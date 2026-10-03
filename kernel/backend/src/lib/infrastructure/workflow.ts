import type { Schema } from "effect";
import { Layer } from "effect";
import {
	ClusterWorkflowEngine,
	RunnerHealth,
	Runners,
	Sharding,
	ShardingConfig,
	SqlRunnerStorage,
} from "effect/cluster";

import { WorkflowGarbageCollectionStorageLive } from "#modules/garbage-collection/workflow-storage";

import { PgClientLive } from "./db/postgres";

export type DurableSchema = Schema.ConstraintCodec<unknown, unknown>;

export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provideMerge(
		Sharding.layer.pipe(
			Layer.provideMerge(Runners.layerNoop),
			Layer.provideMerge(WorkflowGarbageCollectionStorageLive),
			Layer.provide([Layer.orDie(SqlRunnerStorage.layer), RunnerHealth.layerNoop]),
			Layer.provide(ShardingConfig.layerFromEnv({ shardLockDisableAdvisory: true })),
		),
	),
	Layer.provide(PgClientLive),
);
