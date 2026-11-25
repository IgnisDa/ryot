import { describe, expect, it } from "bun:test";

import {
	fallbackChain,
	parseAcceptLanguage,
	preferredLocale,
	textDirection,
	weekStartForLocale,
} from "./locale";

describe("locale fallback", () => {
	it("tries regional and language catalogs before English", () => {
		expect(fallbackChain("en-AU", ["en"])).toEqual(["en-AU", "en"]);
		expect(fallbackChain("de-AT", ["en", "de"])).toEqual(["de-AT", "de", "en"]);
		expect(fallbackChain("pt", ["en", "pt-PT", "pt-BR"])).toEqual(["pt", "pt-BR", "en"]);
		expect(fallbackChain("en-GB", ["en-XA", "de"])).toEqual(["en-GB", "en"]);
		expect(fallbackChain("not a tag", ["en"])).toEqual(["en"]);
	});

	it("keeps only catalog candidates in the requested script before English fallback", () => {
		expect(fallbackChain("zh-Hant-TW-u-ca-chinese", ["zh", "zh-Hant"])).toEqual([
			"zh-Hant-TW",
			"zh-Hant",
			"en",
		]);
		expect(fallbackChain("zh-CN", ["zh-Hans", "en"])).toEqual(["zh-CN", "zh", "zh-Hans", "en"]);
		expect(fallbackChain("zh-TW", ["zh-Hans", "en"])).toEqual(["zh-TW", "en"]);
	});
});

describe("device locale selection", () => {
	const catalogs = ["en", "en-XA", "pt-BR", "de"];

	it("retains the requested regional locale for the first supported language", () => {
		expect(preferredLocale(["fr-FR", "de-AT"], catalogs)).toBe("de-AT");
		expect(preferredLocale(["en-AU", "de"], catalogs)).toBe("en-AU");
		expect(preferredLocale(["en-gb"], catalogs)).toBe("en-GB");
		expect(preferredLocale(["EN-xa"], catalogs)).toBe("en-XA");
	});

	it("keeps the primary valid locale for formatting when there is no matching catalog", () => {
		expect(preferredLocale(["*", "ja-JP"], catalogs)).toBe("ja-JP");
		expect(preferredLocale([], catalogs)).toBe("en");
	});

	it("orders Accept-Language entries by quality", () => {
		expect(parseAcceptLanguage("de;q=0.5, fr-CH, fr;q=0.9, *;q=0.1, en;q=0")).toEqual([
			"fr-CH",
			"fr",
			"de",
		]);
	});
});

describe("locale conventions", () => {
	it("derives text direction from the likely script", () => {
		expect(textDirection("ar")).toBe("rtl");
		expect(textDirection("he-IL")).toBe("rtl");
		expect(textDirection("fa")).toBe("rtl");
		expect(textDirection("en-XA")).toBe("ltr");
		expect(textDirection("az-Arab")).toBe("rtl");
	});

	it("uses Sunday as 0 for the region's first weekday", () => {
		expect(weekStartForLocale("en")).toBe(0);
		expect(weekStartForLocale("en-AU")).toBe(1);
		expect(weekStartForLocale("de")).toBe(1);
		expect(weekStartForLocale("ar-EG")).toBe(6);
		expect(weekStartForLocale("pt")).toBe(0);
	});
});
