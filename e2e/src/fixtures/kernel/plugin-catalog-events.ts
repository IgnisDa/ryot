import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import { Effect, Fiber, Stream } from "effect";

import type { ContractSession } from "./contract-client";

const DEFAULT_TIMEOUT_MS = 10_000;

type CatalogEvent = typeof PLUGIN_CATALOG_CONNECTED_EVENT | typeof PLUGIN_CATALOG_INVALIDATED_EVENT;
type EventWaiter = {
	event: CatalogEvent;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
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
					clearTimeout(waiter.timer);
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
				clearTimeout(waiter.timer);
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
				Effect.promise(
					() =>
						new Promise<CatalogEvent>((resolve, reject) => {
							if (failure) {
								reject(failure);
								return;
							}
							const index = queued.indexOf(event);
							if (index >= 0) {
								queued.splice(index, 1);
								resolve(event);
								return;
							}
							const waiter: EventWaiter = {
								event,
								reject,
								resolve,
								timer: setTimeout(
									() => {
										waiters.delete(waiter);
										reject(new Error(`Timed out waiting for plugin catalog '${event}' event`));
									},
									waitOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
								),
							};
							waiters.add(waiter);
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
					clearTimeout(waiter.timer);
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
					Effect.promise(
						() =>
							new Promise<void>((resolve, reject) => {
								if (failure) {
									reject(failure);
									return;
								}
								if (queued.includes(PLUGIN_CATALOG_INVALIDATED_EVENT)) {
									reject(new Error("Unexpected queued plugin catalog invalidation"));
									return;
								}
								const waiter: EventWaiter = {
									reject,
									event: PLUGIN_CATALOG_INVALIDATED_EVENT,
									resolve: () => reject(new Error("Unexpected plugin catalog invalidation")),
									timer: setTimeout(() => {
										waiters.delete(waiter);
										resolve();
									}, assertOptions.windowMs ?? 500),
								};
								waiters.add(waiter);
							}),
					),
			} satisfies PluginCatalogEventStream;
		}),
		(stream) => stream.close(),
	);
