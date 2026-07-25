import { BunRedis } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import type { Schema } from "effect";
import { Context, Duration, Effect, Layer, Redacted } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { PersistedQueue } from "effect/unstable/persistence";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "./config/service";

export type DurableSchema = Schema.ConstraintCodec<unknown, unknown>;

const WorkflowPgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: config.database.workflowPoolMax,
		}),
	),
);

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
		}),
	),
	Layer.provide(WorkflowPgClientLive),
);

// TODO: https://github.com/Effect-TS/effect/issues/6294
// Production workaround, not the default composition model. Detaching removes
// structured parent ownership, so use it only with a deterministic execution
// id and an idempotent child. The caller must either
// await the detached execution or observe its durable terminal state and
// propagate failure; cancellation and timeout behavior must remain explicit.
// Prefer structured children again once the upstream resume defect is fixed.
const omitWorkflowParent = <R>(context: Context.Context<R>) =>
	Context.makeUnsafe<R>(Context.omit(WorkflowInstance)(context).mapUnsafe);

export const withoutWorkflowParent = <A, E, R>(
	effect: WorkflowInstance extends R ? never : Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.updateContext(effect, omitWorkflowParent);

export const detachDiscardedWorkflowChildren = (engine: WorkflowEngine["Service"]) =>
	({
		...engine,
		execute: (workflow, options) => {
			const execution = engine.execute(workflow, options);
			return options.discard ? Effect.updateContext(execution, omitWorkflowParent) : execution;
		},
	}) satisfies WorkflowEngine["Service"];

export const WorkflowEngineLive = Layer.effect(
	WorkflowEngine,
	Effect.map(WorkflowEngine, detachDiscardedWorkflowChildren),
).pipe(Layer.provide(ClusterWorkflowEngineLive));

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
