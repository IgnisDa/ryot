import { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createMediaImportRunBody, MediaCreateImportRunBody } from "./import-sources";

it("builds a typed media request accepted by the open import envelope", () => {
	const body = createMediaImportRunBody({
		source: "igdb",
		uploadToken: "upload-1",
		collection: "Favorites",
	});

	expect(Schema.decodeUnknownSync(CreateImportRunBody)(body)).toEqual(body);
	expect(body.collection).toBe("Favorites");
});

it("keeps media-specific request validation in the media plugin", () => {
	expect(() =>
		Schema.decodeUnknownSync(MediaCreateImportRunBody)({ source: "igdb", uploadToken: "upload-1" }),
	).toThrow();
});

it("accepts unknown JSON-compatible sources only through the generic envelope", () => {
	expect(
		Schema.decodeUnknownSync(CreateImportRunBody)({
			source: "fixture_source",
			options: { dryRun: true, limit: 10 },
		}),
	).toEqual({ source: "fixture_source", options: { dryRun: true, limit: 10 } });
	expect(() =>
		Schema.decodeUnknownSync(CreateImportRunBody)({ source: "", value: "invalid" }),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(CreateImportRunBody)({ source: "fixture_source", value: Number.NaN }),
	).toThrow();
});
