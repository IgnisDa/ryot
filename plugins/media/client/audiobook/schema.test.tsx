import { afterEach, describe, expect, it } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { audiobookRecipes } from "../../shared/audiobook-recipes";
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
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { audiobookPresentationFacts, audiobookSchema, audiobookSummaryFacts } from "./schema";

const noopAdapter = { query: () => Effect.succeed({}) };

const audiobookSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(
		bindRecipe(audiobookRecipes.summaryRecipe({ reference: FLAT_SUMMARY_INPUT.reference }), {
			entityId: FLAT_SUMMARY_INPUT.entityId,
		}),
		{ runtime: 750, ...overrides },
	);
afterEach(() => {
	document.body.innerHTML = "";
});

describe("audiobook schema", () => {
	it("lists the length and drops it when unrecorded", () => {
		expect(audiobookSummaryFacts(audiobookSummary())).toEqual([
			{ inline: true, icon: "clock", label: "Length", value: "12h 30m" },
		]);
		expect(audiobookSummaryFacts(audiobookSummary({ runtime: null }))).toEqual([]);
	});

	it("titles the credits as authors and narrators and the group as a series", () => {
		const { unmount, container } = renderMediaScreenBody(
			audiobookSchema,
			audiobookSummary(),
			decodeFlatOverview(
				bindRecipe(audiobookRecipes.overviewRecipe({ reference: FLAT_OVERVIEW_INPUT.reference }), {
					entityId: FLAT_OVERVIEW_INPUT.entityId,
				}),
				{ unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }] },
			),
		);

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
		expect(container.querySelector("article > a > *")?.className).toContain("aspect-2/3");
		expect(container.querySelector("article > a > * > *")?.className).toContain("aspect-square");
		unmount();
	});
});
