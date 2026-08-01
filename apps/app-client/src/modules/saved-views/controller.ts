import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { withSavedViewCursor } from "./atom-requests";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	appendSavedViewPage,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
} from "./state";

type SavedViewOperationToken = {
	readonly identity: string;
	readonly generation: number;
	readonly layout: SavedViewLayout;
};

export const isSavedViewOperationCurrent = (
	token: SavedViewOperationToken,
	current: SavedViewOperationToken,
) =>
	token.identity === current.identity &&
	token.layout === current.layout &&
	token.generation === current.generation;

export const fetchSavedViewReplacement = (input: {
	readonly pagesToLoad: number;
	readonly queryDocument: RyotQLDocument;
	readonly execute: (queryDocument: RyotQLDocument) => Effect.Effect<unknown, unknown>;
	readonly decode: (response: unknown) => Effect.Effect<SavedViewReadyState, unknown>;
}) =>
	Effect.gen(function* () {
		let queryDocument = input.queryDocument;
		let replacement: SavedViewNormalizedState = { itemsById: new Map(), pages: [] };
		for (let index = 0; index < input.pagesToLoad; index += 1) {
			const response = yield* input.execute(queryDocument);
			const decoded = yield* input.decode(response);
			replacement = appendSavedViewPage(
				replacement,
				{ queryDocument, entityIds: decoded.entityIds, pageInfo: decoded.data.pageInfo },
				decoded.data.items,
			);
			const cursor = decoded.data.pageInfo.nextCursor;
			if (!decoded.data.pageInfo.hasMore || !cursor) {
				break;
			}
			queryDocument = withSavedViewCursor(input.queryDocument, cursor);
		}
		return replacement;
	});
