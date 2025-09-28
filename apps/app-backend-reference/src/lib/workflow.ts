import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import * as PersistedQueueRedis from "@effect/experimental/PersistedQueue/Redis";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "./config";

export const WorkflowPgClientLive = PgClient.layerConfig({
	url: Config.redacted("DATABASE_URL"),
});

export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provide(SingleRunner.layer({ runnerStorage: "sql" })),
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
			prefix: "reference:pq:",
			password: url.password || undefined,
			username: url.username || undefined,
			port: url.port ? Number.parseInt(url.port) : 6379,
		});
	}),
);

export const PersistedQueueLive = PersistedQueue.layer.pipe(
	Layer.provide(RedisPersistedQueueStoreLive),
);
