import { describe, expect, it } from "bun:test";

import type {
	AssistantMessagePart,
	AssistantToolCall,
} from "@ryot-app/contract/modules/assistant/schemas";
import {
	AssistantMessageId,
	AssistantToolCallId,
	AssistantTurnId,
} from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";

import {
	type AssistantCallRecord,
	type AssistantTurnRecord,
	projectAssistantTurn,
} from "./assistant";

const turnId = AssistantTurnId.make("turn");
const pageInfo = { limit: 400, hasMore: false };
const ok = (value: JsonValue): AgentToolResult => ({ value, truncated: false });
const tool = (
	id: string,
	name: "search" | "execute" | "page_write" | "page_publish",
	requiresApproval = false,
): AssistantToolCall => ({
	tool: name,
	kind: "tool",
	requiresApproval,
	arguments: { id },
	modelCallId: `model-${id}`,
	id: AssistantToolCallId.make(id),
});
const record = (
	call: AssistantToolCall,
	result: null | AgentToolResult,
	decision: AssistantCallRecord["decision"] = null,
): AssistantCallRecord => ({ call, result, turnId, decision, revision: 1, id: call.id });
const message = (
	id: string,
	role: "user" | "tool" | "assistant",
	parts: readonly AssistantMessagePart[],
) => ({ role, parts, sequence: 0, id: AssistantMessageId.make(id) });
const turn = (
	status: AssistantTurnRecord["status"],
	messages: AssistantTurnRecord["messages"]["items"],
	calls: readonly AssistantCallRecord[],
): AssistantTurnRecord => ({
	status,
	round: 1,
	id: turnId,
	revision: 1,
	failure: null,
	completedAt: null,
	requestId: "request",
	text: "Delete my old page",
	calls: { pageInfo, items: calls },
	createdAt: "2026-11-13T10:00:00.000Z",
	messages: { pageInfo, items: messages },
});

describe("projectAssistantTurn", () => {
	it("groups consecutive steps, orders replies, and places writes after the step that requested them", () => {
		const search = tool("search", "search");
		const execute = tool("execute", "execute");
		const write = {
			hostCallIndex: 0,
			parentId: execute.id,
			requiresApproval: true,
			kind: "capability" as const,
			arguments: { pageId: "page" },
			id: AssistantToolCallId.make("execute:write:0"),
			capability: {
				title: "Delete page",
				input: { type: "object" },
				output: { type: "object" },
				source: { kind: "kernel" as const },
				description: "Delete an owned page",
				id: CapabilityId.make("kernel:pages.delete"),
				hints: { readOnly: false, idempotent: false, destructive: true },
			},
		};
		const projected = projectAssistantTurn(
			turn(
				"awaiting-approval",
				[
					message("prompt", "user", [{ kind: "text", text: "Delete my old page" }]),
					message("round-1", "assistant", [
						{ kind: "text", text: "Looking for the page." },
						{ kind: "reasoning", field: "reasoning", text: "Find pages first" },
						{ call: search, kind: "tool-call" },
					]),
					message("result-1", "tool", [
						{ kind: "tool-result", toolCallId: search.id, result: ok({ items: [] }) },
					]),
					message("round-2-text", "assistant", [{ text: "  ", kind: "text" }]),
					message("round-2", "assistant", [{ call: execute, kind: "tool-call" }]),
				],
				[record(search, ok({ items: [] })), record(execute, null), record(write, null)],
			),
		);
		expect(projected.prompt).toBe("Delete my old page");
		expect(projected.entries.map((entry) => entry.kind)).toEqual(["reply", "steps", "approval"]);
		const [, steps, approval] = projected.entries;
		expect(steps).toMatchObject({
			kind: "steps",
			steps: [
				{ kind: "reasoning", text: "Find pages first" },
				{ kind: "tool", tool: "search", status: "done" },
				{ kind: "tool", tool: "execute", status: "running" },
			],
		});
		expect(approval).toMatchObject({ state: "pending", call: { id: write.id } });
	});

	it("derives step and approval outcomes from results, decisions and the turn status", () => {
		const failed = tool("failed", "search");
		const declined = tool("declined", "page_publish", true);
		const unfinished = tool("unfinished", "search");
		const publish = tool("publish", "page_publish", true);
		const projected = projectAssistantTurn(
			turn(
				"interrupted",
				[
					message("round", "assistant", [
						{ call: failed, kind: "tool-call" },
						{ call: declined, kind: "tool-call" },
						{ call: unfinished, kind: "tool-call" },
						{ call: publish, kind: "tool-call" },
					]),
					message("preview", "tool", [
						{
							pageId: "page",
							draftRevision: 2,
							kind: "page-preview",
							artifactHash: "artifact",
							definitionHash: "definition",
						},
					]),
				],
				[
					record(failed, ok({ error: "tool-failed" })),
					record(declined, ok({ declined: true }), "decline"),
					record(unfinished, ok({ interrupted: true })),
					record(publish, null),
				],
			),
		);
		expect(projected.entries).toMatchObject([
			{ kind: "steps", steps: [{ status: "failed" }] },
			{ kind: "approval", state: "declined" },
			{ kind: "steps", steps: [{ status: "interrupted" }] },
			{ kind: "approval", state: "expired" },
			{
				kind: "page-preview",
				identity: {
					pageId: "page",
					draftRevision: 2,
					artifactHash: "artifact",
					definitionHash: "definition",
				},
			},
		]);
	});

	it("marks turns whose messages or calls exceed one page as partial", () => {
		const projected = projectAssistantTurn({
			...turn("completed", [], []),
			calls: { items: [], pageInfo: { limit: 400, hasMore: true } },
		});
		expect(projected.partial).toBe(true);
		expect(projected.entries).toEqual([]);
	});
});
