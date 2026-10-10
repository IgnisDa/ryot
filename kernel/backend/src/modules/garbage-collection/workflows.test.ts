import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Context, Effect, Exit, Layer, Option, Redacted, Ref, Result, Schema } from "effect";
import {
	EntityAddress,
	EntityId,
	EntityType,
	Envelope,
	Message,
	MessageStorage,
	Reply,
	ShardId,
	ShardingConfig,
	Snowflake,
} from "effect/cluster";
import { Headers } from "effect/http";
import { Rpc } from "effect/rpc";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";

import { PgClientLive } from "#lib/infrastructure/db/postgres";
import { workflowExecution } from "#lib/infrastructure/db/schema/tables/workflow-executions";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import {
	workflowClockEntityType,
	WorkflowExecutionExpired,
	type WorkflowIdentity,
	WorkflowParentPayload,
} from "./workflow-models";
import { WorkflowGarbageCollectionRepository } from "./workflow-repository";
import { WorkflowGarbageCollectionStorageLive } from "./workflow-storage";
import { WorkflowGarbageCollector } from "./workflows";

const resultSchema = Workflow.Result({ error: Schema.String, success: Schema.String });
const runRpc = Rpc.make("run", {
	primaryKey: () => "",
	success: resultSchema,
	payload: WorkflowParentPayload.fields,
});

const clockRpc = Rpc.make("run", {
	success: Schema.Void,
	primaryKey: ({ name }) => name,
	payload: { name: Schema.String, workflowName: Schema.String },
});

const deferredRpc = Rpc.make("deferred", {
	success: Schema.Void,
	primaryKey: ({ name }) => name,
	payload: { name: Schema.String },
});

// Interactive lane variants live in their own shard group.
const shardOf = (identity: WorkflowIdentity) =>
	ShardId.make(identity.workflowName.endsWith("Interactive") ? "interactive" : "default", 1);

const saveClock = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
	const generator = yield* Snowflake.Generator;
	const storage = yield* MessageStorage.MessageStorage;
	const message = new Message.OutgoingRequest({
		rpc: clockRpc,
		context: Context.empty(),
		respond: () => Effect.void,
		annotations: Context.empty(),
		lastReceivedReply: Option.none(),
		envelope: Envelope.makeRequest<typeof clockRpc>({
			tag: "run",
			headers: Headers.empty,
			requestId: generator.nextUnsafe(),
			payload: clockRpc.payloadSchema.make({ name: "sleep", workflowName: identity.workflowName }),
			address: EntityAddress.make({
				shardId: shardOf(identity),
				entityId: EntityId.make(identity.executionId),
				entityType: EntityType.make(workflowClockEntityType),
			}),
		}),
	});
	yield* storage.saveRequest(message);
	yield* storage.saveReply(
		new Reply.ReplyWithContext({
			rpc: clockRpc,
			context: Context.empty(),
			reply: new Reply.WithExit<typeof clockRpc>({
				exit: Exit.void,
				id: generator.nextUnsafe(),
				requestId: message.envelope.requestId,
			}),
		}),
	);
});

const request = Effect.fnUntraced(function* (
	identity: WorkflowIdentity,
	parent?: WorkflowIdentity,
	requestId?: Snowflake.Snowflake,
) {
	const generator = yield* Snowflake.Generator;
	return new Message.OutgoingRequest({
		rpc: runRpc,
		context: Context.empty(),
		respond: () => Effect.void,
		annotations: Context.empty(),
		lastReceivedReply: Option.none(),
		envelope: Envelope.makeRequest<typeof runRpc>({
			tag: "run",
			headers: Headers.empty,
			requestId: requestId ?? generator.nextUnsafe(),
			payload: runRpc.payloadSchema.make(
				parent ? { "~effect/cluster/ClusterWorkflowEngine/payloadParentKey": parent } : {},
			),
			address: EntityAddress.make({
				shardId: shardOf(identity),
				entityId: EntityId.make(identity.executionId),
				entityType: EntityType.make(`Workflow/${identity.workflowName}`),
			}),
		}),
	});
});

