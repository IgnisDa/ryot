import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import { mediaFilesystem } from "../../imports/ingestion.test-support";
import { runIntegrationTestScript } from "../artifacts.test-support";
import definition, { mangaRef, manifest } from "./komga.sandbox";

const mangaLink = { label: "AniList", url: "https://anilist.co/manga/30002" };
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const bookLink = { label: "OpenLibrary", url: "https://openlibrary.org/works/OL45804W/Dune" };
const book = (
	id: string,
	link = mangaLink,
	number = "12",
	readProgress: JsonValue = { page: 25, completed: false },
) => ({
	id,
	readProgress,
	media: { pagesCount: 100 },
	metadata: { number, title: id, links: [link] },
});

const setup = (responses: Array<JsonValue | Error>, syncOwnership = false) => {
	const calls: Array<Parameters<ScriptHost["httpCall"]>> = [];
	const host = defineSandboxTestHost(manifest, {
		getPluginConfig: () => hostSuccess({ hardcoverApiKey: "hardcover-key" }),
		getCurrentIntegration: () =>
			hostSuccess(
				integrationRecord({
					syncOwnership,
					provider: "komga",
					providerSpecifics: { apiKey: "komga-key", baseUrl: "http://komga.test/" },
				}),
			),
		httpCall: (...args) =>
			Effect.suspend(() => {
				calls.push(args);
				const response = responses.shift();
				return response === undefined || response instanceof Error
					? hostFailure("Request failed")
					: httpSuccess(response);
			}),
	});
	return { host, calls };
};

describe("Komga provider links", () => {
	it.each([
		["AniList", "https://anilist.co/manga/30002/berserk", "manga.anilist", "manga", "30002"],
		["mAl", "https://myanimelist.net/manga/2/Berserk", "manga.myanimelist", "manga", "2"],
		[
			"MangaUpdates",
			"https://www.mangaupdates.com/series/pb8uwds/one-piece",
			"manga.manga-updates",
			"manga",
			"55099564912",
		],
		["Hardcover", "https://hardcover.app/books/123", "book.hardcover", "book", "123"],
		[
			"OpenLibrary",
			"https://openlibrary.org/works/OL45804W/Dune",
			"book.openlibrary",
			"book",
			"OL45804W",
		],
		[
			"GoogleBooks",
			"https://books.google.com/books?id=volume_1-2&printsec=frontcover",
			"book.google-books",
			"book",
			"volume_1-2",
		],
		[
			"gOoGlE bOoKs",
			"https://books.google.co.in/books/edition/Dune/volume_1-2",
			"book.google-books",
			"book",
			"volume_1-2",
		],
	])(
		"maps %s links to the defining provider identifier",
		(label, url, providerSlug, entitySchemaSlug, externalId) => {
			expect(mangaRef([{ url, label }], "Title")).toEqual({
				externalId,
				providerSlug,
				kind: "resolved",
				entitySchemaSlug,
				sourceLabel: "Title",
			});
		},
	);

	it.each([
		["AniList", "https://anilist.co.evil.test/manga/30002"],
		["AniList", "https://evil.test/?link=anilist.co/manga/30002"],
		["AniList", "https://anilist.co/manga/12wrong"],
		["AniList", "https://anilist.co/anime/30002"],
		["Hardcover", "https://hardcover.app/books/dune"],
		["OpenLibrary", "https://openlibrary.org/books/OL123M/Dune"],
		["GoogleBooks", "https://books.google.com/books?id="],
		["MangaUpdates", "https://mangaupdates.com/series/zzzzzzzzzzzzzzzz"],
		["MangaUpdates", "https://mangaupdates.com/series.html?id=71967"],
		["AniList", "not a URL"],
	])("does not guess an identifier from %s %s", (label, url) => {
		expect(mangaRef([{ url, label }], "Title")).toBeNull();
	});

	it("continues past invalid links to the first supported identifier", () => {
		expect(mangaRef([{ url: "bad", label: "Hardcover" }, mangaLink], "Title")).toMatchObject({
			externalId: "30002",
			providerSlug: "manga.anilist",
		});
	});
});

