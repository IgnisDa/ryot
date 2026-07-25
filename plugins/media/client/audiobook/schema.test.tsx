import { afterEach, describe, expect, it } from "vitest";

import { audiobookRecipes } from "../../shared/audiobook-recipes";
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
import { mountRyotClient } from "../../tests/client/test-support";
import { audiobookPresentationFacts, audiobookSchema, audiobookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const audiobookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(audiobookRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		runtime: 750,
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("audiobook schema", () => {
	it("lists the length and drops it when unrecorded", () => {
		expect(audiobookSummaryFacts(audiobookSummary())).toEqual([
			{ icon: "clock", label: "Length", value: "12h 30m" },
		]);
		expect(audiobookSummaryFacts(audiobookSummary({ runtime: null }))).toEqual([]);
	});

	it("titles the credits as authors and narrators and the group as a series", () => {
		const { unmount, container } = renderFlatScreenBody(
			audiobookSchema,
			audiobookSummary(),
			decodeFlatOverview(audiobookRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT), {
				unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }],
			}),
		);

		expect(container.textContent).toContain("Audiobook");
		expect(container.textContent).toContain("Authors & narrators");
		expect(container.textContent).toContain("Nia Voice");
		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View series");
		unmount();
	});

	it("reads the length on rows, hints how much was listened to and draws square art", () => {
		const data = decodeFlatPresentation(audiobookRecipes, {
			runtime: 750,
			schemaSlug: "audiobook",
		});

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
