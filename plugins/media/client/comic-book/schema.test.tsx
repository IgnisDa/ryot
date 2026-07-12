import { afterEach, describe, expect, it } from "vitest";

import { comicBookRecipes } from "../../shared/comic-book-recipes";
import { decodeFlatActivity } from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatGroupRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { comicBookPresentationFacts, comicBookSchema, comicBookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const comicBookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(comicBookRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		pages: 32,
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("comic book schema", () => {
	it("lists the pages and drops them when unrecorded", () => {
		expect(comicBookSummaryFacts(comicBookSummary())).toEqual([
			{ value: "32", label: "Pages", icon: "book-open" },
		]);
		expect(comicBookSummaryFacts(comicBookSummary({ pages: null }))).toEqual([]);
	});

	it("reads the page count on rows, hints how much was read and draws poster art", () => {
		const data = decodeFlatPresentation(comicBookRecipes, { pages: 32, schemaSlug: "comic-book" });

		expect(comicBookPresentationFacts({ ...data, pages: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<comicBookSchema.RowContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("32 pages");
		expect(container.textContent).toContain("42% read");
		expect(container.querySelector("article > a > *")?.className).toContain("h-20 w-14");
		unmount();
	});

	it("totals pages read and marks the total as a floor when a read comic book has no page count", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<comicBookSchema.Activity
				compact
				refresh={() => undefined}
				state={comicBookSchema.mapActivity(
					readyQueryResult(
						decodeFlatActivity({ completionCount: 2, consumedAmount: 640, unknownAmountCount: 1 }),
					),
				)}
			/>,
		);
		expect(container.textContent).toContain("Pages");
		expect(container.textContent).toContain("640+");
		expect(container.textContent).toContain("Finished the comic book");
		unmount();
	});

	it("titles the credits as writers and artists and the group as a series", () => {
		const { unmount, container } = renderMediaScreenBody(
			comicBookSchema,
			comicBookSummary(),
			decodeFlatOverview(comicBookRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
		);

		expect(container.textContent).toContain("Writers & artists");
		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View series");
		unmount();
	});
});
