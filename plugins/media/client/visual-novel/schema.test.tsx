import { afterEach, describe, expect, it } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { visualNovelRecipes } from "../../shared/visual-novel-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatPersonRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { visualNovelPresentationFacts, visualNovelSchema, visualNovelSummaryFacts } from "./schema";

const noopAdapter = { query: () => Effect.succeed({}) };

const visualNovelSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(
		bindRecipe(visualNovelRecipes.summaryRecipe({ reference: FLAT_SUMMARY_INPUT.reference }), {
			entityId: FLAT_SUMMARY_INPUT.entityId,
		}),
		{ lengthMinutes: 750, ...overrides },
	);
afterEach(() => {
	document.body.innerHTML = "";
});

describe("visual novel schema", () => {
	it("lists the length and drops it when unrecorded", () => {
		expect(visualNovelSummaryFacts(visualNovelSummary())).toEqual([
			{ inline: true, icon: "clock", label: "Length", value: "12h 30m" },
		]);
		expect(visualNovelSummaryFacts(visualNovelSummary({ lengthMinutes: null }))).toEqual([]);
	});

	it("titles the credits as developers and never claims it is part of a series", () => {
		const { unmount, container } = renderMediaScreenBody(
			visualNovelSchema,
			visualNovelSummary(),
			decodeFlatOverview(
				bindRecipe(
					visualNovelRecipes.overviewRecipe({ reference: FLAT_OVERVIEW_INPUT.reference }),
					{ entityId: FLAT_OVERVIEW_INPUT.entityId },
				),
			),
		);

		expect(container.textContent).toContain("Developers");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reads the length on cards, hints how much was read and draws poster art", () => {
		const data = decodeFlatPresentation(visualNovelRecipes, {
			lengthMinutes: 750,
			schemaSlug: "visual-novel",
		});

		expect(visualNovelPresentationFacts({ ...data, lengthMinutes: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<visualNovelSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("12h 30m");
		expect(container.textContent).toContain("42% read");
		expect(container.querySelector("article > a > *")?.className).toContain("aspect-2/3");
		unmount();
	});
});
