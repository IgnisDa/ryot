import { Effect } from "effect";

import type { AuthService } from "#lib/auth";
import type { UserId } from "#lib/schema/brands";

import {
	encodeConnectedFrame,
	encodeEntityUpdatedFrame,
	type EntityUpdatedFrame,
} from "./messages";
import type { StreamEnqueue, StreamRegistry } from "./registry";

export const STREAM_PATH = "/api/stream";

const HEARTBEAT_INTERVAL_MS = 25_000;

const buildStreamResponse = (
	request: Request,
	streamId: string,
	userId: UserId,
	registry: typeof StreamRegistry.Service,
): Response => {
	const encoder = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let cleaned = false;

	const cleanup = () => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		if (heartbeat !== undefined) {
			clearInterval(heartbeat);
		}
		registry.remove(streamId);
	};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue: StreamEnqueue = (frame: EntityUpdatedFrame) => {
				try {
					controller.enqueue(
						encoder.encode(`event: entity:updated\ndata: ${encodeEntityUpdatedFrame(frame)}\n\n`),
					);
				} catch {
					cleanup();
				}
			};
			registry.add(streamId, userId, enqueue);
			controller.enqueue(
				encoder.encode(`event: connected\ndata: ${encodeConnectedFrame({ streamId })}\n\n`),
			);
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					cleanup();
				}
			}, HEARTBEAT_INTERVAL_MS);
			request.signal.addEventListener("abort", () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// enqueue's own failure handler may have already closed/errored this controller.
				}
			});
		},
		cancel() {
			cleanup();
		},
	});

	return new Response(stream, {
		headers: {
			Connection: "keep-alive",
			"Cache-Control": "no-cache",
			"Content-Type": "text/event-stream",
		},
	});
};

// Auth is resolved per-request (not once at a persistent-connection handshake) since there is no
// upgrade step to hook into; this is otherwise an ordinary authenticated request.
export const handleStreamRequest = (
	request: Request,
	streamId: string,
	auth: AuthService,
	registry: typeof StreamRegistry.Service,
) =>
	Effect.gen(function* () {
		const user = yield* auth
			.currentUser(request.headers)
			.pipe(Effect.catchAll(() => Effect.succeed(null)));
		if (!user) {
			return new Response("Unauthorized", { status: 401 });
		}
		return buildStreamResponse(request, streamId, user.id, registry);
	});
