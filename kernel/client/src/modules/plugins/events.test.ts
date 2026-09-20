import { describe, expect, it } from "@effect/vitest";
import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import { Effect, Fiber, Layer, ManagedRuntime, Schedule } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { makePluginCatalogEventsLayer, PluginCatalogEventsService } from "#/modules/plugins/events";

const serverOrigin = decodeServerOrigin("https://ryot.example");
const scope: ApiScope = { userId: "user-1", serverUrl: serverOrigin };

const encoder = new TextEncoder();
const frame = (type: string) => `event: ${type}\ndata:\n\n`;

class TestStream {
	closed = false;
	aborted = false;
	readonly body: ReadableStream<Uint8Array>;
	private controller: ReadableStreamDefaultController<Uint8Array> | undefined;

	constructor(signal: AbortSignal) {
		this.body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.controller = controller;
			},
		});
		signal.addEventListener("abort", () => {
			this.aborted = true;
			if (!this.closed) {
				this.closed = true;
				this.controller?.error(new Error("aborted"));
			}
		});
	}

	send(text: string) {
		this.controller?.enqueue(encoder.encode(text));
	}

	end() {
		this.closed = true;
		this.controller?.close();
	}
}

const makeRuntime = (
	options: {
		readonly token?: string;
		readonly refreshedToken?: string;
		readonly rejectAttempts?: number;
		readonly responseStatuses?: readonly number[];
	} = {},
) => {
	const streams: TestStream[] = [];
	const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> = [];
	let token = options.token ?? null;
	const tokenRequests: boolean[] = [];
	const tokens = Layer.succeed(OAuthTokenService, {
		clear: () => Effect.void,
		logout: () => Effect.succeed(null),
		userInfo: () => Effect.succeed(null),
		rejectAuthorization: () => Effect.die("not used"),
		completeAuthorization: () => Effect.die("not used"),
		accessToken: (_origin, forceRefresh = false) =>
			Effect.sync(() => {
				tokenRequests.push(forceRefresh);
				return forceRefresh ? (options.refreshedToken ?? token) : token;
			}),
	});
	const events = makePluginCatalogEventsLayer((url, request) => {
		requests.push({ url, headers: request.headers });
		const status =
			options.responseStatuses?.[requests.length - 1] ??
			(requests.length <= (options.rejectAttempts ?? 0) ? 503 : 200);
		if (status < 200 || status >= 300) {
			return Promise.resolve({ status, ok: false, body: null });
		}
		const stream = new TestStream(request.signal);
		streams.push(stream);
		return Promise.resolve({ status, ok: true, body: stream.body });
	}, Schedule.spaced("1 millis"));
	return {
		streams,
		requests,
		tokenRequests,
		setToken: (value: string) => {
			token = value;
		},
		runtime: ManagedRuntime.make(events.pipe(Layer.provide(tokens))),
	};
};

const waitUntil = (predicate: () => boolean, message: string) =>
	Effect.runPromise(
		Effect.suspend(() => (predicate() ? Effect.void : Effect.fail(message))).pipe(
			Effect.retry({ times: 500, schedule: Schedule.spaced("2 millis") }),
			Effect.orDie,
		),
	);

