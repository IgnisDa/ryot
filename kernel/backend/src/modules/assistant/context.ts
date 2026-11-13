import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";

import { defaultResultByteBudget } from "#platform/tool-result";

export const assistantMaxRounds = 12;
export const assistantContextByteBudget = defaultResultByteBudget * 4;

export const assistantTurnHistory = <
	M extends { readonly turnId: string } & Pick<AssistantMessage, "role" | "parts">,
>(
	messages: readonly M[],
	turnId: string,
): readonly M[] =>
	messages.flatMap((message) => {
		if (message.turnId === turnId) {
			return [message];
		}
		const parts = message.parts.filter((part) => part.kind === "text");
		return message.role === "tool" || parts.length === 0 ? [] : [{ ...message, parts }];
	});

// A tool-call message and all its results enter or leave model context together.
export const assistantContext = <M extends Pick<AssistantMessage, "role" | "parts">>(
	messages: readonly M[],
	byteBudget = assistantContextByteBudget,
	fits: (messages: readonly M[]) => boolean = () => true,
	pinned: (message: M) => boolean = () => false,
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
	const bytes = (group: readonly M[]) => new TextEncoder().encode(JSON.stringify(group)).byteLength;
	const kept = new Set(groups.filter((group) => group.some(pinned)));
	let size = [...kept].reduce((total, group) => total + bytes(group), 0);
	for (const group of groups.toReversed()) {
		if (kept.has(group)) {
			continue;
		}
		const groupBytes = bytes(group);
		const candidate = groups.filter((other) => other === group || kept.has(other)).flat();
		if (size + groupBytes > byteBudget || !fits(candidate)) {
			break;
		}
		size += groupBytes;
		kept.add(group);
	}
	return groups.filter((group) => kept.has(group)).flat();
};
