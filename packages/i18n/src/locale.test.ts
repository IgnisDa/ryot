import { describe, expect, it } from "bun:test";

import {
	cldrWeekStart,
	fallbackChain,
	negotiateLocale,
	parseAcceptLanguage,
	textDirection,
	weekStartForLocale,
} from "./locale";

describe("locale fallback", () => {
	it("truncates subtags and ends at English", () => {
		expect(fallbackChain("pt-BR")).toEqual(["pt-BR", "pt", "en"]);
		expect(fallbackChain("zh-Hant-TW-u-ca-chinese")).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
		expect(fallbackChain("en-XA")).toEqual(["en-XA", "en"]);
		expect(fallbackChain("not a tag")).toEqual(["en"]);
	});
});

describe("locale negotiation", () => {
	const available = ["en", "en-XA", "pt-BR", "de"] as const;

	it("prefers the first request with an exact, truncated or same-language match", () => {
		expect(negotiateLocale(["fr-FR", "de-AT"], available, "en")).toBe("de");
		expect(negotiateLocale(["pt"], available, "en")).toBe("pt-BR");
		expect(negotiateLocale(["en-GB", "de"], available, "en")).toBe("en");
		expect(negotiateLocale(["EN-xa"], available, "en")).toBe("en-XA");
	});

	it("falls back when nothing matches", () => {
		expect(negotiateLocale(["ja", "*"], available, "en")).toBe("en");
		expect(negotiateLocale([], available, "de")).toBe("de");
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
		expect(weekStartForLocale("en-GB")).toBe(1);
		expect(weekStartForLocale("de")).toBe(1);
		expect(weekStartForLocale("ar-EG")).toBe(6);
		expect(weekStartForLocale("pt")).toBe(0);
	});

	it("keeps the CLDR table in step with the runtime week data", () => {
		for (const locale of ["en", "en-GB", "de", "fr", "ar-EG", "fa-IR", "ja", "pt-BR", "dv", "es"]) {
			expect([locale, cldrWeekStart(locale)]).toEqual([locale, weekStartForLocale(locale)]);
		}
	});
});
