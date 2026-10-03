import { useRyotQuery, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useState } from "react";

type Page<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
};

export type PagedInput<Input> = Input & { readonly after: string | undefined };

export const useCursorPages = <Input, Item extends { readonly id: string }>(
	query: RyotQuery<PagedInput<Input>, Page<Item>>,
	input: Input,
) => {
	const key = JSON.stringify(input);
	const [paging, setPaging] = useState<{
		readonly key: string;
		readonly cursors: readonly string[];
	}>({ key, cursors: [] });
	const cursors = paging.key === key ? paging.cursors : [];
	const after = cursors.at(-1);
	const result = useRyotQuery(query, { ...input, after });
	const [loaded, setLoaded] = useState<{
		readonly items: readonly Item[];
		readonly page: Page<Item> | undefined;
	}>({ items: [], page: undefined });
	if (result.data !== undefined && result.data !== loaded.page) {
		setLoaded({
			page: result.data,
			items:
				after === undefined
					? result.data.items
					: [
							...new Map(
								[...loaded.items, ...result.data.items].map((item) => [item.id, item]),
							).values(),
						],
		});
	}
	const nextCursor = result.data?.pageInfo.nextCursor;
	const hasMore = result.data?.pageInfo.hasMore === true;
	const next =
		hasMore && nextCursor !== null && nextCursor !== undefined && !cursors.includes(nextCursor)
			? nextCursor
			: undefined;
	return {
		...result,
		hasMore,
		items: loaded.items,
		invalidCursor: hasMore && next === undefined,
		showMore: () => {
			if (next !== undefined) {
				setPaging({ key, cursors: [...cursors, next] });
			}
		},
	};
};
