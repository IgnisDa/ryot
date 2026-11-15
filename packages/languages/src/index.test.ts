import { expect, it } from "bun:test";

import {
	canonicalLanguageCode,
	canonicalLanguagePattern,
	languageCodeForIso6393,
	languageCodeFromName,
	languageName,
} from "./index";

it("normalizes provider codes and bibliographic aliases into one stored identity", () => {
	for (const [input, code, iso3, name] of [
		[" ENG ", "en", "eng", "English"],
		["fre", "fr", "fra", "French"],
		["chi", "zh", "zho", "Chinese"],
		["yue", "yue", "yue", "Yue Chinese"],
		["ja", "ja", "jpn", "Japanese"],
	] as const) {
		expect(canonicalLanguageCode(input)).toBe(code);
		expect(languageCodeForIso6393(input)).toBe(iso3);
		expect(languageName(code)).toBe(name);
		expect(languageCodeFromName(name)).toBe(code);
		expect(new RegExp(canonicalLanguagePattern).test(code)).toBe(true);
	}
	expect(canonicalLanguageCode("not-a-language")).toBeUndefined();
	expect(new RegExp(canonicalLanguagePattern).test("eng")).toBe(false);
	expect(languageCodeFromName("unknown value")).toBeUndefined();
});
