import { afterEach, describe, expect, it } from "vitest";

import {
	creatorActivityData,
	creatorCollectionAddedEventRow,
	decodeCreatorActivity,
} from "../../tests/client/creator/activity-fixture";
import {
	creatorAlbumCreditRow,
	creatorMovieCreditRow,
	creatorOverviewData,
	decodeCreatorOverview,
} from "../../tests/client/creator/overview-fixture";
import { creatorFixtureSchema } from "../../tests/client/creator/schema-fixture";
import {
	creatorSummaryRow,
	decodeCreatorSummaryResult,
} from "../../tests/client/creator/summary-fixture";
import { declaresEntityInterest } from "../../tests/client/interest-fixture";
import {
	malformedQueryResult,
	readyQueryResult,
	rowsResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "./overview-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const FILLED_CREDITS = {
	movie: { items: [creatorMovieCreditRow] },
	"music-group": { items: [creatorAlbumCreditRow] },
};

const readyState = (summary: Record<string, unknown> = creatorSummaryRow) =>
	creatorFixtureSchema.mapSummary(readyQueryResult(decodeCreatorSummaryResult([summary])));

const renderBody = (
	overview = decodeCreatorOverview(FILLED_CREDITS),
	state: ReturnType<typeof readyState> = readyState(),
) =>
	mountRyotClient(
		noopAdapter,
		<creatorFixtureSchema.ScreenBody
			compact
			state={state}
			safeAreaTop={0}
			activity={null}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			overview={mapMediaOverview(readyQueryResult(overview))}
		/>,
	);

const renderActivity = (state: Parameters<typeof creatorFixtureSchema.Activity>[0]["state"]) =>
	mountRyotClient(
		noopAdapter,
		<creatorFixtureSchema.Activity compact state={state} refresh={() => undefined} />,
	);

const sectionTitles = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("section h2"))
		.map(({ textContent }) => textContent)
		.filter((title) => title !== "Images");

afterEach(() => {
	document.body.innerHTML = "";
});

describe("creator detail screen", () => {
	it("offers exactly the overview and activity tabs", () => {
		const { unmount, container } = renderBody();

		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map(({ textContent }) => textContent),
		).toEqual(["Overview", "Activity"]);
		unmount();
	});

	it("keeps monitoring, library, collections and reviews on a rail without status or logging", () => {
		const { unmount, container } = renderBody();
		const text = container.textContent;

		expect(text).toContain("Monitoring");
		expect(text).toContain("In library");
		expect(text).toContain("Collections");
		expect(text).toContain("Write review");
		expect(text).not.toContain("Your status");
		expect(text).not.toContain("Ownership");
		expect(text).not.toContain("Log activity");
		unmount();
	});

	it("shows the descriptor's facts and links with the first four aliases and no media framing", () => {
		const { unmount, container } = renderBody();
		const text = container.textContent;

		expect(text).toContain("Fixture fact");
		expect(text).not.toContain("rating");
		expect(text).not.toContain("Production status");
		expect(container.querySelector('a[href="https://creator.test"]')?.textContent).toContain(
			"Website",
		);
		expect(text).toContain("E. Norton");
		expect(text).toContain("Edward H. Norton");
		expect(
			Array.from(container.querySelectorAll("span")).filter(({ textContent }) =>
				creatorSummaryRow.alternateNames.includes(textContent),
			),
		).toHaveLength(4);
		unmount();
	});

	it("draws the header art from the descriptor's artwork purpose", () => {
		const { unmount, container } = renderBody();

		expect(
			container.querySelector('img[src="https://images.test/edward.jpg"]')?.className,
		).toContain("aspect-2/3");
		unmount();
	});
});

