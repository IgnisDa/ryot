import { Effect } from "effect";

import { RyotClientError } from "../client/errors";

export const readCursorPages = <A>(
	read: (
		after: string | undefined,
	) => Effect.Effect<
		{
			readonly items: readonly A[];
			readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
		},
		RyotClientError
	>,
	options: { readonly maxPages?: number } = {},
) =>
	Effect.gen(function* () {
		const items: A[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		for (let pages = 0; options.maxPages === undefined || pages < options.maxPages; pages += 1) {
			const page = yield* read(after);
			items.push(...page.items);
			if (!page.pageInfo.hasMore) {
				return { items, hasMore: false };
			}
			const next = page.pageInfo.nextCursor;
			if (next === null || next === "" || cursors.has(next)) {
				return yield* new RyotClientError("malformed-result");
			}
			cursors.add(next);
			after = next;
		}
		return { items, hasMore: true };
	});
