import type { Duration } from "effect";
import { Cause, Context, Deferred, Effect, FiberSet, Layer, Option } from "effect";

import {
	decodeWorkflowExecutionNotificationMessage,
	encodeWorkflowExecutionNotificationMessage,
	redisKeys,
	RedisService,
} from "../redis";
import type { WorkflowIdentity } from "./identity";

const identityKey = (identity: WorkflowIdentity) =>
	JSON.stringify([identity.workflowName, identity.executionId]);

const makeHub = () => {
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
};

const logFailure = (message: string) =>
	Effect.catchCauseIf(
		(cause) => !Cause.hasInterruptsOnly(cause),
		(cause) => Effect.logError(message, cause),
	);

export class WorkflowExecutionNotifications extends Context.Service<WorkflowExecutionNotifications>()(
	"WorkflowExecutionNotifications",
	{
		make: Effect.sync(() => {
			const { listen, publish } = makeHub();
			return { listen, publish };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);

	static readonly liveLayer = Layer.effect(
		this,
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const hub = makeHub();
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					subscriber.removeAllListeners();
					subscriber.disconnect();
				}),
			);

			const dispatch = (message: string) => {
				const decoded = decodeWorkflowExecutionNotificationMessage(message);
				return decoded._tag === "Some" ? hub.publish(decoded.value) : Effect.void;
			};
			const subscribe = Effect.tryPromise(() =>
				subscriber.subscribe(redisKeys.workflowExecutionNotificationChannel),
			);
			const recover = subscribe.pipe(
				Effect.andThen(hub.wakeAll),
				logFailure("workflow execution notification subscription failed"),
			);
			let initialized = false;

			subscriber.on("message", (_channel, message) =>
				runFork(
					dispatch(message).pipe(logFailure("workflow execution notification dispatch failed")),
				),
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
											.pipe(logFailure("workflow execution notification publish failed")),
									),
								),
							),
						),
			};
		}),
	);
}

export const awaitWorkflowSettled = Effect.fn("workflow.awaitSettled")(function* <A, E, R>(input: {
	timeout?: Duration.Input;
	backstop: Duration.Input;
	read: Effect.Effect<A, E, R>;
	isSettled: (value: A) => boolean;
	identities: ReadonlyArray<WorkflowIdentity>;
}) {
	const notifications = yield* WorkflowExecutionNotifications;
	const settle = Effect.gen(function* () {
		for (;;) {
			const settled = yield* Effect.scoped(
				Effect.gen(function* () {
					const hints = yield* Effect.forEach(input.identities, notifications.listen);
					const value = yield* input.read;
					if (input.isSettled(value)) {
						return Option.some(value);
					}
					yield* Effect.raceAll([...hints, Effect.sleep(input.backstop)]);
					return Option.none<A>();
				}),
			);
			if (Option.isSome(settled)) {
				return settled.value;
			}
		}
	});
	if (input.timeout === undefined) {
		return yield* settle;
	}
	const result = yield* settle.pipe(Effect.timeoutOption(input.timeout));
	return Option.isSome(result) ? result.value : yield* input.read;
});
