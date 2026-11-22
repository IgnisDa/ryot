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

	it("saves a full regional locale and resets the week start", () => {
		const draft = makePreferenceDraft(preferences);

		expect(
			preferencePayload(preferences, { ...draft, weekStart: "0", interfaceLocale: "en-AU" }),
		).toEqual({ weekStart: 0, interfaceLocale: "en-AU" });
		expect(
			preferencePayload(
				{ ...preferences, weekStart: 6, interfaceLocale: "en-XA" },
				{ ...draft, weekStart: "", interfaceLocale: "" },
			),
		).toEqual({ weekStart: null });
	});

	it("only includes a changed rating scale", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, { ...draft, ratingScale: "hundred" })).toEqual({});
		expect(preferencePayload(preferences, { ...draft, ratingScale: "three-point" })).toEqual({
			ratingScale: "three-point",
		});
	});
});
