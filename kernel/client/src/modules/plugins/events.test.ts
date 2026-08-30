import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import { Effect, Fiber, Layer, ManagedRuntime, Schedule } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
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
		readonly isNative?: boolean;
		readonly refreshedToken?: string;
		readonly rejectAttempts?: number;
		readonly responseStatuses?: readonly number[];
	} = {},
) => {
	const streams: TestStream[] = [];
	const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> = [];
	let token = options.token ?? null;
	const clientIds: string[] = [];
	const tokenRequests: boolean[] = [];
	const tokens = Layer.succeed(OAuthTokenService, {
		clear: () => Effect.void,
		logout: () => Effect.succeed(null),
		userInfo: () => Effect.succeed(null),
		rejectAuthorization: () => Effect.die("not used"),
		completeAuthorization: () => Effect.die("not used"),
		accessToken: (_origin, clientId, forceRefresh = false) =>
			Effect.sync(() => {
				clientIds.push(clientId);
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
	const runtimeClient = Layer.succeed(
		RuntimeOAuthClientService,
		makeRuntimeOAuthClient({
			isNative: () => options.isNative ?? false,
			getApplicationId: () => Promise.resolve("io.ryot.app"),
		}),
	);

	return {
		streams,
		requests,
		clientIds,
		tokenRequests,
		setToken: (value: string) => {
			token = value;
		},
		runtime: ManagedRuntime.make(events.pipe(Layer.provide(tokens), Layer.provide(runtimeClient))),
	};
};

const waitUntil = (predicate: () => boolean, message: string) =>
	new Promise<void>((resolve, reject) => {
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			if (predicate()) {
				clearInterval(timer);
				resolve();
			} else if (attempts > 500) {
				clearInterval(timer);
				reject(new Error(message));
			}
		}, 2);
	});

describe("plugin catalog events service", () => {
	it("streams the canonical endpoint with a bearer token and routes catalog events", async () => {
		const { runtime, streams, requests } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		try {
			await waitUntil(() => streams.length === 1, "stream was never opened");
			expect(requests[0]?.url).toBe(`${serverOrigin}/api/plugins/events`);
			expect(requests[0]?.headers.authorization).toBe("Bearer token-1");
			expect(requests[0]?.headers.accept).toBe("text/event-stream");

			streams[0]?.send(": ping\n\n");
			streams[0]?.send(frame(PLUGIN_CATALOG_CONNECTED_EVENT));
			streams[0]?.send(`${frame("unrelated")}${frame(PLUGIN_CATALOG_INVALIDATED_EVENT)}`);
			await waitUntil(() => refreshes === 2, "catalog events were never routed");
			expect(refreshes).toBe(2);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("routes events split across chunk boundaries", async () => {
		const { runtime, streams } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		try {
			await waitUntil(() => streams.length === 1, "stream was never opened");
			streams[0]?.send(`event: ${PLUGIN_CATALOG_INVALIDATED_EVENT}`);
			streams[0]?.send("\nid: 7\nretry: 5000\ndata:");
			expect(refreshes).toBe(0);
			streams[0]?.send("\n\n");
			await waitUntil(() => refreshes === 1, "chunked catalog event was never routed");
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("reconnects with a fresh token when the stream ends", async () => {
		const { runtime, streams, requests, setToken } = makeRuntime({ token: "token-1" });
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		try {
			await waitUntil(() => streams.length === 1, "stream was never opened");
			setToken("token-2");
			streams[0]?.end();

			await waitUntil(() => streams.length === 2, "stream was never reopened");
			expect(requests[1]?.headers.authorization).toBe("Bearer token-2");
			streams[1]?.send(frame(PLUGIN_CATALOG_INVALIDATED_EVENT));
			await waitUntil(() => refreshes === 1, "reconnected stream never routed events");
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("reconnects when the server rejects the stream", async () => {
		const { runtime, streams, requests } = makeRuntime({ token: "token-1", rejectAttempts: 2 });
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		try {
			await waitUntil(() => streams.length === 1, "rejected stream was never retried");
			expect(requests).toHaveLength(3);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("aborts the stream on interruption and stops reconnecting", async () => {
		const { runtime, streams, requests } = makeRuntime({ token: "token-1" });
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		await waitUntil(() => streams.length === 1, "stream was never opened");
		await Effect.runPromise(Fiber.interrupt(subscription));
		expect(streams[0]?.aborted).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(requests).toHaveLength(1);
		await runtime.dispose();
	});

	it("does not open a stream when no token is stored", async () => {
		const { runtime, requests, tokenRequests } = makeRuntime();
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		try {
			await waitUntil(() => tokenRequests.length === 1, "token was never requested");
			expect(requests).toHaveLength(0);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("force-refreshes once and retries once after an unauthorized response", async () => {
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

		try {
			await waitUntil(() => streams.length === 1, "refreshed stream was never opened");
			expect(requests).toHaveLength(2);
			expect(requests[0]?.headers.authorization).toBe("Bearer token-1");
			expect(requests[1]?.headers.authorization).toBe("Bearer token-2");
			expect(tokenRequests).toEqual([false, true]);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("stops after a second unauthorized response", async () => {
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

		try {
			await waitUntil(() => requests.length === 2, "unauthorized stream was never retried");
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(requests).toHaveLength(2);
			expect(tokenRequests).toEqual([false, true]);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("uses the native OAuth client for an installed application", async () => {
		const { runtime, streams, clientIds } = makeRuntime({ isNative: true, token: "token-1" });
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		try {
			await waitUntil(() => streams.length === 1, "stream was never opened");
			expect(clientIds).toEqual(["ryot-native"]);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});
});
