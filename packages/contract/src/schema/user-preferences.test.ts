import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import {
	defaultUserPreferences,
	resolveInterfaceLocale,
	resolveWeekStart,
	UserPreferencesPatch,
} from "./user-preferences";

const decodePatch = Schema.decodeUnknownResult(UserPreferencesPatch);

describe("user preferences", () => {
	it("resolves an unset week start through the interface locale, else English", () => {
		expect(resolveWeekStart(defaultUserPreferences)).toBe(0);
		expect(resolveWeekStart({ weekStart: null, interfaceLocale: "en-XA" })).toBe(1);
		expect(resolveWeekStart({ weekStart: 6, interfaceLocale: "en" })).toBe(6);
	});

	it("resolves an unset interface locale to English for backend rendering", () => {
		expect(resolveInterfaceLocale(defaultUserPreferences)).toBe("en");
		expect(resolveInterfaceLocale({ interfaceLocale: "en-XA" })).toBe("en-XA");
	});

	it("accepts shipped interface locales, weekdays and canonical content locale tags only", () => {
		expect(
			Result.isSuccess(
				decodePatch({ weekStart: 0, contentLanguage: "yue", interfaceLocale: "en-XA" }),
			),
		).toBe(true);
		expect(
			Result.isSuccess(decodePatch({ interfaceLocale: "fr", contentLanguage: "zh-Hans" })),
		).toBe(true);
		expect(
			Result.isSuccess(decodePatch({ contentLanguage: "pt-BR", interfaceLocale: "pt-PT" })),
		).toBe(true);
		for (const patch of [
			{ weekStart: 7 },
			{ interfaceLocale: "ar" },
			{ contentLanguage: "EN" },
			{ contentLanguage: "pt-br" },
			{ language: "en" },
		]) {
			expect(Result.isFailure(decodePatch(patch))).toBe(true);
		}
	});
});
