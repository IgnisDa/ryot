import type {
	PluginBridgeOperationResult,
	PluginBridgeRyotQLResult,
} from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginOperationBridge } from "./operations";
import { createPluginQueryBridge } from "./queries";

let channels: MessageChannel[] = [];

const openChannel = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	channel.port2.start();
	channels.push(channel);
	return { channel, messages };
};

afterEach(() => {
	for (const channel of channels) {
		channel.port1.close();
		channel.port2.close();
	}
	channels = [];
});

describe("plugin data bridges", () => {
	it("preserves operation request, success, and failure semantics", async () => {
		const { channel, messages } = openChannel();
		const invoke = createPluginOperationBridge(channel.port2);
		const success = invoke({ slug: "greet", input: { name: "Ada" } });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(messages).toEqual([
			{
				operationSlug: "greet",
				input: { name: "Ada" },
				requestId: "operation-1",
				type: "operation-request",
			},
		]);
		channel.port1.postMessage({
			value: { greeting: "Hi" },
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		} satisfies PluginBridgeOperationResult);
		await expect(success).resolves.toEqual({ greeting: "Hi" });

		const failure = invoke({ slug: "greet", input: {} });
		channel.port1.postMessage({
			outcome: "failure",
			reason: "operation-failed",
			type: "operation-result",
			requestId: "operation-2",
		} satisfies PluginBridgeOperationResult);
		await expect(failure).rejects.toMatchObject({ reason: "operation-failed" });
	});

	it("uses strict V2 query messages and returns the response", async () => {
		const { channel, messages } = openChannel();
		const query = createPluginQueryBridge(channel.port2);
		const document = { queries: {}, output: {} } as PreparedRecipe<unknown>["document"];
		const result = query(document);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(messages).toEqual([{ document, requestId: "ryotql-1", type: "ryotql-request" }]);
		channel.port1.postMessage({
			response: { data: {} },
			outcome: "success",
			type: "ryotql-result",
			requestId: "ryotql-1",
		} satisfies PluginBridgeRyotQLResult);
		await expect(result).resolves.toEqual({ data: {} });
	});
});
