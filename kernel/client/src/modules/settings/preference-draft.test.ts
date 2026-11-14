import { describe, expect, it } from "bun:test";

import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";

const preferences = defaultUserPreferences;

describe("user settings preference draft", () => {
	it("does not treat the empty language field as a change from provider default", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, draft)).toEqual({});
	});

	it("only includes a changed language preference", () => {
		expect(
			preferencePayload(preferences, { ...makePreferenceDraft(preferences), language: " es " }),
		).toEqual({ language: "es" });
	});

	it("clears an existing language when the field is blank", () => {
		expect(
			preferencePayload(
				{ ...preferences, language: "es" },
				{ ...makePreferenceDraft(preferences), language: "  " },
			),
		).toEqual({ language: null });
	});

	it("only includes a changed rating scale", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, { ...draft, ratingScale: "hundred" })).toEqual({});
		expect(preferencePayload(preferences, { ...draft, ratingScale: "three-point" })).toEqual({
			ratingScale: "three-point",
		});
	});
});
