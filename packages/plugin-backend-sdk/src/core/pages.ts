import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

/** Where a page of a cursor-paged read ends: whether more follow, and the cursor to the next. */
export type PageInfo = { readonly hasMore: boolean; readonly nextCursor: null | string };

export class PaginationError extends Schema.TaggedError<
	PaginationError,
	{ readonly brand: unique symbol }
>()("PaginationError", { message: Schema.String }) {}

/** The cursor to read the page after `pageInfo`'s, or undefined after the last page. */
export const continuationCursor = Effect.fnUntraced(function* (
	pageInfo: PageInfo,
	previous?: string,
) {
	if (!pageInfo.hasMore) {
		return undefined;
	}
	const cursor = pageInfo.nextCursor;
	if (cursor === null || cursor === "" || cursor === previous) {
		return yield* new PaginationError({ message: "Pagination did not advance" });
	}
	return cursor;
});

/** Every item of a cursor-paged read: `loadPage` reads the page after a cursor, or the first. */
export const readAllPages = <Item, Error, Requirements>(
	loadPage: (
		after: string | undefined,
	) => Effect.Effect<
		{ readonly pageInfo: PageInfo; readonly items: ReadonlyArray<Item> },
		Error,
		Requirements
	>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		do {
			const page = yield* loadPage(after);
			items.push(...page.items);
			after = yield* continuationCursor(page.pageInfo).pipe(Effect.orDie);
			if (after !== undefined) {
				if (cursors.has(after)) {
					return yield* Effect.die("Pagination did not advance");
				}
				cursors.add(after);
			}
		} while (after !== undefined);
		return items;
	});
