import type { MappedRyotQueryState } from "./query-state";

export type MediaCursorPageFailure = Pick<
	Extract<MappedRyotQueryState<never>, { status: "malformed" | "transport-error" }>,
	"status"
>;

export type MediaCursorPage<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly hasMore?: boolean; readonly nextCursor: null | string };
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
