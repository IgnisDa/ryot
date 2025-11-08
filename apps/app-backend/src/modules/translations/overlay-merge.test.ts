import { describe, expect, it } from "vitest";

import { RemoteImageUrl } from "#lib/schema/brands";
import type { StoredEntityImage } from "#modules/entities/types";

import { mergeTranslationOverlay, type TranslationFields } from "./overlay-merge";

const canonicalImage: StoredEntityImage = {
	type: "remote",
	url: RemoteImageUrl.make("https://example.com/canonical.jpg"),
};

const overlayImage: StoredEntityImage = {
	type: "remote",
	url: RemoteImageUrl.make("https://example.com/overlay.jpg"),
};

const canonical: TranslationFields = {
	name: "Fight Club",
	image: canonicalImage,
	properties: { description: "An insomniac office worker..." },
};

describe("mergeTranslationOverlay", () => {
	it("returns status pending when there is no overlay row", () => {
		const result = mergeTranslationOverlay({ canonical, overlay: null });

		expect(result.status).toBe("pending");
		expect(result.fields).toEqual(canonical);
	});

	it("merges name, translatable properties, and image over the canonical fields", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: {
				image: overlayImage,
				name: "El club de la lucha",
				properties: { description: "Un trabajador de oficina insomne..." },
			},
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			image: overlayImage,
			name: "El club de la lucha",
			properties: { description: "Un trabajador de oficina insomne..." },
		});
	});

	it("keeps canonical values for the fields a partial overlay omits", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: "El club de la lucha", image: null, properties: {} },
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			image: canonicalImage,
			name: "El club de la lucha",
			properties: { description: "An insomniac office worker..." },
		});
	});

	it("returns status none for an empty negative-cache row", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: null, image: null, properties: {} },
		});

		expect(result.status).toBe("none");
		expect(result.fields).toEqual(canonical);
	});
});
