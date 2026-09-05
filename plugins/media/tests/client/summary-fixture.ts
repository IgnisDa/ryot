import { Result } from "@ryot-app/client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import { rowsResult } from "./query-result-fixture";

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

export const decodeMediaSummaryResult = <Data>(
	recipe: PreparedRecipe<Data>,
	input: {
		readonly summary: readonly Record<string, unknown>[];
		readonly requested: readonly Record<string, unknown>[];
	},
) =>
	Result.getOrThrow(
		recipe.decode({
			data: { summary: singleRow(input.summary), requested: singleRow(input.requested) },
		}),
	);
