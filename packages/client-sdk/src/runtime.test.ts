import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type ClientCompositionMetadata,
	type PluginBridgeInit,
} from "@ryot-app/client-plugin-contract";
import { Effect, Fiber, Result, Schema } from "effect";
import { createElement, Fragment } from "react";

import { RyotClientError } from "./index";
import { createPluginNavigationStore } from "./navigation/store";
import { createPluginRuntime } from "./runtime";

const metadata: ClientCompositionMetadata = {
	hash: "composition-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const init: PluginBridgeInit = {
	mode: "light",
	safeAreaTop: 0,
	safeAreaBottom: 0,
	documentKey: "page-1",
	sessionId: "session-id",
	compositionHash: metadata.hash,
	...metadata,
};
const document = { output: {}, queries: {} } as Parameters<
	ReturnType<typeof createPluginRuntime>["client"]["data"]["query"]
>[0]["document"];
const asset = { type: "local", key: "permanent/image.png" } as const;
const resolution = {
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: "https://ryot.test/api/uploads/local/download?key=permanent%2Fimage.png",
};
const channels: MessageChannel[] = [];
// oxlint-disable-next-line effecttsgo/new-promise -- Test waits for a browser MessagePort macrotask.
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const openRuntime = () => {
	const channel = new MessageChannel();
	channels.push(channel);
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	const navigation = createPluginNavigationStore(() => ({
		params: {},
		element: createElement(Fragment),
	}));
	const runtime = createPluginRuntime(
		channel.port2,
		init,
		metadata,
		{ setAttribute: () => {} },
		navigation,
		undefined,
		undefined,
		() => navigation.replaceDocument(() => ({ params: {}, element: createElement(Fragment) })),
	);
	channel.port1.postMessage({
		index: 0,
		key: "k0",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: { path: "/", search: "", kind: "route" },
	});
	return delay().then(() => ({ channel, runtime, messages }));
};
const query = (runtime: ReturnType<typeof createPluginRuntime>) =>
	runtime.client.data.query({ document, decode: Result.succeed });
const sent = (messages: unknown[], type: string) =>
	messages.filter(
		(message) =>
			typeof message === "object" && message !== null && "type" in message && message.type === type,
	);

afterEach(() => {
	for (const channel of channels.splice(0)) {
		channel.port1.close();
		channel.port2.close();
	}
});

