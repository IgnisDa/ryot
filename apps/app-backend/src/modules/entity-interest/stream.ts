import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound, type NotFound } from "@ryot/contract/errors";
import {
	encodeConnectedFrame,
	encodeEntityUpdatedFrame,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Duration, Effect, Queue, Schedule, Stream } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { ENTITY_INTEREST_STREAM_RENEWAL_INTERVAL_SECONDS } from "#lib/infrastructure/redis";

import type { LocalStreamConnections, LocalStreamEnqueue } from "./connections";
import type { EntityInterestStore } from "./store";

const HEARTBEAT_INTERVAL_MS = 5_000;
const RENEWAL_INTERVAL = Duration.seconds(ENTITY_INTEREST_STREAM_RENEWAL_INTERVAL_SECONDS);

const encoder = new TextEncoder();

const SSE_HEADERS = { "cache-control": "no-cache", connection: "keep-alive" };

const PING = encoder.encode(": ping\n\n");

const heartbeats = Stream.fromSchedule(Schedule.spaced(HEARTBEAT_INTERVAL_MS)).pipe(
	Stream.map(() => PING),
);

type Connections = Pick<typeof LocalStreamConnections.Service, "add" | "remove">;
type Store = Pick<typeof EntityInterestStore.Service, "closeStream" | "openStream" | "renewStream">;

export const events = (
	streamId: string,
	user: CurrentUserValue,
	connections: Connections,
	store: Store,
) =>
	Stream.callback<Uint8Array, NotFound>((queue) =>
		Effect.acquireRelease(
			Effect.gen(function* () {
				const enqueue: LocalStreamEnqueue = (frame: EntityUpdatedFrame) =>
					Queue.offerUnsafe(
						queue,
						encoder.encode(`event: entity:updated\ndata: ${encodeEntityUpdatedFrame(frame)}\n\n`),
					);
				yield* connections.add(streamId, enqueue);
				yield* store
					.openStream({
						streamId,
						userId: user.id,
						preferredLanguage: user.preferences.language,
					})
					.pipe(
						Effect.catchCause((cause) =>
							connections.remove(streamId, enqueue).pipe(Effect.andThen(Effect.failCause(cause))),
						),
					);
				Queue.offerUnsafe(
					queue,
					encoder.encode(`event: connected\ndata: ${encodeConnectedFrame({ streamId })}\n\n`),
				);
				yield* Effect.sleep(RENEWAL_INTERVAL).pipe(
					Effect.andThen(store.renewStream(streamId)),
					Effect.flatMap((renewed) =>
						renewed
							? Effect.void
							: Queue.fail(queue, notFound("Unknown stream")).pipe(
									Effect.andThen(Effect.interrupt),
								),
					),
					Effect.catchCause((cause) =>
						Cause.hasInterrupts(cause)
							? Effect.failCause(cause)
							: Effect.logWarning("entity interest stream renewal failed", cause).pipe(
									Effect.annotateLogs({ streamId }),
								),
					),
					Effect.forever,
					Effect.forkScoped,
				);
				return enqueue;
			}),
			(enqueue) =>
				connections
					.remove(streamId, enqueue)
					.pipe(
						Effect.andThen(
							store
								.closeStream(streamId)
								.pipe(
									Effect.catchCause((cause) =>
										Effect.logWarning("entity interest stream cleanup failed", cause).pipe(
											Effect.annotateLogs({ streamId }),
										),
									),
								),
						),
					),
		).pipe(Effect.catchCause((cause) => Queue.failCause(queue, cause))),
	);

export const buildInterestStreamResponse = (
	streamId: string,
	user: CurrentUserValue,
	connections: Connections,
	store: Store,
) =>
	HttpServerResponse.stream(Stream.merge(events(streamId, user, connections, store), heartbeats), {
		headers: SSE_HEADERS,
		contentType: "text/event-stream",
	});
