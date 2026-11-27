import type { Duration } from "effect";
import { Cause, Context, Deferred, Effect, FiberSet, Layer, Option, Schema } from "effect";

import { Broadcast } from "../broadcast";
import type { WorkflowIdentity } from "./identity";

const notificationTopic = "workflow-execution";
const NotificationMessage = Schema.fromJsonString(
	Schema.Struct({ executionId: Schema.String, workflowName: Schema.String }),
);
const encodeNotification = Schema.encodeEffect(NotificationMessage);
const decodeNotification = Schema.decodeOption(NotificationMessage);

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
	"@ryot-app/kernel-backend/platform/workflow/execution-notifications/WorkflowExecutionNotifications",
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
			const broadcast = yield* Broadcast;
			const hub = makeHub();
			const runFork = yield* FiberSet.makeRuntime();
			yield* broadcast.subscribe(notificationTopic, (message) => {
				const decoded = decodeNotification(message);
				if (Option.isSome(decoded)) {
					runFork(
						hub
							.publish(decoded.value)
							.pipe(logFailure("workflow execution notification dispatch failed")),
					);
				}
			});
			yield* broadcast.onReconnect(() => {
				runFork(hub.wakeAll);
			});
			return {
				listen: hub.listen,
				publish: (identity: WorkflowIdentity) =>
					hub.publish(identity).pipe(
						Effect.andThen(
							Effect.sync(() =>
								runFork(
									encodeNotification(identity).pipe(
										Effect.flatMap((message) => broadcast.publish(notificationTopic, message)),
										logFailure("workflow execution notification publish failed"),
									),
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
