import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import { Duration, Effect, Fiber, Stream } from "effect";

import type { ContractSession } from "./contract-client";

const DEFAULT_TIMEOUT_MS = 10_000;

type CatalogEvent = typeof PLUGIN_CATALOG_CONNECTED_EVENT | typeof PLUGIN_CATALOG_INVALIDATED_EVENT;
type EventWaiter = {
	event: CatalogEvent;
	reject: (error: Error) => void;
	resolve: (event: CatalogEvent) => void;
};
type WaitOptions = { readonly timeoutMs?: number };

export type PluginCatalogEventStream = {
	close: () => Effect.Effect<void>;
	drainQueuedEvents: () => Effect.Effect<readonly CatalogEvent[]>;
	waitForConnected: (options?: WaitOptions) => Effect.Effect<void>;
	waitForCatalogInvalidated: (options?: WaitOptions) => Effect.Effect<void>;
	assertNoInvalidation: (options?: { readonly windowMs?: number }) => Effect.Effect<void>;
};

const parseEventBlock = (block: string): CatalogEvent | null => {
	let event: string | undefined;
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith(":")) {
			continue;
		}
		if (line.startsWith("event:")) {
			event = line.slice(6).trimStart();
		}
	}
	return event === PLUGIN_CATALOG_CONNECTED_EVENT || event === PLUGIN_CATALOG_INVALIDATED_EVENT
		? event
		: null;
};

export const openPluginCatalogEventsScoped = (
	auth: { readonly client: ContractSession },
	options: WaitOptions = {},
) =>
	Effect.acquireRelease(
		Effect.gen(function* () {
			const response = yield* auth.client.call((client) =>
				client.plugins.events({ responseMode: "response-only" }),
			);
			if (response.status !== 200) {
				throw new Error(`Plugin catalog event stream returned HTTP ${response.status}`);
			}
			if (!response.headers["content-type"]?.startsWith("text/event-stream")) {
				throw new Error("Plugin catalog event stream has an invalid content type");
			}
			for (const [header, expected] of [
				["cache-control", "no-cache"],
				["connection", "keep-alive"],
				["x-accel-buffering", "no"],
			] as const) {
				if (response.headers[header] !== expected) {
					throw new Error(`Plugin catalog event stream has an invalid ${header} header`);
				}
			}

			let buffer = "";
			let closed = false;
			let failure: Error | null = null;
			const decoder = new TextDecoder();
			const queued: CatalogEvent[] = [];
			const waiters = new Set<EventWaiter>();

			const fail = (error: Error) => {
				if (closed || failure) {
					return;
				}
				failure = error;
				for (const waiter of waiters) {
					waiter.reject(error);
				}
				waiters.clear();
			};
			const publish = (event: CatalogEvent) => {
				const waiter = [...waiters].find((candidate) => candidate.event === event);
				if (!waiter) {
					queued.push(event);
					return;
				}
				waiters.delete(waiter);
				waiter.resolve(event);
			};
			const consume = (chunk: Uint8Array) => {
				buffer += decoder.decode(chunk, { stream: true });
				for (;;) {
					const boundary = buffer.search(/\r?\n\r?\n/);
					if (boundary < 0) {
						return;
					}
					const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0];
					if (!separator) {
						return;
					}
					const block = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + separator.length);
					const event = parseEventBlock(block);
					if (event) {
						publish(event);
					}
				}
			};
			const waitFor = (event: CatalogEvent, waitOptions: WaitOptions = {}) =>
				Effect.callback<CatalogEvent>((resume) => {
					if (failure) {
						resume(Effect.die(failure));
						return Effect.void;
					}
					const index = queued.indexOf(event);
					if (index >= 0) {
						queued.splice(index, 1);
						resume(Effect.succeed(event));
						return Effect.void;
					}
					const waiter: EventWaiter = {
						event,
						reject: (error) => resume(Effect.die(error)),
						resolve: (value) => resume(Effect.succeed(value)),
					};
					waiters.add(waiter);
					return Effect.sync(() => {
						waiters.delete(waiter);
					});
				}).pipe(
					Effect.timeoutOrElse({
						orElse: () =>
							Effect.die(new Error(`Timed out waiting for plugin catalog '${event}' event`)),
						duration: Duration.millis(
							waitOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
						),
					}),
				);

			const fiber = yield* Stream.runForEach(response.stream, (chunk) =>
				Effect.sync(() => consume(chunk)),
			).pipe(
				Effect.tapCause((cause) => Effect.sync(() => fail(new Error(String(cause))))),
				Effect.ensuring(
					Effect.sync(() => {
						if (!closed) {
							fail(new Error("Plugin catalog event stream ended unexpectedly"));
						}
					}),
				),
				Effect.forkScoped,
			);

			const close = Effect.gen(function* () {
				if (closed) {
					return;
				}
				closed = true;
				for (const waiter of waiters) {
					waiter.reject(new Error("Plugin catalog event stream closed"));
				}
				waiters.clear();
				yield* Fiber.interrupt(fiber);
			});

			return {
				close: () => close,
				waitForConnected: (waitOptions?: WaitOptions) =>
					waitFor(PLUGIN_CATALOG_CONNECTED_EVENT, waitOptions).pipe(Effect.asVoid),
				waitForCatalogInvalidated: (waitOptions?: WaitOptions) =>
					waitFor(PLUGIN_CATALOG_INVALIDATED_EVENT, waitOptions).pipe(Effect.asVoid),
				drainQueuedEvents: () =>
					Effect.sync(() => {
						const events = queued.slice();
						queued.length = 0;
						return events;
					}),
				assertNoInvalidation: (assertOptions = {}) =>
					Effect.callback<void>((resume) => {
						if (failure) {
							resume(Effect.die(failure));
							return Effect.void;
						}
						if (queued.includes(PLUGIN_CATALOG_INVALIDATED_EVENT)) {
							resume(Effect.die(new Error("Unexpected queued plugin catalog invalidation")));
							return Effect.void;
						}
						const waiter: EventWaiter = {
							event: PLUGIN_CATALOG_INVALIDATED_EVENT,
							reject: (error) => resume(Effect.die(error)),
							resolve: () =>
								resume(Effect.die(new Error("Unexpected plugin catalog invalidation"))),
						};
						waiters.add(waiter);
						return Effect.sync(() => {
							waiters.delete(waiter);
						});
					}).pipe(
						Effect.timeoutOrElse({
							orElse: () => Effect.void,
							duration: Duration.millis(assertOptions.windowMs ?? 500),
						}),
					),
			} satisfies PluginCatalogEventStream;
		}),
		(stream) => stream.close(),
	);