const saveRun = Effect.fnUntraced(function* (
	identity: WorkflowIdentity,
	parent?: WorkflowIdentity,
) {
	const message = yield* request(identity, parent);
	yield* (yield* MessageStorage.MessageStorage).saveRequest(message);
	return message;
});

const reply = Effect.fnUntraced(function* (
	message: Effect.Success<ReturnType<typeof request>>,
	result: typeof resultSchema.Type,
) {
	return new Reply.ReplyWithContext({
		rpc: runRpc,
		context: Context.empty(),
		reply: new Reply.WithExit<typeof runRpc>({
			exit: Exit.succeed(result),
			requestId: message.envelope.requestId,
			id: (yield* Snowflake.Generator).nextUnsafe(),
		}),
	});
});

const completeRun = Effect.fnUntraced(function* (
	message: Effect.Success<ReturnType<typeof request>>,
	exit: Exit.Exit<string, string> = Exit.succeed("result"),
) {
	yield* (yield* MessageStorage.MessageStorage).saveReply(
		yield* reply(message, new Workflow.Complete({ exit })),
	);
});

const counts = Effect.fnUntraced(function* () {
	return yield* (yield* DatabaseSession).run((db) =>
		db.execute<{ messages: number; replies: number }>(
			sql`
			select (select count(*)::integer from cluster_messages) as messages,
				(select count(*)::integer from cluster_replies) as replies
		`,
			"objects",
		),
	);
});

const collectorLayer = Layer.unwrap(
	Effect.gen(function* () {
		const database = yield* IsolatedDatabase;
		return WorkflowGarbageCollector.layer.pipe(
			Layer.provideMerge(WorkflowGarbageCollectionStorageLive),
			Layer.provideMerge(DatabaseSession.layer),
			Layer.provideMerge(PgClientLive),
			Layer.provideMerge(Snowflake.layerGenerator),
			Layer.provide(ShardingConfig.layerFromEnv()),
			Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(database.url) } })),
			Layer.provide(BunServices.layer),
		);
	}),
).pipe(Layer.provide(isolatedDatabaseLayer("workflow_gc")));

