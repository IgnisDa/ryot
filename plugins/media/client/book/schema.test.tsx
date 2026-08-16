import { afterEach, describe, expect, it } from "vitest";

import {
	bookOverviewRecipe,
	bookPresentationRecipe,
	bookSummaryRecipe,
} from "../../shared/book-recipes";
import { decodeFlatActivity } from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatGroupRow,
	flatPersonRow,
} from "../../tests/client/flat-media/overview-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { bookPresentationFacts, bookSchema, bookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const UNLINKED_CREATORS = [
	{ role: "Author", name: "Ann Author" },
	{ name: "Pan Press", role: "Publisher" },
];

const bookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(bookSummaryRecipe(FLAT_SUMMARY_INPUT), {
		pages: 320,
		isCompilation: false,
		...overrides,
	});

const bookOverview = (
	input: Parameters<typeof decodeFlatOverview>[1] = {},
	unlinkedCreators: readonly Record<string, unknown>[] | null = UNLINKED_CREATORS,
) =>
	decodeFlatOverview(bookOverviewRecipe(FLAT_OVERVIEW_INPUT), {
		...input,
		extra: {
			creators: rowsResult([{ unlinkedCreators }], { limit: 1, hasMore: false, nextCursor: null }),
		},
	});

const renderBody = (overview = bookOverview()) =>
	mountRyotClient(
		noopAdapter,
		<bookSchema.ScreenBody
			compact
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: bookSummary() }}
			overview={mapMediaOverview(readyQueryResult(overview))}
		/>,
	);

const presentationData = () => {
	const decoded = bookPresentationRecipe(["media-1"]).decode({
		data: {
			rows: rowsResult(
				[
					{
						pages: 320,
						images: null,
						id: "media-1",
						publishDate: null,
						publishYear: 2014,
						schemaSlug: "book",
						progressPercent: 42,
						name: "The Martian",
						state: "in_progress",
						productionStatus: null,
						populationStatus: "ready",
						translationStatus: "none",
					},
				],
				{ limit: 100, hasMore: false, nextCursor: null },
			),
		},
	});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("book schema", () => {
	it("lists the pages and compilation facts and drops the unrecorded ones", () => {
		expect(bookSummaryFacts(bookSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ value: "320", label: "Pages", icon: "book-open" },
			{ value: "No", icon: "layers", label: "Compilation" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(bookSummaryFacts(bookSummary({ isCompilation: true }))).toContainEqual({
			value: "Yes",
			icon: "layers",
			label: "Compilation",
		});
		expect(
			bookSummaryFacts(
				bookSummary({
					pages: null,
					isCompilation: null,
					providerRating: null,
					productionStatus: null,
				}),
			),
		).toEqual([]);
	});

	it("reads the page count on rows, hints how much was read and draws poster art", () => {
		const data = presentationData();

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

	it("lists unlinked authors in the people rail and unlinked publishers with the companies", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Authors & contributors");
		expect(container.textContent).toContain("Publishers");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).toContain("Ann Author");
		expect(container.textContent).toContain("Pan Press");
		expect(container.querySelector('[aria-label="Open Ann Author"]')).toBeNull();
		expect(container.querySelector('[aria-label="Open Pan Press"]')).toBeNull();
		const sections = Array.from(container.querySelectorAll("section"));
		expect(
			sections.find((section) => section.textContent.includes("Authors & contributors"))
				?.textContent,
		).toContain("Ann Author");
		expect(
			sections.find((section) => section.textContent.startsWith("Publishers"))?.textContent,
		).toContain("Pan Press");
		unmount();
	});

	it("keeps an overview holding only unlinked creators", () => {
		const onlyUnlinked = bookOverview({
			group: [],
			people: [],
			companies: [],
			recommendations: [],
		});

		expect(bookSchema.overviewIsEmpty(onlyUnlinked)).toBe(false);
		expect(
			bookSchema.overviewIsEmpty(
				bookOverview({ group: [], people: [], companies: [], recommendations: [] }, null),
			),
		).toBe(true);
		const { unmount, container } = renderBody(onlyUnlinked);
		expect(container.textContent).toContain("Ann Author");
		unmount();
	});

	it("presents the group as the series the book is part of", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View series");
		unmount();
	});
});
