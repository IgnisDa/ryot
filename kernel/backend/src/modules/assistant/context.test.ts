import { expect, it } from "bun:test";

import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";
import { agentTools } from "@ryot-app/contract/schema/agent-tool";
import { AssistantToolCallId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";

import { truncateJsonResult } from "#platform/tool-result";

import { assistantContext, assistantContextByteBudget, assistantTurnHistory } from "./context";
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

const toolCallId = AssistantToolCallId.make("call");
const toolExchange = (turnId: string) =>
	[
		{
			turnId,
			role: "assistant",
			parts: [
				{ kind: "reasoning", field: "reasoning", text: "Look it up." },
				{ kind: "text", text: `Checking for ${turnId}.` },
				{
					kind: "tool-call",
					call: {
						kind: "tool",
						arguments: {},
						id: toolCallId,
						modelCallId: "model",
						requiresApproval: false,
						tool: agentTools.search.name,
					},
				},
			],
		},
		{
			turnId,
			role: "tool",
			parts: [{ toolCallId, kind: "tool-result", result: truncateJsonResult({ found: true }) }],
		},
	] satisfies ({ readonly turnId: string } & Pick<AssistantMessage, "role" | "parts">)[];

it("replays only the visible text of earlier turns", () => {
	const current = toolExchange("current");
	expect(
		assistantTurnHistory(
			[
				{ role: "user", turnId: "earlier", parts: [{ kind: "text", text: "Earlier question" }] },
				...toolExchange("earlier"),
				...current,
			],
			"current",
		),
	).toEqual([
		{ role: "user", turnId: "earlier", parts: [{ kind: "text", text: "Earlier question" }] },
		{
			turnId: "earlier",
			role: "assistant",
			parts: [{ kind: "text", text: "Checking for earlier." }],
		},
		...current,
	]);
});

const textMessage = (
	role: AssistantMessage["role"],
	text: string,
): Pick<AssistantMessage, "role" | "parts"> => ({ role, parts: [{ text, kind: "text" }] });

it("keeps pinned messages when newer groups exhaust the budget", () => {
	const question = textMessage("user", "Question");
	const older = textMessage("assistant", "x".repeat(600));
	const newest = textMessage("assistant", "Newest");
	expect(
		assistantContext(
			[question, older, newest],
			500,
			() => true,
			(candidate) => candidate === question,
		),
	).toEqual([question, newest]);
});
