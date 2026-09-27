import { BunRedis } from "@effect/platform-bun";
import type { Schema } from "effect";
import { Duration, Effect, Layer, Redacted } from "effect";
import {
	ClusterWorkflowEngine,
	RunnerHealth,
	Runners,
	Sharding,
	ShardingConfig,
	SqlRunnerStorage,
} from "effect/cluster";
import { PersistedQueue } from "effect/persistence";

import { WorkflowGarbageCollectionStorageLive } from "#modules/garbage-collection/workflow-storage";

import { AppConfig } from "./config/service";
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

const RedisLive = Layer.unwrap(
	Effect.map(AppConfig, (config) => BunRedis.layer({ url: Redacted.value(config.redisUrl) })),
);

const RedisPersistedQueueStoreLive = PersistedQueue.layerStoreRedis({
	prefix: "ryot:pq:",
	// Sandbox replays are the only persisted-queue workload, so keep their handoff latency below the
	// workflow's interactive budget without increasing SQL workflow polling.
	pollInterval: Duration.millis(25),
}).pipe(Layer.provide(RedisLive));

export const PersistedQueueLive = PersistedQueue.layer.pipe(
	Layer.provide(RedisPersistedQueueStoreLive),
);
