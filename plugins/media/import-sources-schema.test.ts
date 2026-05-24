import { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createMediaImportRunBody, MediaCreateImportRunBody } from "./import-sources";
import { TraktImportParserInput } from "./imports/schemas";

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

it("accepts explicit Trakt user and list requests", () => {
	const user = createMediaImportRunBody({ mode: "user", source: "trakt", username: "alice" });
	const list = createMediaImportRunBody({
		mode: "list",
		source: "trakt",
		collection: "Favorites",
		url: "https://trakt.tv/users/alice/lists/favorites",
	});

	expect(Schema.decodeUnknownSync(MediaCreateImportRunBody)(user)).toEqual(user);
	expect(Schema.decodeUnknownSync(MediaCreateImportRunBody)(list)).toEqual(list);
});

it.each([
	["legacy user request", { source: "trakt", username: "alice" }],
	["user request without a username", { source: "trakt", mode: "user" }],
	[
		"mixed user and list request",
		{
			mode: "user",
			source: "trakt",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	[
		"list request without a collection",
		{ source: "trakt", mode: "list", url: "https://trakt.tv/users/alice/lists/favorites" },
	],
	[
		"mixed list and user request",
		{
			mode: "list",
			source: "trakt",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	[
		"list request with an invalid URL",
		{ source: "trakt", mode: "list", url: "not-a-url", collection: "Favorites" },
	],
])("rejects $0", (_, body) => {
	expect(() => Schema.decodeUnknownSync(MediaCreateImportRunBody)(body)).toThrow();
});

it("keeps Trakt parser input aligned with the explicit modes", () => {
	const user = { start: 0, limit: 25, mode: "user", username: "alice" } as const;
	const list = {
		start: 0,
		limit: 25,
		mode: "list",
		collection: "Favorites",
		url: "https://trakt.tv/users/alice/lists/favorites",
	} as const;

	expect(Schema.decodeUnknownSync(TraktImportParserInput)(user)).toEqual(user);
	expect(Schema.decodeUnknownSync(TraktImportParserInput)(list)).toEqual(list);
	expect(() =>
		Schema.decodeUnknownSync(TraktImportParserInput)({ start: 0, limit: 25, username: "alice" }),
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
