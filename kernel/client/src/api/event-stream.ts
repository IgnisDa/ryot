import { Effect, Match, Schema } from "effect";

export type EventStreamFactory = (
	url: string,
	request: EventStreamRequest,
) => Promise<EventStreamResponse>;

type EventStreamListener = (type: string, data: string) => void;

type EventStreamRequest = {
	readonly signal: AbortSignal;
	readonly headers: Record<string, string>;
};

type EventStreamResponse = {
	readonly ok: boolean;
	readonly status: number;
	readonly body: null | ReadableStream<Uint8Array>;
};

export const fetchEventStream: EventStreamFactory = (url, request) =>
	fetch(url, { ...request, cache: "no-store", credentials: "omit" });

export class EventStreamClosed extends Schema.TaggedError<
	EventStreamClosed,
	{ readonly brand: unique symbol }
>()("EventStreamClosed", { cause: Schema.Unknown }) {}

const LINE_BREAK = /\r\n|\r|\n/;

const readEventStream = (body: ReadableStream<Uint8Array>, onEvent: EventStreamListener) =>
	Effect.acquireUseRelease(
		Effect.sync(() => body.getReader()),
		(reader) =>
			Effect.gen(function* () {
				const decoder = new TextDecoder();
				let buffer = "";
				let data = "";
				let eventType = "";

				const dispatch = () => {
					if (data !== "") {
						onEvent(eventType === "" ? "message" : eventType, data.slice(0, -1));
					}
					data = "";
					eventType = "";
				};

				const consumeLine = (line: string) => {
					if (line === "") {
						dispatch();
						return;
					}
					if (line.startsWith(":")) {
						return;
					}
					const separator = line.indexOf(":");
					const field = separator === -1 ? line : line.slice(0, separator);
					const raw = separator === -1 ? "" : line.slice(separator + 1);
					const value = raw.startsWith(" ") ? raw.slice(1) : raw;
					Match.value(field).pipe(
						Match.when("event", () => {
							eventType = value;
						}),
						Match.when("data", () => {
							data += `${value}\n`;
						}),
						Match.orElse(() => undefined),
					);
				};

				for (;;) {
					const chunk = yield* Effect.tryPromise({
						try: () => reader.read(),
						catch: (cause) => new EventStreamClosed({ cause }),
					});
					if (chunk.done) {
						break;
					}
					buffer += decoder.decode(chunk.value, { stream: true });
					let match = LINE_BREAK.exec(buffer);
					while (match !== null && !(match[0] === "\r" && match.index === buffer.length - 1)) {
						consumeLine(buffer.slice(0, match.index));
						buffer = buffer.slice(match.index + match[0].length);
						match = LINE_BREAK.exec(buffer);
					}
				}
			}),
		(reader) => Effect.ignoreCause(Effect.promise(() => reader.cancel())),
	);

/** Reads one connection to its end. Succeeds with `true` when the token was refused, so the caller can refresh it. */
export const openEventStream = (
	open: EventStreamFactory,
	url: string,
	token: string,
	onEvent: EventStreamListener,
) =>
	// The stream signal must outlive fetch's response Promise until its reader is closed.
	Effect.acquireUseRelease(
		Effect.sync(() => new AbortController()),
		(controller) =>
			Effect.gen(function* () {
				const response = yield* Effect.tryPromise({
					catch: (cause) => new EventStreamClosed({ cause }),
					try: () =>
						open(url, {
							signal: controller.signal,
							headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
						}),
				});
				if (response.status === 401) {
					return true;
				}
				if (!response.ok || response.body === null) {
					return yield* new EventStreamClosed({ cause: "event stream was rejected" });
				}
				yield* readEventStream(response.body, onEvent);
				return false;
			}),
		(controller) => Effect.sync(() => controller.abort()),
	);
