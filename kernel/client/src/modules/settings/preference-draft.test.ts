import { describe, expect, it } from "vitest";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";

const preferences = { allowNsfw: false, language: null, disableIntegrations: false };

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
		).toEqual({ allowNsfw: true, language: "es" });
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
