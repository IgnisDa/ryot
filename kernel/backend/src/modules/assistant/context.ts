import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";

import { defaultResultByteBudget } from "#platform/tool-result";

export const assistantMaxRounds = 12;
export const assistantContextByteBudget = defaultResultByteBudget * 8;

// A tool-call message and all its results enter or leave model context together.
export const assistantContext = <M extends Pick<AssistantMessage, "role" | "parts">>(
	messages: readonly M[],
	byteBudget = assistantContextByteBudget,
	fits: (messages: readonly M[]) => boolean = () => true,
): readonly M[] => {
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
	if (pending.size > 0) {
		groups.pop();
	}
	let size = 0;
	const selected: M[][] = [];
	for (const group of groups.toReversed()) {
		const bytes = new TextEncoder().encode(JSON.stringify(group)).byteLength;
		if (size + bytes > byteBudget || !fits([...group, ...selected.flat()])) {
			break;
		}
		size += bytes;
		selected.unshift(group);
	}
	return selected.flat();
};
