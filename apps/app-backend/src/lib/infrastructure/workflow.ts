import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import * as PersistedQueueRedis from "@effect/experimental/PersistedQueue/Redis";
import { PgClient } from "@effect/sql-pg";
import type * as Workflow from "@effect/workflow/Workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { Context, Schema } from "effect";
import { Clock, Duration, Effect, Layer, Redacted } from "effect";

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
// message_id AND entity_id both VARCHAR(255). The dedupe key stored in
// message_id is `${entityType}/${executionId}/${tag}/${primaryKey}`, and
// entity_id holds the workflow execution id itself. Ryot's chained workflows
// compose execution ids by suffixing (cron -> media refresh -> provider
// population -> lifecycle subscription -> sandbox -> notification delivery), so
// a deep automation chain drives both columns past 255 chars and every persist
// dies with "value too long", leaving the awaiting workflow suspended (or dead)
// forever. Widen both columns until upstream shrinks the key (the source has a
// "hash the entity address to save space?" note); drop once the fix lands.
const widenClusterMessageColumns = Effect.flatMap(PgClient.PgClient, (sql) =>
	Effect.all(
		[
			sql`ALTER TABLE cluster_messages ALTER COLUMN message_id TYPE text`,
			sql`ALTER TABLE cluster_messages ALTER COLUMN entity_id TYPE text`,
		],
		{ discard: true },
	),
).pipe(Effect.orDie, Effect.asVoid);

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
		}).pipe(Layer.tap(() => widenClusterMessageColumns)),
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

// TODO: https://github.com/Effect-TS/effect/issues/6318 (related: #6294)
// Companion workaround to the poll interval above: when a DurableQueue job
// completes before its awaiting workflow finishes persisting the Suspended
// reply, the engine's deferred-triggered resume reads storage, finds no
// Suspended reply, and no-ops — leaving the workflow Suspended forever even
// though its deferred is resolved. Result pollers therefore nudge a resume
// when a workflow has stayed Suspended across polls: resume only resets a
// workflow whose persisted reply is Suspended, re-execution replays journaled
// activities and deduped queue offers, and a resolved deferred completes it
// immediately, so the nudge is safe for genuinely in-flight jobs.
const resumeNudgePruneSize = 4_096;
const resumeNudgeIntervalMs = 2_000;
const suspendedSeenAt = new Map<string, number>();

export const pollWorkflowWithResumeNudge = <
	Name extends string,
	Payload extends Workflow.AnyStructSchema,
	Success extends Schema.Schema.Any,
	Error extends Schema.Schema.All,
>(
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	workflow: Workflow.Workflow<Name, Payload, Success, Error>,
	executionId: string,
) =>
	Effect.gen(function* () {
		const result = yield* engine.poll(workflow, executionId);
		if (result?._tag !== "Suspended") {
			suspendedSeenAt.delete(executionId);
			return result;
		}

		const now = yield* Clock.currentTimeMillis;
		const firstSeenAt = suspendedSeenAt.get(executionId);
		if (firstSeenAt === undefined) {
			if (suspendedSeenAt.size >= resumeNudgePruneSize) {
				suspendedSeenAt.clear();
			}
			suspendedSeenAt.set(executionId, now);
			return result;
		}

		if (now - firstSeenAt >= resumeNudgeIntervalMs) {
			suspendedSeenAt.set(executionId, now);
			yield* engine.resume(workflow, executionId);
		}
		return result;
	});