layer(Layer.effectContext(TestClock.withLive(Layer.build(collectorLayer))))((test) => {
	test.effect("clears successful mailboxes and clocks after 24 hours and fences replay", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-10-02T00:00:00Z"));
			const identity = { executionId: "success", workflowName: "SuccessWorkflow" };
			const storage = yield* MessageStorage.MessageStorage;
			const collector = yield* WorkflowGarbageCollector;
			const message = yield* saveRun(identity);
			yield* saveClock(identity);
			yield* completeRun(message);
			yield* TestClock.adjust("23 hours");
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
			expect(yield* counts()).toEqual([{ replies: 2, messages: 2 }]);
			yield* TestClock.adjust("1 hour");
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 1 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
			const replay = yield* Effect.exit(storage.saveRequest(yield* request(identity)));
			assert(Exit.isFailure(replay));
			expect(Cause.findDefect(replay.cause)).toEqual(
				Result.succeed(new WorkflowExecutionExpired(identity)),
			);
			yield* completeRun(message);
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
			const session = yield* DatabaseSession;
			const rows = yield* session.run((db) => db.select().from(workflowExecution));
			expect(rows).toMatchObject([{ ...identity, shardId: null, status: "succeeded" }]);
			expect(rows[0]?.expiredAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
			expect(rows[0]?.clearedAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
		}),
	);

	test.effect("clears a completed interactive-variant execution from its own shard group", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-10-06T00:00:00Z"));
			const identity = { executionId: "interactive", workflowName: "SuccessWorkflowInteractive" };
			const collector = yield* WorkflowGarbageCollector;
			const message = yield* saveRun(identity);
			yield* saveClock(identity);
			yield* completeRun(message);
			yield* TestClock.adjust("24 hours");
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 1 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
			const rows = yield* (yield* DatabaseSession).run((db) =>
				db.select().from(workflowExecution).where(eq(workflowExecution.executionId, "interactive")),
			);
			expect(rows).toMatchObject([{ ...identity, shardId: null, status: "succeeded" }]);
		}),
	);

	test.effect(
		"keeps completed children while a parent is suspended and starts TTL at tree completion",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-10-10T00:00:00Z"));
				const parent = { executionId: "parent", workflowName: "ParentWorkflow" };
				const child = { executionId: "child", workflowName: "ChildWorkflow" };
				const parentMessage = yield* saveRun(parent);
				const childMessage = yield* saveRun(child, parent);
				const storage = yield* MessageStorage.MessageStorage;
				yield* completeRun(childMessage);
				yield* storage.saveReply(yield* reply(parentMessage, new Workflow.Suspended({})));
				yield* TestClock.adjust("8 days");
				const collector = yield* WorkflowGarbageCollector;
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				expect(yield* storage.repliesForUnfiltered([childMessage.envelope.requestId])).toHaveLength(
					1,
				);
				yield* storage.clearReplies(parentMessage.envelope.requestId);
				yield* completeRun(parentMessage);
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* TestClock.adjust("24 hours");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
				expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
			}),
	);

	test.effect("keeps a tree with a failed child for seven days even if its root succeeds", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-11-01T00:00:00Z"));
			const parent = { executionId: "failure-parent", workflowName: "ParentWorkflow" };
			const parentMessage = yield* saveRun(parent);
			const childMessage = yield* saveRun(
				{ executionId: "failure-child", workflowName: "ChildWorkflow" },
				parent,
			);
			yield* completeRun(childMessage, Exit.fail("provider failed"));
			yield* completeRun(parentMessage);
			yield* TestClock.adjust("6 days");
			const collector = yield* WorkflowGarbageCollector;
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
			yield* TestClock.adjust("1 day");
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("does not collect a successful root while a discarded child remains active", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-12-01T00:00:00Z"));
			const parent = { executionId: "discard-parent", workflowName: "ParentWorkflow" };
			const parentMessage = yield* saveRun(parent);
			const childMessage = yield* saveRun(
				{ executionId: "discard-child", workflowName: "ChildWorkflow" },
				parent,
			);
			yield* completeRun(parentMessage);
			yield* TestClock.adjust("8 days");
			const collector = yield* WorkflowGarbageCollector;
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
			yield* completeRun(childMessage);
			yield* TestClock.adjust("24 hours");
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("keeps a terminal tree with an unprocessed deferred completion", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-01-01T00:00:00Z"));
			const identity = { executionId: "pending-deferred", workflowName: "PendingWorkflow" };
			const message = yield* saveRun(identity);
			yield* completeRun(message);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.execute(sql`
					insert into cluster_messages (id, message_id, shard_id, entity_type, entity_id, kind, tag, payload, request_id)
					values (1, 'pending-deferred', 'default:1', 'Workflow/PendingWorkflow', 'pending-deferred', 0, 'deferred', '{}', 1)
				`),
			);
			yield* TestClock.adjust("8 days");
			const collector = yield* WorkflowGarbageCollector;
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
			expect(yield* counts()).toEqual([{ replies: 1, messages: 2 }]);
			yield* session.run((db) =>
				db.execute(sql`update cluster_messages set processed = true where id = 1`),
			);
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 1 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("keeps tombstones through a partial cleanup and retries the failed address", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-02-01T00:00:00Z"));
			const identity = { executionId: "cleanup-retry", workflowName: "RetryWorkflow" };
			const message = yield* saveRun(identity);
			yield* saveClock(identity);
			yield* completeRun(message);
			yield* TestClock.adjust("24 hours");
			const storage = yield* MessageStorage.MessageStorage;
			const failClock = yield* Ref.make(true);
			const collector = yield* WorkflowGarbageCollector.make.pipe(
				Effect.provideService(
					WorkflowGarbageCollectionRepository,
					yield* WorkflowGarbageCollectionRepository.make,
				),
				Effect.provideService(MessageStorage.MessageStorage, {
					...storage,
					clearAddress: (address) =>
						Effect.gen(function* () {
							if (address.entityType === workflowClockEntityType && (yield* Ref.get(failClock))) {
								yield* Ref.set(failClock, false);
								return yield* Effect.die("clock cleanup unavailable");
							}
							return yield* storage.clearAddress(address);
						}),
				}),
			);
			assert(Exit.isFailure(yield* Effect.exit(collector.runBatch())));
			expect(yield* counts()).toEqual([{ replies: 1, messages: 1 }]);
			assert(Exit.isFailure(yield* Effect.exit(storage.saveRequest(yield* request(identity)))));
			expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 1 });
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("serializes child admission with tree expiry", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-03-01T00:00:00Z"));
			const root = { executionId: "race-root", workflowName: "RaceRootWorkflow" };
			const child = { executionId: "race-child", workflowName: "RaceChildWorkflow" };
			yield* completeRun(yield* saveRun(root));
			yield* TestClock.adjust("24 hours");
			const collector = yield* WorkflowGarbageCollector;
			const [collection, admission] = yield* Effect.all(
				[collector.runBatch(), Effect.exit(saveRun(child, root))],
				{ concurrency: 2 },
			);
			if (Exit.isSuccess(admission)) {
				expect(collection.expiredTrees).toBe(0);
				yield* completeRun(admission.value);
				yield* TestClock.adjust("24 hours");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			} else {
				expect(collection.expiredTrees).toBe(1);
				expect(Cause.findDefect(admission.cause)).toEqual(
					Result.succeed(new WorkflowExecutionExpired(child)),
				);
			}
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("rejects new descendants and deferred messages for an expired tree", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-04-01T00:00:00Z"));
			const identity = { executionId: "expired-parent", workflowName: "ExpiredParentWorkflow" };
			const parentMessage = yield* saveRun(identity);
			yield* completeRun(parentMessage);
			yield* TestClock.adjust("24 hours");
			yield* (yield* WorkflowGarbageCollector).runBatch();
			const child = { workflowName: "ChildWorkflow", executionId: "expired-new-child" };
			const admission = yield* Effect.exit(saveRun(child, identity));
			assert(Exit.isFailure(admission));
			expect(Cause.findDefect(admission.cause)).toEqual(
				Result.succeed(new WorkflowExecutionExpired(child)),
			);
			assert(Exit.isFailure(yield* Effect.exit(saveClock(identity))));
			const deferred = new Message.OutgoingRequest<typeof deferredRpc>({
				rpc: deferredRpc,
				context: Context.empty(),
				respond: () => Effect.void,
				annotations: Context.empty(),
				lastReceivedReply: Option.none(),
				envelope: Envelope.makeRequest<typeof deferredRpc>({
					tag: "deferred",
					headers: Headers.empty,
					address: parentMessage.envelope.address,
					requestId: (yield* Snowflake.Generator).nextUnsafe(),
					payload: deferredRpc.payloadSchema.make({ name: "late-completion" }),
				}),
			});
			const completion = yield* Effect.exit(
				(yield* MessageStorage.MessageStorage).saveRequest(deferred),
			);
			assert(Exit.isFailure(completion));
			expect(Cause.findDefect(completion.cause)).toEqual(
				Result.succeed(new WorkflowExecutionExpired(identity)),
			);
			const session = yield* DatabaseSession;
			expect(
				yield* session.run((db) =>
					db
						.select()
						.from(workflowExecution)
						.where(
							and(
								eq(workflowExecution.workflowName, child.workflowName),
								eq(workflowExecution.executionId, child.executionId),
							),
						),
				),
			).toEqual([]);
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("rolls back lifecycle admission when mailbox persistence fails", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-05-01T00:00:00Z"));
			const original = yield* saveRun({
				executionId: "existing-id",
				workflowName: "OriginalWorkflow",
			});
			const identity = { workflowName: "NewWorkflow", executionId: "conflicting-id" };
			const conflicting = yield* request(identity, undefined, original.envelope.requestId);
			const storage = yield* MessageStorage.MessageStorage;
			const result = yield* Effect.exit(storage.saveRequest(conflicting));
			assert(Exit.isFailure(result));
			const session = yield* DatabaseSession;
			expect(
				yield* session.run((db) =>
					db
						.select()
						.from(workflowExecution)
						.where(
							and(
								eq(workflowExecution.workflowName, identity.workflowName),
								eq(workflowExecution.executionId, identity.executionId),
							),
						),
				),
			).toEqual([]);
			yield* completeRun(original);
			yield* TestClock.adjust("24 hours");
			expect(yield* (yield* WorkflowGarbageCollector).runBatch()).toEqual({
				expiredTrees: 1,
				clearedExecutions: 1,
			});
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("rejects reuse of a child execution by another workflow tree", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2027-06-01T00:00:00Z"));
			const first = { executionId: "first-root", workflowName: "RootWorkflow" };
			const second = { executionId: "second-root", workflowName: "RootWorkflow" };
			const child = { executionId: "shared-child", workflowName: "ChildWorkflow" };
			const firstMessage = yield* saveRun(first);
			yield* completeRun(yield* saveRun(child, first));
			yield* completeRun(firstMessage);
			const secondMessage = yield* saveRun(second);
			assert(Exit.isFailure(yield* Effect.exit(saveRun(child, second))));
			const session = yield* DatabaseSession;
			const [owner] = yield* session.run((db) =>
				db
					.select()
					.from(workflowExecution)
					.where(
						and(
							eq(workflowExecution.workflowName, child.workflowName),
							eq(workflowExecution.executionId, child.executionId),
						),
					),
			);
			expect(owner?.rootExecutionId).toBe(first.executionId);
			yield* completeRun(secondMessage, Exit.fail("invalid child identity"));
			yield* TestClock.adjust("7 days");
			expect(yield* (yield* WorkflowGarbageCollector).runBatch()).toEqual({
				expiredTrees: 2,
				clearedExecutions: 3,
			});
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("rejects a run request whose parent execution is missing", () =>
		Effect.gen(function* () {
			const missing = { workflowName: "RootWorkflow", executionId: "missing-parent" };
			const root = { executionId: "orphan-root", workflowName: "RootWorkflow" };
			const storage = yield* MessageStorage.MessageStorage;
			assert(Exit.isFailure(yield* Effect.exit(saveRun(root, missing))));
			const rootMessage = yield* saveRun(root);
			assert(
				Exit.isFailure(yield* Effect.exit(storage.saveRequest(yield* request(root, missing)))),
			);
			yield* completeRun(rootMessage);
			yield* TestClock.adjust("24 hours");
			expect(yield* (yield* WorkflowGarbageCollector).runBatch()).toEqual({
				expiredTrees: 1,
				clearedExecutions: 1,
			});
			expect(yield* counts()).toEqual([{ replies: 0, messages: 0 }]);
		}),
	);

	test.effect("records replies for entities outside workflow bookkeeping", () =>
		Effect.gen(function* () {
			const generator = yield* Snowflake.Generator;
			const storage = yield* MessageStorage.MessageStorage;
			const address = EntityAddress.make({
				entityId: EntityId.make("plain"),
				shardId: ShardId.make("default", 1),
				entityType: EntityType.make("PlainEntity"),
			});
			const message = new Message.OutgoingRequest({
				rpc: deferredRpc,
				context: Context.empty(),
				respond: () => Effect.void,
				annotations: Context.empty(),
				lastReceivedReply: Option.none(),
				envelope: Envelope.makeRequest<typeof deferredRpc>({
					address,
					tag: "deferred",
					headers: Headers.empty,
					requestId: generator.nextUnsafe(),
					payload: deferredRpc.payloadSchema.make({ name: "plain" }),
				}),
			});
			yield* storage.saveRequest(message);
			yield* storage.saveReply(
				new Reply.ReplyWithContext({
					rpc: deferredRpc,
					context: Context.empty(),
					reply: new Reply.WithExit<typeof deferredRpc>({
						exit: Exit.void,
						id: generator.nextUnsafe(),
						requestId: message.envelope.requestId,
					}),
				}),
			);
			expect(yield* counts()).toEqual([{ replies: 1, messages: 1 }]);
			yield* storage.clearAddress(address);
		}),
	);
});
