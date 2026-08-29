import { afterEach, describe, expect, it } from "vitest";

import { bookRecipes } from "../../shared/book-recipes";
import { decodeFlatActivity } from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatGroupRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import { renderFlatScreenBody } from "../../tests/client/flat-media/screen-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { bookPresentationFacts, bookSchema, bookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const bookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(bookRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		pages: 320,
		isCompilation: false,
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("book schema", () => {
	it("lists the pages and compilation facts and drops the unrecorded ones", () => {
		expect(bookSummaryFacts(bookSummary())).toEqual([
			{ value: "320", label: "Pages", icon: "book-open" },
			{ value: "No", icon: "layers", label: "Compilation" },
		]);
		expect(bookSummaryFacts(bookSummary({ isCompilation: true }))).toContainEqual({
			value: "Yes",
			icon: "layers",
			label: "Compilation",
		});
		expect(bookSummaryFacts(bookSummary({ pages: null, isCompilation: null }))).toEqual([]);
	});

	it("reads the page count on rows, hints how much was read and draws poster art", () => {
		const data = decodeFlatPresentation(bookRecipes, { pages: 320, schemaSlug: "book" });

		expect(bookPresentationFacts(data)).toEqual(["320 pages"]);
		expect(bookPresentationFacts({ ...data, pages: 1 })).toEqual(["1 page"]);
		expect(bookPresentationFacts({ ...data, pages: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<bookSchema.RowContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("320 pages");
		expect(container.textContent).toContain("42% read");
		expect(container.querySelector("article > a > *")?.className).toContain("h-20 w-14");
		unmount();
	});

	it("totals pages read and marks the total as a floor when a read book has no page count", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<bookSchema.Activity
				compact
				refresh={() => undefined}
				state={bookSchema.mapActivity(
					readyQueryResult(
						decodeFlatActivity({ completionCount: 2, consumedAmount: 640, unknownAmountCount: 1 }),
					),
				)}
			/>,
		);
		expect(container.querySelector('[aria-label="Reading record"]')).not.toBeNull();
		expect(container.textContent).toContain("Reads");
		expect(container.textContent).toContain("Pages");
		expect(container.textContent).toContain("640+");
		expect(container.textContent).not.toContain("Time");
		expect(container.textContent).toContain("Finished the book");
		unmount();
	});

	it("presents the group as the series the book is part of", () => {
		const { unmount, container } = renderFlatScreenBody(
			bookSchema,
			bookSummary(),
			decodeFlatOverview(bookRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
		);

		expect(container.textContent).toContain("Authors & contributors");
		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View series");
		unmount();
	});
});
