import { describe } from "vitest";

import { episodicEpisodeRow } from "../../tests/client/episodic/episodes-fixture";
import { episodicFixtureSchema } from "../../tests/client/episodic/schema-fixture";
import { declaresEntityInterest } from "../../tests/client/interest-fixture";
import { podcastSummaryRow } from "../../tests/client/podcast/fixtures";
import { rowsResult } from "../../tests/client/query-result-fixture";

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const summaryResponse = (nextUp: readonly unknown[]) => ({
	data: {
		requested: rows([{ schemaSlug: "podcast" }]),
		summary: rows([
			{
				...podcastSummaryRow,
				id: "media-1",
				nextUp: { items: nextUp, pageInfo: { limit: 1, hasMore: false } },
				collections: {
					pageInfo: { limit: 6, hasMore: false },
					items: [{ id: "collection-1", name: "Favourites" }],
				},
			},
		]),
	},
});

const declaresInterest = declaresEntityInterest("media-1");

describe("episodic media query entity interest", () => {
	declaresInterest(
		"summary with a next-up episode",
		episodicFixtureSchema.summaryQuery,
		summaryResponse([episodicEpisodeRow]),
		["collection-1", episodicEpisodeRow.id],
	);
	declaresInterest(
		"summary without a next-up episode",
		episodicFixtureSchema.summaryQuery,
		summaryResponse([]),
		["collection-1"],
	);
});