describe("creator credit rails", () => {
	it("renders the sections in descriptor order with each section's aspect", () => {
		const { unmount, container } = renderBody();

		expect(sectionTitles(container)).toEqual(["Films", "Records"]);
		expect(
			container.querySelector(`a[href="/e/${creatorMovieCreditRow.id}"] > *`)?.className,
		).toContain("aspect-2/3");
		expect(
			container.querySelector(`a[href="/e/${creatorAlbumCreditRow.id}"] > *`)?.className,
		).toContain("aspect-square");
		unmount();
	});

	it("hides sections without credits", () => {
		const { unmount, container } = renderBody(
			decodeCreatorOverview({ "music-group": { items: [creatorAlbumCreditRow] } }),
		);

		expect(sectionTitles(container)).toEqual(["Records"]);
		unmount();
	});

	it("lines each tile with its roles and the character when credited", () => {
		const { unmount, container } = renderBody();

		const lines = (id: string) =>
			Array.from(container.querySelectorAll(`a[href="/e/${id}"] > p`)).map(
				({ textContent }) => textContent,
			);

		expect(lines(creatorMovieCreditRow.id)).toEqual(["Fight Club", "Actor", "as The Narrator"]);
		expect(lines(creatorAlbumCreditRow.id)).toEqual(["Night Songs", "Artist"]);
		unmount();
	});

	it("offers view all only on a section with more credits", () => {
		const { unmount, container } = renderBody(
			decodeCreatorOverview({
				...FILLED_CREDITS,
				movie: { hasMore: true, items: [creatorMovieCreditRow] },
			}),
		);
		const sections = Array.from(container.querySelectorAll("section"));

		expect(
			sections.find((section) => section.textContent.startsWith("Films"))?.textContent,
		).toContain("View all");
		expect(
			sections.find((section) => section.textContent.startsWith("Records"))?.textContent,
		).not.toContain("View all");
		unmount();
	});

	it("reports the overview empty only when every section is empty", () => {
		expect(creatorFixtureSchema.overviewIsEmpty(decodeCreatorOverview())).toBe(true);
		expect(
			creatorFixtureSchema.overviewIsEmpty(
				decodeCreatorOverview({ "music-group": { items: [creatorAlbumCreditRow] } }),
			),
		).toBe(false);
	});

	it("resolves every credit cover", () => {
		expect(
			creatorFixtureSchema.overviewManagedAssets(decodeCreatorOverview(FILLED_CREDITS)),
		).toEqual([
			{ type: "s3", key: "fight-club" },
			{ type: "s3", key: "night-songs" },
		]);
	});
});

describe("creator activity tab", () => {
	it("counts reviews and spans the recorded activity", () => {
		const { unmount, container } = renderActivity(
			creatorFixtureSchema.mapActivity(readyQueryResult(decodeCreatorActivity())),
		);
		const text = container.textContent;

		expect(text).toContain("Reviews");
		expect(text).toContain("Span");
		expect(text).toContain("Reviewed this creator");
		expect(text).toContain("Added to the Favourites collection");
		expect(container.querySelector('[aria-label="Activity record"]')).not.toBeNull();
		unmount();
	});

	it("shows only the latest date when the activity is truncated", () => {
		const { unmount, container } = renderActivity(
			creatorFixtureSchema.mapActivity(
				readyQueryResult(decodeCreatorActivity({ truncated: true })),
			),
		);

		expect(container.textContent).toContain("Latest");
		expect(container.textContent).not.toContain("Span");
		unmount();
	});

	it("invites a review when nothing was recorded", () => {
		const { unmount, container } = renderActivity(
			creatorFixtureSchema.mapActivity(
				readyQueryResult(
					decodeCreatorActivity({ events: [], reviewCount: 0, collectionEvents: [] }),
				),
			),
		);

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).toContain("Write review");
		expect(container.textContent).not.toContain("Log activity");
		unmount();
	});

	it("separates transport failures from malformed activity", () => {
		const transport = renderActivity(creatorFixtureSchema.mapActivity(transportErrorQueryResult()));
		expect(transport.container.textContent).toContain("Unable to load activity");
		transport.unmount();

		const malformed = renderActivity(creatorFixtureSchema.mapActivity(malformedQueryResult()));
		expect(malformed.container.textContent).toContain("could not be displayed");
		malformed.unmount();
	});
});

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const declaresInterest = declaresEntityInterest("creator-1");

describe("creator query entity interest", () => {
	declaresInterest(
		"summary",
		creatorFixtureSchema.summaryQuery,
		{ data: { summary: rows([creatorSummaryRow]), requested: rows([{ schemaSlug: "creator" }]) } },
		["collection-1"],
	);
	declaresInterest(
		"overview",
		creatorFixtureSchema.overviewQuery,
		{ data: creatorOverviewData(FILLED_CREDITS) },
		[creatorMovieCreditRow.id, creatorAlbumCreditRow.id],
	);
	declaresInterest(
		"activity",
		creatorFixtureSchema.activityQuery,
		{ data: creatorActivityData() },
		[creatorCollectionAddedEventRow.collectionId],
	);
});
