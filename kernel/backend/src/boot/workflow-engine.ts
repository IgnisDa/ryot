import { Layer, type Schema } from "effect";
import {
	ClusterWorkflowEngine,
	RunnerHealth,
	Runners,
	Sharding,
	ShardingConfig,
	SqlRunnerStorage,
} from "effect/cluster";

import { WorkflowGarbageCollectionStorageLive } from "#modules/garbage-collection/workflow-storage";
import { PgClientLive } from "#platform/db/postgres";
import { RedisService } from "#platform/redis";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

export type DurableSchema = Schema.ConstraintCodec<unknown, unknown>;

export const shardingConfig = { shardLockDisableAdvisory: true } satisfies Partial<
	ShardingConfig.ShardingConfig["Service"]
>;

const storage = WorkflowGarbageCollectionStorageLive.pipe(
	Layer.provideMerge(
		WorkflowExecutionNotifications.liveLayer.pipe(Layer.provide(RedisService.layer)),
	),
);

// TODO: https://github.com/Effect-TS/effect/issues/9335
// Effect 4.0.5 reads every local reply back from storage, which roughly doubles workflow replays.
export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provideMerge(
		Sharding.layer.pipe(
			Layer.provideMerge(Runners.layerNoop),
			Layer.provide(RunnerHealth.layerNoop),
			Layer.provideMerge(storage),
			Layer.provide(Layer.orDie(SqlRunnerStorage.layer)),
			Layer.provide(ShardingConfig.layer(shardingConfig)),
		),
	),
	Layer.provide(PgClientLive),
);
