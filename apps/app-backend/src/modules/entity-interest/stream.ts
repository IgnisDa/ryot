import {
	encodeConnectedFrame,
	encodeEntityUpdatedFrame,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";
import type { UserId } from "@ryot/contract/schema/brands";
import { Effect, Queue, Schedule, Stream } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import type { StreamEnqueue, StreamRegistry } from "./registry";

const HEARTBEAT_INTERVAL_MS = 5_000;

const encoder = new TextEncoder();

const SSE_HEADERS = { "cache-control": "no-cache", connection: "keep-alive" };

const PING = encoder.encode(": ping\n\n");

const heartbeats = Stream.fromSchedule(Schedule.spaced(HEARTBEAT_INTERVAL_MS)).pipe(
	Stream.map(() => PING),
);

export const events = (streamId: string, userId: UserId, registry: typeof StreamRegistry.Service) =>
	Stream.callback<Uint8Array>((queue) =>
		Effect.acquireRelease(
			Effect.suspend(() => {
				const enqueue: StreamEnqueue = (frame: EntityUpdatedFrame) =>
					Queue.offerUnsafe(
						queue,
						encoder.encode(`event: entity:updated\ndata: ${encodeEntityUpdatedFrame(frame)}\n\n`),
					);
				registry.add(streamId, userId, enqueue);
				Queue.offerUnsafe(
					queue,
					encoder.encode(`event: connected\ndata: ${encodeConnectedFrame({ streamId })}\n\n`),
				);
				return Effect.void;
			}),
			() => Effect.suspend(() => (registry.remove(streamId), Effect.void)),
		),
	);

export const buildInterestStreamResponse = (
	streamId: string,
	userId: UserId,
	registry: typeof StreamRegistry.Service,
) =>
	HttpServerResponse.stream(Stream.merge(events(streamId, userId, registry), heartbeats), {
		headers: SSE_HEADERS,
		contentType: "text/event-stream",
	});
