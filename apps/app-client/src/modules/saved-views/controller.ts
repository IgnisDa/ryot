import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";

import { withSavedViewCursor } from "./atom-requests";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	appendSavedViewPage,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
} from "./state";

type SavedViewOperationToken = {
	readonly layout: SavedViewLayout;
	readonly identity: string;
	readonly generation: number;
};

export const isSavedViewOperationCurrent = (
	token: SavedViewOperationToken,
	current: SavedViewOperationToken,
) =>
	token.identity === current.identity &&
	token.layout === current.layout &&
	token.generation === current.generation;

export const fetchSavedViewReplacement = async (input: {
	readonly signal: AbortSignal;
	readonly pagesToLoad: number;
	readonly queryDocument: RyotQLDocument;
	readonly execute: (queryDocument: RyotQLDocument, signal: AbortSignal) => Promise<unknown>;
	readonly decode: (response: unknown) => SavedViewReadyState;
}): Promise<SavedViewNormalizedState> => {
	const loadPage = async (
		index: number,
		queryDocument: RyotQLDocument,
		replacement: SavedViewNormalizedState,
	): Promise<SavedViewNormalizedState> => {
		if (index === input.pagesToLoad) {
			return replacement;
		}
		const decoded = input.decode(await input.execute(queryDocument, input.signal));
		const nextReplacement = appendSavedViewPage(
			replacement,
			{ queryDocument, entityIds: decoded.entityIds, pageInfo: decoded.data.pageInfo },
			decoded.data.items,
		);
		const cursor = decoded.data.pageInfo.nextCursor;
		if (!decoded.data.pageInfo.hasMore || !cursor) {
			return nextReplacement;
		}
		return loadPage(index + 1, withSavedViewCursor(input.queryDocument, cursor), nextReplacement);
	};

	return loadPage(0, input.queryDocument, { itemsById: new Map(), pages: [] });
};
