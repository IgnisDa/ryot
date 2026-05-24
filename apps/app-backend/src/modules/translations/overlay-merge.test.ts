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
	description: "An insomniac office worker...",
};

describe("mergeTranslationOverlay", () => {
	it("returns status pending when there is no overlay row", () => {
		const result = mergeTranslationOverlay({ canonical, overlay: null });

		expect(result.status).toBe("pending");
		expect(result.fields).toEqual(canonical);
	});

	it("merges name, description, and image over the canonical fields", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: {
				image: overlayImage,
				name: "El club de la lucha",
				description: "Un trabajador de oficina insomne...",
			},
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			image: overlayImage,
			name: "El club de la lucha",
			description: "Un trabajador de oficina insomne...",
		});
	});

	it("keeps canonical values for the null fields of a partial overlay", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: "El club de la lucha", description: null, image: null },
		});

		expect(result.status).toBe("ready");
		expect(result.fields).toEqual({
			image: canonicalImage,
			name: "El club de la lucha",
			description: canonical.description,
		});
	});

	it("returns status none for an all-null negative-cache row", () => {
		const result = mergeTranslationOverlay({
			canonical,
			overlay: { name: null, description: null, image: null },
		});

		expect(result.status).toBe("none");
		expect(result.fields).toEqual(canonical);
	});
});
