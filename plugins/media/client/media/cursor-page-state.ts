import type { MediaGroupMemberUnit, MediaText } from "../messages";
import type { MappedRyotQueryState } from "./query-state";

export type MediaCursorPageFailure = Pick<
	Extract<MappedRyotQueryState<never>, { status: "malformed" | "transport-error" }>,
	"status"
>;

export type MediaCursorPage<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly hasMore?: boolean; readonly nextCursor: null | string };
};

type MediaCursorPageKind = "credits" | "episodes" | "activities" | MediaGroupMemberUnit;

export const mediaCursorPageError = (
	text: MediaText,
	input: { readonly kind: MediaCursorPageKind; readonly state: MediaCursorPageFailure },
) => {
	const { kind } = input;
	return {
		title: text("cursor.error-title", { kind }),
		detail:
			input.state.status === "transport-error"
				? text("cursor.error-transport", { kind })
				: text("cursor.error-malformed", { kind }),
	};
};
