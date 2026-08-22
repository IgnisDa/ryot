import type { PluginBridgeOperationResult } from "@ryot/contract/modules/plugins/client";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginOperationBridge, PluginOperationError } from "./operations";
import { bindOperationBridge, ryot } from "./ryot";

const Greeting = Schema.Struct({ greeting: Schema.String });

let channels: MessageChannel[] = [];

const openChannel = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	channels.push(channel);

	const bridge = createPluginOperationBridge(channel.port2);
	channel.port2.start();

	const reply = (result: PluginBridgeOperationResult) => channel.port1.postMessage(result);

	return { bridge, messages, reply };
};

afterEach(() => {
	for (const { port1, port2 } of channels) {
		port1.close();
		port2.close();
	}
	channels = [];
});

describe("createPluginOperationBridge", () => {
	it("posts the expected operation-request message shape", async () => {
		const { bridge, messages } = openChannel();

		void bridge.invoke({ slug: "greet", input: { name: "Ada" }, output: Greeting });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(messages).toEqual([
			{
				operationSlug: "greet",
				input: { name: "Ada" },
				requestId: "operation-1",
				type: "operation-request",
			},
		]);
	});

	it("settles two concurrent calls out of order with their own decoded value", async () => {
		const { bridge, reply } = openChannel();

		const first = bridge.invoke({ slug: "greet", input: { name: "Ada" }, output: Greeting });
		const second = bridge.invoke({ slug: "greet", input: { name: "Bo" }, output: Greeting });

		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-2",
			value: { greeting: "Hi Bo" },
		});
		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
			value: { greeting: "Hi Ada" },
		});

		await expect(first).resolves.toEqual({ greeting: "Hi Ada" });
		await expect(second).resolves.toEqual({ greeting: "Hi Bo" });
	});

	it("settles a duplicated result once and ignores the second delivery", async () => {
		const { bridge, reply } = openChannel();

		const call = bridge.invoke({ slug: "greet", input: {}, output: Greeting });
		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
			value: { greeting: "Hi" },
		});
		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
			value: { greeting: "Bye" },
		});

		await expect(call).resolves.toEqual({ greeting: "Hi" });
	});

	it("rejects with a PluginOperationError for an operation-failed outcome", async () => {
		const { bridge, reply } = openChannel();

		const call = bridge.invoke({ slug: "greet", input: {}, output: Greeting });
		reply({
			outcome: "failure",
			type: "operation-result",
			requestId: "operation-1",
			reason: "operation-failed",
		});

		await expect(call).rejects.toMatchObject({ reason: "operation-failed" });
		await expect(call).rejects.toBeInstanceOf(PluginOperationError);
	});

	it("rejects with a PluginOperationError for a transport outcome", async () => {
		const { bridge, reply } = openChannel();

		const call = bridge.invoke({ slug: "greet", input: {}, output: Greeting });
		reply({
			outcome: "failure",
			reason: "transport",
			type: "operation-result",
			requestId: "operation-1",
		});

		await expect(call).rejects.toMatchObject({ reason: "transport" });
	});

	it("rejects with malformed-result when the success value fails the output codec", async () => {
		const { bridge, reply } = openChannel();

		const call = bridge.invoke({ slug: "greet", input: {}, output: Greeting });
		reply({
			outcome: "success",
			value: { greeting: 42 },
			type: "operation-result",
			requestId: "operation-1",
		});

		await expect(call).rejects.toMatchObject({ reason: "malformed-result" });
	});

	it("ignores a result message that fails to decode and does not settle the pending call", async () => {
		const { bridge } = openChannel();

		const call = bridge.invoke({ slug: "greet", input: {}, output: Greeting });
		let settled = false;
		call.then(
			() => (settled = true),
			() => (settled = true),
		);

		channels[0]?.port1.postMessage({ type: "operation-result", requestId: "operation-1" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(settled).toBe(false);
	});

	it("rejects an input that cannot cross the port without retaining the request", async () => {
		const { bridge, messages, reply } = openChannel();

		const rejected = bridge.invoke({
			slug: "greet",
			output: Greeting,
			input: { callback: () => "not structured-cloneable" },
		});

		await expect(rejected).rejects.toBeInstanceOf(PluginOperationError);
		await expect(rejected).rejects.toMatchObject({ reason: "transport" });
		expect(messages).toEqual([]);

		const reused = bridge.invoke({ slug: "greet", input: { name: "Ada" }, output: Greeting });
		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-2",
			value: { greeting: "Hello, Ada" },
		});

		await expect(reused).resolves.toEqual({ greeting: "Hello, Ada" });
	});
});

describe("ryot.data.invokeOperation", () => {
	it("delegates to the bound bridge once bootstrap binds one", async () => {
		const { bridge, reply } = openChannel();
		bindOperationBridge(bridge);

		const call = ryot.data.invokeOperation({ slug: "greet", input: {}, output: Greeting });
		reply({
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
			value: { greeting: "Hi" },
		});

		await expect(call).resolves.toEqual({ greeting: "Hi" });
	});
});
