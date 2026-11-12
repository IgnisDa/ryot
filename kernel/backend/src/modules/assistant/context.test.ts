import { expect, it } from "bun:test";

import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";
import { agentTools } from "@ryot-app/contract/schema/agent-tool";
import { stableStringify } from "@ryot-app/ts-utils/json";

import { assistantContext, assistantContextByteBudget } from "./context";
import { assistantModelRequestByteBudget, assistantProviderPrompt } from "./provider-model";

const requestBytes = (
	messages: readonly Pick<AssistantMessage, "role" | "parts">[],
	tools: readonly unknown[],
) =>
	new TextEncoder().encode(stableStringify([assistantProviderPrompt("system", messages), tools]))
		.byteLength;

it("bounds history by actual request bytes, including tool descriptors", () => {
	const tools = [...Object.values(agentTools), { description: "x".repeat(250_000) }];
	const history = [
		{ role: "user" as const, parts: [{ kind: "text" as const, text: "x".repeat(800_000) }] },
		{ role: "user" as const, parts: [{ kind: "text" as const, text: "x".repeat(16_000) }] },
	];
	expect(requestBytes([], Object.values(agentTools))).toBeLessThan(100_000);
	expect(requestBytes(history, tools)).toBeGreaterThan(assistantModelRequestByteBudget);
	const selected = assistantContext(
		history,
		assistantContextByteBudget,
		(messages) => requestBytes(messages, tools) <= assistantModelRequestByteBudget,
	);
	expect(selected).toEqual(history.slice(-1));
	expect(requestBytes(selected, tools)).toBeLessThanOrEqual(assistantModelRequestByteBudget);
});
