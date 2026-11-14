import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";

type PromptMeasurement = { readonly tokens: number; readonly characters: number };

type ContextMessage = { readonly turnId: string } & Pick<
	AssistantMessage,
	"role" | "parts" | "sequence"
>;

const DEFAULT_CHARACTERS_PER_TOKEN = 3.5;
const RESERVE_SHARE = 0.15;
const RESERVE_MIN = 16_000;
export const ASSISTANT_COMPACTION_KEEP_TOKENS = 15_000;

export const estimateTokens = (characters: number, measurement: null | PromptMeasurement) =>
	Math.ceil(
		measurement === null || measurement.characters === 0
			? characters / DEFAULT_CHARACTERS_PER_TOKEN
			: (characters * measurement.tokens) / measurement.characters,
	);

export const compactionThreshold = (contextWindow: number) =>
	contextWindow - Math.max(Math.round(contextWindow * RESERVE_SHARE), RESERVE_MIN);

const latestCompaction = (messages: readonly ContextMessage[]) => {
	for (const message of messages.toReversed()) {
		for (const part of message.parts) {
			if (part.kind === "compaction") {
				return part;
			}
		}
	}
	return null;
};

/**
 * The model-visible history: the latest compaction summary and every message after the span it summarized. Other
 * turns' reasoning is dropped because providers only replay reasoning within the turn that produced it.
 */
export const activeHistory = <M extends ContextMessage>(messages: readonly M[], turnId: string) => {
	const compaction = latestCompaction(messages);
	const kept = messages.flatMap((message) => {
		if (
			(compaction !== null && message.sequence <= compaction.throughSequence) ||
			message.parts.some((part) => part.kind === "compaction")
		) {
			return [];
		}
		if (message.turnId === turnId) {
			return [message];
		}
		const parts = message.parts.filter((part) => part.kind !== "reasoning");
		return parts.length === 0 ? [] : [{ ...message, parts }];
	});
	return { messages: kept, summary: compaction?.summary ?? null };
};

/** Tool calls and their results stay in one group, so a split never orphans either side. */
export const messageGroups = <M extends Pick<AssistantMessage, "parts">>(
	messages: readonly M[],
) => {
	const groups: M[][] = [];
	const pending = new Set<string>();
	for (const message of messages) {
		if (pending.size === 0) {
			groups.push([]);
		}
		groups.at(-1)?.push(message);
		for (const part of message.parts) {
			if (part.kind === "tool-call") {
				pending.add(part.call.id);
			}
			if (part.kind === "tool-result") {
				pending.delete(part.toolCallId);
			}
		}
	}
	return groups;
};

export const compactionSplit = <M extends ContextMessage>(
	messages: readonly M[],
	tokens: (messages: readonly M[]) => number,
	keepTokens: number,
) => {
	const groups = messageGroups(messages);
	let kept = 0;
	let size = 0;
	for (const group of groups.toReversed()) {
		const groupTokens = tokens(group);
		if (size + groupTokens > keepTokens) {
			break;
		}
		size += groupTokens;
		kept += 1;
	}
	const older = groups.slice(0, groups.length - Math.max(kept, 1));
	return older.length === 0 ? null : older;
};
