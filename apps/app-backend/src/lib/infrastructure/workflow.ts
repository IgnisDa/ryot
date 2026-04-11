import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import * as PersistedQueueRedis from "@effect/experimental/PersistedQueue/Redis";
import { PgClient } from "@effect/sql-pg";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Context, Duration, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "./config/service";

const WorkflowPgClientLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: config.database.workflowPoolMax,
		}),
	),
);

// TODO: https://github.com/Effect-TS/effect/issues/6317
// @effect/cluster's SqlMessageStorage migration creates cluster_messages with
// message_id and entity_id both VARCHAR(255). message_id stores the dedupe key
// `${entityType}/${executionId}/${tag}/${primaryKey}` (for a DurableQueue
// deferred the primaryKey embeds the execution id twice more), and entity_id
// stores the raw execution id directly. Chained workflows (import -> population
// -> sandbox queue, interest population dispatch) compose execution ids by
// suffixing, so either column can exceed 255 chars and every persist attempt
// dies with "value too long", leaving the awaiting workflow suspended (or dead)
// forever. Widen both columns until upstream shrinks the key (the source has a
// "hash the entity address to save space?" note); drop once the fix lands.
const widenClusterMessageColumns = Effect.flatMap(
	PgClient.PgClient,
	(sql) =>
		sql`ALTER TABLE cluster_messages ALTER COLUMN message_id TYPE text, ALTER COLUMN entity_id TYPE text`,
).pipe(Effect.orDie, Effect.asVoid);

// TODO: https://github.com/Effect-TS/effect/issues/6294
// A workflow awaiting more than one child resumes its 2nd+ child only via this
// storage poll, not the in-process latch (@effect/cluster omits pollStorage in
// sendResumeParent's reset path). Below the 10s default so chained triggers /
// multi-item event creates don't stall ~10s per child; drop once the fix lands.
const ClusterWorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provide(
		SingleRunner.layer({
			runnerStorage: "sql",
			shardingConfig: {
				shardLockDisableAdvisory: true,
				entityMessagePollInterval: Duration.millis(250),
			},
		}).pipe(Layer.tap(() => widenClusterMessageColumns)),
	),
	Layer.provide(WorkflowPgClientLive),
);

const omitWorkflowParent = <R>(context: Context.Context<R>) => {
	const services = new Map(context.unsafeMap);
	services.delete(WorkflowInstance.key);
	return Context.unsafeMake<R>(services);
};

// TODO: https://github.com/Effect-TS/effect/issues/6294
// Production workaround, not the default composition model. Detaching removes
// structured parent ownership, so use it only with a deterministic execution
// id and an idempotent child. The caller must either
// await the detached execution or observe its durable terminal state and
// propagate failure; cancellation and timeout behavior must remain explicit.
// Prefer structured children again once the upstream resume defect is fixed.
export const withoutWorkflowParent = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.mapInputContext(effect, (context: Context.Context<R>) => omitWorkflowParent(context));

export const detachDiscardedWorkflowChildren = (engine: WorkflowEngine["Type"]) => ({
	...engine,
	execute: ((workflow, options) => {
		const execution = engine.execute(workflow, options);
		return options.discard ? withoutWorkflowParent(execution) : execution;
	}) as WorkflowEngine["Type"]["execute"],
});

export const WorkflowEngineLive = Layer.effect(
	WorkflowEngine,
	Effect.map(WorkflowEngine, detachDiscardedWorkflowChildren),
).pipe(Layer.provide(ClusterWorkflowEngineLive));

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
