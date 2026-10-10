import type { SearchProviderEntitiesResponse } from "@ryot-app/contract/modules/provider-entities/schemas";
import { describe, expect, it } from "vitest";

import { describeProviderSearchResultItem } from "#/modules/provider-add/result-display";

type Item = SearchProviderEntitiesResponse["items"][number];

const item = (overrides: Partial<Item>): Item => ({
	externalId: "tt0111161",
	title: "The Shawshank Redemption",
	...overrides,
});

describe("provider search result display", () => {
	it("returns the direct image url and title", () => {
		const display = describeProviderSearchResultItem(
			item({ imageUrl: "https://images.test/poster.jpg" }),
		);

		expect(display.imageUrl).toBe("https://images.test/poster.jpg");
		expect(display.title).toBe("The Shawshank Redemption");
	});

	it("formats ordered mixed metadata", () => {
		const display = describeProviderSearchResultItem(
			item({ metadata: ["Frank Darabont", 1994, "Drama"] }),
		);

		expect(display.metaText).toBe("Frank Darabont · 1994 · Drama");
	});

	it("has no meta text when metadata is omitted", () => {
		expect(describeProviderSearchResultItem(item({})).metaText).toBeUndefined();
	});
});