describe("Komga collection", () => {
	it.live("posts a bounded search with API-key auth", () =>
		Effect.gen(function* () {
			const { host, calls } = setup([
				{ totalPages: 1, content: [book("chapter-13", mangaLink, "13")] },
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(calls).toEqual([
				[
					"POST",
					"http://komga.test/api/v1/books/list?page=0&size=500",
					{
						body: encodeJson({
							condition: { readStatus: { operator: "is", value: "IN_PROGRESS" } },
						}),
						headers: {
							"X-API-Key": "komga-key",
							Accept: "application/json",
							"Content-Type": "application/json",
						},
					},
				],
			]);
			expect(result.failures).toEqual([]);
		}),
	);

	it.live("writes the previous chapter for a partly read manga chapter and no percent", () =>
		Effect.gen(function* () {
			const { host } = setup([{ content: [book("partial", mangaLink, "12")] }]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups.map(({ events }) => events[0]?.properties)).toEqual([
				{ mangaChapter: 11, consumedOn: "Komga" },
			]);
		}),
	);

	it.live("writes the chapter itself once it is fully read", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [
						book("whole", mangaLink, "12", { page: 100, completed: false }),
						book("fractional", mangaLink, "12.5", { page: 100, completed: false }),
					],
				},
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups.map(({ events }) => events[0]?.properties)).toEqual([
				{ mangaChapter: 12, consumedOn: "Komga" },
				{ mangaChapter: 12.5, consumedOn: "Komga" },
			]);
		}),
	);

	it.live("skips partly read first, fractional, and malformed manga chapters", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [
						book("first", mangaLink, "1"),
						book("fractional", mangaLink, "12.5"),
						book("zero", mangaLink, "0"),
						book("missing", mangaLink, ""),
						book("special", mangaLink, "12 extra"),
						book("negative", mangaLink, "-1"),
						book("book", bookLink, "12"),
					],
				},
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups.map(({ events }) => events[0]?.properties)).toEqual([
				{ consumedOn: "Komga", progressPercent: 25 },
			]);
			expect(result.entityGroups.map(({ entityRef }) => entityRef.entitySchemaSlug)).toEqual([
				"book",
			]);
		}),
	);

	it.live("resolves Hardcover slugs to numeric IDs with a parameterized exact lookup", () =>
		Effect.gen(function* () {
			const { host, calls } = setup([
				{
					content: [book("Dune", { label: "Hardcover", url: "https://hardcover.app/books/dune" })],
				},
				{ data: { books: [{ id: 123 }] } },
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups[0]?.entityRef).toEqual({
				kind: "resolved",
				externalId: "123",
				sourceLabel: "Dune",
				entitySchemaSlug: "book",
				providerSlug: "book.hardcover",
			});
			expect(calls[1]).toEqual([
				"POST",
				"https://api.hardcover.app/v1/graphql",
				{
					headers: { Authorization: "hardcover-key", "Content-Type": "application/json" },
					body: encodeJson({
						variables: { slug: "dune" },
						query:
							"query KomgaHardcoverBook($slug: String!) { books(where: { slug: { _eq: $slug } }) { id } }",
					}),
				},
			]);
		}),
	);

	it.live("does not guess a Hardcover numeric ID when the slug lookup is ambiguous", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [book("Dune", { label: "Hardcover", url: "https://hardcover.app/books/dune" })],
				},
				{ data: { books: [{ id: 123 }, { id: 456 }] } },
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toMatchObject([{ itemIndex: 0, stage: "input_transformation" }]);
		}),
	);

	it.live(
		"resolves a legacy MangaUpdates query through its canonical URL rather than reusing its old ID",
		() =>
			Effect.gen(function* () {
				const { host, calls } = setup([
					{
						content: [
							book("legacy", {
								label: "MangaUpdates",
								url: "https://www.mangaupdates.com/series.html?id=71967",
							}),
						],
					},
					'<html><head><link rel="canonical" href="https://www.mangaupdates.com/series/ttaew4a/title"></head></html>',
				]);
				const result = yield* runIntegrationTestScript(definition, {}, host, execution);
				expect(calls[1]).toEqual(["GET", "https://www.mangaupdates.com/series.html?id=71967"]);
				expect(result.entityGroups[0]?.entityRef).toMatchObject({
					externalId: "64897697818",
					providerSlug: "manga.manga-updates",
				});
			}),
	);

	it.live("does not map a legacy MangaUpdates query to an unrelated numeric API ID", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [
						book("legacy", {
							label: "MangaUpdates",
							url: "https://mangaupdates.com/series.html?id=71967",
						}),
					],
				},
				'<html><head><link rel="canonical" href="https://evil.test/series/ttaew4a"></head></html>',
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toMatchObject([
				{ itemIndex: 0, sourceIdentifier: "legacy", stage: "input_transformation" },
			]);
		}),
	);

	it.live("keeps progress and ownership separate across bounded page continuations", () =>
		Effect.gen(function* () {
			const { host, calls } = setup(
				[
					{ totalPages: 2, content: [book("manga")] },
					{ totalPages: 2, content: [book("book", bookLink)] },
					{ totalPages: 2, content: [book("unread-manga", mangaLink, "1", null)] },
					{
						totalPages: 2,
						content: [book("finished-book", bookLink, "1", { page: 100, completed: true })],
					},
				],
				true,
			);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(calls.map(([, url]) => url)).toEqual([
				"http://komga.test/api/v1/books/list?page=0&size=500",
				"http://komga.test/api/v1/books/list?page=1&size=500",
				"http://komga.test/api/v1/books/list?page=0&size=500",
				"http://komga.test/api/v1/books/list?page=1&size=500",
			]);
			expect(calls.map(([, , options]) => options?.body)).toEqual([
				encodeJson({ condition: { readStatus: { operator: "is", value: "IN_PROGRESS" } } }),
				encodeJson({ condition: { readStatus: { operator: "is", value: "IN_PROGRESS" } } }),
				"{}",
				"{}",
			]);
			expect(result.entityGroups).toMatchObject([
				{
					itemIndex: 0,
					entityRef: { entitySchemaSlug: "manga" },
					events: [{ eventSchemaSlug: "progress" }],
				},
				{
					itemIndex: 1,
					entityRef: { entitySchemaSlug: "book" },
					events: [{ eventSchemaSlug: "progress" }],
				},
				{
					events: [],
					itemIndex: 2,
					ownershipProvider: "komga",
					entityRef: { entitySchemaSlug: "manga" },
				},
				{
					events: [],
					itemIndex: 3,
					ownershipProvider: "komga",
					entityRef: { entitySchemaSlug: "book" },
				},
			]);
		}),
	);

	it.live("attributes a metadata lookup failure to its item and keeps later progress", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [
						book("broken", { label: "Hardcover", url: "https://hardcover.app/books/dune" }),
						book("working"),
					],
				},
				new Error("Provider unavailable"),
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.failures).toMatchObject([
				{
					itemIndex: 0,
					stage: "source_fetch",
					sourceIdentifier: "broken",
					message: "Failed to resolve Komga metadata-provider link",
				},
			]);
			expect(result.entityGroups).toMatchObject([
				{ itemIndex: 1, entityRef: { externalId: "30002" } },
			]);
		}),
	);

	it.live("retains acceptance time when a continuation has a later execution start", () =>
		Effect.gen(function* () {
			const { host, calls } = setup([
				{ totalPages: 2, content: [book("first")] },
				{ totalPages: 2, content: [book("second")] },
			]);
			const fs = mediaFilesystem({});
			const first = yield* definition.run({}, host, execution);
			expect(calls).toHaveLength(1);
			if (!first.carryFile) {
				throw new Error("Missing continuation");
			}
			const carry = fs.scratch.get(first.carryFile);
			if (!carry) {
				throw new Error("Missing continuation bytes");
			}
			fs.files.set("carry", carry);
			const second = yield* definition.run(
				{ ingestionArtifacts: { runId: "run", captures: { carry: "carry" } } },
				host,
				{ ...execution, startedAt: "2026-01-02T00:00:00.000Z" },
			);
			expect(second.carryFile).toBeNull();
			expect(
				(yield* fs.records()).flatMap(
					({ group }) => group?.events.map(({ occurredAt }) => occurredAt) ?? [],
				),
			).toEqual([execution.startedAt]);
		}),
	);

	it.live("skips unread and completed progress and reports unsupported links per item", () =>
		Effect.gen(function* () {
			const { host } = setup([
				{
					content: [
						book("null", mangaLink, "1", null),
						book("unread", mangaLink, "1", { page: 0 }),
						book("complete", mangaLink, "1", { page: 100, completed: true }),
						book("unresolved", { label: "Unsupported", url: "https://example.com/1" }),
						book("working"),
					],
				},
			]);
			const result = yield* runIntegrationTestScript(definition, {}, host, execution);
			expect(result.entityGroups).toMatchObject([{ itemIndex: 4 }]);
			expect(result.failures).toMatchObject([
				{ itemIndex: 3, stage: "input_transformation", sourceIdentifier: "unresolved" },
			]);
		}),
	);
});
