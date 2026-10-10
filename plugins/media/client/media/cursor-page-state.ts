import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type MediaCursorPage<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly nextCursor: string | null };
};

export type MediaCursorPageState<Item> = MappedRyotQueryState<{
	readonly status: "ready";
	readonly items: readonly Item[];
	readonly nextCursor: string | null;
}>;

export type MediaCursorPageFailure = Pick<
	Extract<MediaCursorPageState<never>, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapMediaCursorPage = <Item>(
	result: RyotQueryResult<MediaCursorPage<Item>>,
): MediaCursorPageState<Item> => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return { status: "ready", items: state.value.items, nextCursor: state.value.pageInfo.nextCursor };
};

export const mediaCursorPageError = (input: {
	readonly noun: string;
	readonly state: MediaCursorPageFailure;
}) => ({
	title: `Unable to load these ${input.noun}`,
	detail:
		input.state.status === "transport-error"
			? `These ${input.noun} could not be loaded. Check your connection and try again.`
			: `These ${input.noun} came back in a form that could not be displayed. Try again later.`,
});
