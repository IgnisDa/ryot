import { HttpServerResponse } from "@effect/platform";
import { Effect, Schedule, Stream } from "effect";

import type { UserId } from "#lib/schema/brands";

import {
	encodeConnectedFrame,
	encodeEntityUpdatedFrame,
	type EntityUpdatedFrame,
} from "./messages";
import type { StreamEnqueue, StreamRegistry } from "./registry";

const HEARTBEAT_INTERVAL_MS = 25_000;

const encoder = new TextEncoder();

const SSE_HEADERS = { "cache-control": "no-cache", connection: "keep-alive" };

const PING = encoder.encode(": ping\n\n");

// Keeps idle proxies from timing out the connection. A separate stream (rather than a side-effecting
// interval inside the push stream below) so it stops for free when Stream.merge tears everything down
// together on client disconnect.
const heartbeats = Stream.fromSchedule(Schedule.spaced(HEARTBEAT_INTERVAL_MS)).pipe(
	Stream.as(PING),
);

// Push-based: registry.add hands the fan-out an `enqueue` closure that feeds frames into this
// stream. Registration and its teardown (registry.remove) run when the stream's scope closes, which
// Stream.asyncPush ties to the client disconnecting.
const events = (streamId: string, userId: UserId, registry: typeof StreamRegistry.Service) =>
	Stream.asyncPush<Uint8Array>((emit) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const enqueue: StreamEnqueue = (frame: EntityUpdatedFrame) =>
					emit.single(
						encoder.encode(`event: entity:updated\ndata: ${encodeEntityUpdatedFrame(frame)}\n\n`),
					);
				registry.add(streamId, userId, enqueue);
				emit.single(
					encoder.encode(`event: connected\ndata: ${encodeConnectedFrame({ streamId })}\n\n`),
				);
			}),
			() => Effect.sync(() => registry.remove(streamId)),
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
