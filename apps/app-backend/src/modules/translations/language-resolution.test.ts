import { describe, expect, it } from "vitest";

import { resolveLanguage } from "./language-resolution";

const preferences = [
	{ source: "tmdb", preferredLanguage: "es-ES" },
	{ source: "anilist", preferredLanguage: "native" },
];

describe("resolveLanguage", () => {
	it("renders canonical when there is no preference for the source", () => {
		const result = resolveLanguage({
			preferences,
			source: "tvdb",
			canonicalLanguage: "en-US",
		});

		expect(result).toEqual({ kind: "canonical" });
	});

	it("renders canonical when the preference equals the canonical language", () => {
		const result = resolveLanguage({
			preferences,
			source: "tmdb",
			canonicalLanguage: "es-ES",
		});

		expect(result).toEqual({ kind: "canonical" });
	});

	it("translates with the provider-native language when the preference differs", () => {
		const result = resolveLanguage({
			preferences,
			source: "tmdb",
			canonicalLanguage: "en-US",
		});

		expect(result).toEqual({ kind: "translate", language: "es-ES" });
	});

	it("resolves each source independently from the same preference list", () => {
		const result = resolveLanguage({
			preferences,
			source: "anilist",
			canonicalLanguage: "english",
		});

		expect(result).toEqual({ kind: "translate", language: "native" });
	});

	it("renders canonical when the preference list is empty", () => {
		const result = resolveLanguage({
			source: "tmdb",
			preferences: [],
			canonicalLanguage: "en-US",
		});

		expect(result).toEqual({ kind: "canonical" });
	});
});
