import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
	type PluginClientArtifactMetadata,
} from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

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

const openRuntime = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	channels.push(channel);
	return { channel, messages, runtime: createPluginRuntime(channel.port2, init, metadata) };
};

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));

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
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
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
	});

	it("rejects every pending call once and blocks new admissions after disposal", async () => {
		const { channel, messages, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		const operation = runtime.client.data.invokeOperation({
			input: {},
			slug: "greet",
			output: Schema.Unknown,
		});
		await delay();

		runtime.dispose();
		runtime.dispose();
		await expect(query).rejects.toMatchObject({ reason: "transport" });
		await expect(operation).rejects.toMatchObject({ reason: "disposed" });
		await expect(
			runtime.client.data.query({ document, decode: Result.succeed }),
		).rejects.toMatchObject({ reason: "transport" });
		await expect(
			runtime.client.data.invokeOperation({ input: {}, slug: "late", output: Schema.Unknown }),
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

	it("preserves operation success and failure semantics", async () => {
		const { channel, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();

		const success = runtime.client.data.invokeOperation({
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

		const failure = runtime.client.data.invokeOperation({
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

		const malformed = runtime.client.data.invokeOperation({
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
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();

		let settlements = 0;
		const operation = runtime.client.data
			.invokeOperation({ input: null, slug: "greet", output: Schema.String })
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
			runtime.client.data.invokeOperation({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "protocol" });
	});

	it("classifies peer failure as protocol while keeping query errors compatible", async () => {
		const { channel, messages, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		const query = runtime.client.data.query({ document, decode: Result.succeed });
		await delay();
		channel.port1.postMessage({ reason: "failed", type: "lifecycle-close" });
		await expect(query).rejects.toMatchObject({ reason: "transport" });
		await expect(
			runtime.client.data.invokeOperation({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "protocol" });
		channel.port1.postMessage({
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
			response: { data: {} },
		});
		runtime.navigate("push", { path: "/late" });
		await delay();
		expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigate" }));
	});

	it("classifies peer disposal as disposed", async () => {
		const { channel, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		const operation = runtime.client.data.invokeOperation({
			input: {},
			slug: "greet",
			output: Schema.Unknown,
		});
		channel.port1.postMessage({ reason: "disposed", type: "lifecycle-close" });

		await expect(operation).rejects.toMatchObject({ reason: "disposed" });
	});

	it("ignores valid results with unknown request IDs", async () => {
		const { channel, runtime } = openRuntime();
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		const operation = runtime.client.data.invokeOperation({
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
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await delay();
		channel.port2.postMessage = () => {
			throw new Error("channel closed");
		};
		const operation = runtime.client.data.invokeOperation({
			input: {},
			slug: "greet",
			output: Schema.Unknown,
		});

		await expect(operation).rejects.toMatchObject({ reason: "transport" });
		await expect(
			runtime.client.data.invokeOperation({ input: {}, slug: "late", output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "transport" });
	});
});
