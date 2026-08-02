import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeThemeApplied,
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginBridgeInit,
	type PluginClientArtifactMetadata,
} from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { RyotClientError } from "./index";
import { createPluginRuntime } from "./runtime";

const metadata: PluginClientArtifactMetadata = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const init: PluginBridgeInit = {
	format: metadata.format,
	sessionId: "session-id",
	artifactHash: metadata.hash,
	apiVersion: metadata.apiVersion,
	bridgeVersion: metadata.bridgeVersion,
	compilerVersion: metadata.compilerVersion,
};
const document = { queries: {}, output: {} } as PreparedRecipe<unknown>["document"];
const channels: MessageChannel[] = [];
const tokens = Object.fromEntries(
	REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, `light-${name}`]),
);
const theme = { resolvedMode: "light", tokens };

const openRuntime = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	channels.push(channel);
	const properties = new Map<string, string>();
	const style = {
		setProperty: (property: string, value: string) => properties.set(property, value),
	};
	return {
		channel,
		messages,
		properties,
		runtime: createPluginRuntime(channel.port2, init, metadata, style),
	};
};

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));
const activate = (channel: MessageChannel) => {
	channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
	channel.port1.postMessage({ generation: 1, type: "theme", theme });
};

afterEach(() => {
	for (const channel of channels.splice(0)) {
		channel.port1.close();
		channel.port2.close();
	}
});

describe("plugin runtime", () => {
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

	it("fails a ready session through shared teardown", async () => {
		const { channel, messages, runtime } = openRuntime();
		runtime.fatal();
		runtime.fatal();
		await delay();

		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "protocol" });
		expect(runtime.locations.getSnapshot()).toBeUndefined();
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
		expect(() => runtime.client.navigation.push({ path: "/early" })).toThrow(
			new RyotClientError("transport"),
		);
		expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigate" }));
		activate(channel);
		await delay();

		expect(runtime).not.toHaveProperty("navigate");
		runtime.client.navigation.push({ path: "/items", search: { tab: "stats" } });
		runtime.client.navigation.replace({ path: "/" });
		await delay();

		expect(messages).toContainEqual({
			mode: "push",
			type: "navigate",
			location: { path: "/items", search: "tab=stats" },
		});
		expect(messages).toContainEqual({
			mode: "replace",
			type: "navigate",
			location: { path: "/", search: "" },
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
			output: Schema.Unknown,
		});
		await delay();

		runtime.dispose();
		runtime.dispose();
		expect(() => runtime.client.navigation.push({ path: "/late" })).toThrow(
			new RyotClientError("disposed"),
		);
		await expect(query).rejects.toMatchObject({ reason: "disposed" });
		await expect(operation).rejects.toMatchObject({ reason: "disposed" });
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "disposed" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
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
		const pending = Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS }, (_, index) =>
			index % 2 === 0
				? runtime.client.data.query({ document, decode: Result.succeed })
				: runtime.client.operations.invoke({
						input: null,
						output: Schema.Unknown,
						slug: `operation-${index}`,
					}),
		);
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
					(message.type === "operation-request" || message.type === "ryotql-request"),
			),
		).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
		expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" });
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
			.invoke({ input: {}, slug: "greet", output: Schema.Unknown })
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
		expect(runtime.locations.getSnapshot()).toBeUndefined();
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "protocol" });
		expect(() => runtime.client.navigation.push({ path: "/late" })).toThrow(
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
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
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
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "protocol" });
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			response: { data: {} },
			requestId: "ryotql-1",
		});
		expect(() => runtime.client.navigation.push({ path: "/late" })).toThrow(
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
			output: Schema.Unknown,
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
			output: Schema.Unknown,
		});

		await expect(operation).rejects.toMatchObject({ reason: "transport" });
		await expect(
			runtime.client.operations.invoke({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "transport" });
	});

	it("throws a transport error when navigation cannot be posted", async () => {
		const { channel, runtime } = openRuntime();
		activate(channel);
		await delay();
		channel.port2.postMessage = () => {
			throw new Error("channel closed");
		};

		expect(() => runtime.client.navigation.push({ path: "/items" })).toThrow(
			new RyotClientError("transport"),
		);
		expect(() => runtime.client.navigation.push({ path: "/late" })).toThrow(
			new RyotClientError("transport"),
		);
	});

	it("applies the initial theme before acknowledging it and gates activation on both inputs", async () => {
		const { channel, messages, properties, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "transport" });

		channel.port1.postMessage({
			type: "theme",
			generation: 17,
			theme: { resolvedMode: "light", tokens: { ...tokens, future: "ignored" } },
		});
		await delay();

		expect(properties.get("--bg")).toBe("light-bg");
		expect(properties.has("--future")).toBe(false);
		expect(messages).toContainEqual({ generation: 17, type: "theme-applied" });
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		expect(messages).toContainEqual({ document, requestId: "ryotql-1", type: "ryotql-request" });
		runtime.dispose();
		await expect(query).rejects.toMatchObject({ reason: "disposed" });
	});

	it("publishes live themes without changing location, runtime identity, or pending calls", async () => {
		const { channel, messages, properties, runtime } = openRuntime();
		activate(channel);
		await delay();
		const client = runtime.client;
		const location = runtime.locations.getSnapshot();
		let notifications = 0;
		const unsubscribe = client.theme.subscribe(() => {
			notifications += 1;
		});
		const query = client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({
			generation: 2,
			type: "theme",
			theme: { resolvedMode: "dark", tokens: { ...tokens, bg: "dark-bg" } },
		});
		await delay();

		expect(runtime.client).toBe(client);
		expect(runtime.locations.getSnapshot()).toBe(location);
		expect(client.theme.getSnapshot().resolvedMode).toBe("dark");
		expect(properties.get("--bg")).toBe("dark-bg");
		expect(notifications).toBe(1);
		expect(
			messages.filter((message) =>
				Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeThemeApplied)(message)),
			),
		).toHaveLength(1);

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
		channel.port1.postMessage({
			generation: 2,
			type: "theme",
			theme: { resolvedMode: "dark", tokens: {} },
		});

		await expect(query).rejects.toMatchObject({ reason: "protocol" });
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "protocol" });
		await delay();
		expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" });
	});
});
