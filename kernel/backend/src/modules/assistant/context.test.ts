import { expect, it } from "bun:test";

import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";
import { agentTools } from "@ryot-app/contract/schema/agent-tool";
import { AssistantToolCallId, AssistantTurnId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";

import { truncateJsonResult } from "#platform/tool-result";

import {
	activeHistory,
	compactionSplit,
	compactionThreshold,
	estimateTokens,
	messageGroups,
} from "./context";

type Message = Pick<AssistantMessage, "role" | "parts" | "turnId" | "sequence">;

let sequence = 0;
const message = (turnId: string, role: Message["role"], parts: Message["parts"]): Message => {
	sequence += 1;
	return { role, parts, sequence, turnId: AssistantTurnId.make(turnId) };
};
const toolExchange = (turnId: string) => {
	const toolCallId = AssistantToolCallId.make(`${turnId}:call`);
	return [
		message(turnId, "assistant", [
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
		]),
		message(turnId, "tool", [
			{ toolCallId, kind: "tool-result", result: truncateJsonResult({ found: true }) },
		]),
	];
};

it("replays every turn's tool traffic but only the current turn's reasoning", () => {
	const earlier = [
		message("earlier", "user", [{ kind: "text", text: "Earlier question" }]),
		...toolExchange("earlier"),
	];
	const current = toolExchange("current");
	const [question, call, result] = earlier;
	assert(question && call && result);
	const history = activeHistory([...earlier, ...current], "current");
	expect(history.summary).toBeNull();
	expect(history.messages).toEqual([
		question,
		{ ...call, parts: call.parts.filter((part) => part.kind !== "reasoning") },
		result,
		...current,
	]);
});

it("starts the model-visible history at the latest compaction summary", () => {
	const older = [
		message("old", "user", [{ kind: "text", text: "Old question" }]),
		...toolExchange("old"),
	];
	const kept = message("old", "assistant", [{ kind: "text", text: "Kept verbatim" }]);
	const first = message("old", "assistant", [
		{ kind: "compaction", summary: "First summary", throughSequence: older[0]?.sequence ?? 0 },
	]);
	const latest = message("current", "assistant", [
		{ kind: "compaction", summary: "Latest summary", throughSequence: older.at(-1)?.sequence ?? 0 },
	]);
	const question = message("current", "user", [{ kind: "text", text: "Next question" }]);
	const history = activeHistory([...older, kept, first, latest, question], "current");
	expect(history.summary).toBe("Latest summary");
	expect(history.messages).toEqual([kept, question]);
});

const tokens = (messages: readonly Message[]) =>
	estimateTokens(JSON.stringify(messages.map(({ parts }) => parts)).length, null);

it("splits older groups for compaction without separating calls from their results", () => {
	const question = message("turn", "user", [{ kind: "text", text: "Question" }]);
	const exchange = toolExchange("turn");
	const answer = message("turn", "assistant", [{ kind: "text", text: "x".repeat(400) }]);
	const history = [question, ...exchange, answer];
	expect(messageGroups(history)).toEqual([[question], exchange, [answer]]);
	expect(compactionSplit(history, tokens, 200)).toEqual([[question], exchange]);
	expect(compactionSplit([answer], tokens, 1)).toBeNull();
});

it("calibrates estimates by the provider's measured tokens per character", () => {
	expect(estimateTokens(700, null)).toBe(200);
	expect(estimateTokens(700, { tokens: 300, characters: 600 })).toBe(350);
	expect(compactionThreshold(496_000)).toBe(421_600);
	expect(compactionThreshold(64_000)).toBe(48_000);
});