describe("plugin catalog events service", () => {
	it.live("does not refresh on connection and refreshes only on invalidation", () => {
		const { runtime, streams, requests } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() => waitUntil(() => streams.length === 1, "stream was never opened"));
			expect(requests[0]?.url).toBe(`${serverOrigin}/api/plugins/events`);
			expect(requests[0]?.headers.authorization).toBe("Bearer token-1");
			expect(requests[0]?.headers.accept).toBe("text/event-stream");

			streams[0]?.send(": ping\n\n");
			streams[0]?.send(frame(PLUGIN_CATALOG_CONNECTED_EVENT));
			yield* Effect.promise(() =>
				waitUntil(() => streams[0]?.body.locked ?? false, "stream was not consumed"),
			);
			expect(refreshes).toBe(0);
			streams[0]?.send(`${frame("unrelated")}${frame(PLUGIN_CATALOG_INVALIDATED_EVENT)}`);
			yield* Effect.promise(() =>
				waitUntil(() => refreshes === 1, "catalog invalidation was never routed"),
			);
			expect(refreshes).toBe(1);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("routes events split across chunk boundaries", () => {
		const { runtime, streams } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() => waitUntil(() => streams.length === 1, "stream was never opened"));
			streams[0]?.send(`event: ${PLUGIN_CATALOG_INVALIDATED_EVENT}`);
			streams[0]?.send("\nid: 7\nretry: 5000\ndata:");
			expect(refreshes).toBe(0);
			streams[0]?.send("\n\n");
			yield* Effect.promise(() =>
				waitUntil(() => refreshes === 1, "chunked catalog event was never routed"),
			);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("reconnects with a fresh token when the stream ends", () => {
		const { runtime, streams, requests, setToken } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() => waitUntil(() => streams.length === 1, "stream was never opened"));
			setToken("token-2");
			streams[0]?.end();

			yield* Effect.promise(() =>
				waitUntil(() => streams.length === 2, "stream was never reopened"),
			);
			expect(requests[1]?.headers.authorization).toBe("Bearer token-2");
			streams[1]?.send(frame(PLUGIN_CATALOG_INVALIDATED_EVENT));
			yield* Effect.promise(() =>
				waitUntil(() => refreshes === 1, "reconnected stream never routed events"),
			);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("reconnects when the server rejects the stream", () => {
		const { runtime, streams, requests } = makeRuntime({ token: "token-1", rejectAttempts: 2 });
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				waitUntil(() => streams.length === 1, "rejected stream was never retried"),
			);
			expect(requests).toHaveLength(3);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("aborts the stream on interruption and stops reconnecting", () =>
		Effect.gen(function* () {
			const { runtime, streams, requests } = makeRuntime({ token: "token-1" });
			const subscription = runtime.runFork(
				Effect.flatMap(PluginCatalogEventsService, (service) =>
					service.subscribe(scope, () => undefined),
				),
			);

			yield* Effect.promise(() => waitUntil(() => streams.length === 1, "stream was never opened"));
			yield* Fiber.interrupt(subscription);
			expect(streams[0]?.aborted).toBe(true);

			yield* Effect.sleep("50 millis");
			expect(requests).toHaveLength(1);
			yield* Effect.promise(() => runtime.dispose());
		}),
	);

	it.live("does not open a stream when no token is stored", () => {
		const { runtime, requests, tokenRequests } = makeRuntime();
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				waitUntil(() => tokenRequests.length === 1, "token was never requested"),
			);
			expect(requests).toHaveLength(0);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("force-refreshes once and retries once after an unauthorized response", () => {
		const { runtime, streams, requests, tokenRequests } = makeRuntime({
			token: "token-1",
			refreshedToken: "token-2",
			responseStatuses: [401, 200],
		});
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				waitUntil(() => streams.length === 1, "refreshed stream was never opened"),
			);
			expect(requests).toHaveLength(2);
			expect(requests[0]?.headers.authorization).toBe("Bearer token-1");
			expect(requests[1]?.headers.authorization).toBe("Bearer token-2");
			expect(tokenRequests).toEqual([false, true]);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});

	it.live("stops after a second unauthorized response", () => {
		const { runtime, requests, tokenRequests } = makeRuntime({
			token: "token-1",
			refreshedToken: "token-2",
			responseStatuses: [401, 401],
		});
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				waitUntil(() => requests.length === 2, "unauthorized stream was never retried"),
			);
			yield* Effect.sleep("20 millis");
			expect(requests).toHaveLength(2);
			expect(tokenRequests).toEqual([false, true]);
		}).pipe(
			Effect.ensuring(
				Fiber.interrupt(subscription).pipe(Effect.andThen(Effect.promise(() => runtime.dispose()))),
			),
		);
	});
});
