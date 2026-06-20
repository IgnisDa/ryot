import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import * as PersistedQueueRedis from "@effect/experimental/PersistedQueue/Redis";
import { PgClient } from "@effect/sql-pg";
import { Config, Duration, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "./config/service";

const WorkflowPgClientLive = PgClient.layerConfig({
	url: Config.redacted("DATABASE_URL"),
	maxConnections: Config.integer("DATABASE_WORKFLOW_POOL_MAX").pipe(Config.withDefault(10)),
});

// TODO: https://github.com/Effect-TS/effect/issues/6294
// A workflow awaiting more than one child resumes its 2nd+ child only via this
// storage poll, not the in-process latch (@effect/cluster omits pollStorage in
// sendResumeParent's reset path). Below the 10s default so chained triggers /
// multi-item event creates don't stall ~10s per child; drop once the fix lands.
export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provide(
		SingleRunner.layer({
			runnerStorage: "sql",
			shardingConfig: { entityMessagePollInterval: Duration.millis(250) },
		}),
	),
	Layer.provide(WorkflowPgClientLive),
);

const RedisPersistedQueueStoreLive = Layer.scoped(
	PersistedQueue.PersistedQueueStore,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const url = new URL(Redacted.value(config.redisUrl));
		const db = url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1)) || 0 : 0;

		return yield* PersistedQueueRedis.make({
			db,
			host: url.hostname,
			prefix: "ryot:pq:",
			password: url.password || undefined,
			username: url.username || undefined,
			// Below the 1s default so a trigger chain's queue hops don't compound.
			pollInterval: Duration.millis(250),
			port: url.port ? Number.parseInt(url.port) : 6379,
		});
	}),
);

export const PersistedQueueLive = PersistedQueue.layer.pipe(
	Layer.provide(RedisPersistedQueueStoreLive),
);
