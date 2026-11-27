import { Effect } from "effect";

export const loadCompleteRows = Effect.fn("loadCompleteRows")(function* <A, E, R>(
	query: (
		after?: string,
	) => Effect.Effect<
		{
			readonly items: readonly A[];
			readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
		},
		E,
		R
	>,
) {
	const items: A[] = [];
	let after: string | undefined;
	for (;;) {
		const page = yield* query(after);
		items.push(...page.items);
		if (!page.pageInfo.hasMore) {
			return items;
		}
		const cursor = page.pageInfo.nextCursor;
		if (cursor === null || cursor === after) {
			return yield* Effect.die(new Error("Complete rows query did not advance its cursor"));
		}
		after = cursor;
	}
});
