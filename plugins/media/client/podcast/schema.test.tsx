import { afterEach, describe, expect, it } from "vitest";

import { podcastRecipes } from "../../shared/podcast-recipes";
import {
	decodePodcastActivity,
	decodePodcastOverview,
	decodePodcastSummary,
} from "../../tests/client/podcast/fixtures";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { podcastEpisodeCountLine } from "./episodes";
import {
	podcastActivityCoverage,
	podcastPresentationDetail,
	podcastPresentationFacts,
	podcastSchema,
	podcastSummaryFacts,
} from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const presentationRow = {
	id: "podcast-1",
	name: "Reply All",
	publishDate: null,
	publishYear: 2014,
	storedEpisodes: 400,
	watchedEpisodes: 183,
	state: "in_progress",
	schemaSlug: "podcast",
	inProgressEpisodes: 1,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Ended",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/reply-all.jpg" }],
};

const presentationData = (overrides: Record<string, unknown> = {}) => {
	const decoded = podcastRecipes
		.presentationRecipe(["podcast-1"])
		.decode({
			data: {
				rows: rowsResult([{ ...presentationRow, ...overrides }], {
					limit: 100,
					hasMore: false,
					nextCursor: null,
				}),
			},
		});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

const renderOverview = () =>
	mountRyotClient(
		noopAdapter,
		<podcastSchema.ScreenBody
			compact
			episodes={null}
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: decodePodcastSummary() }}
			overview={mapMediaOverview(readyQueryResult(decodePodcastOverview()))}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("podcast schema", () => {
	it("lists the published episode count", () => {
		expect(podcastSummaryFacts(decodePodcastSummary())).toEqual([
			{ value: "412", icon: "podcast", label: "Episodes" },
		]);
		expect(podcastSummaryFacts(decodePodcastSummary({ totalEpisodes: null }))).toEqual([]);
	});

	it("titles the credits as hosts and networks and offers no where to watch", () => {
		const { unmount, container } = renderOverview();

		expect(container.textContent).toContain("Podcast");
		expect(container.textContent).toContain("Hosts & guests");
		expect(container.textContent).toContain("Networks & publishers");
		expect(container.textContent).not.toContain("Where to watch");
		unmount();
	});

	it("routes the providers' unlinked creators into the people and company rails", () => {
		const { unmount, container } = renderOverview();

		expect(container.textContent).toContain("PJ Vogt");
		expect(container.textContent).toContain("Gimlet Media");
		unmount();
	});

	it("draws square art and hints how much of the feed has been played", () => {
		const data = presentationData();
		const card = mountRyotClient(
			noopAdapter,
			<podcastSchema.CardContent compact data={data} entityId="podcast-1" />,
		);
		expect(card.container.querySelector("article > a > *")?.className).toContain("aspect-square");
		card.unmount();

		const row = mountRyotClient(
			noopAdapter,
			<podcastSchema.RowContent compact data={data} entityId="podcast-1" />,
		);
		expect(row.container.querySelector("article > a > *")?.className).toContain("h-20 w-20");
		row.unmount();

		expect(podcastPresentationFacts(data)).toEqual(["Ended"]);
		expect(podcastPresentationDetail(data)).toBe(
			"400 stored episodes · 183 played · 1 episode in progress",
		);
		expect(podcastPresentationDetail(presentationData({ storedEpisodes: 0 }))).toBeUndefined();
	});

	it("counts the feed from the summary aggregates", () => {
		expect(podcastEpisodeCountLine(decodePodcastSummary())).toBe("412 episodes · 183 played");
		expect(podcastEpisodeCountLine(decodePodcastSummary({ watchedEpisodes: 0 }))).toBe(
			"412 episodes",
		);
		expect(
			podcastEpisodeCountLine(decodePodcastSummary({ storedEpisodes: 0, totalEpisodes: null })),
		).toBeUndefined();
		expect(podcastEpisodeCountLine(undefined)).toBeUndefined();
	});

	it("shows one Episodes coverage bar for the whole feed", () => {
		expect(podcastActivityCoverage(decodePodcastActivity())).toEqual({
			minutes: { missing: 2, total: 9150 },
			headline: { total: 400, watched: 183 },
			rows: [{ total: 400, percent: 46, watched: 183, key: "podcast-1", label: "Episodes" }],
		});
		expect(podcastActivityCoverage(decodePodcastActivity({ coverage: [] })).rows).toEqual([]);
	});

	it("records listens rather than watches", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<podcastSchema.Activity
				compact
				refresh={() => undefined}
				state={podcastSchema.mapActivity(readyQueryResult(decodePodcastActivity()))}
			/>,
		);

		expect(container.querySelector('[aria-label="Listen record"]')).not.toBeNull();
		expect(container.textContent).toContain("Listens");
		expect(container.textContent).toContain("Finished the podcast");
		unmount();
	});
});
