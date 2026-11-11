import type { JsonValue } from "@ryot-app/contract/schema/json";

export const defaultResultByteBudget = 65_536;
export const minimumResultByteBudget = 64;

export type AgentToolResult =
	| { readonly truncated: false; readonly value: JsonValue }
	| { readonly truncated: true; readonly jsonPrefix: string };

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export const truncateJsonResult = (
	value: JsonValue,
	byteBudget = defaultResultByteBudget,
): AgentToolResult => {
	if (!Number.isSafeInteger(byteBudget) || byteBudget < minimumResultByteBudget) {
		throw new RangeError(
			`Result byte budget must be an integer of at least ${minimumResultByteBudget}`,
		);
	}
	const complete: AgentToolResult = { value, truncated: false };
	if (byteLength(complete) <= byteBudget) {
		return complete;
	}
	const characters = Array.from(JSON.stringify(value));
	let lower = 0;
	let upper = characters.length;
	while (lower < upper) {
		const middle = Math.ceil((lower + upper) / 2);
		if (
			byteLength({ truncated: true, jsonPrefix: characters.slice(0, middle).join("") }) <=
			byteBudget
		) {
			lower = middle;
		} else {
			upper = middle - 1;
		}
	}
	return { truncated: true, jsonPrefix: characters.slice(0, lower).join("") };
};
