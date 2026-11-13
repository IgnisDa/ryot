import type {
	AssistantLocalToolName,
	AssistantToolCall,
} from "@ryot-app/contract/modules/assistant/schemas";
import { agentTools, toAgentJsonSchema } from "@ryot-app/contract/schema/agent-tool";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

import type { AssistantModelTool } from "./provider-model";

/** Tool output kept inline in the conversation; anything larger is stored and previewed. */
export const INLINE_OUTPUT_BYTES = 50 * 1024;
export const INLINE_OUTPUT_LINES = 2_000;
/** Largest result a tool may produce for Ryo before the producer cuts it. */
export const PRODUCER_OUTPUT_BYTES = 8 * 1024 * 1024;
const PREVIEW_HEAD_BYTES = 24 * 1024;
const PREVIEW_TAIL_BYTES = 8 * 1024;
const READ_MAX_MATCHES = 200;

const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

export const ReadResultInput = strictStruct({
	outputId: Schema.NonEmptyString,
	pattern: optional(Schema.NonEmptyString),
	offset: optional(Schema.Int.check(Schema.isGreaterThan(0))),
	limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: INLINE_OUTPUT_LINES }))),
});

export const assistantLocalTools: {
	readonly [Name in AssistantLocalToolName]: AssistantModelTool & { readonly readOnly: boolean };
} = {
	read_result: {
		readOnly: true,
		name: "read_result",
		input: toAgentJsonSchema(ReadResultInput),
		description:
			"Read a tool output that was too large to show in full. Give the outputId from its preview. Without a pattern it returns numbered lines from offset (1-based, default 1), up to limit lines (default and maximum 2000). With a pattern (a case-insensitive regular expression) it returns up to 200 matching numbered lines.",
	},
};

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const cutToBytes = (text: string, budget: number, fromEnd: boolean) => {
	const encoded = new TextEncoder().encode(text);
	if (encoded.byteLength <= budget) {
		return text;
	}
	const slice = fromEnd
		? encoded.subarray(encoded.byteLength - budget)
		: encoded.subarray(0, budget);
	return new TextDecoder().decode(slice).replace(fromEnd ? /^�+/ : /�+$/, "");
};

const resultText = (result: AgentToolResult) => {
	if (result.truncated === false) {
		return typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
	}
	return result.truncated === true ? result.jsonPrefix : null;
};

/** Stores an oversized result under `outputId`, keeping its head and tail inline. */
export const retainToolResult = (result: AgentToolResult, outputId: string) => {
	const text = resultText(result);
	if (text === null) {
		return { result, output: null };
	}
	const lines = text.split("\n").length;
	const size = bytes(text);
	if (size <= INLINE_OUTPUT_BYTES && lines <= INLINE_OUTPUT_LINES) {
		return { result, output: null };
	}
	const head = cutToBytes(
		text
			.split("\n")
			.slice(0, INLINE_OUTPUT_LINES / 2)
			.join("\n"),
		PREVIEW_HEAD_BYTES,
		false,
	);
	const tail = cutToBytes(text.slice(head.length), PREVIEW_TAIL_BYTES, true);
	return {
		output: text,
		result: {
			head,
			tail,
			lines,
			outputId,
			bytes: size,
			truncated: "retained",
			producerLimited: result.truncated === true,
		} as const,
	};
};

/** The model-visible preview; rendered per prompt so the outputId always names the stored row. */
export const retainedPreview = (result: Extract<AgentToolResult, { truncated: "retained" }>) =>
	`${result.head}\n[Output too large to show in full: ${result.lines} lines, ${result.bytes} bytes${result.producerLimited ? ", cut at its producer's limit" : ""}. Showing the first ${result.head.split("\n").length} lines and the end. Read the rest with read_result({ outputId: "${result.outputId}", offset }) or search it with a pattern.]\n${result.tail}`;

const numbered = (lines: readonly string[], start: number) =>
	lines.map((line, index) => `${start + index}: ${line}`).join("\n");

export const readStoredOutput = (
	text: string,
	input: typeof ReadResultInput.Type,
): { readonly [key: string]: number | string } => {
	const lines = text.split("\n");
	if (input.pattern !== undefined && input.pattern !== null) {
		const pattern = new RegExp(input.pattern, "i");
		const matches = lines.flatMap((line, index) =>
			pattern.test(line) ? [`${index + 1}: ${line}`] : [],
		);
		return {
			matches: matches.length,
			totalLines: lines.length,
			text: cutToBytes(matches.slice(0, READ_MAX_MATCHES).join("\n"), INLINE_OUTPUT_BYTES, false),
		};
	}
	const start = input.offset ?? 1;
	const selected = lines.slice(start - 1, start - 1 + (input.limit ?? INLINE_OUTPUT_LINES));
	const shown = cutToBytes(numbered(selected, start), INLINE_OUTPUT_BYTES, false);
	return {
		text: shown,
		startLine: start,
		totalLines: lines.length,
		endLine: start + shown.split("\n").length - 1,
	};
};

const runsConcurrently = (call: AssistantToolCall) => {
	if (call.kind !== "tool" || call.requiresApproval) {
		return false;
	}
	if (call.tool === "read_result") {
		return assistantLocalTools[call.tool].readOnly;
	}
	const tool = agentTools[call.tool];
	return tool.hints.readOnly && tool.approval === "none";
};

/** Consecutive read-only calls run together; any other call runs alone, in the order the model gave. */
export const concurrentBatches = (calls: readonly AssistantToolCall[]) => {
	const batches: AssistantToolCall[][] = [];
	for (const call of calls) {
		const previous = batches.at(-1);
		const first = previous?.[0];
		if (previous && first && runsConcurrently(first) && runsConcurrently(call)) {
			previous.push(call);
		} else {
			batches.push([call]);
		}
	}
	return batches;
};
