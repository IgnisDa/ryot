import {
	LIVE_UPDATES_CONNECTED_EVENT,
	type LiveUpdateFrame,
} from "@ryot-app/contract/modules/live-updates/messages";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	Clock,
	Context,
	Duration,
	Effect,
	FiberSet,
	Layer,
	Option,
	Queue,
	Schema,
	Stream,
} from "effect";

import { Broadcast } from "#platform/broadcast";

import {
	DerivedDataUpdatedMessage,
	derivedDataUpdatedTopic,
	EntityUpdatedMessage,
	entityUpdatedTopic,
	ImpersonationEndedMessage,
	impersonationEndedTopic,
} from "./publish";

const DERIVED_DATA_FRAME_INTERVAL = Duration.seconds(3);
const HEARTBEAT_INTERVAL = "25 seconds";

const encoder = new TextEncoder();
const connected = encoder.encode(`event: ${LIVE_UPDATES_CONNECTED_EVENT}\ndata:\n\n`);
const heartbeat = encoder.encode(": ping\n\n");
const frameBytes = (frame: LiveUpdateFrame) =>
	encoder.encode(`data: ${stableStringify(frame)}\n\n`);

type LiveStream = {
	/** The time of this stream's last derived-data frame, and whether another is already due. */
	derivedAt: number;
	readonly userId: UserId;
	derivedPending: boolean;
	readonly sessionId: string | undefined;
	readonly queue: Queue.Queue<Uint8Array>;
};

export class LiveUpdates extends Context.Service<LiveUpdates>()(
	"@ryot-app/kernel-backend/modules/live-updates/hub/LiveUpdates",
	{
		make: Effect.gen(function* () {
			const broadcast = yield* Broadcast;
			const run = yield* FiberSet.makeRuntime();
			const streams = new Map<UserId, Set<LiveStream>>();
			const offer = (target: LiveStream, bytes: Uint8Array) =>
				Queue.offerUnsafe(target.queue, bytes);

			const sendDerivedData = Effect.fnUntraced(function* (target: LiveStream) {
				if (target.derivedPending) {
					return;
				}
				const wait =
					target.derivedAt +
					Duration.toMillis(DERIVED_DATA_FRAME_INTERVAL) -
					(yield* Clock.currentTimeMillis);
				if (wait > 0) {
					target.derivedPending = true;
					yield* Effect.sleep(Duration.millis(wait));
					target.derivedPending = false;
				}
				target.derivedAt = yield* Clock.currentTimeMillis;
				offer(target, frameBytes({ type: "derived-data-updated" }));
			});

			yield* broadcast.subscribe(entityUpdatedTopic, (message) => {
				const decoded = Schema.decodeOption(EntityUpdatedMessage)(message);
				if (Option.isNone(decoded)) {
					return;
				}
				const { reason, userIds, entityId } = decoded.value;
				const bytes = frameBytes({ reason, entityId, type: "entity-updated" });
				for (const userId of userIds) {
					for (const target of streams.get(userId) ?? []) {
						offer(target, bytes);
					}
				}
			});
			yield* broadcast.subscribe(derivedDataUpdatedTopic, (message) => {
				const decoded = Schema.decodeOption(DerivedDataUpdatedMessage)(message);
				if (Option.isSome(decoded)) {
					for (const target of streams.get(decoded.value.userId) ?? []) {
						run(sendDerivedData(target));
					}
				}
			});
			yield* broadcast.subscribe(impersonationEndedTopic, (message) => {
				const decoded = Schema.decodeOption(ImpersonationEndedMessage)(message);
				if (Option.isNone(decoded)) {
					return;
				}
				for (const targets of streams.values()) {
					for (const target of targets) {
						if (target.sessionId === decoded.value.sessionId) {
							run(Queue.shutdown(target.queue));
						}
					}
				}
			});

			const stream = (input: { readonly userId: UserId; readonly sessionId?: string }) =>
				Stream.unwrap(
					Effect.acquireRelease(
						Effect.gen(function* () {
							const queue = yield* Queue.unbounded<Uint8Array>();
							const target: LiveStream = {
								queue,
								derivedAt: 0,
								userId: input.userId,
								derivedPending: false,
								sessionId: input.sessionId,
							};
							const targets = streams.get(input.userId) ?? new Set();
							targets.add(target);
							streams.set(input.userId, targets);
							offer(target, connected);
							return target;
						}),
						(target) =>
							Effect.suspend(() => {
								const targets = streams.get(target.userId);
								targets?.delete(target);
								if (targets?.size === 0) {
									streams.delete(target.userId);
								}
								return Queue.shutdown(target.queue);
							}),
					).pipe(
						Effect.map((target) =>
							Stream.fromQueue(target.queue).pipe(
								Stream.merge(
									Stream.fromEffect(
										Effect.sleep(HEARTBEAT_INTERVAL).pipe(Effect.as(heartbeat)),
									).pipe(Stream.forever),
									{ haltStrategy: "left" },
								),
							),
						),
					),
				).pipe(Stream.scoped);

			return { stream };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
