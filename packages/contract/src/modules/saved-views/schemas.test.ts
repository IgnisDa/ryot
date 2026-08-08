import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SavedViewCardMapping, SavedViewTableMapping } from "./schemas";

describe("saved-view mappings", () => {
	it("decodes persisted display metadata", () => {
		expect(
			Result.getOrThrow(
				Schema.decodeUnknownResult(SavedViewCardMapping)({
					callout: null,
					imageField: null,
					titleField: "title",
					overline: { field: "overline", displayKind: "text" },
					primaryMetadata: { field: "year", displayKind: "number" },
					secondaryMetadata: { field: "published", displayKind: "date" },
				}),
			),
		).toMatchObject({ primaryMetadata: { displayKind: "number" } });

		expect(
			Result.getOrThrow(
				Schema.decodeUnknownResult(SavedViewTableMapping)({
					imageField: null,
					columns: [{ field: "details", label: "Details", displayKind: "json" }],
				}),
			),
		).toMatchObject({ columns: [{ displayKind: "json" }] });
	});

	it("rejects legacy field-only mappings", () => {
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(SavedViewCardMapping)({
					imageField: null,
					titleField: "title",
					calloutField: null,
					overlineField: "overline",
					primaryMetadataField: null,
					secondaryMetadataField: null,
				}),
			),
		).toBe(true);
	});
});
