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
import { waitForMessagePortMacrotask } from "./testing";

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
const openRuntime = () =>
	Effect.gen(function* () {
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
		yield* waitForMessagePortMacrotask;
		return { channel, runtime, messages };
	});
const query = (runtime: ReturnType<typeof createPluginRuntime>) =>
	runtime.client.data.query({
		document,
		decode: (response): Result.Result<unknown, RyotClientError> => Result.succeed(response),
	});
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
			const { channel, runtime, messages } = yield* openRuntime();
			expect(messages[0]).toEqual({
				format: metadata.format,
				sessionId: init.sessionId,
				compositionHash: metadata.hash,
				apiVersion: metadata.apiVersion,
				bridgeVersion: metadata.bridgeVersion,
				compilerVersion: metadata.compilerVersion,
			});
			const first = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
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
			expect(yield* Fiber.join(first)).toEqual({ data: {} });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-cancel")).toEqual([]);
			const second = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				type: "ryotql-result",
				requestId: "ryotql-2",
				reason: "query-failed",
			});
			expect(yield* Fiber.join(second)).toMatchObject({ failure: { reason: "query-failed" } });
		}),
	);

	it.live("cancels an interrupted query exactly once and ignores its late result", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const fiber = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			yield* Fiber.interrupt(fiber);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-cancel")).toEqual([
				{ requestId: "ryotql-1", type: "ryotql-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-1",
				response: { data: {} },
			});
			const next = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
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
			expect(yield* Fiber.join(next)).toEqual({ data: {} });
		}),
	);

	it.live("cancels interrupted asset resolution and retains its correlation", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const fiber = yield* Effect.forkChild(runtime.client.assets.resolve([asset]), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			yield* Fiber.interrupt(fiber);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "asset-cancel")).toEqual([
				{ requestId: "asset-1", type: "asset-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-1",
				resolutions: [resolution],
			});
			const next = yield* Effect.forkChild(runtime.client.assets.resolve([asset]), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-2",
				resolutions: [resolution],
			});
			expect(yield* Fiber.join(next)).toEqual([resolution]);
		}),
	);

	it.live("does not introduce a cancel wire message for operations, storage, or uploads", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* openRuntime();
			const operation = yield* Effect.forkChild(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
				{ startImmediately: true },
			);
			const storage = yield* Effect.forkChild(runtime.client.storage.get("fixture", "key"), {
				startImmediately: true,
			});
			const upload = yield* Effect.forkChild(
				runtime.client.uploads.uploadTemporary({
					fileName: "data.txt",
					contentType: "text/plain",
					source: new Blob(["data"]),
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			yield* Effect.forEach([operation, storage, upload], Fiber.interrupt);
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
			const { channel, runtime, messages } = yield* openRuntime();
			const source = new Blob(["id,title"], { type: "text/csv" });
			const upload = yield* Effect.forkChild(
				runtime.client.uploads.uploadTemporary({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			const request = sent(messages, "upload-request")[0];
			expect(request).toMatchObject({
				requestId: "upload-1",
				fileName: "items.csv",
				contentType: "text/csv",
			});
			const uploadSource =
				request && typeof request === "object" && "source" in request ? request.source : undefined;
			if (!(uploadSource instanceof Blob)) {
				throw new Error("Expected Blob upload");
			}
			expect(yield* Effect.promise(() => uploadSource.text())).toBe("id,title");
			channel.port1.postMessage({
				outcome: "success",
				type: "upload-result",
				requestId: "upload-1",
				token: { token: "upload-token", expiresAt: "2026-01-01T00:15:00.000Z" },
			});
			expect(yield* Fiber.join(upload)).toMatchObject({ token: "upload-token" });
			const storage = yield* Effect.forkChild(
				Effect.result(runtime.client.storage.get("fixture", "key")),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				reason: "quota",
				outcome: "failure",
				type: "storage-result",
				requestId: "storage-2",
			});
			expect(yield* Fiber.join(storage)).toMatchObject({ failure: { reason: "quota" } });
		}),
	);

	it.live("fails all pending requests on replacement and disposal, ignoring late responses", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* openRuntime();
			const pending = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
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
			expect(yield* Fiber.join(pending)).toMatchObject({ failure: { reason: "disposed" } });
			const next = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			runtime.dispose();
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-2",
				response: { data: {} },
			});
			expect(yield* Fiber.join(next)).toMatchObject({ failure: { reason: "disposed" } });
			expect(yield* Effect.result(query(runtime))).toMatchObject({
				failure: { reason: "disposed" },
			});
		}),
	);

	it.live("fails the session at the aggregate pending limit", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* openRuntime();
			const fibers = yield* Effect.forEach(
				Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS }),
				() => Effect.forkChild(Effect.result(query(runtime)), { startImmediately: true }),
			);
			const overflow = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			expect(yield* Fiber.join(overflow)).toMatchObject({ failure: { reason: "protocol" } });
			const results = yield* Effect.forEach(fibers, Fiber.join);
			yield* waitForMessagePortMacrotask;
			expect(results).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "ryotql-request")).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "lifecycle-close")).toEqual([
				{ reason: "failed", type: "lifecycle-close" },
			]);
		}),
	);

	it.live("classifies malformed host results as protocol failures", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* openRuntime();
			const pending = yield* Effect.forkChild(
				Effect.result(
					runtime.client.operations.invoke({
						input: null,
						slug: "greet",
						pluginSlug: "fixture",
						output: Schema.String,
					}),
				),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				type: "operation-result",
				requestId: "operation-1",
				value: { invalid: undefined },
			});
			expect(yield* Fiber.join(pending)).toMatchObject({
				failure: new RyotClientError("protocol"),
			});
		}),
	);

	it.live("dispatches operation and collection results with semantic mutation hints", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			let hints = 0;
			runtime.client.mutationCompleted.subscribe(() => hints++);
			const operation = yield* Effect.forkChild(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
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
			expect(yield* Fiber.join(operation)).toBe("hello");
			const membership = yield* Effect.forkChild(
				Effect.result(
					runtime.client.collections.removeMembership({
						entityId: "entity-1",
						collectionId: "collection-1",
					}),
				),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
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
			expect(yield* Fiber.join(membership)).toMatchObject({
				failure: { reason: "collection-failed" },
			});
			expect(hints).toBe(1);
		}),
	);

	it.live("keeps theme, page refresh, and entity-interest subscriptions synchronous", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
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
			yield* waitForMessagePortMacrotask;
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
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "entity-interest").at(-1)).toEqual({
				visible: [],
				foreground: [],
				type: "entity-interest",
			});
		}),
	);
});
