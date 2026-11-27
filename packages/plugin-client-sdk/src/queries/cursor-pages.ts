import type { RowsPageInfo } from "@ryot-app/contract/modules/ryotql/language";
import { Effect } from "effect";

import { RyotClientError } from "../client/errors";
import { validateCursorPage } from "./pagination";

export const readCursorPages = <A, E>(
	read: (
		after: string | undefined,
	) => Effect.Effect<
		{
			readonly items: readonly A[];
			readonly pageInfo: Partial<typeof RowsPageInfo.Type> &
				Pick<typeof RowsPageInfo.Type, "hasMore" | "nextCursor">;
		},
		E
	>,
	options: { readonly maxPages?: number } = {},
) =>
	Effect.gen(function* () {
		const items: A[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		let first: undefined | Parameters<typeof validateCursorPage>[0];
		for (let pages = 0; options.maxPages === undefined || pages < options.maxPages; pages += 1) {
			const page = yield* read(after);
			yield* Effect.try({
				try: () => validateCursorPage(page, first),
				catch: () => new RyotClientError({ reason: "malformed-result" }),
			});
			first ??= page;
			items.push(...page.items);
			if (!page.pageInfo.hasMore) {
				return { items, hasMore: false };
			}
			const next = page.pageInfo.nextCursor;
			if (next === null || next === "" || cursors.has(next)) {
				return yield* new RyotClientError({ reason: "malformed-result" });
			}
			cursors.add(next);
			after = next;
		}
		return { items, hasMore: true };
	});
