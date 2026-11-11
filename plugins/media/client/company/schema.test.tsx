import { afterEach, describe, expect, it } from "bun:test";

import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { companyRecipes } from "../../shared/company-recipes";
import { decodeCreatorOverviewOf } from "../../tests/client/creator/overview-fixture";
import {
	CREATOR_SUMMARY_INPUT,
	decodeCreatorSummary,
} from "../../tests/client/creator/summary-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { companySchema, companySummaryFacts } from "./schema";

const companySummary = (overrides: Record<string, unknown> = {}) =>
	decodeCreatorSummary(
		bindRecipe(companyRecipes.summaryRecipe({ reference: CREATOR_SUMMARY_INPUT.reference }), {
			entityId: CREATOR_SUMMARY_INPUT.entityId,
		}),
		{
			website: null,
			sourceUrl: null,
			foundedYear: 1994,
			headquarters: "Los Angeles, California",
			...overrides,
		},
	);
afterEach(() => {
	document.body.innerHTML = "";
});

describe("company schema", () => {
	it("lists the founding year and headquarters and drops them when unrecorded", () => {
		expect(companySummaryFacts(companySummary())).toEqual([
			{ icon: "clock", value: "1994", label: "Founded" },
			{ icon: "building-2", label: "Headquarters", value: "Los Angeles, California" },
		]);
		expect(companySummaryFacts(companySummary({ foundedYear: null, headquarters: null }))).toEqual(
			[],
		);
	});

	it("draws the logo square and contained", () => {
		const { unmount, container } = renderMediaScreenBody(
			companySchema,
			companySummary(),
			decodeCreatorOverviewOf(
				bindRecipe(companyRecipes.overviewRecipe({ reference: { kind: "self" } }), {
					entityId: "creator-1",
				}),
			),
		);
		const logo = container.querySelector('img[src="https://images.test/logo.png"]');

		expect(logo?.className).toContain("aspect-square");
		expect(logo?.className).toContain("object-contain");
		unmount();
	});
});
