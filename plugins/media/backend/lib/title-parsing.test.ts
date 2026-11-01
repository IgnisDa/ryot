import { describe, expect, it } from "vitest";

import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
	extractMetadataLookupYearFromTitle,
	hasMetadataLookupShowIndicators,
} from "./title-parsing";

describe("metadata lookup title parsing", () => {
	it("cleans years, file extensions, and quality markers from movie titles", () => {
		expect(extractMetadataLookupBaseTitle("The Matrix (1999) 1080p.mkv")).toBe("The Matrix");
		expect(extractMetadataLookupYearFromTitle("The Matrix (1999) 1080p.mkv")).toBe(1999);
	});

	it("extracts SxxEyy show coordinates", () => {
		expect(extractMetadataLookupBaseTitle("Breaking Bad S02E03 1080p")).toBe("Breaking Bad");
		expect(extractMetadataLookupSeasonEpisode("Breaking Bad S02E03 1080p")).toEqual({
			season: 2,
			episode: 3,
		});
	});

	it("extracts Netflix limited-series episode coordinates", () => {
		const title = "The Queen's Gambit: Limited Series: Exchanges (Episode 2)";

		expect(extractMetadataLookupBaseTitle(title)).toBe("The Queen's Gambit");
		expect(extractMetadataLookupSeasonEpisode(title)).toEqual({ season: 1, episode: 2 });
	});

	it("extracts part and chapter coordinates", () => {
		const title = "Example Show: Part 2: Chapter Three";

		expect(extractMetadataLookupBaseTitle(title)).toBe("Example Show");
		expect(extractMetadataLookupSeasonEpisode(title)).toEqual({ season: 2, episode: 3 });
	});

	it("resolves roman numeral coordinates without relying on newer array methods", () => {
		const title = "Example Show: Season IV: Chapter IX";

		expect(extractMetadataLookupSeasonEpisode(title)).toEqual({ season: 4, episode: 9 });
	});

	it("detects show indicators", () => {
		expect(hasMetadataLookupShowIndicators("Arcane: Season 1: Episode 1")).toBe(true);
		expect(hasMetadataLookupShowIndicators("Dune (2021)")).toBe(false);
	});
});
