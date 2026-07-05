import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PLUGIN_HEADER_TITLE_MAX,
	PluginBridgeClientMessage,
	PluginEntityLocation,
	type PluginRouteLocation,
	type PluginBridgeInit,
	type PluginClientArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RyotClientError, type EntityUpdate } from "./index";
import { createPluginNavigationStore } from "./navigation/store";
import { createPluginRuntime } from "./runtime";

const metadata: PluginClientArtifactMetadata = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const init: PluginBridgeInit = {
	mode: "light",
	safeAreaTop: 0,
	safeAreaBottom: 0,
	format: metadata.format,
	sessionId: "session-id",
	artifactHash: metadata.hash,
	apiVersion: metadata.apiVersion,
	bridgeVersion: metadata.bridgeVersion,
	compilerVersion: metadata.compilerVersion,
};
const document = { queries: {}, output: {} } as PreparedRecipe<unknown>["document"];
const asset = { key: "permanent/image.png", type: "local" } as const;
const assetResolution = {
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: "https://ryot.test/api/uploads/local/download?key=permanent%2Fimage.png",
};
const channels: MessageChannel[] = [];
const EmptyScreen = () => null;
const routeResolver = () => ({ element: createElement(EmptyScreen), params: {} });
const routeLocation = (path: string, search = ""): PluginRouteLocation => ({
	path,
	search,
	kind: "route",
});
const entityLocation = (entityId: string, entitySchemaSlug: string) =>
	Schema.decodeUnknownSync(PluginEntityLocation)({ entityId, entitySchemaSlug, kind: "entity" });

const openRuntime = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	channels.push(channel);
	const attributes = new Map<string, string>();
	const root = {
		setAttribute: (name: string, value: string) => attributes.set(name, value),
	};
	return {
		channel,
		messages,
		attributes,
		runtime: createPluginRuntime(
			channel.port2,
			init,
			metadata,
			root,
			createPluginNavigationStore(routeResolver),
		),
	};
};

const headersIn = (messages: readonly unknown[]) =>
	messages.filter(
		(message) =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "header",
	);
const screenStatesIn = (messages: readonly unknown[]) =>
	messages.filter(
		(message) =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "screen-state",
	);

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));
const activate = (channel: MessageChannel) => {
	channel.port1.postMessage({
		index: 0,
		key: "k0",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: routeLocation("/"),
	});
};

afterEach(() => {
	for (const channel of channels.splice(0)) {
		channel.port1.close();
		channel.port2.close();
	}
});

