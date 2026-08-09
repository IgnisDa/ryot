// oxlint-disable eslint/no-underscore-dangle -- TanStack owns these ParsedHistoryState field names
import type { ParsedLocation } from "@tanstack/react-router";

export const historyEntry = (state: ParsedLocation["state"]) => ({
	index: state.__TSR_index,
	key: state.__TSR_key ?? state.key ?? `i${state.__TSR_index}`,
});
