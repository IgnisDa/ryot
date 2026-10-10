import { Cause, Context, Deferred, Effect, FiberSet, Layer } from "effect";

import {
	decodeWorkflowExecutionNotificationMessage,
	encodeWorkflowExecutionNotificationMessage,
	redisKeys,
	RedisService,
} from "./redis";
import type { WorkflowIdentity } from "./workflow-identity";

const identityKey = (identity: WorkflowIdentity) =>
	JSON.stringify([identity.workflowName, identity.executionId]);

class WorkflowExecutionNotificationHub extends Context.Service<WorkflowExecutionNotificationHub>()(
	"WorkflowExecutionNotificationHub",
	{
		make: Effect.sync(() => {
			const waiters = new Map<string, Set<Deferred.Deferred<void>>>();
			const listen = (identity: WorkflowIdentity) =>
				Effect.acquireRelease(
					Effect.gen(function* () {
						const waiter = yield* Deferred.make<void>();
						const key = identityKey(identity);
						const identityWaiters = waiters.get(key) ?? new Set();
						identityWaiters.add(waiter);
						waiters.set(key, identityWaiters);
						return waiter;
					}),
					(waiter) =>
						Effect.sync(() => {
							const key = identityKey(identity);
							const identityWaiters = waiters.get(key);
							identityWaiters?.delete(waiter);
							if (identityWaiters?.size === 0) {
								waiters.delete(key);
							}
						}),
				).pipe(Effect.map(Deferred.await));
			const publish = (identity: WorkflowIdentity) =>
				Effect.suspend(() =>
					Effect.forEach(
						waiters.get(identityKey(identity)) ?? [],
						(waiter) => Deferred.succeed(waiter, undefined),
						{ discard: true },
					),
				);
			const wakeAll = Effect.suspend(() =>
				Effect.forEach(
					waiters.values(),
					(identityWaiters) =>
						Effect.forEach(identityWaiters, (waiter) => Deferred.succeed(waiter, undefined), {
							discard: true,
						}),
					{ discard: true },
				),
			);

			return { listen, publish, wakeAll };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const logSubscriptionFailure = Effect.catchCauseIf(
	(cause) => !Cause.hasInterruptsOnly(cause),
	(cause) => Effect.logError("workflow execution notification subscription failed", cause),
);
const logPublishFailure = Effect.catchCause((cause) =>
	Effect.logError("workflow execution notification publish failed", cause),
);

export class WorkflowExecutionNotifications extends Context.Service<WorkflowExecutionNotifications>()(
	"WorkflowExecutionNotifications",
	{
		make: Effect.map(WorkflowExecutionNotificationHub, (hub) => ({
			listen: hub.listen,
			publish: hub.publish,
		})),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(WorkflowExecutionNotificationHub.layer),
	);

	static readonly liveLayer = Layer.effect(
		this,
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const hub = yield* WorkflowExecutionNotificationHub;
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					subscriber.removeAllListeners();
					subscriber.disconnect();
				}),
			);

			const dispatch = (incoming: string, message: string) => {
				if (incoming !== redisKeys.workflowExecutionNotificationChannel) {
					return Effect.void;
				}
				const decoded = decodeWorkflowExecutionNotificationMessage(message);
				return decoded._tag === "Some" ? hub.publish(decoded.value) : Effect.void;
			};
			const subscribe = Effect.tryPromise(() =>
				subscriber.subscribe(redisKeys.workflowExecutionNotificationChannel),
			);
			const recover = subscribe.pipe(Effect.andThen(hub.wakeAll), logSubscriptionFailure);
			let initialized = false;
			const logDispatchFailure = Effect.catchCauseIf(
				(cause) => !Cause.hasInterruptsOnly(cause),
				(cause) => Effect.logError("workflow execution notification dispatch failed", cause),
			);

			subscriber.on("message", (incoming, message) =>
				runFork(dispatch(incoming, message).pipe(logDispatchFailure)),
			);
			subscriber.on("error", (error) =>
				runFork(Effect.logError("workflow execution notification subscriber error", error)),
			);
			subscriber.on("ready", () => {
				if (initialized) {
					runFork(recover);
				}
			});
			yield* subscribe;
			initialized = true;

			return {
				listen: hub.listen,
				publish: (identity: WorkflowIdentity) =>
					hub
						.publish(identity)
						.pipe(
							Effect.andThen(
								Effect.sync(() =>
									runFork(
										redis
											.publish(
												redisKeys.workflowExecutionNotificationChannel,
												encodeWorkflowExecutionNotificationMessage(identity),
											)
											.pipe(logPublishFailure),
									),
								),
							),
						),
			};
		}),
	).pipe(Layer.provideMerge(WorkflowExecutionNotificationHub.layer));
}
