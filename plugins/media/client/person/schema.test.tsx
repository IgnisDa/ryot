import { afterEach, describe, expect, it } from "vitest";

import { personRecipes } from "../../shared/person-recipes";
import {
	creatorAlbumCreditRow,
	creatorMovieCreditRow,
	decodeCreatorOverviewOf,
} from "../../tests/client/creator/overview-fixture";
import {
	CREATOR_SUMMARY_INPUT,
	decodeCreatorSummary,
} from "../../tests/client/creator/summary-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { creatorLinks } from "../creator/credit-sections";
import { personSchema, personSummaryFacts } from "./schema";

const TODAY = "2026-09-14";

const personSummary = (overrides: Record<string, unknown> = {}) =>
	decodeCreatorSummary(personRecipes.summaryRecipe(CREATOR_SUMMARY_INPUT), {
		website: null,
		gender: "Male",
		deathDate: null,
		sourceUrl: null,
		birthDate: "1969-08-18",
		birthPlace: "Boston, Massachusetts, USA",
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("person schema", () => {
	it("lists the birth date with the living age, birthplace and gender", () => {
		expect(personSummaryFacts(personSummary(), TODAY)).toEqual([
			{ icon: "clock", label: "Born", suffix: " (age 57)", value: "Aug 18, 1969" },
			{ icon: "globe", label: "Birthplace", value: "Boston, Massachusetts, USA" },
			{ icon: "user", value: "Male", label: "Gender" },
		]);
	});

	it("reports the age at death instead of a living age", () => {
		expect(
			personSummaryFacts(
				personSummary({ gender: null, birthPlace: null, deathDate: "2020-08-17" }),
				TODAY,
			),
		).toEqual([
			{ icon: "clock", label: "Born", suffix: undefined, value: "Aug 18, 1969" },
			{ icon: "clock", label: "Died", suffix: " (aged 50)", value: "Aug 17, 2020" },
		]);
	});

	it("counts a living age only once this year's birthday has passed, and never a negative one", () => {
		expect(
			personSummaryFacts(
				personSummary({ gender: null, birthPlace: null, birthDate: "1969-12-18" }),
				TODAY,
			),
		).toEqual([{ icon: "clock", label: "Born", suffix: " (age 56)", value: "Dec 18, 1969" }]);
		expect(
			personSummaryFacts(
				personSummary({ gender: null, birthPlace: null, birthDate: "2030-01-01" }),
				TODAY,
			),
		).toEqual([{ icon: "clock", label: "Born", suffix: undefined, value: "Jan 1, 2030" }]);
	});

	it("links only web addresses", () => {
		expect(
			creatorLinks(
				personSummary({ website: "javascript:alert(1)", sourceUrl: "https://tmdb.test/edward" }),
			),
		).toEqual([{ label: "TMDB page", href: "https://tmdb.test/edward" }]);
	});

	it("drops unrecorded facts and omits the age for a date that is not a full ISO date", () => {
		expect(
			personSummaryFacts(personSummary({ gender: null, birthDate: null, birthPlace: null }), TODAY),
		).toEqual([]);
		expect(
			personSummaryFacts(
				personSummary({ gender: null, birthPlace: null, birthDate: "1969" }),
				TODAY,
			),
		).toEqual([{ icon: "clock", label: "Born", value: "1969", suffix: undefined }]);
	});

	it("draws the profile photo in 2:3 and titles the credit rails and links", () => {
		const { unmount, container } = renderMediaScreenBody(
			personSchema,
			personSummary({ website: "https://edward.test", sourceUrl: "https://tmdb.test/edward" }),
			decodeCreatorOverviewOf(
				personRecipes.overviewRecipe({ creditLimit: 12, entityId: "creator-1" }),
				{
					movie: { items: [creatorMovieCreditRow] },
					"music-group": { items: [creatorAlbumCreditRow] },
				},
			),
		);

		expect(
			container.querySelector('img[src="https://images.test/edward.jpg"]')?.className,
		).toContain("aspect-2/3");
		expect(container.textContent).toContain("Person");
		expect(container.textContent).toContain("Movies");
		expect(container.textContent).toContain("Albums");
		expect(container.textContent).toContain("as The Narrator");
		expect(container.querySelector('a[href="https://edward.test"]')?.textContent).toContain(
			"Website",
		);
		expect(container.querySelector('a[href="https://tmdb.test/edward"]')?.textContent).toContain(
			"TMDB page",
		);
		unmount();
	});
});
