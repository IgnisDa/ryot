import { describe, expect, it } from "vitest";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";

const preferences = { language: null, allowNsfw: false, disableIntegrations: false };

describe("user settings preference draft", () => {
	it("does not treat the empty language field as a change from provider default", () => {
		const draft = makePreferenceDraft(preferences);

		expect(preferencePayload(preferences, draft)).toEqual({});
	});

	it("only includes changed preferences", () => {
		expect(
			preferencePayload(preferences, {
				allowNsfw: true,
				language: " es ",
				disableIntegrations: false,
			}),
		).toEqual({ language: "es", allowNsfw: true });
	});

	it("clears an existing language when the field is blank", () => {
		expect(
			preferencePayload(
				{ ...preferences, language: "es" },
				{ ...makePreferenceDraft(preferences), language: "  " },
			),
		).toEqual({ language: null });
	});
});