describe("plugin runtime", () => {
	it("aggregates deterministic bounded interest, routes hints, and clears disposed owners", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const firstEvents: EntityUpdate[] = [];
		const secondEvents: EntityUpdate[] = [];
		const first = (event: EntityUpdate) => {
			firstEvents.push(event);
		};
		const second = (event: EntityUpdate) => {
			secondEvents.push(event);
		};
		const rows = Array.from({ length: 600 }, (_, i) => `row-${String(i).padStart(3, "0")}`);
		const a = runtime.client.entities.watch(
			{ foreground: ["z", "a"], visible: rows.toReversed() },
			first,
		);
		const b = runtime.client.entities.watch({ foreground: ["row-599"], visible: ["z"] }, second);
		await delay();
		const interests = () =>
			messages.filter(
				(value) =>
					typeof value === "object" &&
					value !== null &&
					"type" in value &&
					value.type === "entity-interest",
			);
		expect(interests().at(-1)).toEqual({
			type: "entity-interest",
			foreground: ["a", "row-599", "z"],
			visible: rows.slice(0, 497),
		});
		a.update({ foreground: ["a", "z", "a"], visible: rows });
		await delay();
		expect(interests()).toHaveLength(2);
		channel.port1.postMessage({ type: "entity-updated", entityId: "z", reason: "populated" });
		channel.port1.postMessage({
			entityId: "unknown",
			reason: "translated",
			type: "entity-updated",
		});
		await delay();
		expect(firstEvents).toEqual([{ entityId: "z", reason: "populated" }]);
		expect(secondEvents).toEqual([{ entityId: "z", reason: "populated" }]);
		b.dispose();
		a.dispose();
		await delay();
		expect(interests().at(-1)).toEqual({ type: "entity-interest", foreground: [], visible: [] });
		const terminal = runtime.client.entities.watch({ foreground: ["a"], visible: [] }, first);
		runtime.dispose();
		terminal.dispose();
		expect(() => terminal.update({ foreground: [], visible: [] })).toThrow(
			new RyotClientError("disposed"),
		);
	});

	it("forwards semantic kernel shortcuts only while active", async () => {
		const { channel, messages, runtime } = openRuntime();

		runtime.forwardKernelShortcut("command-center");
		activate(channel);
		await delay();
		runtime.forwardKernelShortcut("command-center");
		runtime.forwardKernelShortcut("workspace-switcher");
		await delay();

		expect(messages).toContainEqual({ shortcut: "command-center", type: "kernel-shortcut" });
		expect(messages).toContainEqual({ shortcut: "workspace-switcher", type: "kernel-shortcut" });
		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "kernel-shortcut",
			),
		).toHaveLength(2);
	});

	it("publishes one atomic navigation snapshot and no header of its own", async () => {
		const { channel, messages, runtime } = openRuntime();
		const snapshots: unknown[] = [];
		runtime.navigation.subscribe(() => snapshots.push(runtime.navigation.getSnapshot()));

		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: true,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await delay();

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({
			compact: true,
			safeAreaTop: 0,
			edgeBack: false,
			leading: "drawer",
			entry: { index: 0, key: "k0" },
			screens: [{ key: "k0", location: { kind: "route", path: "/" } }],
		});
		expect(headersIn(messages)).toEqual([]);
	});

	it("activates an entity location without a protocol failure", async () => {
		const { channel, runtime } = openRuntime();
		const location = entityLocation("entity-1", "media-movie");

		channel.port1.postMessage({
			index: 0,
			location,
			key: "k0",
			compact: false,
			leading: "none",
			edgeBack: false,
			type: "location",
		});
		await delay();

		expect(runtime.navigation.getSnapshot()).toMatchObject({
			screens: [{ key: "k0", location }],
			entry: { index: 0, key: "k0", location },
		});
	});

	it("stamps a published title with the current entry and ignores one before any location", async () => {
		const { channel, messages, runtime } = openRuntime();

		runtime.navigation.publishTitle("Too early");
		await delay();

		expect(headersIn(messages)).toEqual([]);

		channel.port1.postMessage({
			index: 3,
			key: "k3",
			compact: true,
			edgeBack: true,
			leading: "back",
			type: "location",
			location: routeLocation("/items/1"),
		});
		await delay();
		runtime.navigation.publishTitle("Item 1");
		runtime.navigation.publishTitle(null);
		runtime.navigation.openDrawer();
		await delay();

		expect(messages).toContainEqual({
			index: 3,
			key: "k3",
			type: "header",
			header: { title: "Item 1" },
		});
		expect(messages).toContainEqual({ index: 3, key: "k3", header: null, type: "header" });
		expect(messages).toContainEqual({ type: "open-drawer" });
	});

	it("normalizes a published title so a header never breaches the bridge contract", async () => {
		const { channel, messages, runtime } = openRuntime();
		const overlong = "O".repeat(PLUGIN_HEADER_TITLE_MAX + 40);

		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: true,
			edgeBack: false,
			leading: "drawer",
			type: "location",
			location: routeLocation("/"),
		});
		await delay();
		runtime.navigation.publishTitle("");
		runtime.navigation.publishTitle("   ");
		runtime.navigation.publishTitle(overlong);
		runtime.navigation.publishTitle("  Severance  ");
		await delay();

		expect(headersIn(messages)).toEqual([
			{ index: 0, key: "k0", header: null, type: "header" },
			{ index: 0, key: "k0", header: null, type: "header" },
			{
				index: 0,
				key: "k0",
				type: "header",
				header: { title: "O".repeat(PLUGIN_HEADER_TITLE_MAX) },
			},
			{ index: 0, key: "k0", type: "header", header: { title: "Severance" } },
		]);
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		expect(headersIn(messages).filter((header) => Result.isFailure(decode(header)))).toEqual([]);
	});

	it("reports screen state from each reconciled stack", async () => {
		const { channel, messages } = openRuntime();
		const sendLocation = (index: number, key: string) =>
			channel.port1.postMessage({
				key,
				index,
				compact: true,
				type: "location",
				edgeBack: index > 0,
				leading: index > 0 ? "back" : "drawer",
				location: routeLocation(`/items/${index}`),
			});

		sendLocation(0, "k0");
		sendLocation(1, "k1");
		sendLocation(2, "k2");
		sendLocation(1, "k1");
		sendLocation(7, "k7");
		await delay();

		expect(screenStatesIn(messages)).toEqual([
			{ index: 0, key: "k0", type: "screen-state", hasPreviousScreen: false },
			{ index: 1, key: "k1", type: "screen-state", hasPreviousScreen: true },
			{ index: 2, key: "k2", type: "screen-state", hasPreviousScreen: true },
			{ index: 1, key: "k1", type: "screen-state", hasPreviousScreen: true },
			{ index: 7, key: "k7", type: "screen-state", hasPreviousScreen: false },
		]);
	});

	it("does not report screen state after teardown starts", async () => {
		const { channel, messages, runtime } = openRuntime();
		runtime.navigation.subscribe(() => runtime.dispose());

		activate(channel);
		await delay();

		expect(screenStatesIn(messages)).toEqual([]);
	});

	it("tracks the safe-area insets from init and from a viewport message", async () => {
		const { channel, runtime } = openRuntime();

		expect(runtime.navigation.getSnapshot()).toMatchObject({
			safeAreaTop: 0,
			safeAreaBottom: 0,
		});

		channel.port1.postMessage({ safeAreaTop: 59, safeAreaBottom: 34, type: "viewport" });
		await delay();

		expect(runtime.navigation.getSnapshot()).toMatchObject({
			safeAreaTop: 59,
			safeAreaBottom: 34,
		});
	});

	it("owns handshake, activation, dispatch, and correlated calls", async () => {
		const { channel, messages, runtime } = openRuntime();
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "transport" });
		activate(channel);
		await delay();

		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		expect(messages).toContainEqual({ document, requestId: "ryotql-1", type: "ryotql-request" });
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		await expect(query).resolves.toEqual({ data: {} });

		const failure = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({
			outcome: "failure",
			type: "ryotql-result",
			requestId: "ryotql-2",
			reason: "query-failed",
		});
		await expect(failure).rejects.toMatchObject({ reason: "query-failed" });
	});

	it("sends a managed asset batch and resolves its correlated result", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();

		const resolution = runtime.client.assets.resolve([asset]);
		await delay();

		expect(messages).toContainEqual({
			assets: [asset],
			requestId: "asset-1",
			type: "asset-request",
		});
		channel.port1.postMessage({
			outcome: "success",
			requestId: "asset-1",
			type: "asset-result",
			resolutions: [assetResolution],
		});

		await expect(resolution).resolves.toEqual([assetResolution]);
	});

	it("preserves an asset-failed result without failing the session", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();

		const resolution = runtime.client.assets.resolve([asset]);
		await delay();
		channel.port1.postMessage({
			outcome: "failure",
			requestId: "asset-1",
			type: "asset-result",
			reason: "asset-failed",
		});

		await expect(resolution).rejects.toMatchObject({ reason: "asset-failed" });
		const nextResolution = runtime.client.assets.resolve([asset]);
		await delay();
		channel.port1.postMessage({
			outcome: "success",
			requestId: "asset-2",
			type: "asset-result",
			resolutions: [assetResolution],
		});
		await expect(nextResolution).resolves.toEqual([assetResolution]);
	});

	it("fails a ready session through shared teardown", async () => {
		const { channel, messages, runtime } = openRuntime();
		runtime.fatal();
		runtime.fatal();
		await delay();

		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "protocol" });
		expect(runtime.navigation.getSnapshot().entry).toBeUndefined();
		expect(() => runtime.client.theme.getSnapshot()).toThrow(new RyotClientError("protocol"));
		expect(() => runtime.client.theme.subscribe(() => undefined)).toThrow(
			new RyotClientError("protocol"),
		);
		activate(channel);
		await delay();

		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "lifecycle-close",
			),
		).toEqual([{ reason: "failed", type: "lifecycle-close" }]);
	});

	it("sends navigation through the client adapter after activation", async () => {
		const { channel, messages, runtime } = openRuntime();
		expect(() => runtime.client.navigation.push({ kind: "route", path: "/early" })).toThrow(
			new RyotClientError("transport"),
		);
		expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigate" }));
		activate(channel);
		await delay();

		expect(runtime).not.toHaveProperty("navigate");
		runtime.client.navigation.push({
			kind: "route",
			path: "/items",
			search: { tab: "stats" },
		});
		runtime.client.navigation.replace({ kind: "route", path: "/" });
		runtime.client.navigation.push({ kind: "entity", entityId: "entity-1" });
		await delay();

		expect(messages).toContainEqual({
			mode: "push",
			type: "navigate",
			target: { kind: "route", path: "/items", search: "tab=stats" },
		});
		expect(messages).toContainEqual({
			mode: "replace",
			type: "navigate",
			target: { kind: "route", path: "/", search: "" },
		});
		expect(messages).toContainEqual({
			mode: "push",
			type: "navigate",
			target: { kind: "entity", entityId: "entity-1" },
		});
	});

	it("rejects every pending call once and blocks new admissions after disposal", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		const operation = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: JsonValue,
		});
		const assetRequest = runtime.client.assets.resolve([asset]);
		await delay();

		runtime.dispose();
		runtime.dispose();
		expect(() => runtime.client.navigation.push({ kind: "route", path: "/late" })).toThrow(
			new RyotClientError("disposed"),
		);
		await expect(query).rejects.toMatchObject({ reason: "disposed" });
		await expect(operation).rejects.toMatchObject({ reason: "disposed" });
		await expect(assetRequest).rejects.toMatchObject({ reason: "disposed" });
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "disposed" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "disposed" });
		await delay();
		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "lifecycle-close",
			),
		).toEqual([{ reason: "disposed", type: "lifecycle-close" }]);
	});

	it("fails the session when aggregate pending requests exceed the admission limit", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const pending = Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS }, (_, index) => {
			if (index % 3 === 0) {
				return runtime.client.assets.resolve([asset]);
			}
			if (index % 3 === 1) {
				return runtime.client.data.query({ document, decode: Result.succeed });
			}
			return runtime.client.operations.invoke({
				input: null,
				output: JsonValue,
				slug: `operation-${index}`,
			});
		});
		const overflow = runtime.client.data.query({ document, decode: Result.succeed });
		const results = await Promise.allSettled([...pending, overflow]);
		await delay();

		expect(results).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS + 1);
		expect(
			results.every(
				(result) =>
					result.status === "rejected" &&
					result.reason instanceof RyotClientError &&
					result.reason.reason === "protocol",
			),
		).toBe(true);
		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					(message.type === "asset-request" ||
						message.type === "operation-request" ||
						message.type === "ryotql-request"),
			),
		).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
		expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" });
	});

	it("cancels one query exactly once, releases admission, and ignores its late result", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		const canceled = runtime.client.data.query(
			{ document, decode: Result.succeed },
			{ signal: controller.signal },
		);
		const pending = Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS - 1 }, () =>
			runtime.client.data.query({ document, decode: Result.succeed }),
		);
		const settlements = Promise.allSettled(pending);
		await delay();

		controller.abort(reason);
		controller.abort(new Error("ignored"));
		await expect(canceled).rejects.toBe(reason);
		const replacement = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();

		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "ryotql-cancel",
			),
		).toEqual([{ requestId: "ryotql-1", type: "ryotql-cancel" }]);
		expect(messages).toContainEqual({
			document,
			type: "ryotql-request",
			requestId: `ryotql-${CLIENT_BRIDGE_MAX_PENDING_REQUESTS + 1}`,
		});
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		await delay();
		runtime.dispose();
		await expect(replacement).rejects.toMatchObject({ reason: "disposed" });
		const results = await settlements;
		expect(results.every((result) => result.status === "rejected")).toBe(true);
	});

	it("cancels an asset request and suppresses its late result", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		let settlements = 0;
		const canceled = runtime.client.assets
			.resolve([asset], { signal: controller.signal })
			.catch((error: unknown) => {
				settlements += 1;
				throw error;
			});
		await delay();

		controller.abort(reason);
		await expect(canceled).rejects.toBe(reason);
		await delay();
		expect(messages).toContainEqual({ requestId: "asset-1", type: "asset-cancel" });
		channel.port1.postMessage({
			outcome: "success",
			requestId: "asset-1",
			type: "asset-result",
			resolutions: [assetResolution],
		});
		await delay();
		expect(settlements).toBe(1);

		const replacement = runtime.client.assets.resolve([asset]);
		await delay();
		expect(messages).toContainEqual({
			assets: [asset],
			requestId: "asset-2",
			type: "asset-request",
		});
		channel.port1.postMessage({
			outcome: "success",
			requestId: "asset-2",
			type: "asset-result",
			resolutions: [assetResolution],
		});
		await expect(replacement).resolves.toEqual([assetResolution]);
	});

	it("rejects simultaneous pending calls once on fatal failure and ignores late results", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();

		let querySettlements = 0;
		const query = runtime.client.data
			.query({ document, decode: Result.succeed })
			.catch((error: unknown) => {
				querySettlements += 1;
				throw error;
			});
		let operationSettlements = 0;
		const operation = runtime.client.operations
			.invoke({ input: {}, slug: "greet", output: JsonValue })
			.catch((error: unknown) => {
				operationSettlements += 1;
				throw error;
			});
		await delay();

		runtime.fatal();
		runtime.fatal();
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		channel.port1.postMessage({
			value: "late",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-2",
		});

		await expect(query).rejects.toMatchObject({ reason: "protocol" });
		await expect(operation).rejects.toMatchObject({ reason: "protocol" });
		expect(querySettlements).toBe(1);
		expect(operationSettlements).toBe(1);
		expect(runtime.navigation.getSnapshot().entry).toBeUndefined();
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "protocol" });
		expect(() => runtime.client.navigation.push({ kind: "route", path: "/late" })).toThrow(
			new RyotClientError("protocol"),
		);
		await delay();

		expect(
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "lifecycle-close",
			),
		).toEqual([{ reason: "failed", type: "lifecycle-close" }]);
		expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigate" }));
	});

	it("sends an upload source across the port untouched and resolves its token", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();

		const source = new Blob(["id,title"], { type: "text/csv" });
		const token = { token: "upload-token", expiresAt: "2026-01-01T00:15:00.000Z" };
		const upload = runtime.client.uploads.uploadTemporary({
			source,
			fileName: "items.csv",
			contentType: "text/csv",
		});
		await delay();

		const request = messages.find(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				"type" in message &&
				message.type === "upload-request",
		);
		expect(request).toMatchObject({
			fileName: "items.csv",
			contentType: "text/csv",
			requestId: "upload-1",
		});
		const cloned = (request as { source: Blob }).source;
		expect(cloned).toBeInstanceOf(Blob);
		expect(cloned.type).toBe("text/csv");
		expect(await cloned.text()).toBe("id,title");

		channel.port1.postMessage({
			token,
			outcome: "success",
			type: "upload-result",
			requestId: "upload-1",
		});
		await expect(upload).resolves.toEqual(token);
	});

	it("preserves upload failure reasons and rejects pending uploads on teardown", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();

		const request = {
			fileName: "items.csv",
			contentType: "text/csv",
			source: new Blob(["id,title"]),
		};

		const failure = runtime.client.uploads.uploadTemporary(request);
		channel.port1.postMessage({
			outcome: "failure",
			type: "upload-result",
			requestId: "upload-1",
			reason: "operation-failed",
		});
		await expect(failure).rejects.toMatchObject({ reason: "operation-failed" });

		const pending = runtime.client.uploads.uploadTemporary(request);
		await delay();
		runtime.fatal();
		await expect(pending).rejects.toMatchObject({ reason: "protocol" });
		await expect(runtime.client.uploads.uploadTemporary(request)).rejects.toMatchObject({
			reason: "protocol",
		});
	});

	it("preserves operation success and failure semantics", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();

		const success = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: Schema.String,
		});
		channel.port1.postMessage({
			value: "hello",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		});
		await expect(success).resolves.toBe("hello");

		const failure = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: Schema.String,
		});
		channel.port1.postMessage({
			outcome: "failure",
			type: "operation-result",
			requestId: "operation-2",
			reason: "operation-failed",
		});
		await expect(failure).rejects.toMatchObject({ reason: "operation-failed" });

		const malformed = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: Schema.String,
		});
		channel.port1.postMessage({
			outcome: "failure",
			type: "operation-result",
			requestId: "operation-3",
			reason: "malformed-result",
		});
		await expect(malformed).rejects.toMatchObject({ reason: "malformed-result" });
	});

	it("fails the session on a malformed correlated result and settles the operation once", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();

		let settlements = 0;
		const operation = runtime.client.operations
			.invoke({ input: null, slug: "greet", output: Schema.String })
			.catch((error: unknown) => {
				settlements += 1;
				throw error;
			});
		channel.port1.postMessage({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
			value: { invalid: undefined },
		});

		await expect(operation).rejects.toMatchObject({ reason: "protocol" });
		channel.port1.postMessage({
			value: "hello",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		});
		await delay();
		expect(settlements).toBe(1);
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "protocol" });
	});

	it("classifies peer failure as protocol for every pending call", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({ reason: "failed", type: "lifecycle-close" });
		await expect(query).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "protocol" });
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		expect(() => runtime.client.navigation.push({ kind: "route", path: "/late" })).toThrow(
			new RyotClientError("protocol"),
		);
		await delay();
		expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigate" }));
	});

	it("classifies peer disposal as disposed", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		const operation = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: JsonValue,
		});
		channel.port1.postMessage({ reason: "disposed", type: "lifecycle-close" });

		await expect(query).rejects.toMatchObject({ reason: "disposed" });
		await expect(operation).rejects.toMatchObject({ reason: "disposed" });
	});

	it("ignores valid results with unknown request IDs", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();
		const operation = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: Schema.String,
		});
		channel.port1.postMessage({
			value: "ignored",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-unknown",
		});
		channel.port1.postMessage({
			value: "hello",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		});

		await expect(operation).resolves.toBe("hello");
	});

	it("classifies channel communication failures as transport", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();
		channel.port2.postMessage = () => {
			throw new Error("channel closed");
		};
		const operation = runtime.client.operations.invoke({
			input: {},
			slug: "greet",
			output: JsonValue,
		});

		await expect(operation).rejects.toMatchObject({ reason: "transport" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: JsonValue }),
		).rejects.toMatchObject({ reason: "transport" });
	});

	it("throws a transport error when navigation cannot be posted", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();
		channel.port2.postMessage = () => {
			throw new Error("channel closed");
		};

		expect(() => runtime.client.navigation.push({ kind: "route", path: "/items" })).toThrow(
			new RyotClientError("transport"),
		);
		expect(() => runtime.client.navigation.push({ kind: "route", path: "/late" })).toThrow(
			new RyotClientError("transport"),
		);
	});

	it("applies the init theme mode before any host message arrives", async () => {
		const { channel, messages, attributes, runtime } = openRuntime();

		expect(attributes.get("data-theme")).toBe("light");

		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await delay();

		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		expect(messages).toContainEqual({ document, requestId: "ryotql-1", type: "ryotql-request" });
		runtime.dispose();
		await expect(query).rejects.toMatchObject({ reason: "disposed" });
	});

	it("publishes live themes without changing location, runtime identity, or pending calls", async () => {
		const { channel, attributes, runtime } = openRuntime();
		activate(channel);
		await delay();
		const client = runtime.client;
		const location = runtime.navigation.getSnapshot().entry;
		let notifications = 0;
		const unsubscribe = client.theme.subscribe(() => {
			notifications += 1;
		});
		const query = client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({ mode: "dark", type: "theme" });
		await delay();

		expect(runtime.client).toBe(client);
		expect(runtime.navigation.getSnapshot().entry).toBe(location);
		expect(client.theme.getSnapshot().resolvedMode).toBe("dark");
		expect(attributes.get("data-theme")).toBe("dark");
		expect(notifications).toBe(1);

		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		await expect(query).resolves.toEqual({ data: {} });
		unsubscribe();
	});

	it("fails the shared lifecycle when a live theme is malformed", async () => {
		const { channel, messages, runtime } = openRuntime();
		activate(channel);
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({ mode: "system", type: "theme" });

		await expect(query).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await delay();
		expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" });
	});
});
