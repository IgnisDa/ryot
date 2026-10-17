import { Data, Effect } from "effect";

class InvalidPageCursorError extends Data.TaggedError("InvalidPageCursorError") {}

type Page<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
};

export const loadAllPages = Effect.fn("loadAllPages")(function* <Item, Error, Requirements>(
	fetchPage: (after: string | undefined) => Effect.Effect<Page<Item>, Error, Requirements>,
) {
	const items: Item[] = [];
	const cursors = new Set<string>();
	let after: string | undefined;
	let hasMore: boolean;
	do {
		const page = yield* fetchPage(after);
		items.push(...page.items);
		hasMore = page.pageInfo.hasMore;
		const next = page.pageInfo.nextCursor;
		if (hasMore && (next === null || next === "" || cursors.has(next))) {
			return yield* new InvalidPageCursorError();
		}
		if (next !== null) {
			cursors.add(next);
		}
		after = next ?? undefined;
	} while (hasMore);
	return items;
});
