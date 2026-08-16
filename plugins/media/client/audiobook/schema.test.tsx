import { afterEach, describe, expect, it } from "vitest";

import { audiobookRecipes } from "../../shared/audiobook-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatGroupRow,
} from "../../tests/client/flat-media/overview-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { audiobookPresentationFacts, audiobookSchema, audiobookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const audiobookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(audiobookRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		runtime: 750,
		...overrides,
	});

const renderBody = () =>
	mountRyotClient(
		noopAdapter,
		<audiobookSchema.ScreenBody
			compact
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: audiobookSummary() }}
			overview={mapMediaOverview(
				readyQueryResult(
					decodeFlatOverview(audiobookRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT), {
						unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }],
					}),
				),
			)}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("audiobook schema", () => {
	it("lists the rating, length and production status and drops the unrecorded ones", () => {
		expect(audiobookSummaryFacts(audiobookSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ icon: "clock", label: "Length", value: "12h 30m" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			audiobookSummaryFacts(
				audiobookSummary({ runtime: null, providerRating: null, productionStatus: null }),
			),
		).toEqual([]);
	});

	it("titles the credits as authors and narrators and the group as a series", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Audiobook");
		expect(container.textContent).toContain("Authors & narrators");
		expect(container.textContent).toContain("Nia Voice");
		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View series");
		unmount();
	});

	it("reads the length on rows, hints how much was listened to and draws square art", () => {
		const decoded = audiobookRecipes
			.presentationRecipe(["media-1"])
			.decode({
				data: {
					rows: rowsResult(
						[
							{
								runtime: 750,
								images: null,
								id: "media-1",
								publishDate: null,
								publishYear: 2014,
								name: "The Martian",
								progressPercent: 42,
								state: "in_progress",
								productionStatus: null,
								schemaSlug: "audiobook",
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
		const data = { ...decoded.success[0], batchAssets: [] };

		expect(audiobookPresentationFacts(data)).toEqual(["12h 30m"]);
		expect(audiobookPresentationFacts({ ...data, runtime: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<audiobookSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("42% listened");
		expect(container.querySelector("article > a > *")?.className).toContain("aspect-square");
		unmount();
	});
});