describe("plugin Effect request engine", () => {
	it.live("reports embedded metadata and correlates successful and failed queries", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			expect(messages[0]).toEqual({
				format: metadata.format,
				sessionId: init.sessionId,
				compositionHash: metadata.hash,
				apiVersion: metadata.apiVersion,
				bridgeVersion: metadata.bridgeVersion,
				compilerVersion: metadata.compilerVersion,
			});
			const first = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => delay());
			expect(sent(messages, "ryotql-request")).toContainEqual({
				document,
				requestId: "ryotql-1",
				type: "ryotql-request",
			});
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-1",
				response: { data: {} },
			});
			yield* Effect.promise(() => expect(first).resolves.toEqual({ data: {} }));
			yield* Effect.promise(() => delay());
			expect(sent(messages, "ryotql-cancel")).toEqual([]);
			const second = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => delay());
			channel.port1.postMessage({
				outcome: "failure",
				type: "ryotql-result",
				requestId: "ryotql-2",
				reason: "query-failed",
			});
			yield* Effect.promise(() => expect(second).rejects.toMatchObject({ reason: "query-failed" }));
		}),
	);

	it.live("cancels an interrupted query exactly once and ignores its late result", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			const fiber = Effect.runFork(query(runtime));
			yield* Effect.promise(() => delay());
			yield* Fiber.interrupt(fiber);
			yield* Effect.promise(() => delay());
			expect(sent(messages, "ryotql-cancel")).toEqual([
				{ requestId: "ryotql-1", type: "ryotql-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-1",
				response: { data: {} },
			});
			const next = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => delay());
			expect(sent(messages, "ryotql-request")).toContainEqual({
				document,
				requestId: "ryotql-2",
				type: "ryotql-request",
			});
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-2",
				response: { data: {} },
			});
			yield* Effect.promise(() => expect(next).resolves.toEqual({ data: {} }));
		}),
	);

	it.live("cancels interrupted asset resolution and retains its correlation", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			const fiber = Effect.runFork(runtime.client.assets.resolve([asset]));
			yield* Effect.promise(() => delay());
			yield* Fiber.interrupt(fiber);
			yield* Effect.promise(() => delay());
			expect(sent(messages, "asset-cancel")).toEqual([
				{ requestId: "asset-1", type: "asset-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-1",
				resolutions: [resolution],
			});
			const next = Effect.runPromise(runtime.client.assets.resolve([asset]));
			yield* Effect.promise(() => delay());
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-2",
				resolutions: [resolution],
			});
			yield* Effect.promise(() => expect(next).resolves.toEqual([resolution]));
		}),
	);

	it.live("does not introduce a cancel wire message for operations, storage, or uploads", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* Effect.promise(() => openRuntime());
			const operation = Effect.runFork(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
			);
			const storage = Effect.runFork(runtime.client.storage.get("fixture", "key"));
			const upload = Effect.runFork(
				runtime.client.uploads.uploadTemporary({
					fileName: "data.txt",
					contentType: "text/plain",
					source: new Blob(["data"]),
				}),
			);
			yield* Effect.promise(() => delay());
			yield* Effect.promise(() =>
				Promise.all(
					[operation, storage, upload].map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))),
				),
			);
			expect(sent(messages, "operation-request")).toHaveLength(1);
			expect(sent(messages, "storage-request")).toHaveLength(1);
			expect(sent(messages, "upload-request")).toHaveLength(1);
			expect(sent(messages, "operation-cancel")).toHaveLength(0);
			expect(sent(messages, "storage-cancel")).toHaveLength(0);
			expect(sent(messages, "upload-cancel")).toHaveLength(0);
		}),
	);

	it.live("sends Blob uploads and accepts storage results", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			const source = new Blob(["id,title"], { type: "text/csv" });
			const upload = Effect.runPromise(
				runtime.client.uploads.uploadTemporary({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
			);
			yield* Effect.promise(() => delay());
			const request = sent(messages, "upload-request")[0];
			expect(request).toMatchObject({
				requestId: "upload-1",
				fileName: "items.csv",
				contentType: "text/csv",
			});
			if (
				!request ||
				typeof request !== "object" ||
				!("source" in request) ||
				!(request.source instanceof Blob)
			) {
				throw new Error("Expected Blob upload");
			}
			expect(yield* Effect.promise(() => request.source.text())).toBe("id,title");
			channel.port1.postMessage({
				outcome: "success",
				type: "upload-result",
				requestId: "upload-1",
				token: { token: "upload-token", expiresAt: "2026-01-01T00:15:00.000Z" },
			});
			yield* Effect.promise(() => expect(upload).resolves.toMatchObject({ token: "upload-token" }));
			const storage = Effect.runPromise(runtime.client.storage.get("fixture", "key"));
			yield* Effect.promise(() => delay());
			channel.port1.postMessage({
				reason: "quota",
				outcome: "failure",
				type: "storage-result",
				requestId: "storage-2",
			});
			yield* Effect.promise(() => expect(storage).rejects.toMatchObject({ reason: "quota" }));
		}),
	);

	it.live("fails all pending requests on replacement and disposal, ignoring late responses", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* Effect.promise(() => openRuntime());
			const pending = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => delay());
			channel.port1.postMessage({
				type: "document",
				documentKey: "page-2",
				navigation: {
					index: 1,
					key: "k1",
					compact: false,
					edgeBack: false,
					leading: "none",
					type: "location",
					location: { search: "", path: "/new", kind: "route" },
				},
			});
			yield* Effect.promise(() => expect(pending).rejects.toMatchObject({ reason: "disposed" }));
			const next = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => delay());
			runtime.dispose();
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-2",
				response: { data: {} },
			});
			yield* Effect.promise(() => expect(next).rejects.toMatchObject({ reason: "disposed" }));
			expect(yield* Effect.flip(query(runtime))).toMatchObject({ reason: "disposed" });
		}),
	);

	it.live("fails the session at the aggregate pending limit", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* Effect.promise(() => openRuntime());
			const fibers = Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS }, () =>
				Effect.runFork(query(runtime)),
			);
			const overflow = Effect.runPromise(query(runtime));
			yield* Effect.promise(() => expect(overflow).rejects.toMatchObject({ reason: "protocol" }));
			const results = yield* Effect.promise(() =>
				Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.await(fiber)))),
			);
			yield* Effect.promise(() => delay());
			expect(results).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "ryotql-request")).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "lifecycle-close")).toEqual([
				{ reason: "failed", type: "lifecycle-close" },
			]);
		}),
	);

	it.live("classifies malformed host results as protocol failures", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* Effect.promise(() => openRuntime());
			const pending = Effect.runPromise(
				runtime.client.operations.invoke({
					input: null,
					slug: "greet",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
			);
			yield* Effect.promise(() => delay());
			channel.port1.postMessage({
				outcome: "success",
				type: "operation-result",
				requestId: "operation-1",
				value: { invalid: undefined },
			});
			yield* Effect.promise(() => expect(pending).rejects.toEqual(new RyotClientError("protocol")));
		}),
	);

	it.live("dispatches operation and collection results with semantic mutation hints", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			let hints = 0;
			runtime.client.mutationCompleted.subscribe(() => hints++);
			const operation = Effect.runPromise(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
			);
			yield* Effect.promise(() => delay());
			expect(sent(messages, "operation-request")).toEqual([
				{
					input: {},
					pluginSlug: "fixture",
					operationSlug: "greet",
					requestId: "operation-1",
					type: "operation-request",
				},
			]);
			channel.port1.postMessage({
				value: "hello",
				outcome: "success",
				type: "operation-result",
				requestId: "operation-1",
			});
			yield* Effect.promise(() => expect(operation).resolves.toBe("hello"));
			const membership = Effect.runPromise(
				runtime.client.collections.removeMembership({
					entityId: "entity-1",
					collectionId: "collection-1",
				}),
			);
			yield* Effect.promise(() => delay());
			expect(sent(messages, "collection-request")).toContainEqual({
				requestId: "collection-2",
				type: "collection-request",
				action: "remove-membership",
				input: { entityId: "entity-1", collectionId: "collection-1" },
			});
			channel.port1.postMessage({
				outcome: "failure",
				type: "collection-result",
				requestId: "collection-2",
				reason: "collection-failed",
			});
			yield* Effect.promise(() =>
				expect(membership).rejects.toMatchObject({ reason: "collection-failed" }),
			);
			expect(hints).toBe(1);
		}),
	);

	it.live("keeps theme, page refresh, and entity-interest subscriptions synchronous", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* Effect.promise(() => openRuntime());
			let themes = 0;
			let hints = 0;
			const updates: unknown[] = [];
			const unsubscribe = runtime.client.theme.subscribe(() => themes++);
			runtime.client.mutationCompleted.subscribe(() => hints++);
			const subscription = runtime.client.entities.watch(
				{ visible: [], foreground: ["entity-1"] },
				(update) => updates.push(update),
			);
			channel.port1.postMessage({ mode: "dark", type: "theme" });
			channel.port1.postMessage({ type: "page-refresh" });
			channel.port1.postMessage({
				entityId: "entity-1",
				reason: "translated",
				type: "entity-updated",
			});
			yield* Effect.promise(() => delay());
			expect(runtime.client.theme.getSnapshot()).toEqual({ resolvedMode: "dark" });
			expect(themes).toBe(1);
			expect(hints).toBe(1);
			expect(updates).toEqual([{ entityId: "entity-1", reason: "translated" }]);
			expect(sent(messages, "entity-interest")).toContainEqual({
				visible: [],
				type: "entity-interest",
				foreground: ["entity-1"],
			});
			subscription.dispose();
			unsubscribe();
			yield* Effect.promise(() => delay());
			expect(sent(messages, "entity-interest").at(-1)).toEqual({
				visible: [],
				foreground: [],
				type: "entity-interest",
			});
		}),
	);
});
