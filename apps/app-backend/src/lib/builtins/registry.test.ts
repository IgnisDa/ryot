import { describe, expect, it } from "vitest";

import { builtinSandboxScripts } from "./registry";

describe("builtinSandboxScripts", () => {
	it("declares TMDB translation metadata for people and movie groups", () => {
		const scripts = builtinSandboxScripts();
		const providerInformationFor = (slug: string) => {
			const script = scripts.find((item) => item.slug === slug);
			return script && "providerInformation" in script.metadata
				? script.metadata.providerInformation
				: undefined;
		};

		expect(providerInformationFor("person.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
		expect(providerInformationFor("movie-group.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
	});
});
