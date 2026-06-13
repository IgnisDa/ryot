import { describe, expect, it } from "vitest";

import { mergeTranslationOverlay, type TranslationFields } from "./overlay-merge";

const canonicalImages = [{ type: "remote", url: "https://example.com/canonical.jpg" }];
const overlayImages = [{ type: "remote", url: "https://example.com/overlay.jpg" }];

const canonical: TranslationFields = {
	name: "Fight Club",
	properties: { description: "An insomniac office worker...", images: canonicalImages },
};

describe("mergeTranslationOverlay", () => {
	it("returns status pending when there is no overlay row", () => {
		const result = mergeTranslationOverlay({ canonical, overlay: null });

		expect(result.status).toBe("pending");
		expect(result.fields).toEqual(canonical);
	});

	it("merges name and translatable properties (including images) over the canonical fields", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: {
				name: "El club de la lucha",
				properties: { description: "Un trabajador de oficina insomne...", images: overlayImages },
			},
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			name: "El club de la lucha",
			properties: { description: "Un trabajador de oficina insomne...", images: overlayImages },
		});
	});

	it("keeps canonical values for the fields a partial overlay omits", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: "El club de la lucha", properties: {} },
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			name: "El club de la lucha",
			properties: { description: "An insomniac office worker...", images: canonicalImages },
		});
	});

	it("returns status none for an empty negative-cache row", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: null, properties: {} },
		});

		expect(result.status).toBe("none");
		expect(result.fields).toEqual(canonical);
	});
});
