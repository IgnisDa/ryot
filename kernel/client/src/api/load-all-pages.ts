import { Data, Effect } from "effect";

export class MissingNextCursorError extends Data.TaggedError("MissingNextCursorError") {}

type Page<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
};

export const loadAllPages = Effect.fn("loadAllPages")(function* <Item, Error, Requirements>(
	fetchPage: (after: string | undefined) => Effect.Effect<Page<Item>, Error, Requirements>,
) {
	const items: Item[] = [];
	let after: string | undefined;
	let hasMore: boolean;
	do {
		const page = yield* fetchPage(after);
		items.push(...page.items);
		hasMore = page.pageInfo.hasMore;
		if (hasMore && page.pageInfo.nextCursor === null) {
			return yield* new MissingNextCursorError();
		}
		after = page.pageInfo.nextCursor ?? undefined;
	} while (hasMore);
	return items;
});
