import { describe, expect, it } from "vitest";

import { resolveLanguage } from "./language-resolution";

describe("resolveLanguage", () => {
	it("renders canonical when there is no preferred language", () => {
		const result = resolveLanguage({ preferredLanguage: null, canonicalLanguage: "en" });

		expect(result).toEqual({ kind: "canonical" });
	});

	it("renders canonical when the preferred language equals the canonical language", () => {
		const result = resolveLanguage({ preferredLanguage: "en", canonicalLanguage: "en" });

		expect(result).toEqual({ kind: "canonical" });
	});

	it("translates with the preferred language when it differs from the canonical language", () => {
		const result = resolveLanguage({ preferredLanguage: "es", canonicalLanguage: "en" });

		expect(result).toEqual({ kind: "translate", language: "es" });
	});

	it("translates with a script-subtagged language (e.g. romaji)", () => {
		const result = resolveLanguage({ preferredLanguage: "ja-Latn", canonicalLanguage: "en" });

		expect(result).toEqual({ kind: "translate", language: "ja-Latn" });
	});
});
