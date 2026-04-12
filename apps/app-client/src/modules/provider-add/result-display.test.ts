import type { SearchProviderEntitiesResponse } from "@ryot/contract/modules/provider-entities/schemas";
import { describe, expect, it } from "vitest";

import { describeProviderSearchItem } from "./result-display";

type Item = SearchProviderEntitiesResponse["items"][number];

const item = (overrides: Partial<Item>): Item => ({
	externalId: "tt0111161",
	titleProperty: { kind: "text", value: "The Shawshank Redemption" },
	...overrides,
});

describe("provider search result display", () => {
	it("extracts a remote image url", () => {
		const display = describeProviderSearchItem(
			item({
				imageProperty: {
					kind: "image",
					value: { type: "remote", url: "https://images.test/poster.jpg" },
				},
			}),
		);

		expect(display.imageUrl).toBe("https://images.test/poster.jpg");
		expect(display.title).toBe("The Shawshank Redemption");
	});

	it("ignores missing, null, managed, and malformed images", () => {
		expect(describeProviderSearchItem(item({})).imageUrl).toBeUndefined();
		expect(
			describeProviderSearchItem(item({ imageProperty: { kind: "null", value: null } })).imageUrl,
		).toBeUndefined();
		expect(
			describeProviderSearchItem(
				item({ imageProperty: { kind: "image", value: { type: "s3", key: "assets/poster.jpg" } } }),
			).imageUrl,
		).toBeUndefined();
		expect(
			describeProviderSearchItem(
				item({ imageProperty: { kind: "image", value: { type: "remote", url: 42 } } }),
			).imageUrl,
		).toBeUndefined();
		expect(
			describeProviderSearchItem(item({ imageProperty: ["not-a-property"] })).imageUrl,
		).toBeUndefined();
	});

	it("joins secondary subtitle, primary subtitle, and callout in order", () => {
		const display = describeProviderSearchItem(
			item({
				calloutProperty: { kind: "text", value: "Drama" },
				primarySubtitleProperty: { kind: "number", value: 1994 },
				secondarySubtitleProperty: { kind: "text", value: "Frank Darabont" },
			}),
		);

		expect(display.metaText).toBe("Frank Darabont · 1994 · Drama");
	});

	it("skips null, empty, and unrecognised meta parts", () => {
		const display = describeProviderSearchItem(
			item({
				calloutProperty: { kind: "text", value: "   " },
				primarySubtitleProperty: { kind: "null", value: null },
				secondarySubtitleProperty: { kind: "text", value: " Frank Darabont " },
			}),
		);

		expect(display.metaText).toBe("Frank Darabont");
	});

	it("renders a numeric callout on its own", () => {
		const display = describeProviderSearchItem(
			item({ calloutProperty: { kind: "number", value: 9 } }),
		);

		expect(display.metaText).toBe("9");
	});

	it("has no meta text when every part is absent or null", () => {
		const display = describeProviderSearchItem(
			item({
				calloutProperty: { kind: "null", value: null },
				primarySubtitleProperty: { kind: "null", value: null },
			}),
		);

		expect(display.metaText).toBeUndefined();
	});
});
