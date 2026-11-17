import { describe, expect, it } from "bun:test";

import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";

const preferences = defaultUserPreferences;

describe("user settings preference draft", () => {
	it("does not treat empty default fields as changes", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, draft)).toEqual({});
	});

	it("only includes a changed content language, normalized to its code", () => {
		expect(
			preferencePayload(preferences, {
				...makePreferenceDraft(preferences),
				contentLanguage: " ES ",
			}),
		).toEqual({ contentLanguage: "es" });
	});

	it("clears an existing content language when the field is blank", () => {
		expect(
			preferencePayload(
				{ ...preferences, contentLanguage: "es" },
				{ ...makePreferenceDraft(preferences), contentLanguage: "  " },
			),
		).toEqual({ contentLanguage: null });
	});

	it("preserves canonical regional and script subtags", () => {
		const draft = makePreferenceDraft(preferences);
		expect(preferencePayload(preferences, { ...draft, contentLanguage: " PT-br " })).toEqual({
			contentLanguage: "pt-BR",
		});
		expect(preferencePayload(preferences, { ...draft, contentLanguage: "zh-hans" })).toEqual({
			contentLanguage: "zh-Hans",
		});
		expect(
			preferencePayload(
				{ ...preferences, contentLanguage: "pt-BR" },
				{ ...draft, contentLanguage: "pt-br" },
			),
		).toEqual({});
	});

	it("includes interface locale and week start changes and their resets", () => {
		const draft = makePreferenceDraft(preferences);

		expect(
			preferencePayload(preferences, { ...draft, weekStart: "0", interfaceLocale: "en" }),
		).toEqual({ weekStart: 0, interfaceLocale: "en" });
		expect(
			preferencePayload(
				{ ...preferences, weekStart: 6, interfaceLocale: "en-XA" },
				{ ...draft, weekStart: "", interfaceLocale: "" },
			),
		).toEqual({ weekStart: null, interfaceLocale: null });
	});

	it("only includes a changed rating scale", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, { ...draft, ratingScale: "hundred" })).toEqual({});
		expect(preferencePayload(preferences, { ...draft, ratingScale: "three-point" })).toEqual({
			ratingScale: "three-point",
		});
	});
});
